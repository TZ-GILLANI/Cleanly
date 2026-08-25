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


console.log("\n── a migration you have not run yet must not brick the app ──");
{
  /* The real failure: /api/companies asks for service_areas and eu_vat. If
     schema.sql has not been run, the SELECT fails, the endpoint 500s, and
     because the app loads the company list WHILE SIGNING IN, nobody can log
     in at all — not even to reach Profile and fix whatever upset it.

     A missing optional column should cost a feature, not the product. */
  const co = fs.readFileSync(new URL("../server/routes/companies.js", import.meta.url), "utf8");
  const db = fs.readFileSync(new URL("../server/db.js", import.meta.url), "utf8");
  /* Behaviour is covered end to end in test/migration.mjs, which boots against
     a database missing both columns. What matters here is that NOTHING decides
     this by reading an error message — Postgres and pg-mem word it
     differently, so that guard passes its own tests and fails in production. */
  ok("there is a hasColumn helper that asks the schema", /export async function hasColumn/.test(db));
  ok("it caches, so it costs one query per boot", /_cols\.set\(key, ok\)/.test(db));
  ok("the listing builds its columns from what exists", /for \(const c of \["service_areas", "eu_vat"\]\) if \(await hasColumn/.test(co));
  ok("so does the update", /if \(!\(await hasColumn\("companies", col\)\)\) continue;/.test(co));
  ok("nothing matches on the wording of a database error",
     !/does not exist\|undefined column/.test(co), "error-text matching is back");
  ok("and a missing column is named in the log", /is missing — run schema\.sql/.test(db));

  const st = fs.readFileSync(new URL("../src/store.jsx", import.meta.url), "utf8");
  ok("signing in no longer throws the session away when a list fails",
     !/setToken\(null\); return \{ error: L\("Could not load your data/.test(st));
  const survivors = (st.match(/catch \(e\) \{ console\.error\("post-(login|signup) load failed/g) || []).length;
  ok("…on every path that signs somebody in, not just one", survivors === 4, `${survivors} of 4`);
}


console.log("\n── one theme, not two half-themes ──");
{
  /* A fixed hex sitting in the same style object as a themed token is a colour
     that was chosen for ONE of the two modes. It looks right in whichever mode
     it was picked in and wrong in the other, which is why light mode kept
     showing colours that belonged to the old palette. */
  const lines = app.split("\n");
  const bad = [];
  lines.forEach((ln, i) => {
    if (i < 300 || /^\s*(\/\/|\*|\/\*)/.test(ln)) return;
    const hex = [...ln.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]).filter((h) => !/^#(fff|FFF|000)/.test(h));
    if (!hex.length) return;
    if (/C\.(card|bg|ink|line|coralSoft|amberSoft|mintSoft|navyChip|shell)\b/.test(ln))
      bad.push(`${i + 1}: ${hex.join(",")}`);
  });
  ok("no fixed colour shares a style object with a themed one", bad.length === 0, bad.join(" | "));
  ok("and the palettes still define the same set of tokens in both modes", (() => {
    const grab = (n) => app.slice(app.indexOf(`const ${n} = {`), app.indexOf("};", app.indexOf(`const ${n} = {`)));
    const keys = (b) => new Set([...b.matchAll(/(\w+):\s*"/g)].map((m) => m[1]));
    const l = keys(grab("LIGHT")), d = keys(grab("DARK"));
    return l.size === d.size && [...l].every((k) => d.has(k));
  })());
}


console.log("\n── you can tell which code is live ──");
{
  const idx = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  /* Read the number from package.json rather than writing it here. A test
     that hardcodes the version fails on the next bump for no reason, and the
     habit of editing a test to make it pass is how a real failure gets waved
     through. */
  const pkgV = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  ok("/api/health reports the build version", idx.includes(`version: "${pkgV}"`), pkgV);
  /* Names the columns rather than pinning the exact string, so adding one to
     the level does not fail a test that is not about that. */
  ok("…and which migration the code expects",
     /schemaLevel: "[^"]*service_areas[^"]*eu_vat[^"]*"/.test(idx),
     (idx.match(/schemaLevel: "[^"]*"/) || [""])[0]);
  ok("…and whether the database has caught up", /MIGRATION_PENDING/.test(idx));
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const health = /version: "([\d.]+)"/.exec(idx)[1];
  const client = /const APP_VERSION = "([\d.]+)"/.exec(app)[1];
  /* Three copies of one number. When they disagree, /api/health tells you a
     version that is not what the app thinks it is, which defeats the whole
     point of adding it. */
  ok("server, client and package.json all report the same version",
     health === pkg.version && client === pkg.version,
     `health=${health} client=${client} package=${pkg.version}`);
}


console.log("\n── hooks that can be skipped ──");
{
  /* AdminDashboard called useStore() INSIDE its JSX, after two early returns.
     First render (loading) React counted four hooks; second render (data in)
     it counted five. A hook count that changes between renders is the one
     thing React cannot recover from — it throws, the boundary catches it, and
     the admin gets a crash screen. It had been printing as a warning in the
     render suite for a while, and a warning nobody reads is not a test. */
  /* Blank out comments FIRST, keeping line numbers, then scan.

     A per-line "does it start with //" test cannot see the middle of a block
     comment — and the paragraph I wrote explaining this very bug quotes the
     broken line, so the check kept flagging its own documentation. */
  const stripped = app
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
  const lines = stripped.split("\n");
  let fn = null, returned = false;
  const bad = [];
  lines.forEach((ln, i) => {
    const m = /^function ([A-Z]\w+)\s*\(/.exec(ln) || /^const ([A-Z]\w+) = \(/.exec(ln);
    if (m) { fn = m[1]; returned = false; return; }
    if (!fn) return;
    if (/^  (if \([^)]*\)\s*)?return\b/.test(ln)) returned = true;
    const hook = /\buseStore\(\)|\bReact\.use[A-Z]\w*\(|\buseState\(|\buseEffect\(|\buseMemo\(|\buseCallback\(|\buseRef\(/.test(ln);
    if (!hook) return;
    const inJsx = /^\s*[{<]/.test(ln) || /\{\s*use[A-Z]/.test(ln);
    if (returned || inJsx) bad.push(`${i + 1} ${fn}: ${ln.trim().slice(0, 70)}`);
  });
  ok("no hook is called after an early return or inside JSX", bad.length === 0, bad.join(" | "));
  ok("and the scan walked the whole component tree", lines.length > 5000, `${lines.length} lines`);
}

console.log(`\n════ WIRED: ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
