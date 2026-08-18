import { Router } from "express";
import { query } from "../db.js";
import { geocode, distanceKm } from "../lib/geocode.js";
import { translateAll, translateList, sourceChanged } from "../lib/translate.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { huTaxIdValid, huRegNumberValid, formatTaxId } from "../lib/validate.js";

const router = Router();

/* GET /api/companies — public: all approved+listed companies */
router.get("/", async (req, res) => {
  try {
    const result = await query(
      "SELECT id, name, emoji, tagline, area, city, country, service_lat, service_lng, service_radius_km, currency, requirements, tagline_i18n, requirements_i18n, google_place_id, student_discount, promo, availability, rating, review_count, cover, logo_url, is_listed, is_approved, created_at FROM companies WHERE is_listed = true AND is_approved = true ORDER BY rating DESC, review_count DESC"
    );
    let rows = result.rows;

    /* ── 4.6 Service areas. If the caller passes ?near=<address> we geocode it
       once (cached forever) and keep only companies whose circle contains it,
       annotating each with distance. Companies without coordinates are never
       hidden — they fall back to the old city match. ── */
    const near = String(req.query.near || "").trim();
    if (near) {
      const me = await geocode(near);
      if (me) {
        rows = rows
          .map((c) => {
            const d = (c.service_lat != null && c.service_lng != null)
              ? distanceKm(me.lat, me.lng, c.service_lat, c.service_lng) : null;
            return { ...c, distance_km: d };
          })
          .filter((c) => c.distance_km == null || c.distance_km <= (Number(c.service_radius_km) || 10))
          .sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9));
      }
    }
    res.json({ companies: rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch companies" });
  }
});

/* GET /api/companies/:id — public */
router.get("/:id", async (req, res) => {
  try {
    const result = await query("SELECT id, name, emoji, tagline, area, city, country, service_lat, service_lng, service_radius_km, currency, requirements, tagline_i18n, requirements_i18n, google_place_id, student_discount, promo, availability, rating, review_count, cover, logo_url, is_listed, is_approved, created_at FROM companies WHERE id = $1", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "Company not found" });
    res.json({ company: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch company" });
  }
});

/* PUT /api/companies/:id — company owner only */
router.put("/:id", requireAuth, requireRole("company"), async (req, res) => {
  const { name, emoji, tagline, area, studentDiscount, cover, logoUrl, taxId, regNumber, contactPhone, documents, city, googlePlaceId, promo, availability, country, serviceLat, serviceLng, serviceRadiusKm, currency, requirements, billingName, billingZip, billingCity, billingAddress, billingEmail } = req.body;
  let availJson;
  if (availability === null) {
    availJson = "null";          // explicit clear → no restrictions
  } else if (availability !== undefined) {
    try {
      const a = availability || {};
      const days = {};
      for (const k of ["0","1","2","3","4","5","6"]) {
        const d = (a.days || {})[k] || {};
        const slots = Array.isArray(d.slots)
          ? [...new Set(d.slots.filter((t) => /^\d{2}:\d{2}$/.test(String(t))))].sort().slice(0, 24)
          : [];
        days[k] = { on: !!d.on && slots.length > 0, slots };
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
      /* busyServices: { "<serviceId>": { "YYYY-MM-DD": ["10:00"] } } — a block
         that applies to ONE service only, so a company can sell laundry at an
         hour when its cleaning is already spoken for. */
      const busyServices = {};
      if (a.busyServices && typeof a.busyServices === "object") {
        for (const [sid, byDate] of Object.entries(a.busyServices).slice(0, 60)) {
          if (!/^[0-9a-fA-F-]{16,40}$/.test(String(sid)) || !byDate || typeof byDate !== "object") continue;
          const dates = {};
          for (const [k, v] of Object.entries(byDate).slice(0, 400)) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(k)) || !Array.isArray(v)) continue;
            const slots = v.filter((t) => /^\d{2}:\d{2}$/.test(String(t))).slice(0, 24);
            if (slots.length) dates[k] = slots;
          }
          if (Object.keys(dates).length) busyServices[sid] = dates;
        }
      }
      availJson = JSON.stringify({ paused: !!a.paused, days, closed, busy, busyServices });
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
        availability = CASE WHEN $16::text IS NULL THEN availability WHEN $16 = 'null' THEN NULL ELSE $16::jsonb END,
        country = COALESCE($17, country),
        service_lat = COALESCE($18, service_lat),
        service_lng = COALESCE($19, service_lng),
        service_radius_km = COALESCE($20, service_radius_km),
        currency = COALESCE($21, currency),
        requirements = CASE WHEN $22::text IS NULL THEN requirements ELSE $22::jsonb END,
        billing_name = COALESCE($23, billing_name),
        billing_zip = COALESCE($24, billing_zip),
        billing_city = COALESCE($25, billing_city),
        billing_address = COALESCE($26, billing_address),
        billing_email = COALESCE($27, billing_email)
      WHERE id = $14 RETURNING *`,
      [name, emoji, tagline, area, studentDiscount, cover, logoUrl, taxId ? formatTaxId(taxId) : null, regNumber, contactPhone,
       Array.isArray(documents) ? JSON.stringify(documents.slice(0, 6)) : null, city || null, googlePlaceId !== undefined ? String(googlePlaceId).slice(0, 100) : null, req.params.id, promoJson === undefined ? null : promoJson, availJson === undefined ? null : availJson,
       country ? String(country).toUpperCase().slice(0, 2) : null,
       serviceLat != null && !Number.isNaN(Number(serviceLat)) ? Number(serviceLat) : null,
       serviceLng != null && !Number.isNaN(Number(serviceLng)) ? Number(serviceLng) : null,
       serviceRadiusKm != null ? Math.min(Math.max(parseInt(serviceRadiusKm, 10) || 10, 1), 200) : null,
       currency ? String(currency).toUpperCase().slice(0, 3) : null,
       Array.isArray(requirements)
         ? JSON.stringify(requirements.map((x) => String(x).slice(0, 140)).filter(Boolean).slice(0, 12))
         : null,
       billingName != null ? String(billingName).slice(0, 200) : null,
       billingZip != null ? String(billingZip).slice(0, 12) : null,
       billingCity != null ? String(billingCity).slice(0, 80) : null,
       billingAddress != null ? String(billingAddress).slice(0, 200) : null,
       billingEmail != null ? String(billingEmail).slice(0, 160) : null]
    );
    const saved = result.rows[0];

    /* ── 5.2 Translate what they typed, in the background. Never make the save
       wait on a translation API, and never fail the save if it is down. ── */
    (async () => {
      try {
        const src = String(req.user?.lang || "hu").slice(0, 2);
        if (saved.tagline && sourceChanged(saved.tagline_i18n, saved.tagline)) {
          const m = await translateAll(saved.tagline, src);
          if (m) await query("UPDATE companies SET tagline_i18n = $1 WHERE id = $2", [JSON.stringify(m), saved.id]);
        }
        const reqs = Array.isArray(saved.requirements) ? saved.requirements : [];
        const prevSrc = (saved.requirements_i18n || []).map((x) => (x && x[x._src]) || "").join("\u0000");
        if (reqs.length && prevSrc !== reqs.join("\u0000")) {
          const maps = await translateList(reqs, src);
          if (maps) await query("UPDATE companies SET requirements_i18n = $1 WHERE id = $2", [JSON.stringify(maps), saved.id]);
        }
      } catch (e) { console.error("company translate:", e.message); }
    })();

    res.json({ company: saved });
  } catch (err) {
    res.status(500).json({ error: "Failed to update company" });
  }
});

export default router;
