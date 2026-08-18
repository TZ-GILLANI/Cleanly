import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { translateAll, sourceChanged } from "../lib/translate.js";

/* 5.2 — translate the service name and description after saving, off the hot path. */
function translateService(row, lang) {
  if (!row) return;
  (async () => {
    try {
      const src = String(lang || "hu").slice(0, 2);
      if (row.name && sourceChanged(row.name_i18n, row.name)) {
        const m = await translateAll(row.name, src);
        if (m) await query("UPDATE services SET name_i18n = $1 WHERE id = $2", [JSON.stringify(m), row.id]);
      }
      if (row.description && sourceChanged(row.description_i18n, row.description)) {
        const m = await translateAll(row.description, src);
        if (m) await query("UPDATE services SET description_i18n = $1 WHERE id = $2", [JSON.stringify(m), row.id]);
      }
    } catch (e) { console.error("service translate:", e.message); }
  })();
}

/* One place for the rules, so create and update cannot drift apart. */
const PERIODS = ["weekly", "biweekly", "monthly"];
function validateService(b, ptype) {
  const num = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
  const price = num(b.priceHuf), rate = num(b.hourlyRateHuf);
  const mn = num(b.minHours), mx = num(b.maxHours), mins = num(b.minutes);
  if (price !== null && (!Number.isFinite(price) || price < 0 || price > 100_000_000)) return "Price must be a positive amount";
  if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 10_000_000)) return "Hourly rate must be a positive amount";
  if (mins !== null && (!Number.isFinite(mins) || mins < 5 || mins > 1440)) return "Duration must be between 5 and 1440 minutes";
  if (mn !== null && (!Number.isFinite(mn) || mn < 1 || mn > 24)) return "Minimum hours must be between 1 and 24";
  if (mx !== null && (!Number.isFinite(mx) || mx < 1 || mx > 24)) return "Maximum hours must be between 1 and 24";
  if (mn !== null && mx !== null && mn > mx) return "Minimum hours cannot be more than maximum hours";
  if (ptype === "subscription" && b.period !== undefined && !PERIODS.includes(b.period)) return "Billing period must be weekly, biweekly or monthly";
  if (b.pricingType !== undefined && !["flat", "hourly", "subscription", "unit"].includes(b.pricingType)) return "Unknown pricing model";
  if (b.fulfilment !== undefined && !["onsite", "collection"].includes(b.fulfilment)) return "Unknown fulfilment type";
  const up = num(b.unitPriceHuf), mnu = num(b.minUnits), mxu = num(b.maxUnits);
  if (up !== null && (!Number.isFinite(up) || up < 0 || up > 10_000_000)) return "Unit price must be a positive amount";
  if (mnu !== null && (!Number.isFinite(mnu) || mnu <= 0 || mnu > 100000)) return "Minimum quantity must be a positive number";
  if (mxu !== null && (!Number.isFinite(mxu) || mxu <= 0 || mxu > 100000)) return "Maximum quantity must be a positive number";
  if (mnu !== null && mxu !== null && mnu > mxu) return "Minimum quantity cannot be more than the maximum";
  if (b.unitLabel !== undefined && b.unitLabel !== null && String(b.unitLabel).trim().length > 12) return "Unit name is too long";
  const td = num(b.turnaroundDays);
  if (td !== null && (!Number.isFinite(td) || td < 0 || td > 60)) return "Turnaround must be between 0 and 60 days";
  const sc = num(b.slotCapacity);
  if (sc !== null && (!Number.isFinite(sc) || sc < 1 || sc > 100)) return "Jobs per hour must be between 1 and 100";
  return null;
}

const router = Router();

/* The notice a customer must tick before paying. The company has one that
   applies to everything it does; a service can add its own, because "leave the
   laundry bag outside the door" belongs to the laundry, not to the company.
   Same shape and same limits as the company list, so the two can be merged and
   shown as one. */
function cleanRequirements(v) {
  if (!Array.isArray(v)) return undefined;                 // undefined = leave alone
  return v.map((x) => String(x).trim().slice(0, 140)).filter(Boolean).slice(0, 8);
}


/* GET /api/services — public: all active services */
router.get("/", async (req, res) => {
  try {
    // Only services you could actually book: the company must be approved and listed.
    // Without the join this leaked the price list of every pending applicant.
    const result = await query(
      `SELECT s.* FROM services s
         JOIN companies c ON c.id = s.company_id
        WHERE s.is_active = true AND c.is_approved = true AND c.is_listed = true
        ORDER BY s.created_at ASC`
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
  const { requirements } = req.body;
  const { name, description, icon, priceHuf, minutes, tasks, pricingType, hourlyRateHuf, minHours, maxHours, period, promoPct,
          fulfilment, turnaroundDays, slotCapacity,
          unitLabel, unitPriceHuf, minUnits, maxUnits } = req.body;
  const promo = promoPct == null || promoPct === 0 || promoPct === "" ? null : parseInt(promoPct, 10);
  if (promo !== null && (!Number.isFinite(promo) || promo < 1 || promo > 90)) return res.status(400).json({ error: "Discount must be between 1% and 90%" });
  const ptype = pricingType || "flat";
  if (!name) return res.status(400).json({ error: "Name is required" });
  if (ptype === "hourly" && (hourlyRateHuf == null || hourlyRateHuf <= 0)) return res.status(400).json({ error: "Hourly rate is required" });
  if (ptype === "subscription" && (priceHuf == null || !period)) return res.status(400).json({ error: "Subscription price and period are required" });
  if (ptype === "flat" && priceHuf == null) return res.status(400).json({ error: "Price is required" });
  if (ptype === "unit" && (unitPriceHuf == null || unitPriceHuf <= 0 || !String(unitLabel || "").trim()))
    return res.status(400).json({ error: "A price per unit and a unit name (kg, m²…) are required" });
  const vErr = validateService(req.body, ptype);
  if (vErr) return res.status(400).json({ error: vErr });

  /* Cleano pays Stripe's processing cost out of its own commission so partners
     receive their listed price in full. Below a certain price the commission is
     smaller than Stripe's cut and that promise silently breaks — so we refuse
     the service rather than let a partner be short-changed later. Checked on the
     SMALLEST charge the service can produce. */
  {
    const { minimumServicePriceHuf } = await import("./payments.js");
    const floor = minimumServicePriceHuf();
    const smallest =
      ptype === "hourly" ? (Number(hourlyRateHuf) || 0) * (Number(minHours) || 2)
      : ptype === "unit" ? (Number(unitPriceHuf) || 0) * (Number(minUnits) || 1)
      : Number(priceHuf) || 0;
    if (smallest > 0 && smallest < floor) {
      return res.status(400).json({
        error: `The smallest charge for this service is ${smallest} Ft, which is below the ${floor} Ft minimum. Card processing costs more than our commission at that price.`,
      });
    }
  }

  try {
    const result = await query(
      `INSERT INTO services
        (company_id, name, description, icon, price_huf, minutes, tasks, pricing_type, hourly_rate_huf, min_hours, max_hours, period, promo_pct,
         fulfilment, turnaround_days, slot_capacity, unit_label, unit_price_huf, min_units, max_units, requirements)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
      [req.user.companyId, name, description, icon || "🏠", priceHuf || 0, minutes || 120, JSON.stringify(tasks || []),
       ptype, ptype === "hourly" ? hourlyRateHuf : null, minHours || 2, maxHours || 8, ptype === "subscription" ? period : null, promo,
       ["onsite", "collection"].includes(fulfilment) ? fulfilment : "onsite",
       turnaroundDays != null ? parseInt(turnaroundDays, 10) : 3,
       slotCapacity != null && slotCapacity !== "" ? parseInt(slotCapacity, 10) : null,
       ptype === "unit" ? String(unitLabel).trim().slice(0, 12) : null,
       ptype === "unit" ? parseInt(unitPriceHuf, 10) : null,
       ptype === "unit" ? (minUnits != null ? Number(minUnits) : 1) : null,
       ptype === "unit" ? (maxUnits != null ? Number(maxUnits) : 50) : null,
       (() => { const r = cleanRequirements(requirements); return r ? JSON.stringify(r) : null; })()]
    );
    translateService(result.rows[0], req.user?.lang);
    res.status(201).json({ service: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create service" });
  }
});

/* PUT /api/services/:id */
router.put("/:id", requireAuth, requireRole("company"), async (req, res) => {
  const { requirements } = req.body;
  const { name, description, icon, priceHuf, minutes, tasks, isActive, pricingType, hourlyRateHuf, minHours, maxHours, period, promoPct,
          fulfilment, turnaroundDays, slotCapacity,
          unitLabel, unitPriceHuf, minUnits, maxUnits } = req.body;
  let promoU;
  if (promoPct !== undefined) {
    promoU = promoPct == null || promoPct === 0 || promoPct === "" ? null : parseInt(promoPct, 10);
    if (promoU !== null && (!Number.isFinite(promoU) || promoU < 1 || promoU > 90)) return res.status(400).json({ error: "Discount must be between 1% and 90%" });
  }
  try {
    const existing = await query("SELECT company_id, pricing_type FROM services WHERE id = $1", [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: "Service not found" });
    if (existing.rows[0].company_id !== req.user.companyId) return res.status(403).json({ error: "Forbidden" });

    const vErr = validateService(req.body, pricingType || existing.rows[0].pricing_type);
    if (vErr) return res.status(400).json({ error: vErr });

    /* Changing the pricing model under people who are already subscribed leaves
       their plan pointing at a service that no longer works that way. Refuse. */
    if (pricingType && pricingType !== existing.rows[0].pricing_type) {
      const live = await query(
        "SELECT COUNT(*)::int AS n FROM subscriptions WHERE service_id = $1 AND status = 'active'",
        [req.params.id]).catch(() => ({ rows: [{ n: 0 }] }));
      if (live.rows[0].n > 0) return res.status(400).json({ error: "People are subscribed to this service — create a new one instead of changing how it is priced" });
    }

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
        promo_pct = CASE WHEN $14::int = -1 THEN promo_pct WHEN $14::int = 0 THEN NULL ELSE $14::int END,
        fulfilment = COALESCE($15, fulfilment),
        turnaround_days = COALESCE($16, turnaround_days),
        slot_capacity = CASE WHEN $17::int = -1 THEN slot_capacity WHEN $17::int = 0 THEN NULL ELSE $17::int END,
        unit_label = COALESCE($18, unit_label),
        unit_price_huf = COALESCE($19, unit_price_huf),
        min_units = COALESCE($20, min_units),
        max_units = COALESCE($21, max_units),
        requirements = CASE WHEN $22::text IS NULL THEN requirements ELSE $22::jsonb END
      WHERE id = $13 RETURNING *`,
      [name, description, icon, priceHuf, minutes, tasks ? JSON.stringify(tasks) : null, isActive,
       pricingType, hourlyRateHuf, minHours, maxHours, period, req.params.id,
       promoU === undefined ? -1 : (promoU === null ? 0 : promoU),
       ["onsite", "collection"].includes(fulfilment) ? fulfilment : null,
       turnaroundDays != null ? parseInt(turnaroundDays, 10) : null,
       slotCapacity === undefined ? -1 : (slotCapacity === null || slotCapacity === "" ? 0 : parseInt(slotCapacity, 10)),
       unitLabel != null ? String(unitLabel).trim().slice(0, 12) : null,
       unitPriceHuf != null ? parseInt(unitPriceHuf, 10) : null,
       minUnits != null ? Number(minUnits) : null,
       maxUnits != null ? Number(maxUnits) : null,
       /* undefined means "the form did not mention it" — leave what is stored.
          An empty array means "the company cleared the list", which must be
          saved, so it cannot collapse to the same null. */
       (() => { const r = cleanRequirements(requirements); return r === undefined ? null : JSON.stringify(r); })()]
    );
    translateService(result.rows[0], req.user?.lang);
    res.json({ service: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to update service" });
  }
});

export default router;
