import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

/* GET /api/services — public: all active services */
router.get("/", async (req, res) => {
  try {
    const result = await query(
      "SELECT * FROM services WHERE is_active = true ORDER BY created_at ASC"
    );
    res.json({ services: result.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch services" });
  }
});

/* GET /api/services/company/:companyId — all (including hidden) for owner */
router.get("/company/:companyId", requireAuth, requireRole("company"), async (req, res) => {
  if (req.user.companyId !== req.params.companyId) return res.status(403).json({ error: "Forbidden" });
  try {
    const result = await query(
      "SELECT * FROM services WHERE company_id = $1 ORDER BY created_at ASC",
      [req.params.companyId]
    );
    res.json({ services: result.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch services" });
  }
});

/* POST /api/services */
router.post("/", requireAuth, requireRole("company"), async (req, res) => {
  const { name, description, icon, priceHuf, minutes, tasks, pricingType, hourlyRateHuf, minHours, maxHours, period, promoPct } = req.body;
  const promo = promoPct == null || promoPct === 0 || promoPct === "" ? null : parseInt(promoPct, 10);
  if (promo !== null && (!Number.isFinite(promo) || promo < 1 || promo > 90)) return res.status(400).json({ error: "Discount must be between 1% and 90%" });
  const ptype = pricingType || "flat";
  if (!name) return res.status(400).json({ error: "Name is required" });
  if (ptype === "hourly" && (hourlyRateHuf == null || hourlyRateHuf <= 0)) return res.status(400).json({ error: "Hourly rate is required" });
  if (ptype === "subscription" && (priceHuf == null || !period)) return res.status(400).json({ error: "Subscription price and period are required" });
  if (ptype === "flat" && priceHuf == null) return res.status(400).json({ error: "Price is required" });

  try {
    const result = await query(
      `INSERT INTO services
        (company_id, name, description, icon, price_huf, minutes, tasks, pricing_type, hourly_rate_huf, min_hours, max_hours, period, promo_pct)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [req.user.companyId, name, description, icon || "🏠", priceHuf || 0, minutes || 120, JSON.stringify(tasks || []),
       ptype, ptype === "hourly" ? hourlyRateHuf : null, minHours || 2, maxHours || 8, ptype === "subscription" ? period : null, promo]
    );
    res.status(201).json({ service: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create service" });
  }
});

/* PUT /api/services/:id */
router.put("/:id", requireAuth, requireRole("company"), async (req, res) => {
  const { name, description, icon, priceHuf, minutes, tasks, isActive, pricingType, hourlyRateHuf, minHours, maxHours, period, promoPct } = req.body;
  let promoU;
  if (promoPct !== undefined) {
    promoU = promoPct == null || promoPct === 0 || promoPct === "" ? null : parseInt(promoPct, 10);
    if (promoU !== null && (!Number.isFinite(promoU) || promoU < 1 || promoU > 90)) return res.status(400).json({ error: "Discount must be between 1% and 90%" });
  }
  try {
    const existing = await query("SELECT company_id FROM services WHERE id = $1", [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: "Service not found" });
    if (existing.rows[0].company_id !== req.user.companyId) return res.status(403).json({ error: "Forbidden" });

    const result = await query(
      `UPDATE services SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        icon = COALESCE($3, icon),
        price_huf = COALESCE($4, price_huf),
        minutes = COALESCE($5, minutes),
        tasks = COALESCE($6, tasks),
        is_active = COALESCE($7, is_active),
        pricing_type = COALESCE($8, pricing_type),
        hourly_rate_huf = COALESCE($9, hourly_rate_huf),
        min_hours = COALESCE($10, min_hours),
        max_hours = COALESCE($11, max_hours),
        period = COALESCE($12, period),
        promo_pct = CASE WHEN $14::int = -1 THEN promo_pct WHEN $14::int = 0 THEN NULL ELSE $14::int END
      WHERE id = $13 RETURNING *`,
      [name, description, icon, priceHuf, minutes, tasks ? JSON.stringify(tasks) : null, isActive,
       pricingType, hourlyRateHuf, minHours, maxHours, period, req.params.id,
       promoU === undefined ? -1 : (promoU === null ? 0 : promoU)]
    );
    res.json({ service: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to update service" });
  }
});

export default router;
