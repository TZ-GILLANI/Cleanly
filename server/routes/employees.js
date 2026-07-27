import { Router } from "express";
import { query } from "../db.js";
import { notify } from "../lib/notify.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

/* GET /api/employees — company's own staff */
router.get("/", requireAuth, requireRole("company"), async (req, res) => {
  try {
    const result = await query(
      "SELECT id, full_name, phone, is_active, company_id, created_at FROM users WHERE company_id = $1 AND role = 'employee' AND approval_status = 'approved' ORDER BY full_name ASC",
      [req.user.companyId]
    );
    res.json({ employees: result.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch employees" });
  }
});

/* GET /api/employees/invites */
router.get("/invites", requireAuth, requireRole("company"), async (req, res) => {
  try {
    const result = await query(
      "SELECT * FROM invite_codes WHERE company_id = $1 ORDER BY created_at DESC",
      [req.user.companyId]
    );
    res.json({ invites: result.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch invites" });
  }
});

/* Generate a clean, fixed-length, unambiguous invite/reference code (e.g. SPARK-7K4D). */
const INVITE_WORDS = ["SPARK", "CLEAN", "FRESH", "MINT", "SHINE", "GLEAM", "CRISP", "PURE"];
const INVITE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I/L
function makeInviteCode() {
  const word = INVITE_WORDS[Math.floor(Math.random() * INVITE_WORDS.length)];
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += INVITE_CHARS[Math.floor(Math.random() * INVITE_CHARS.length)];
  return `${word}-${suffix}`;
}

/* POST /api/employees/invites */
router.post("/invites", requireAuth, requireRole("company"), async (req, res) => {
  const { label } = req.body;
  try {
    // retry on the (rare) chance of a primary-key collision
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = makeInviteCode();
      const dupe = await query("SELECT 1 FROM invite_codes WHERE code = $1", [code]);
      if (dupe.rows.length) continue;
      const result = await query(
        "INSERT INTO invite_codes (code, company_id, label) VALUES ($1,$2,$3) RETURNING *",
        [code, req.user.companyId, label || null]
      );
      return res.status(201).json({ invite: result.rows[0] });
    }
    res.status(500).json({ error: "Could not generate a unique code, please try again" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create invite" });
  }
});

/* DELETE /api/employees/invites/:code */
router.delete("/invites/:code", requireAuth, requireRole("company"), async (req, res) => {
  try {
    const invite = await query("SELECT * FROM invite_codes WHERE code = $1", [req.params.code]);
    if (!invite.rows.length) return res.status(404).json({ error: "Invite not found" });
    if (invite.rows[0].company_id !== req.user.companyId) return res.status(403).json({ error: "Forbidden" });
    if (invite.rows[0].used_by) return res.status(400).json({ error: "Cannot revoke a used invite" });
    await query("DELETE FROM invite_codes WHERE code = $1", [req.params.code]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete invite" });
  }
});

/* DELETE /api/employees/:id — remove a cleaner from the company.
   Deactivates the account, detaches it from the company, and unassigns
   any not-yet-completed jobs so they return to the company pool. */
router.delete("/:id", requireAuth, requireRole("company"), async (req, res) => {
  try {
    const emp = await query(
      "SELECT id, full_name FROM users WHERE id = $1 AND company_id = $2 AND role = 'employee'",
      [req.params.id, req.user.companyId]
    );
    if (!emp.rows.length) return res.status(404).json({ error: "Cleaner not found in your team" });
    await query("UPDATE bookings SET assigned_to = NULL, status = 0 WHERE assigned_to = $1 AND status IN (1, 2, 3)", [req.params.id]);
    await query("UPDATE users SET is_active = false, company_id = NULL WHERE id = $1", [req.params.id]);
    res.json({ ok: true, removed: emp.rows[0].full_name });
  } catch (err) {
    console.error("remove employee:", err);
    res.status(500).json({ error: "Could not remove cleaner" });
  }
});

/* GET /api/employees/pending — cleaners who used our invite code, awaiting approval */
router.get("/pending", requireAuth, requireRole("company"), async (req, res) => {
  try {
    const r = await query(
      "SELECT id, full_name, email, phone, documents, created_at FROM users WHERE company_id = $1 AND role = 'employee' AND approval_status = 'pending' ORDER BY created_at DESC",
      [req.user.companyId]
    );
    res.json({ pending: r.rows });
  } catch (e) { res.status(500).json({ error: "Failed to load pending cleaners" }); }
});

/* PUT /api/employees/:id/approval — company approves or rejects a cleaner */
router.put("/:id/approval", requireAuth, requireRole("company"), async (req, res) => {
  const decision = req.body?.decision;
  if (!["approved", "rejected"].includes(decision)) return res.status(400).json({ error: "Invalid decision" });
  try {
    const r = await query(
      "UPDATE users SET approval_status = $1 WHERE id = $2 AND company_id = $3 AND role = 'employee' RETURNING id, full_name",
      [decision, req.params.id, req.user.companyId]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Cleaner not found in your team" });
    notify(r.rows[0].id, "approval",
      decision === "approved" ? "You're approved" : "Application declined",
      decision === "approved" ? "Your company approved you — log in to see your jobs." : "Your company declined your application.",
      null).catch(() => {});
    res.json({ ok: true, employee: r.rows[0] });
  } catch (e) { res.status(500).json({ error: "Could not update cleaner" }); }
});

export default router;
