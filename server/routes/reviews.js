import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { rateLimit } from "./auth.js";

const router = Router();

/* GET /api/reviews — public */
router.get("/", async (req, res) => {
  try {
    const result = await query(
      "SELECT r.*, u.full_name AS customer_name FROM reviews r JOIN users u ON u.id = r.customer_id ORDER BY r.created_at DESC"
    );
    res.json({ reviews: result.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

/* POST /api/reviews */
router.post("/", requireAuth, async (req, res) => {
  if (req.user.role !== "customer") return res.status(403).json({ error: "Customers only" });
  if (!rateLimit("review:" + req.user.id, 5, 60 * 60e3)) return res.status(429).json({ error: "Too many reviews — try again later" });
  const { bookingId, stars, body } = req.body;
  if (!bookingId || !stars) return res.status(400).json({ error: "Missing fields" });
  if (!(stars >= 1 && stars <= 5)) return res.status(400).json({ error: "Stars must be 1-5" });

  try {
    const booking = await query(
      "SELECT * FROM bookings WHERE id = $1 AND customer_id = $2 AND status = 4",
      [bookingId, req.user.id]
    );
    if (!booking.rows.length) return res.status(403).json({ error: "You can only review completed bookings" });

    const already = await query("SELECT id FROM reviews WHERE booking_id = $1", [bookingId]);
    if (already.rows.length) return res.status(400).json({ error: "Already reviewed" });

    // company_id comes from the booking row — never from the client
    const result = await query(
      "INSERT INTO reviews (booking_id, company_id, customer_id, stars, body) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [bookingId, booking.rows[0].company_id, req.user.id, Math.round(stars), body || null]
    );
    res.status(201).json({ review: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to submit review" });
  }
});

/* GET /api/reviews/company — every review for my company, with the cleaner who did the job */
router.get("/company", requireAuth, requireRole("company"), async (req, res) => {
  try {
    const rows = await query(
      `SELECT rv.id, rv.stars AS rating, rv.body AS comment, rv.created_at,
              cu.full_name AS customer_name,
              b.scheduled_date, b.service_snapshot,
              b.assigned_to AS cleaner_id,
              cl.full_name AS cleaner_name
       FROM reviews rv
       LEFT JOIN bookings b ON b.id = rv.booking_id
       LEFT JOIN users cu ON cu.id = rv.customer_id
       LEFT JOIN users cl ON cl.id = b.assigned_to
       WHERE rv.company_id = $1
       ORDER BY rv.created_at DESC`,
      [req.user.companyId]
    );
    const byCleaner = {};
    for (const x of rows.rows) {
      const k = x.cleaner_id || "unassigned";
      if (!byCleaner[k]) byCleaner[k] = { cleanerId: x.cleaner_id, name: x.cleaner_name || "Not assigned", count: 0, total: 0 };
      byCleaner[k].count++; byCleaner[k].total += Number(x.rating) || 0;
    }
    const cleaners = Object.values(byCleaner).map((c) => ({ ...c, average: c.count ? Math.round((c.total / c.count) * 10) / 10 : 0 }))
      .sort((a, b2) => b2.count - a.count);
    res.json({ reviews: rows.rows, cleaners });
  } catch (e) { console.error("company reviews:", e.message); res.status(500).json({ error: "Failed to load reviews" }); }
});

export default router;
