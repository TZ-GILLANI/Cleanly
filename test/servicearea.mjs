/* THE COMPANY THAT DISAPPEARED.

   TZ Gillani's service pin sits at 47.29638, 21.24939 with a 39 km radius.
   Debrecen's centre is 38.6 km from it; the university district is 40.0 km.
   So the company showed for some Debrecen addresses and vanished for others.

   The rescue was supposed to be service_cities: ["Debrecen"], which the server
   honours through servesCity(). But that reads ?city=, and the client only
   sent it `if (sess.city)` — and buildSession() never copied user.city onto
   the session. users.city has been in the schema since v4.7. So the whole
   "serves the entire city" feature was reachable only by a query parameter
   nothing ever set.

   Two fixes, both tested here:
     1. the session carries the city, so ?city= is actually sent
     2. when it is absent anyway (old builds stay on phones for weeks) the
        server looks for the company's own city names inside the address

   Run: node test/servicearea.mjs                                            */
process.env.PGMEM = "1";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "sa-test-secret";
process.env.PORT = "4591";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };

/* ── Part 1: the geometry, with his real numbers ── */
console.log("\n── the pin, measured ──");
const { distanceKm } = await import("../server/lib/geocode.js");
const PIN = [47.2963845940543, 21.2493896484375];
const centre = distanceKm(47.5316, 21.6273, ...PIN);
const uni    = distanceKm(47.5540, 21.6210, ...PIN);
ok("Debrecen centre is inside a 39 km radius", centre < 39, centre.toFixed(1) + " km");
ok("but the university district is outside it", uni > 39, uni.toFixed(1) + " km");
ok("which is why the company came and went", centre < 39 && uni > 39);

/* ── Part 2: the city rescue, unit level ── */
console.log("\n── naming a city beats measuring a distance ──");
const co = await import("../server/routes/companies.js");
const tz = { service_cities: ["Debrecen"], service_lat: PIN[0], service_lng: PIN[1], service_radius_km: 39 };
ok("servesCity matches the city exactly", co.servesCity(tz, "Debrecen") === true);
ok("and is case-insensitive", co.servesCity(tz, "debrecen") === true);
ok("a different city does not match", co.servesCity(tz, "Budapest") === false);
ok("an EMPTY city does not match — this was the whole bug",
   co.servesCity(tz, "") === false && co.servesCity(tz, undefined) === false);

console.log("\n── the fallback, for builds that never send the city ──");
ok("the address naming Debrecen is enough", co.addressNamesCity(tz, "Nagyerdei krt 98, Debrecen") === true);
ok("even with a postcode in the way", co.addressNamesCity(tz, "Kassai út 26, 4028 Debrecen") === true);
ok("a Budapest address is not", co.addressNamesCity(tz, "Váci út 1, Budapest") === false);
ok("'Debrecenyi utca, Szeged' must NOT count — whole words only",
   co.addressNamesCity(tz, "Debrecenyi utca, Szeged") === false);
ok("a company that names no cities is unaffected",
   co.addressNamesCity({ service_cities: [] }, "Kassai út 26, Debrecen") === false);
ok("service_cities stored as a JSON string still parses",
   co.servesCity({ service_cities: '["Debrecen"]' }, "Debrecen") === true);

/* ── Part 3: end to end, through the real endpoint ── */
const BASE = "http://localhost:4591";
const j = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method, signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
await import("../server/index.js");
await new Promise((r) => setTimeout(r, 900));
const { query } = await import("../server/db.js");

console.log("\n── the endpoint, with a company set up exactly like his ──");
const reg = await j("/api/auth/register", { method: "POST", body: {
  fullName: "Boss", email: "sa-boss@test.hu", password: "secret123", role: "company",
  companyName: "TZ Test Kft", taxId: "10000001-1-02", city: "Debrecen",
  phone: "+36301112233", termsAccepted: true } });
ok("the company registers", reg.status === 201 || reg.status === 200, `got ${reg.status} ${JSON.stringify(reg.data).slice(0,120)}`);
const cid = (await query("SELECT id FROM companies WHERE name = $1", ["TZ Test Kft"])).rows[0]?.id;
await query(
  `UPDATE companies SET is_listed = true, is_approved = true,
     service_lat = $1, service_lng = $2, service_radius_km = 39, service_cities = $3 WHERE id = $4`,
  [PIN[0], PIN[1], JSON.stringify(["Debrecen"]), cid]);
// pin the geocache so the test never touches the network
const uniAddr = "Nagyerdei korut 98, Debrecen";
/* geocode() keys the cache on the trimmed address AS TYPED — not lowercased.
   My first version of this fixture lowercased it, so the cache missed, geocode
   returned null, the whole distance filter was skipped, and every company came
   back. Two assertions below passed for that reason and meant nothing. */
await query("INSERT INTO geocache (q, lat, lng) VALUES ($1,$2,$3) ON CONFLICT (q) DO NOTHING",
  [uniAddr.trim(), 47.5540, 21.6210]);
const cached = await query("SELECT lat, lng FROM geocache WHERE q = $1", [uniAddr.trim()]);
ok("the geocode fixture is actually in the cache — otherwise this whole file proves nothing",
   cached.rows.length === 1 && Number(cached.rows[0].lat).toFixed(3) === "47.554",
   JSON.stringify(cached.rows));

const has = (r) => (r.data.companies || []).some((c) => c.id === cid);

const plain = await j("/api/companies");
ok("with no address at all, the company is listed", has(plain));

const far = await j(`/api/companies?near=${encodeURIComponent(uniAddr)}`);
ok("from the university, WITHOUT a city, it is STILL listed — the fallback caught it", has(far),
   JSON.stringify((far.data.companies || []).map((c) => c.name)));

const withCity = await j(`/api/companies?near=${encodeURIComponent(uniAddr)}&city=Debrecen`);
ok("and with the city sent explicitly, it is listed", has(withCity));

/* Prove the fallback is doing the work, not the radius: a company with the
   same far pin that does NOT claim Debrecen must still be filtered out. */
const reg2 = await j("/api/auth/register", { method: "POST", body: {
  fullName: "Boss2", email: "sa-boss2@test.hu", password: "secret123", role: "company",
  companyName: "Faraway Kft", taxId: "10000001-1-02", city: "Szeged",
  phone: "+36301112244", termsAccepted: true } });
const cid2 = (await query("SELECT id FROM companies WHERE name = $1", ["Faraway Kft"])).rows[0]?.id;
if (cid2) {
  await query(
    `UPDATE companies SET is_listed = true, is_approved = true,
       service_lat = $1, service_lng = $2, service_radius_km = 39, service_cities = $3 WHERE id = $4`,
    [PIN[0], PIN[1], JSON.stringify(["Szeged"]), cid2]);
  const r = await j(`/api/companies?near=${encodeURIComponent(uniAddr)}`);
  const has2 = (r.data.companies || []).some((c) => c.id === cid2);
  ok("a company that does NOT serve your city is still filtered out", !has2);
  ok("so the filter still filters — the fix widened it, it did not disable it", has(r) && !has2);
}

console.log("\n── the client change: the session must carry the city ──");
const fs = await import("fs");
const store = fs.readFileSync(new URL("../src/store.jsx", import.meta.url), "utf8");
ok("buildSession copies user.city onto the session", /city:\s*user\.city/.test(store));
ok("and the companies query still sends it", /sess\.city\s*\?\s*"&city="/.test(store));
ok("profile saves do not drop it again", /city:\s*user\.city\s*\|\|\s*s\.city/.test(store));

console.log(`\n════ SERVICE AREA: ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
