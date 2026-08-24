import { Router } from "express";
import { query, hasColumn } from "../db.js";
import { geocode, distanceKm } from "../lib/geocode.js";
import { translateAll, translateList, sourceChanged } from "../lib/translate.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { huTaxIdValid, huRegNumberValid, formatTaxId, formatRegNumber, euVatCheck, normalizeVat } from "../lib/validate.js";

const router = Router();

/* GET /api/companies — public: all approved+listed companies */
/* Does this company serve that city outright? Case- and accent-tolerant, so
   "DEBRECEN", "Debrecen" and a stray trailing space all match. */
function cityList(co) {
  let list = co?.service_cities;
  if (typeof list === "string") { try { list = JSON.parse(list); } catch { list = []; } }
  return Array.isArray(list) ? list.map((c) => String(c || "").trim()).filter(Boolean) : [];
}

export function servesCity(co, cityRaw) {
  const city = String(cityRaw || "").trim().toLowerCase();
  if (!city) return false;
  return cityList(co).some((c) => c.toLowerCase() === city);
}

/* Fallback for when the app did not tell us the city.

   It is supposed to arrive as ?city=, but every build before this one left it
   off, and those builds stay on people's phones for weeks. Without it a
   company that serves a whole city was judged purely on how far its pin is —
   TZ Gillani's pin sits 38.6 km from the centre of Debrecen with a 39 km
   radius, so the university district, at 40.0 km, fell outside and the company
   vanished from the list.

   So if the city is missing, look for the company's own city names inside the
   address the customer typed. "Kassai út 26, Debrecen" contains "Debrecen";
   that is enough, and it can only ever keep a company in, never drop one. */
export function addressNamesCity(co, addressRaw) {
  const addr = String(addressRaw || "").toLowerCase();
  if (!addr) return false;
  return cityList(co).some((c) => {
    const n = c.toLowerCase();
    // whole word, so "Pest" does not match inside "Budapest"
    return new RegExp("(^|[^\\p{L}])" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^\\p{L}]|$)", "u").test(addr);
  });
}

/* ── Service areas ────────────────────────────────────────────────

   One list, one matching function, used by the company listing AND by booking
   validation. Before this they were separate code paths that could disagree:
   a company could appear in your list and then refuse your booking.

   An area is a named place:
     { city: "Debrecen", mode: "all" }
     { city: "Budapest", mode: "radius", lat, lng, radiusKm: 8, label: "Belváros" }

   An address is covered if ANY area covers it. Nothing else. */

export function serviceAreasOf(co) {
  let a = co?.service_areas;
  if (typeof a === "string") { try { a = JSON.parse(a); } catch { a = null; } }
  if (Array.isArray(a) && a.length) return a.filter((x) => x && x.city);

  /* Nothing migrated yet — build the equivalent from the old columns so a
     company that has not touched their settings keeps exactly the coverage
     they had. This is what makes the change safe to deploy. */
  const out = [];
  for (const c of cityList(co)) out.push({ city: c, mode: "all" });
  if (co?.service_lat != null && co?.service_lng != null && Number(co?.service_radius_km) > 0) {
    out.push({ city: co.city || "", mode: "radius", lat: Number(co.service_lat),
               lng: Number(co.service_lng), radiusKm: Number(co.service_radius_km) });
  }
  return out;
}

const sameCity = (a, b) =>
  String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase() && String(a || "").trim() !== "";

/* `where` is { city, lat, lng } — any of them may be missing.
   Returns { covered, km } so callers can tell the customer HOW far out they are. */
export function areaCovers(co, where) {
  const areas = serviceAreasOf(co);
  if (!areas.length) return { covered: true, km: null };   // no areas set = no limit, as before
  let best = null;
  for (const a of areas) {
    if (a.mode === "all") {
      if (sameCity(a.city, where?.city)) return { covered: true, km: null };
      continue;
    }
    if (a.lat == null || a.lng == null) continue;
    if (where?.lat == null || where?.lng == null) {
      /* No coordinates for the address: fall back to the city the area is
         anchored in. Better to let a booking through than to refuse someone
         because our geocoder was having a quiet day. */
      if (sameCity(a.city, where?.city)) return { covered: true, km: null };
      continue;
    }
    const km = distanceKm(Number(a.lat), Number(a.lng), where.lat, where.lng);
    if (km == null) continue;
    if (best == null || km < best) best = km;
    /* A little slack, applied HERE so the listing and the booking guard agree
       to the metre. A pin is dropped by hand and a geocoded house number is
       not a survey marker; refusing someone 200 m over would be precision the
       data does not have. Proportional, because 1 km of slop on a 60 km radius
       is not the same tolerance as 1 km on a 3 km one. */
    if (km <= Number(a.radiusKm || 10) * 1.1 + 1) return { covered: true, km };
  }
  return { covered: false, km: best };
}

/* A short human summary for the company card: "Debrecen · Budapest +1" */
export function areaSummary(co) {
  const names = [...new Set(serviceAreasOf(co).map((a) => String(a.label || a.city || "").trim()).filter(Boolean))];
  if (!names.length) return "";
  return names.length <= 2 ? names.join(" · ") : `${names.slice(0, 2).join(" · ")} +${names.length - 2}`;
}

router.get("/", async (req, res) => {
  try {
    /* Two column lists, and the second one is the point.

       This endpoint asks for service_areas and eu_vat. If schema.sql has not
       been run yet — a new deploy, a migration done later in the evening — the
       SELECT fails, this returns 500, and because the app loads the company
       list while signing in, NOBODY CAN LOG IN. A missing optional column
       should cost you a feature, not the whole product.

       So: try the full list, and if the database says a column is missing,
       fall back to the columns that have always existed. The area rules then
       fall back to the legacy ones, which is exactly what they did yesterday. */
    /* Ask the schema which optional columns exist, rather than running the
       full SELECT and reading the error. Postgres and pg-mem word that error
       differently, and a guard that matches one wording passes its own tests
       and fails on the real database — which is exactly how this went wrong
       the first time. */
    const BASE = "id, name, emoji, tagline, area, city, country, service_lat, service_lng, service_radius_km, service_cities, currency, requirements, tagline_i18n, requirements_i18n, google_place_id, student_discount, promo, availability, rating, review_count, cover, logo_url, is_listed, is_approved, created_at";
    const extra = [];
    for (const c of ["service_areas", "eu_vat"]) if (await hasColumn("companies", c)) extra.push(c);
    const result = await query(
      `SELECT ${BASE}${extra.length ? ", " + extra.join(", ") : ""} FROM companies
        WHERE is_listed = true AND is_approved = true
        ORDER BY rating DESC, review_count DESC`);
    let rows = result.rows;

    /* ── 4.6 Service areas. If the caller passes ?near=<address> we geocode it
       once (cached forever) and keep only companies whose circle contains it,
       annotating each with distance. Companies without coordinates are never
       hidden — they fall back to the old city match. ── */
    try {
      const near = String(req.query.near || "").trim();
      /* The caller's city, when they know it. `near` is a whole address, so the
         city is whatever they told us separately — not something to guess out of
         a free-text string. */
      const myCity = String(req.query.city || "").trim();
      if (near) {
        const me = await geocode(near);
        if (me) {
          rows = rows
            .map((c) => {
              let d = null;
              for (const a of serviceAreasOf(c)) {
                if (a.lat == null || a.lng == null) continue;
                const km = distanceKm(me.lat, me.lng, Number(a.lat), Number(a.lng));
                if (km != null && (d == null || km < d)) d = km;
              }
              return { ...c, distance_km: d };
            })
            /* A named city beats a measured distance. A company that says it
               serves Nyíregyháza serves it whether that is 4 km or 50 km from
               the pin they dropped, and no radius expresses "these three towns,
               not the villages between them". */
            /* The SAME function the booking endpoint calls. If it says yes here
               and no there, a customer sees a company and then gets refused. */
            .filter((c) => areaCovers(c, { city: myCity, lat: me.lat, lng: me.lng }).covered
                        || (!myCity && addressNamesCity(c, near)))
            .sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9));
        }
      }
    } catch (e) {
      /* Narrowing the list to your area is a convenience. Failing to narrow it
         is not a reason to show you nothing. */
      console.error("companies: area filter failed, returning the unfiltered list —", e.message);
    }
    res.json({ companies: rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch companies" });
  }
});

/* GET /api/companies/:id — public */
router.get("/:id", async (req, res) => {
  try {
    const result = await query("SELECT id, name, emoji, tagline, area, city, country, service_lat, service_lng, service_radius_km, service_areas, service_cities, eu_vat, currency, requirements, tagline_i18n, requirements_i18n, google_place_id, student_discount, promo, availability, rating, review_count, cover, logo_url, is_listed, is_approved, created_at FROM companies WHERE id = $1", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "Company not found" });
    res.json({ company: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch company" });
  }
});

/* PUT /api/companies/:id — company owner only */
router.put("/:id", requireAuth, requireRole("company"), async (req, res) => {
  const { name, emoji, tagline, area, studentDiscount, cover, logoUrl, taxId, regNumber, contactPhone, documents, city, googlePlaceId, promo, availability, country, serviceLat, serviceLng, serviceRadiusKm, serviceAreas, currency, requirements, euVat, billingName, billingZip, billingCity, billingAddress, billingEmail, serviceCities } = req.body;
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

  const vatVerdict = euVatCheck(euVat, country, taxId);
  if (!vatVerdict.ok) {
    const why = {
      no_country: "An EU VAT number starts with the two-letter country code, e.g. HU12345678.",
      not_eu: "That country code is not in the EU VAT system.",
      shape: "That does not match the format used by that country.",
      country_mismatch: "The VAT number's country does not match your company's country.",
      tax_mismatch: "A Hungarian EU VAT number is HU plus the first 8 digits of your adoszam — these do not match.",
    }[vatVerdict.reason] || "That EU VAT number does not look right.";
    return res.status(400).json({ error: why });
  }

  try {
    /* The two columns added in 7.1 are appended only if the database has them.

       My previous attempt ran the whole statement and retried on failure by
       matching the error text. Postgres says `column "eu_vat" ... does not
       exist`; pg-mem says `Column "eu_vat" not found` — so the guard passed
       its own tests and would still have failed on the real database. And a
       retry that strips an assignment leaves its $N parameter behind, which
       Postgres rejects outright. Asking the schema avoids both, and the answer
       is cached, so it costs one query per boot. */
    const areasJson = (() => {
         if (!Array.isArray(serviceAreas)) return null;
         const clean = serviceAreas.slice(0, 40).map((a) => {
           const city = String(a?.city || "").trim().slice(0, 80);
           if (!city) return null;
           const label = String(a?.label || "").trim().slice(0, 80) || undefined;
           if (a?.mode === "radius") {
             const lat = Number(a.lat), lng = Number(a.lng);
             if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
             if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
             const radiusKm = Math.min(Math.max(parseInt(a.radiusKm, 10) || 10, 1), 200);
             return { city, mode: "radius", lat, lng, radiusKm, ...(label ? { label } : {}) };
           }
           return { city, mode: "all", ...(label ? { label } : {}) };
         }).filter(Boolean);
         return JSON.stringify(clean);
       })();
    const euVatValue = euVat !== undefined ? (normalizeVat(euVat) || null) : null;

    let sql = `UPDATE companies SET
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
        billing_email = COALESCE($27, billing_email),
        service_cities = CASE WHEN $28::text IS NULL THEN service_cities ELSE $28::jsonb END
      WHERE id = $14 RETURNING *`;
    const params = [name, emoji, tagline, area, studentDiscount, cover, logoUrl, taxId ? formatTaxId(taxId) : null, regNumber ? formatRegNumber(regNumber) : null, contactPhone,
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
       billingEmail != null ? String(billingEmail).slice(0, 160) : null,
       /* Trimmed, de-duplicated case-insensitively, capped at 40. A partner
          who serves forty towns is a national operator and should be talking
          to you, not typing. */
       Array.isArray(serviceCities)
         ? JSON.stringify([...new Map(serviceCities
             .map((x) => String(x || "").trim().slice(0, 80))
             .filter(Boolean)
             .map((x) => [x.toLowerCase(), x])).values()].slice(0, 40))
         : null,
       /* Sanitised hard: a city name, a mode, and — only for a radius — a real
          point inside a sane range. Anything else is dropped rather than
          stored, because this list decides who can book you. */];
    for (const [col, val] of [["service_areas", areasJson], ["eu_vat", euVatValue]]) {
      if (!(await hasColumn("companies", col))) continue;
      params.push(val);
      const n = params.length;
      const expr = col === "service_areas"
        ? `CASE WHEN $${n}::text IS NULL THEN service_areas ELSE $${n}::jsonb END`
        : `COALESCE($${n}, ${col})`;
      sql = sql.replace(/\n(\s*)WHERE id =/, `,\n$1${col} = ${expr}\n$1WHERE id =`);
    }
    const result = await query(sql, params);
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
