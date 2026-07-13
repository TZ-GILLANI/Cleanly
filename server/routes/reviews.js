import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

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

export default router;
