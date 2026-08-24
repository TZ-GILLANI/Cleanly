/* SERVICE AREAS, v7.1.

   The old model was two ideas that could not talk to each other: one pin with
   a radius, floating free of any city, plus a flat list of whole cities. You
   could say "everywhere within 15 km of this dot" or "all of Debrecen and all
   of Budapest" — but NOT "all of Debrecen, and only the middle of Budapest",
   which is what a company working more than one town actually covers. And
   nothing anchored the pin, so it could sit in a field 38 km from the city on
   its own profile. That is exactly what happened to TZ Gillani.

   Now: a list of named places, each either the whole town or a circle inside
   it. One function decides coverage, and BOTH the company listing and the
   booking endpoint call it — they used to be separate code paths that could
   disagree, so a company could appear in your list and then refuse you.

   Run: node test/areas.mjs                                                   */
process.env.PGMEM = "1";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "areas-test";
process.env.PORT = "4596";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };

const co = await import("../server/routes/companies.js");
const DEB = { lat: 47.5316, lng: 21.6273 };
const UNI = { lat: 47.5540, lng: 21.6210 };
const BUD = { lat: 47.4979, lng: 19.0402 };

console.log("\n── the thing the old model could not say ──");
/* All of Debrecen, and ONLY the middle of Budapest. */
const mixed = { service_areas: [
  { city: "Debrecen", mode: "all" },
  { city: "Budapest", mode: "radius", lat: BUD.lat, lng: BUD.lng, radiusKm: 8, label: "Belváros" },
]};
const cov = (c, w) => co.areaCovers(c, w).covered;
ok("anywhere in Debrecen is covered", cov(mixed, { city: "Debrecen", ...UNI }));
ok("even a Debrecen address nowhere near any pin", cov(mixed, { city: "Debrecen", lat: 47.44, lng: 21.50 }));
ok("central Budapest is covered", cov(mixed, { city: "Budapest", lat: 47.50, lng: 19.05 }));
ok("outer Budapest is NOT — the circle is the point", !cov(mixed, { city: "Budapest", lat: 47.62, lng: 19.10 }));
ok("a third city is not covered at all", !cov(mixed, { city: "Szeged", lat: 46.25, lng: 20.14 }));
ok("three towns, three different rules, all at once",
   cov(mixed, { city: "Debrecen", ...DEB }) && cov(mixed, { city: "Budapest", ...BUD })
   && !cov(mixed, { city: "Szeged", lat: 46.25, lng: 20.14 }));

console.log("\n── a company that has never opened the new screen ──");
/* TZ Gillani exactly as it is on the live server right now. */
const legacy = { city: "Debrecen", service_cities: ["Debrecen"],
  service_lat: 47.2963845940543, service_lng: 21.2493896484375, service_radius_km: 39 };
const migrated = co.serviceAreasOf(legacy);
ok("their old settings migrate to areas on read", migrated.length === 2, JSON.stringify(migrated));
ok("the whole-city rule survives", migrated.some((a) => a.city === "Debrecen" && a.mode === "all"));
ok("and so does the circle", migrated.some((a) => a.mode === "radius" && a.radiusKm === 39));
ok("the university — 40 km from their pin — is still covered", cov(legacy, { city: "Debrecen", ...UNI }));
ok("Budapest still is not", !cov(legacy, { city: "Budapest", ...BUD }));

console.log("\n── the awkward cases ──");
ok("a company with nothing set is not hidden from everyone",
   co.areaCovers({}, { city: "Anywhere", lat: 1, lng: 1 }).covered);
ok("service_areas stored as a JSON string still parses",
   cov({ service_areas: '[{"city":"Debrecen","mode":"all"}]' }, { city: "Debrecen" }));
ok("city matching ignores case and spacing",
   cov(mixed, { city: "  debrecen " }));
ok("an empty city never matches an 'all' rule",
   !cov({ service_areas: [{ city: "Debrecen", mode: "all" }] }, { city: "", lat: null, lng: null }));
ok("a radius area with no coordinates on the ADDRESS falls back to its city",
   cov({ service_areas: [{ city: "Debrecen", mode: "radius", lat: DEB.lat, lng: DEB.lng, radiusKm: 5 }] },
       { city: "Debrecen", lat: null, lng: null }));
ok("a malformed entry is ignored, not crashed on",
   cov({ service_areas: [{ city: "Debrecen", mode: "radius" }, { city: "Debrecen", mode: "all" }] }, { city: "Debrecen" }));
const far = co.areaCovers(mixed, { city: "Budapest", lat: 47.62, lng: 19.10 });
ok("a refusal says HOW far outside they are", far.km > 8 && far.km < 30, String(far.km));

console.log("\n── the summary shown on a company card ──");
ok("two places are listed in full", co.areaSummary(mixed) === "Debrecen · Belváros", co.areaSummary(mixed));
const many = { service_areas: [{ city: "A", mode: "all" }, { city: "B", mode: "all" }, { city: "C", mode: "all" }, { city: "D", mode: "all" }] };
ok("more than two are counted, not crammed in", co.areaSummary(many) === "A · B +2", co.areaSummary(many));
ok("nothing set produces nothing, not the word undefined", co.areaSummary({}) === "");

/* ── The whole point: listing and booking must never disagree ── */
const BASE = "http://localhost:4596";
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
const dPlus = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

console.log("\n── end to end: what you see is what you can book ──");
const boss = await j("/api/auth/register", { method: "POST", body: {
  fullName: "Boss", email: "ar-boss@t.hu", password: "secret123", role: "company",
  companyName: "Areas Kft", taxId: "10000001-1-02", city: "Debrecen",
  phone: "+36301112233", termsAccepted: true } });
ok("the company registers", boss.status === 201 || boss.status === 200, `got ${boss.status}`);
const cid = (await query("SELECT id FROM companies WHERE name = $1", ["Areas Kft"])).rows[0].id;
await query(`UPDATE companies SET is_listed = true, is_approved = true, service_areas = $1 WHERE id = $2`,
  [JSON.stringify(mixed.service_areas), cid]);
const svc = await query(`INSERT INTO services (company_id,name,description,price_huf,minutes,is_active)
  VALUES ($1,'Deep clean','x',12000,90,true) RETURNING id`, [cid]);

/* Deterministic phone numbers. These were `"+3670303194" + random(0..8)` — one
   digit for three customers, so two would collide, the second registration
   would be refused for a duplicate number, and mk() would hand back undefined.
   The test then failed with "No token" on a run that had nothing to do with
   service areas. A test that fails at random teaches you to ignore it. */
let phoneSeq = 100;
const mk = async (email, city, addr, lat, lng) => {
  const r = await j("/api/auth/register", { method: "POST", body: {
    fullName: "C", email, password: "secret123", role: "customer", customerType: "resident",
    city, address: addr, phone: "+3670303" + (++phoneSeq) + "41", termsAccepted: true } });
  if (!r.data.token) ok(`a token came back for ${email}`, false, JSON.stringify(r.data).slice(0, 140));
  for (const key of [addr, `${addr}, ${city}`.trim()])
    await query("INSERT INTO geocache (q, lat, lng) VALUES ($1,$2,$3) ON CONFLICT (q) DO NOTHING", [key, lat, lng]);
  return r.data.token;
};

const inDeb = await mk("ar-deb@t.hu", "Debrecen", "Nagyerdei korut 98", UNI.lat, UNI.lng);
const inBudCentre = await mk("ar-bud1@t.hu", "Budapest", "Deak Ferenc ter 1", 47.4979, 19.0402);
const inBudEdge = await mk("ar-bud2@t.hu", "Budapest", "Csomor utca 100", 47.62, 19.10);

let day = 6;
for (const [who, tok, addr, city, shouldSee] of [
  ["a Debrecen customer", inDeb, "Nagyerdei korut 98", "Debrecen", true],
  ["a central Budapest customer", inBudCentre, "Deak Ferenc ter 1", "Budapest", true],
  ["an outer Budapest customer", inBudEdge, "Csomor utca 100", "Budapest", false],
]) {
  day += 1;   // a different day each, or the first booking takes the slot
  const list = await j(`/api/companies?near=${encodeURIComponent(addr)}&city=${encodeURIComponent(city)}`);
  const sees = (list.data.companies || []).some((c) => c.id === cid);
  ok(`${who} ${shouldSee ? "sees" : "does NOT see"} the company`, sees === shouldSee, `sees=${sees}`);

  const bk = await j("/api/bookings", { method: "POST", token: tok, body: {
    companyId: cid, serviceId: svc.rows[0].id, scheduledDate: dPlus(day), scheduledSlot: "10:00",
    address: addr, city, paymentMethod: "cash" } });
  const booked = bk.status < 300;
  ok(`  …and ${booked ? "can" : "cannot"} book — the two agree`, booked === shouldSee,
     `list=${sees} book=${booked} ${JSON.stringify(bk.data).slice(0, 120)}`);
}

console.log("\n── saving areas through the API ──");
await query("UPDATE users SET approval_status = 'approved' WHERE email = $1", ["ar-boss@t.hu"]);
const login = await j("/api/auth/login", { method: "POST", body: { email: "ar-boss@t.hu", password: "secret123" } });
const btok = login.data.token;
ok("the owner can log in to save areas", !!btok, JSON.stringify(login.data).slice(0, 140));
const saved = await j("/api/companies/" + cid, { method: "PUT", token: btok, body: { serviceAreas: [
  { city: "Debrecen", mode: "all" },
  { city: "Budapest", mode: "radius", lat: BUD.lat, lng: BUD.lng, radiusKm: 12, label: "Belváros" },
  { city: "", mode: "all" },                                    // junk: no city
  { city: "Nowhere", mode: "radius", lat: 999, lng: 999, radiusKm: 5 },   // junk: impossible point
  { city: "Eger", mode: "radius", lat: 47.9, lng: 20.37, radiusKm: 9999 },// junk: silly radius
]}});
ok("the save is accepted", saved.status === 200, `got ${saved.status} ${JSON.stringify(saved.data).slice(0, 120)}`);
const stored = (await query("SELECT service_areas FROM companies WHERE id = $1", [cid])).rows[0].service_areas;
const arr = typeof stored === "string" ? JSON.parse(stored) : stored;
ok("the entry with no city is dropped", !arr.some((a) => !a.city), JSON.stringify(arr));
ok("the impossible coordinates are dropped", !arr.some((a) => a.city === "Nowhere"), JSON.stringify(arr));
ok("a silly radius is clamped, not stored", (arr.find((a) => a.city === "Eger") || {}).radiusKm === 200,
   JSON.stringify(arr.find((a) => a.city === "Eger")));
ok("the real entries survive intact", arr.some((a) => a.city === "Debrecen" && a.mode === "all")
   && arr.some((a) => a.city === "Budapest" && a.radiusKm === 12 && a.label === "Belváros"), JSON.stringify(arr));

console.log("\n── the client mirrors the server, or the list lies ──");
{
  const fs = await import("fs");
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  ok("the client has its own migration that matches", /function areasOf\(co\)/.test(app));
  ok("the editor is wired into the company form", /<ServiceAreasEditor areas=\{f\.service_areas\}/.test(app));
  ok("the free-floating pin editor is gone", !/Cities you serve in full/.test(app));
  ok("a radius always starts anchored on the chosen city",
     /setPt\(\{ lat: c\.lat, lng: c\.lng \}\)/.test(app));
  const noComments = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  ok("the country dropdown no longer prints a flag and nothing",
     !/\{x\.f\} \{x\.n\}/.test(noComments), "x.n is undefined on a DIAL_CODES entry");
  ok("it prints the localised country name instead", /regionNamer\(getLang\(\)\)\(x\.c\)/.test(noComments));
}


/* ── THE WHOLE CHAIN ──────────────────────────────────────────────
   Musa's question: is this connected to what the customer actually sees, all
   the way through? The pieces can each be right and still not add up, and
   this codebase's signature failure is exactly that — a column added, a UI
   built, and one reader left pointing at the old thing.

   So: change the coverage ONCE, then check every surface that claims to know
   about it. */
console.log("\n── change it once, check everywhere ──");
{
  // Narrow the company to Debrecen only — Budapest is dropped entirely.
  const put = await j("/api/companies/" + cid, { method: "PUT", token: btok, body: {
    serviceAreas: [{ city: "Debrecen", mode: "all" }] } });
  ok("the partner narrows their coverage to one town", put.status === 200, `got ${put.status}`);

  const budList = await j(`/api/companies?near=${encodeURIComponent("Deak Ferenc ter 1")}&city=Budapest`);
  ok("  the Budapest customer's LIST drops them", !(budList.data.companies || []).some((c) => c.id === cid));

  const budBook = await j("/api/bookings", { method: "POST", token: inBudCentre, body: {
    companyId: cid, serviceId: svc.rows[0].id, scheduledDate: dPlus(20), scheduledSlot: "11:00",
    address: "Deak Ferenc ter 1", city: "Budapest", paymentMethod: "cash" } });
  ok("  and their BOOKING is refused", budBook.status === 400, `got ${budBook.status}`);
  ok("  with a message naming where the company does work",
     /They work in:\s*Debrecen/.test(budBook.data.error || ""), budBook.data.error);

  const debList = await j(`/api/companies?near=${encodeURIComponent("Nagyerdei korut 98")}&city=Debrecen`);
  ok("  the Debrecen customer still sees them", (debList.data.companies || []).some((c) => c.id === cid));
  const debBook = await j("/api/bookings", { method: "POST", token: inDeb, body: {
    companyId: cid, serviceId: svc.rows[0].id, scheduledDate: dPlus(21), scheduledSlot: "11:00",
    address: "Nagyerdei korut 98", city: "Debrecen", paymentMethod: "cash" } });
  ok("  and can still book", debBook.status < 300, `${debBook.status} ${debBook.data.error || ""}`);

  // The admin's own view of the same company
  const adminCo = (await query("SELECT service_areas FROM companies WHERE id = $1", [cid])).rows[0];
  const stored2 = typeof adminCo.service_areas === "string" ? JSON.parse(adminCo.service_areas) : adminCo.service_areas;
  ok("  the admin reads the same one list", stored2.length === 1 && stored2[0].city === "Debrecen", JSON.stringify(stored2));
}

console.log("\n── every screen that claims to know about coverage ──");
{
  const fs = await import("fs");
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const adm = fs.readFileSync(new URL("../server/routes/admin.js", import.meta.url), "utf8");

  ok("the customer's home list judges coverage by areas, not the old city list",
     /\.filter\(\(c\) => !city \|\| coversCityClient\(c, city\)\)/.test(app));
  ok("the client's twin exists and reads areasOf()",
     /const coversCityClient = \(co, cityRaw\) =>[\s\S]{0,400}areasOf\(co\)/.test(app));
  ok("the company card shows real coverage, not the free-text blurb",
     /areaSummaryClient\(co\) \|\| co\.city/.test(app));
  ok("the setup checklist is satisfied by an AREA, not a typed city name",
     /k: "where", ok: \(f\.service_areas \|\| \[\]\)\.length > 0/.test(app));
  ok("the admin dossier lists the areas", /L\("Areas served", "Ellátott területek"\)/.test(app));
  const adminBlock = app.slice(app.indexOf("function AdminCompanies"), app.indexOf("function AdminCompanies") + 9000);
  ok("the admin's dead radius slider is gone", !/f\.service_radius_km/.test(adminBlock), "still editable");
  ok("and the server no longer lets an admin edit a column that decides nothing",
     !/"service_radius_km"/.test(adm) && !/"service_lat"/.test(adm));
  ok("the admin API does return the areas it displays", /service_areas/.test(adm));

  /* The last one is the one that bites: a screen reading a column the areas
     model replaced is a screen showing something that is no longer true. */
  const migration = app.slice(app.indexOf("function areasOf(co)"), app.indexOf("const areaTitle"));
  const screens = app.replace(migration, "");
  const stale = [...screens.matchAll(/co\.service_cities|co\.service_radius_km/g)].length;
  ok("only the migration helper still reads the retired columns", stale === 0, `${stale} left`);
  ok("…and the migration helper genuinely does read them, or old accounts break",
     /co\?\.service_lat/.test(migration) && /service_cities/.test(migration));
}

console.log(`\n════ SERVICE AREAS: ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
