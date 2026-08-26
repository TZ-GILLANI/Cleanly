import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { rateLimit } from "./auth.js";

const router = Router();

/* GET /api/reviews — public */
router.get("/", async (req, res) => {
  try {
    const result = await query(
      /* Explicit columns, not r.* — the row also holds customer_id, the reason a
         company gave when reporting, and who removed it. None of that is the
         public's business, and crucially the cleaner is never named to customers:
         a review is of the COMPANY. */
      /* booking_id was missing from this list.

         The app decides whether to show "Rate this clean" with
         reviews.some(r => r.booking_id === b.id). Without the column that is
         always false, so the button came back on every refresh — and since the
         app now polls every 25 seconds, it came back constantly, for a review
         the customer had already left. The server was refusing the duplicate
         all along; only the screen was wrong. */
      `SELECT r.id, r.booking_id, r.company_id, r.stars, r.body, r.body_i18n, r.created_at,
              u.full_name AS customer_name
         FROM reviews r JOIN users u ON u.id = r.customer_id
        WHERE r.removed_at IS NULL ORDER BY r.created_at DESC`
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
    /* 5.2 — reviews get translated too, so a German customer can read a Hungarian one. */
    (async () => {
      try {
        const { translateAll } = await import("../lib/translate.js");
        const row = result.rows[0];
        if (row.body) {
          const m = await translateAll(row.body, String(req.user?.lang || "hu").slice(0, 2));
          if (m) await query("UPDATE reviews SET body_i18n = $1 WHERE id = $2", [JSON.stringify(m), row.id]);
        }
      } catch (e) { console.error("review translate:", e.message); }
    })();
    res.status(201).json({ review: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to submit review" });
  }
});

/* GET /api/reviews/company — every review for my company, with the cleaner who did the job */
router.get("/company", requireAuth, requireRole("company"), async (req, res) => {
  try {
    const rows = await query(
      `SELECT rv.id, rv.stars AS rating, rv.body AS comment, rv.body_i18n, rv.created_at, rv.reported_at,
              cu.full_name AS customer_name,
              b.scheduled_date, b.service_snapshot,
              b.assigned_to AS cleaner_id,
              cl.full_name AS cleaner_name
       FROM reviews rv
       LEFT JOIN bookings b ON b.id = rv.booking_id
       LEFT JOIN users cu ON cu.id = rv.customer_id
       LEFT JOIN users cl ON cl.id = b.assigned_to
       WHERE rv.company_id = $1 AND rv.removed_at IS NULL
       ORDER BY rv.created_at DESC`,
      [req.user.companyId]
    );
    /* The company's own headline figure, read from the company row rather than
       recomputed here, so what the partner sees is exactly what customers see. */
    const co = await query("SELECT rating, review_count FROM companies WHERE id = $1", [req.user.companyId]);

    const byCleaner = {};
    for (const x of rows.rows) {
      const k = x.cleaner_id || "unassigned";
      if (!byCleaner[k]) byCleaner[k] = { cleanerId: x.cleaner_id, name: x.cleaner_name || "Not assigned", count: 0, total: 0 };
      byCleaner[k].count++; byCleaner[k].total += Number(x.rating) || 0;
    }
    const cleaners = Object.values(byCleaner).map((c) => ({ ...c, average: c.count ? Math.round((c.total / c.count) * 10) / 10 : 0 }))
      .sort((a, b2) => b2.count - a.count);
    res.json({
      reviews: rows.rows,
      cleaners,
      company: { rating: co.rows[0]?.rating ?? null, reviewCount: co.rows[0]?.review_count ?? 0 },
    });
  } catch (e) { console.error("company reviews:", e.message); res.status(500).json({ error: "Failed to load reviews" }); }
});


/* ── 5.3 Review moderation ─────────────────────────────────────────
   Companies can REPORT, never delete. Admins remove, and every removal is
   written to the admin log. Ratings only mean something if the people being
   rated can't quietly erase them.                                        */
router.post("/:id/report", requireAuth, requireRole("company"), async (req, res) => {
  try {
    const reason = String(req.body?.reason || "").trim().slice(0, 500);
    if (reason.length < 5) return res.status(400).json({ error: "Please say briefly what's wrong with it" });
    const r = await query(
      `UPDATE reviews SET reported_at = NOW(), reported_reason = $1
        WHERE id = $2 AND company_id = $3 AND removed_at IS NULL RETURNING id`,
      [reason, req.params.id, req.user.companyId]);
    if (!r.rows.length) return res.status(404).json({ error: "Review not found" });
    res.json({ reported: true });
  } catch { res.status(500).json({ error: "Could not report the review" }); }
});

/* Admin moderation queue */
router.get("/reported", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const r = await query(
      `SELECT r.id, r.stars AS rating, r.body AS comment, r.body_i18n, r.created_at, r.reported_at, r.reported_reason,
              u.full_name AS customer_name, c.name AS company_name
         FROM reviews r JOIN users u ON u.id = r.customer_id JOIN companies c ON c.id = r.company_id
        WHERE r.reported_at IS NOT NULL AND r.removed_at IS NULL
        ORDER BY r.reported_at DESC`);
    res.json({ reviews: r.rows });
  } catch { res.status(500).json({ error: "Could not load the queue" }); }
});

/* Admin decides the report was unfounded — the review stays, the flag clears. */
router.post("/:id/dismiss", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const r = await query(
      "UPDATE reviews SET reported_at = NULL, reported_reason = NULL WHERE id = $1 AND removed_at IS NULL RETURNING id",
      [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: "Review not found" });
    try { await logAdmin(req, "review.dismiss", "review", req.params.id, "report dismissed — review kept"); } catch {}
    res.json({ dismissed: true });
  } catch (e) { console.error("dismiss review:", e.message); res.status(500).json({ error: "Failed" }); }
});

/* Admin removes an abusive review — logged with who/when/why */
router.post("/:id/remove", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const reason = String(req.body?.reason || "").trim().slice(0, 500);
    if (reason.length < 5) return res.status(400).json({ error: "A reason is required — this is logged" });
    const before = await query("SELECT * FROM reviews WHERE id = $1", [req.params.id]);
    if (!before.rows.length) return res.status(404).json({ error: "Review not found" });
    await query("UPDATE reviews SET removed_at = NOW(), removed_by = $1, removed_reason = $2 WHERE id = $3",
      [req.user.id, reason, req.params.id]);
    try {
      const { logAdmin } = await import("../lib/adminlog.js");
      await logAdmin(req, "review.remove", "review", req.params.id,
        `stars=${before.rows[0].stars} reason="${reason}" body="${String(before.rows[0].body || "").slice(0, 120)}"`);
    } catch {}
    // Recompute the rating without it. The removal itself already succeeded, so a
    // failure here must not report failure to the admin — it would be removed twice.
    try {
      await query(
        `UPDATE companies SET rating = COALESCE((SELECT ROUND(AVG(stars)::numeric,1) FROM reviews WHERE company_id = $1 AND removed_at IS NULL),0),
           review_count = (SELECT COUNT(*) FROM reviews WHERE company_id = $1 AND removed_at IS NULL) WHERE id = $1`,
        [before.rows[0].company_id]);
    } catch (e) { console.error("rating recompute after removal:", e.message); }
    res.json({ removed: true });
  } catch { res.status(500).json({ error: "Could not remove the review" }); }
});

export default router;
