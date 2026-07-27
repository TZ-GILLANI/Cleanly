import { Router } from "express";
import { logAdmin } from "../lib/adminlog.js";
import { notify } from "../lib/notify.js";
import { query } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { rateLimit } from "./auth.js";

const router = Router();

/* Load a complaint and decide if the caller may see/act on it.
   Access: the customer who filed it, ANY admin, or the assigned company's owner. */
async function access(req, complaintId) {
  const r = await query("SELECT * FROM complaints WHERE id = $1", [complaintId]);
  if (!r.rows.length) return { code: 404 };
  const c = r.rows[0];
  const isAdmin = req.user.role === "admin";
  const isOwner = c.user_id === req.user.id;
  const isCompany = req.user.role === "company" && c.assigned_company_id && c.assigned_company_id === req.user.companyId;
  if (!isAdmin && !isOwner && !isCompany) return { code: 403 };
  return { c, isAdmin, isOwner, isCompany };
}

/* POST /api/complaints — any signed-in user files a report */
router.post("/", requireAuth, async (req, res) => {
  if (!rateLimit("complaint:" + req.user.id, 5, 60 * 60e3)) return res.status(429).json({ error: "Too many reports — try again later" });
  const { bookingId, subject, body } = req.body || {};
  if (!subject || !String(subject).trim()) return res.status(400).json({ error: "Subject is required" });
  try {
    if (bookingId) {
      const b = await query("SELECT 1 FROM bookings WHERE id = $1 AND (customer_id = $2 OR assigned_to = $2)", [bookingId, req.user.id]);
      if (!b.rows.length) return res.status(403).json({ error: "Not your booking" });
    }
    const r = await query(
      "INSERT INTO complaints (user_id, booking_id, subject, body) VALUES ($1,$2,$3,$4) RETURNING *",
      [req.user.id, bookingId || null, String(subject).slice(0, 200), body ? String(body).slice(0, 2000) : null]
    );
    res.status(201).json({ complaint: r.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to submit complaint" });
  }
});

/* GET /api/complaints — role-aware:
   admin => all, company => assigned to them, customer => their own */
router.get("/", requireAuth, async (req, res) => {
  try {
    let r;
    if (req.user.role === "admin") {
      r = await query("SELECT c.*, u.full_name AS user_name, u.email AS user_email, co.name AS assigned_company_name FROM complaints c JOIN users u ON u.id = c.user_id LEFT JOIN companies co ON co.id = c.assigned_company_id ORDER BY CASE WHEN c.status = 'resolved' THEN 1 ELSE 0 END, c.created_at DESC");
    } else if (req.user.role === "company") {
      r = await query("SELECT c.*, u.full_name AS user_name FROM complaints c JOIN users u ON u.id = c.user_id WHERE c.assigned_company_id = $1 ORDER BY CASE WHEN c.status = 'resolved' THEN 1 ELSE 0 END, c.created_at DESC", [req.user.companyId]);
    } else {
      r = await query("SELECT c.*, co.name AS assigned_company_name FROM complaints c LEFT JOIN companies co ON co.id = c.assigned_company_id WHERE c.user_id = $1 ORDER BY c.created_at DESC", [req.user.id]);
    }
    res.json({ complaints: r.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch complaints" });
  }
});

/* GET /api/complaints/:id/messages — the thread */
router.get("/:id/messages", requireAuth, async (req, res) => {
  const a = await access(req, req.params.id);
  if (a.code) return res.status(a.code).json({ error: a.code === 404 ? "Not found" : "Forbidden" });
  try {
    const r = await query("SELECT id, sender_id, sender_role, sender_name, body, created_at FROM complaint_messages WHERE complaint_id = $1 ORDER BY created_at ASC", [req.params.id]);
    res.json({ messages: r.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

/* POST /api/complaints/:id/messages — reply on the thread */
router.post("/:id/messages", requireAuth, async (req, res) => {
  if (!rateLimit("cmsg:" + req.user.id, 30, 10 * 60e3)) return res.status(429).json({ error: "Slow down a little — try again in a few minutes" });
  const { body } = req.body || {};
  if (!body || !String(body).trim()) return res.status(400).json({ error: "Message required" });
  const a = await access(req, req.params.id);
  if (a.code) return res.status(a.code).json({ error: a.code === 404 ? "Not found" : "Forbidden" });
  try {
    const me = await query("SELECT full_name FROM users WHERE id = $1", [req.user.id]);
    const name = me.rows[0]?.full_name || req.user.role;
    const r = await query(
      "INSERT INTO complaint_messages (complaint_id, sender_id, sender_role, sender_name, body) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [req.params.id, req.user.id, req.user.role, name, String(body).slice(0, 2000)]
    );
    // notify the other parties on the thread
    if (a.c.user_id !== req.user.id) notify(a.c.user_id, "complaint", "New reply on your report", String(body).slice(0, 130), null);
    if (a.c.assigned_company_id && !a.isCompany) {
      const oc = await query("SELECT owner_id FROM companies WHERE id = $1", [a.c.assigned_company_id]);
      if (oc.rows[0]) notify(oc.rows[0].owner_id, "complaint", "New message on an assigned issue", String(body).slice(0, 130), null);
    }
    res.status(201).json({ message: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to send message" });
  }
});

/* PUT /api/complaints/:id/assign — admin moves a complaint to a company to resolve */
router.put("/:id/assign", requireAuth, requireRole("admin"), async (req, res) => {
  const { companyId } = req.body || {};
  if (!companyId) return res.status(400).json({ error: "companyId required" });
  try {
    const c = await query("SELECT * FROM complaints WHERE id = $1", [req.params.id]);
    if (!c.rows.length) return res.status(404).json({ error: "Not found" });
    const co = await query("SELECT id, owner_id, name FROM companies WHERE id = $1", [companyId]);
    if (!co.rows.length) return res.status(400).json({ error: "Company not found" });
    const r = await query(
      "UPDATE complaints SET assigned_company_id = $1, status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END WHERE id = $2 RETURNING *",
      [companyId, req.params.id]
    );
    logAdmin(req, "complaint_assigned", "complaint", req.params.id, co.rows[0].name);
    notify(co.rows[0].owner_id, "complaint_assigned", "A complaint needs your attention", "Cleano assigned an issue to your company to resolve.", null);
    res.json({ complaint: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to assign complaint" });
  }
});

/* PUT /api/complaints/:id — update status/resolution. Admin OR the assigned company. */
router.put("/:id", requireAuth, async (req, res) => {
  const { status, resolution } = req.body || {};
  if (!["open", "in_progress", "resolved"].includes(status)) return res.status(400).json({ error: "Invalid status" });
  const a = await access(req, req.params.id);
  if (a.code) return res.status(a.code).json({ error: a.code === 404 ? "Not found" : "Forbidden" });
  if (!a.isAdmin && !a.isCompany) return res.status(403).json({ error: "Only Cleano or the assigned company can update this" });
  try {
    const r = await query(
      "UPDATE complaints SET status = $1, resolution = COALESCE($2, resolution), resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() ELSE resolved_at END WHERE id = $3 RETURNING *",
      [status, resolution || null, req.params.id]
    );
    if (a.isAdmin) logAdmin(req, `complaint_${status}`, "complaint", req.params.id, resolution || null);
    if (status === "resolved") notify(a.c.user_id, "complaint", "Your report was resolved ✓", resolution || "The issue has been resolved.", null);
    res.json({ complaint: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to update complaint" });
  }
});

/* PUT /api/complaints/:id/handling — CEO/admin decides who speaks to the customer:
   keep it in-house ("admin") or hand the conversation to the company. */
router.put("/:id/handling", requireAuth, requireRole("admin"), async (req, res) => {
  const to = req.body?.handledBy;
  if (!["admin", "company"].includes(to)) return res.status(400).json({ error: "Invalid handler" });
  try {
    const cur = await query("SELECT assigned_company_id, user_id FROM complaints WHERE id = $1", [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: "Not found" });
    if (to === "company" && !cur.rows[0].assigned_company_id)
      return res.status(400).json({ error: "Assign a company first, then hand the chat over." });

    const r = await query(
      `UPDATE complaints SET handled_by = $1,
              company_action = CASE WHEN $1 = 'admin' THEN NULL ELSE company_action END,
              status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END
       WHERE id = $2 RETURNING *`,
      [to, req.params.id]
    );
    // tell whoever now owns the conversation
    if (to === "company") {
      const oc = await query("SELECT owner_id FROM companies WHERE id = $1", [cur.rows[0].assigned_company_id]);
      if (oc.rows[0]) notify(oc.rows[0].owner_id, "complaint", "A report was handed to you",
        "Cleano passed a customer report to your company — open Issues to reply or call them back.", null).catch(() => {});
    }
    notify(cur.rows[0].user_id, "complaint",
      to === "company" ? "Your report was passed to the company" : "Cleano is handling your report",
      to === "company" ? "The cleaning company will reply to you here." : "Our team is looking after this personally.",
      null).catch(() => {});
    logAdmin(req, to === "company" ? "complaint_to_company" : "complaint_to_admin", "complaint", req.params.id, null);
    res.json({ complaint: r.rows[0] });
  } catch (e) { console.error("handling:", e.message); res.status(500).json({ error: "Could not change handler" }); }
});

/* PUT /api/complaints/:id/company-action — the company chooses how to handle it:
   solve it right here in chat, or call the customer back and report afterwards. */
router.put("/:id/company-action", requireAuth, requireRole("company"), async (req, res) => {
  const action = req.body?.action;
  const note = String(req.body?.note || "").slice(0, 1000);
  if (!["chat", "callback"].includes(action)) return res.status(400).json({ error: "Invalid action" });
  try {
    const cur = await query("SELECT assigned_company_id, user_id FROM complaints WHERE id = $1", [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: "Not found" });
    if (cur.rows[0].assigned_company_id !== req.user.companyId) return res.status(403).json({ error: "Not your report" });

    const r = await query(
      `UPDATE complaints SET company_action = $1, callback_note = $2,
              callback_at = CASE WHEN $1 = 'callback' THEN NOW() ELSE callback_at END
       WHERE id = $3 RETURNING *`,
      [action, note || null, req.params.id]
    );
    // the customer always hears what is happening
    await query(
      "INSERT INTO complaint_messages (complaint_id, sender_id, sender_role, body) VALUES ($1,$2,'company',$3)",
      [req.params.id, req.user.id,
       action === "callback"
         ? "We'll call you back about this shortly." + (note ? " " + note : "")
         : "We're looking into this and will reply here." + (note ? " " + note : "")]
    );
    notify(cur.rows[0].user_id, "complaint",
      action === "callback" ? "The company will call you" : "The company replied",
      action === "callback" ? "They'll phone you about your report shortly." : "Open your report to read their message.",
      null).catch(() => {});
    res.json({ complaint: r.rows[0] });
  } catch (e) { console.error("company-action:", e.message); res.status(500).json({ error: "Could not update" }); }
});

export default router;
