/* A DATABASE THAT HAS NOT CAUGHT UP.

   Musa ran schema.sql, then I added another column, then he could not save
   anything: "Failed to update company", behind which the whole UPDATE was
   being rejected for one optional field he had never used.

   I fixed that twice badly before this. The first attempt retried on failure
   by matching the error text — but Postgres says `column "eu_vat" ... does not
   exist` while pg-mem says `Column "eu_vat" not found`, so the guard passed
   its own tests and would still have failed on his database. It also left the
   stripped column's $N parameter in the array, which Postgres rejects.

   So the statement is now built from what the schema actually has. This test
   boots against a database missing those columns and insists the partner can
   still save everything else.

   Run: node test/migration.mjs                                               */
process.env.PGMEM = "1"; process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "mig"; process.env.PORT = "4652";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };
const j = async (p, { method = "GET", token, body } = {}) => {
  const r = await fetch("http://localhost:4652" + p, { method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

await import("../server/index.js");
await new Promise((r) => setTimeout(r, 900));
const { query, hasColumn } = await import("../server/db.js");

/* Drop BEFORE anything reads the schema. hasColumn caches, and in production
   a column only appears via a redeploy — so a server that never saw it is the
   honest simulation, not one that saw it and then lost it. */
console.log("\n── a database still on the previous migration ──");
for (const c of ["eu_vat", "service_areas"]) {
  try { await query(`ALTER TABLE companies DROP COLUMN ${c}`); } catch {}
}
ok("eu_vat really is gone", (await hasColumn("companies", "eu_vat")) === false);
ok("service_areas really is gone", (await hasColumn("companies", "service_areas")) === false);

const reg = await j("/api/auth/register", { method: "POST", body: {
  fullName: "Boss", email: "mig@t.hu", password: "secret123", role: "company",
  companyName: "Mig Kft", taxId: "10000001-1-02", city: "Debrecen",
  phone: "+36301112233", termsAccepted: true } });
ok("a company can still register", reg.status === 201 || reg.status === 200, `got ${reg.status}`);
const cid = (await query("SELECT id FROM companies WHERE name = $1", ["Mig Kft"])).rows[0].id;
await query("UPDATE users SET approval_status = 'approved' WHERE email = $1", ["mig@t.hu"]);
await query("UPDATE companies SET is_listed = true, is_approved = true WHERE id = $1", [cid]);
const tok = (await j("/api/auth/login", { method: "POST", body: { email: "mig@t.hu", password: "secret123" } })).data.token;
ok("and log in", !!tok);

console.log("\n── the partner can still run their business ──");
const save = await j("/api/companies/" + cid, { method: "PUT", token: tok, body: {
  name: "Mig Renamed", tagline: "We clean", city: "Debrecen", country: "HU",
  billingAddress: "Fo utca 1", billingCity: "Debrecen", billingZip: "4024",
  /* Sent by the app even though the columns are not there — the client has no
     idea which migration the server is on, and should not need to. */
  serviceAreas: [{ city: "Debrecen", mode: "all" }],
  serviceCities: ["Debrecen"], euVat: "HU10000001",
} });
ok("saving the company SUCCEEDS", save.status === 200, `${save.status} ${JSON.stringify(save.data).slice(0, 140)}`);
const row = (await query("SELECT name, tagline, billing_address, billing_zip FROM companies WHERE id = $1", [cid])).rows[0];
ok("the name saved", row.name === "Mig Renamed", row.name);
ok("the tagline saved", row.tagline === "We clean", row.tagline);
ok("the billing address saved", row.billing_address === "Fo utca 1", row.billing_address);
ok("the postcode saved", row.billing_zip === "4024", row.billing_zip);

console.log("\n── and the customer side degrades instead of dying ──");
const list = await j("/api/companies");
ok("the company listing still answers", list.status === 200, `got ${list.status}`);
ok("and still returns the company", (list.data.companies || []).some((c) => c.id === cid));
const near = await j(`/api/companies?near=${encodeURIComponent("Piac utca 1, Debrecen")}&city=Debrecen`);
ok("even with an address to filter by", near.status === 200, `got ${near.status}`);

const health = await j("/api/health");
ok("health reports the migration as pending", health.data.schema === "MIGRATION_PENDING",
   JSON.stringify(health.data));
/* From package.json, not written out here — a version pinned inside a test
   fails on the next bump for no reason, and editing a test to make it pass is
   how a real failure gets waved through. */
const PKG_VERSION = JSON.parse((await import("fs")).readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
ok("and still says which build is running", health.data.version === PKG_VERSION, health.data.version);

console.log(`\n════ MIGRATION LAG: ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
