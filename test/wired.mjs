/* IS IT ACTUALLY WIRED?

   This codebase's signature failure is not a broken function — it is a correct
   function nothing calls. service_cities, distanceKm, return_slot,
   partner_invoice_nudged_at, the type:"phone" flag on the contact number: all
   written, all reviewed, none reached.

   So after every batch: for each thing built, is it referenced anywhere other
   than the line that defines it? A definition count of 1 means dead code.

   Run: node test/wired.mjs                                                   */
import fs from "fs";

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const store = fs.readFileSync(new URL("../src/store.jsx", import.meta.url), "utf8");
const srvFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = d + "/" + e.name;
    if (e.isDirectory()) walk(f);
    else if (/\.js$/.test(e.name)) srvFiles.push(f);
  }
})("server");
const srv = srvFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");

const count = (src, name) => {
  const re = new RegExp("\\b" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g");
  return (src.match(re) || []).length;
};

console.log("\n── service areas ──");
for (const [name, src, min, what] of [
  ["ServiceAreasEditor", app, 2, "the editor a partner uses"],
  ["AddAreaSheet", app, 2, "the add-a-place sheet"],
  ["areasOf", app, 2, "client migration from the old columns"],
  ["coversCityClient", app, 2, "the customer's home list filter"],
  ["areaSummaryClient", app, 2, "company card + admin dossier"],
  ["areaCovers", srv, 2, "the one server matcher"],
  ["serviceAreasOf", srv, 2, "server migration"],
  ["areaSummary", srv, 2, "the refusal message"],
  ["addressNamesCity", srv, 2, "fallback for old app builds"],
]) ok(`${name} — ${what}`, count(src, name) >= min, `only ${count(src, name)} mention(s)`);

console.log("\n── phone, verified everywhere ──");
for (const [name, src, min, what] of [
  ["ChangePhoneSheet", app, 2, "the change flow"],
  ["PhoneRow", app, 3, "customer, cleaner AND company"],
  ["phoneChangeStart", store, 2, "store action"],
  ["phoneChangeCheck", store, 2, "store action"],
  ["errText", app, 2, "turns a server code into a sentence"],
]) ok(`${name} — ${what}`, count(src, name) >= min, `only ${count(src, name)} mention(s)`);

console.log("\n── company identifiers ──");
for (const [name, src, min, what] of [
  ["euVatCheck", srv, 2, "server VAT validation"],
  ["euVatCheckC", app, 2, "client VAT validation"],
  ["vatWhy", app, 2, "explains a rejection"],
  ["formatRegNumberC", app, 2, "live dashes, client"],
  ["formatTaxIdLiveC", app, 2, "live dashes, client"],
  ["formatRegNumber", srv, 2, "dashes kept on save"],
  ["normalizeVat", srv, 2, "normalised before storing"],
]) ok(`${name} — ${what}`, count(src, name) >= min, `only ${count(src, name)} mention(s)`);

console.log("\n── report + city + calendar ──");
for (const [name, src, min, what] of [
  ["CustomerReports", app, 2, "the Report screen"],
  ["ComplaintThread", app, 2, "the live chat inside it"],
  ["applyCityFrom", app, 2, "city follows the address"],
  ["MonthCalendar", app, 3, "booking AND time-off"],
  ["hasDot", app, 2, "partial-availability dot"],
]) ok(`${name} — ${what}`, count(src, name) >= min, `only ${count(src, name)} mention(s)`);

console.log("\n── every column the app writes is one the schema creates ──");
{
  const schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
  const cols = new Set();
  for (const m of schema.matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)/g)) cols.add(m[1]);
  for (const m of schema.matchAll(/^\s{2}(\w+)\s+[A-Z]/gm)) cols.add(m[1]);
  const written = new Set();
  for (const m of srv.matchAll(/^\s*(\w+)\s*=\s*(?:COALESCE\(\$|CASE WHEN \$)/gm)) written.add(m[1]);
  const missing = [...written].filter((c) => !cols.has(c));
  ok("no UPDATE writes a column the schema never creates", missing.length === 0, missing.join(", "));
  ok("and the sweep found real columns to check", written.size > 15, `${written.size} found`);
  for (const c of ["service_areas", "eu_vat", "city", "phone_verified"])
    ok(`  ${c} is in schema.sql`, cols.has(c));
}

console.log("\n── nothing points at what was retired ──");
{
  const migration = app.slice(app.indexOf("function areasOf(co)"), app.indexOf("const areaTitle"));
  const screens = app.replace(migration, "");
  ok("no screen reads service_cities directly", !/co\.service_cities/.test(screens));
  ok("no screen reads service_radius_km directly", !/co\.service_radius_km/.test(screens));
  ok("servesCityClient is gone, not just unused", !/servesCityClient/.test(app));
  ok("the admin cannot edit a column that decides nothing",
     !/"service_radius_km"/.test(fs.readFileSync(new URL("../server/routes/admin.js", import.meta.url), "utf8")));
}

console.log(`\n════ WIRED: ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
