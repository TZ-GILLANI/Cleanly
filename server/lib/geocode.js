import { query } from "../db.js";

/* ── 4.6 Server-side geocoding with a permanent DB cache ────────────
   The browser used to hit OpenStreetMap directly on every render, which
   is rate-limited and against their usage policy at volume. Now: one
   lookup per distinct address, ever, cached in `geocache`.              */

const UA = "Cleano/7.0 (+https://cleanly-2x9z.onrender.com)";

export async function geocode(addressRaw) {
  const q = String(addressRaw || "").trim().slice(0, 300);
  if (q.length < 4) return null;
  try {
    const hit = await query("SELECT lat, lng FROM geocache WHERE q = $1", [q]);
    if (hit.rows.length) {
      const r = hit.rows[0];
      return r.lat == null ? null : { lat: Number(r.lat), lng: Number(r.lng) };
    }
  } catch {}
  let found = null;
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
      { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000) });
    const d = await r.json();
    if (d && d[0]) found = { lat: Number(d[0].lat), lng: Number(d[0].lon) };
  } catch {}
  // cache negatives too — a bad address shouldn't be retried forever
  try { await query("INSERT INTO geocache (q, lat, lng) VALUES ($1,$2,$3) ON CONFLICT (q) DO NOTHING",
    [q, found?.lat ?? null, found?.lng ?? null]); } catch {}
  return found;
}

/* Great-circle distance in km. */
export function distanceKm(aLat, aLng, bLat, bLng) {
  if ([aLat, aLng, bLat, bLng].some((v) => v == null || Number.isNaN(Number(v)))) return null;
  const R = 6371, toRad = (d) => (Number(d) * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.asin(Math.sqrt(s)) * 10) / 10;
}
