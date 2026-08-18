import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { logAdmin } from "../lib/adminlog.js";

const router = Router();

/* ─────────────────────────────────────────────────────────────────────────
   Reporting a customer.

   Everything else in Cleano runs one way: customers rate companies, customers
   complain about companies. A company that sent someone into an abusive
   household, or drove to an empty flat, had nowhere to put that — and no record
   if the same address did it again next month.

   Deliberate design choices:
     · The customer is never told, and never sees it. This is a safety channel
       between the partner and the platform, not a public rating. Telling
       someone they were reported for abuse is how you escalate abuse.
     · A company can only report a customer it has actually worked for.
     · Nothing is automatic. A report does not suspend anybody — an admin reads
       it and decides. Automated punishment on an unverified accusation would be
       worse than the problem.
   ───────────────────────────────────────────────────────────────────────── */

const CATEGORIES = ["abusive", "absent", "unsafe", "payment", "other"];

/* POST /api/customer-reports — a company reports a customer */
router.post("/", requireAuth, requireRole("company"), async (req, res) => {
  try {
    const bookingId = String(req.body?.bookingId || "").trim();
    const category = String(req.body?.category || "other");
    const detail = String(req.body?.detail || "").trim();

    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: "Unknown category" });
    if (detail.length < 10) return res.status(400).json({ error: "Please describe what happened — at least a sentence" });
    if (detail.length > 2000) return res.status(400).json({ error: "That is too long" });

    /* You may only report someone you actually worked for. */
    const b = await query(
      "SELECT id, customer_id, company_id FROM bookings WHERE id = $1 AND company_id = $2",
      [bookingId, req.user.companyId]);
    if (!b.rows.length) return res.status(404).json({ error: "That booking is not yours" });
    const booking = b.rows[0];

    const dup = await query(
      "SELECT id FROM customer_reports WHERE booking_id = $1 AND company_id = $2",
      [bookingId, req.user.companyId]);
    if (dup.rows.length) return res.status(400).json({ error: "You have already reported this booking" });

    const r = await query(
      `INSERT INTO customer_reports (booking_id, customer_id, company_id, reported_by, category, detail)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
      [bookingId, booking.customer_id, req.user.companyId, req.user.id, category, detail]);

    /* Tell the CEO immediately — a safety report should not sit in a queue
       nobody has thought to open. */
    try {
      const { alert } = await import("../lib/alerts.js");
      alert("customer-report", "A company reported a customer",
        `Category: ${category}\nBooking: ${bookingId}\n\n${detail.slice(0, 500)}`);
    } catch {}

    res.status(201).json({ report: r.rows[0] });
  } catch (e) {
    console.error("customer report:", e.message);
    res.status(500).json({ error: "Could not file the report" });
  }
});

/* GET /api/customer-reports/mine — what this company has reported */
router.get("/mine", requireAuth, requireRole("company"), async (req, res) => {
  try {
    const r = await query(
      `SELECT cr.id, cr.category, cr.detail, cr.status, cr.created_at, b.order_no
         FROM customer_reports cr LEFT JOIN bookings b ON b.id = cr.booking_id
        WHERE cr.company_id = $1 ORDER BY cr.created_at DESC LIMIT 100`, [req.user.companyId]);
    res.json({ reports: r.rows });
  } catch (e) {
    console.error("my customer reports:", e.message);
    res.status(500).json({ error: "Could not load your reports" });
  }
});

/* GET /api/customer-reports — the admin queue, newest first */
router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const r = await query(
      `SELECT cr.id, cr.category, cr.detail, cr.status, cr.admin_note, cr.created_at, cr.handled_at,
              cr.customer_id, b.order_no, b.scheduled_date,
              c.name AS company_name,
              CASE WHEN u.deleted_name IS NOT NULL THEN 'Cleano customer' ELSE u.full_name END AS customer_name,
              u.email AS customer_email
         FROM customer_reports cr
         LEFT JOIN bookings b ON b.id = cr.booking_id
         LEFT JOIN companies c ON c.id = cr.company_id
         LEFT JOIN users u ON u.id = cr.customer_id
        ORDER BY (cr.status = 'open') DESC, cr.created_at DESC LIMIT 200`);

    /* How many times each of these people has been reported. Done as a second
       grouped query rather than a correlated subselect — it plans better, and a
       repeat offender is the single most useful thing on this screen. */
    const counts = await query(
      "SELECT customer_id, COUNT(*)::int AS n FROM customer_reports GROUP BY customer_id");
    const byCustomer = Object.fromEntries(counts.rows.map((x) => [x.customer_id, x.n]));
    res.json({ reports: r.rows.map((x) => ({ ...x, reports_about_them: byCustomer[x.customer_id] || 1 })) });
  } catch (e) {
    console.error("customer report queue:", e.message);
    res.status(500).json({ error: "Could not load the queue" });
  }
});

/* POST /api/customer-reports/:id/handle — admin records a decision */
router.post("/:id/handle", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const decision = String(req.body?.decision || "");
    const note = String(req.body?.note || "").trim().slice(0, 1000);
    if (!["reviewed", "dismissed"].includes(decision)) return res.status(400).json({ error: "Decision must be reviewed or dismissed" });
    if (note.length < 5) return res.status(400).json({ error: "Write a short note — this is on the record" });

    const r = await query(
      `UPDATE customer_reports SET status = $1, admin_note = $2, handled_by = $3, handled_at = NOW()
        WHERE id = $4 RETURNING id, customer_id`,
      [decision, note, req.user.id, req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: "Report not found" });

    try {
      await logAdmin(req, "customer_report." + decision, "customer_report", req.params.id, note);
    } catch {}
    res.json({ ok: true });
  } catch (e) {
    console.error("handle customer report:", e.message);
    res.status(500).json({ error: "Could not save that" });
  }
});

export default router;
