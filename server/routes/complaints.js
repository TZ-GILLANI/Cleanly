import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

/* POST /api/complaints — any signed-in user */
router.post("/", requireAuth, async (req, res) => {
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

/* GET /api/complaints — admin sees all, users see their own */
router.get("/", requireAuth, async (req, res) => {
  try {
    const r = req.user.role === "admin"
      ? await query("SELECT c.*, u.full_name AS user_name, u.email AS user_email FROM complaints c JOIN users u ON u.id = c.user_id ORDER BY CASE WHEN c.status = 'resolved' THEN 1 ELSE 0 END, c.created_at DESC")
      : await query("SELECT * FROM complaints WHERE user_id = $1 ORDER BY created_at DESC", [req.user.id]);
    res.json({ complaints: r.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch complaints" });
  }
});

/* PUT /api/complaints/:id — admin only */
router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const { status, resolution } = req.body || {};
  if (!["open", "in_progress", "resolved"].includes(status)) return res.status(400).json({ error: "Invalid status" });
  try {
    const r = await query(
      "UPDATE complaints SET status = $1, resolution = COALESCE($2, resolution), resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() ELSE resolved_at END WHERE id = $3 RETURNING *",
      [status, resolution || null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Not found" });
    res.json({ complaint: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to update complaint" });
  }
});

export default router;
