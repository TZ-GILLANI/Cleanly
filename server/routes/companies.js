import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { huTaxIdValid, huRegNumberValid, formatTaxId } from "../lib/validate.js";

const router = Router();

/* GET /api/companies — public: all approved+listed companies */
router.get("/", async (req, res) => {
  try {
    const result = await query(
      "SELECT id, name, emoji, tagline, area, city, google_place_id, student_discount, promo, availability, rating, review_count, cover, logo_url, is_listed, is_approved, created_at FROM companies WHERE is_listed = true AND is_approved = true ORDER BY rating DESC, review_count DESC"
    );
    res.json({ companies: result.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch companies" });
  }
});

/* GET /api/companies/:id — public */
router.get("/:id", async (req, res) => {
  try {
    const result = await query("SELECT id, name, emoji, tagline, area, city, google_place_id, student_discount, promo, availability, rating, review_count, cover, logo_url, is_listed, is_approved, created_at FROM companies WHERE id = $1", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "Company not found" });
    res.json({ company: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch company" });
  }
});

/* PUT /api/companies/:id — company owner only */
router.put("/:id", requireAuth, requireRole("company"), async (req, res) => {
  const { name, emoji, tagline, area, studentDiscount, cover, logoUrl, taxId, regNumber, contactPhone, documents, city, googlePlaceId, promo, availability } = req.body;
  let availJson;
  if (availability !== undefined) {
    try {
      const a = availability || {};
      const days = {};
      for (const k of ["0","1","2","3","4","5","6"]) {
        const d = (a.days || {})[k] || {};
        const hhmm = (v, fb) => (/^\d{2}:\d{2}$/.test(String(v)) ? String(v) : fb);
        days[k] = { on: !!d.on, from: hhmm(d.from, "08:00"), to: hhmm(d.to, "18:00") };
      }
      const closed = Array.isArray(a.closed)
        ? a.closed.filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x))).slice(0, 200)
        : [];
      // busy: { "YYYY-MM-DD": ["09:30", ...] } — individually blocked time slots
      const busy = {};
      if (a.busy && typeof a.busy === "object") {
        for (const [k, v] of Object.entries(a.busy).slice(0, 400)) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(k)) || !Array.isArray(v)) continue;
          const slots = v.filter((t) => /^\d{2}:\d{2}$/.test(String(t))).slice(0, 24);
          if (slots.length) busy[k] = slots;
        }
      }
      availJson = JSON.stringify({ paused: !!a.paused, days, closed, busy });
    } catch { return res.status(400).json({ error: "Invalid availability" }); }
  }
  // promo: null clears it; otherwise { pct 1–90, label ≤60 chars, until YYYY-MM-DD or null }
  let promoJson;
  if (promo === null) promoJson = "null";
  else if (promo !== undefined) {
    const pct = parseInt(promo.pct, 10);
    if (!Number.isFinite(pct) || pct < 1 || pct > 90) return res.status(400).json({ error: "Discount must be between 1% and 90%" });
    const label = String(promo.label || "").trim().slice(0, 60);
    let until = null;
    if (promo.until) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(promo.until) || isNaN(Date.parse(promo.until))) return res.status(400).json({ error: "Invalid end date" });
      until = promo.until;
    }
    promoJson = JSON.stringify({ pct, label: label || null, until });
  }
  if (req.user.companyId !== req.params.id) return res.status(403).json({ error: "Not your company" });
  if (taxId && !huTaxIdValid(taxId)) return res.status(400).json({ error: "Invalid Hungarian tax number (adószám). Format: 12345678-1-42." });
  if (regNumber && !huRegNumberValid(regNumber)) return res.status(400).json({ error: "Invalid registration number (cégjegyzékszám). Format: 09-09-123456." });

  try {
    const result = await query(
      `UPDATE companies SET
        name = COALESCE($1, name),
        emoji = COALESCE($2, emoji),
        tagline = COALESCE($3, tagline),
        area = COALESCE($4, area),
        student_discount = COALESCE($5, student_discount),
        cover = COALESCE($6, cover),
        logo_url = COALESCE($7, logo_url),
        tax_id = COALESCE($8, tax_id),
        reg_number = COALESCE($9, reg_number),
        contact_phone = COALESCE($10, contact_phone),
        documents = COALESCE($11, documents),
        city = COALESCE($12, city),
        google_place_id = COALESCE($13, google_place_id),
        promo = CASE WHEN $15::text IS NULL THEN promo WHEN $15 = 'null' THEN NULL ELSE $15::jsonb END,
        availability = COALESCE($16::jsonb, availability)
      WHERE id = $14 RETURNING *`,
      [name, emoji, tagline, area, studentDiscount, cover, logoUrl, taxId ? formatTaxId(taxId) : null, regNumber, contactPhone,
       Array.isArray(documents) ? JSON.stringify(documents.slice(0, 6)) : null, city || null, googlePlaceId !== undefined ? String(googlePlaceId).slice(0, 100) : null, req.params.id, promoJson === undefined ? null : promoJson, availJson === undefined ? null : availJson]
    );
    res.json({ company: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to update company" });
  }
});

export default router;
