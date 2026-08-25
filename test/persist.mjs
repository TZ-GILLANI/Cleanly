/* WHAT MUST NOT VANISH ON A REFRESH.

   "Some of the logos and tasks don't show up, or disappear."

   The cause was not the refresh. It was that a booking card asked a FILTERED
   LIST who the company was:

       const co = companies.find(c => c.id === b.company_id)

   For a customer, that list is /companies?near=<their address>, filtered by
   service area AND is_listed AND is_approved. So a company that pauses its
   listing, edits its areas, or simply does not cover the address the customer
   is standing at drops out — and every booking they already have loses its
   name and its logo. The booking was never wrong; the lookup had nothing to
   find. And since the app re-runs that query on every refresh, it showed as
   "it was there, then it went".

   The service already travelled with the booking as service_snapshot. The
   company travels with it now too.

   Run: node test/persist.mjs                                                 */
process.env.PGMEM = "1";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "pv-test";
process.env.PORT = "4604";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };

const BASE = "http://localhost:4604";
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
const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANS";

await j("/api/auth/register", { method: "POST", body: {
  fullName: "B", email: "pv-b@t.hu", password: "secret123", role: "company",
  companyName: "Persist Kft", taxId: "10000001-1-02", city: "Debrecen",
  phone: "+36301112233", termsAccepted: true } });
const cid = (await query("SELECT id FROM companies WHERE name = $1", ["Persist Kft"])).rows[0].id;
await query("UPDATE companies SET is_listed = true, is_approved = true, logo_url = $1 WHERE id = $2", [LOGO, cid]);
await query("UPDATE users SET approval_status = 'approved' WHERE email = $1", ["pv-b@t.hu"]);
const svcId = (await query(`INSERT INTO services (company_id,name,description,price_huf,minutes,is_active,tasks)
  VALUES ($1,'Deep clean','x',12000,120,true,$2) RETURNING id`, [cid, JSON.stringify(["Hoover", "Windows", "Kitchen"])])).rows[0].id;

const cuTok = (await j("/api/auth/register", { method: "POST", body: {
  fullName: "C", email: "pv-c@t.hu", password: "secret123", role: "customer", customerType: "resident",
  city: "Debrecen", address: "Piac utca 1", phone: "+36703031941", termsAccepted: true } })).data.token;
const bk = await j("/api/bookings", { method: "POST", token: cuTok, body: {
  companyId: cid, serviceId: svcId, scheduledDate: dPlus(7), scheduledSlot: "10:00",
  address: "Piac utca 1", city: "Debrecen", paymentMethod: "cash" } });
const bid = bk.data.booking.id;

const mine = async (tok) => ((await j("/api/bookings", { token: tok })).data.bookings || []).find((b) => b.id === bid);

console.log("\n── the booking knows who it is with, on its own ──");
{
  const b = await mine(cuTok);
  ok("the company's name rides on the booking", b.company_name === "Persist Kft", String(b.company_name));
  ok("so does its logo", b.company_logo_url === LOGO, String(b.company_logo_url).slice(0, 20));
  ok("and its emoji, for companies with no logo", !!b.company_emoji, String(b.company_emoji));
  ok("the task list rides on it too", (b.service_snapshot?.tasks || []).length === 3,
     JSON.stringify(b.service_snapshot?.tasks));
}

console.log("\n── now break every list the card used to depend on ──");
await query("UPDATE companies SET is_listed = false WHERE id = $1", [cid]);
await query("UPDATE services SET is_active = false WHERE id = $1", [svcId]);
await query("UPDATE companies SET service_areas = $1 WHERE id = $2",
  [JSON.stringify([{ city: "Szeged", mode: "all" }]), cid]);
{
  const list = await j(`/api/companies?near=${encodeURIComponent("Piac utca 1")}&city=Debrecen`);
  ok("the company really has dropped out of the customer's list",
     !(list.data.companies || []).some((c) => c.id === cid));
  const svcs = await j("/api/services");
  ok("and the service really has dropped out of the public list",
     !(svcs.data.services || []).some((s) => s.id === svcId));

  const b = await mine(cuTok);
  ok("but the booking still knows the company name", b.company_name === "Persist Kft", String(b.company_name));
  ok("and still carries the logo", b.company_logo_url === LOGO);
  ok("and still carries all three tasks", (b.service_snapshot?.tasks || []).length === 3);
}

console.log("\n── the cleaner keeps their own company too ──");
await query("UPDATE companies SET is_listed = true WHERE id = $1", [cid]);
const inv = await j("/api/employees/invites", { method: "POST", token:
  (await j("/api/auth/login", { method: "POST", body: { email: "pv-b@t.hu", password: "secret123" } })).data.token,
  body: { note: "t" } }).catch(() => ({ data: {} }));
await j("/api/auth/register", { method: "POST", body: {
  fullName: "Cl", email: "pv-cl@t.hu", password: "secret123", role: "employee",
  phone: "+36302223344", city: "Debrecen", companyId: cid,
  inviteCode: inv?.data?.invite?.code, termsAccepted: true } });
const clRow = await query("SELECT id FROM users WHERE email = $1", ["pv-cl@t.hu"]);
if (clRow.rows.length) {
  await query("UPDATE users SET approval_status = 'approved' WHERE email = $1", ["pv-cl@t.hu"]);
  const clTok = (await j("/api/auth/login", { method: "POST", body: { email: "pv-cl@t.hu", password: "secret123" } })).data.token;
  await query("UPDATE bookings SET assigned_to = $1, status = 1 WHERE id = $2", [clRow.rows[0].id, bid]);
  await query("UPDATE companies SET is_listed = false WHERE id = $1", [cid]);

  const b = ((await j("/api/bookings", { token: clTok })).data.bookings || []).find((x) => x.id === bid);
  ok("the cleaner's job names their employer even while it is unlisted",
     b?.company_name === "Persist Kft", String(b?.company_name));
  ok("and carries the checklist they have to work through",
     (b?.service_snapshot?.tasks || []).length === 3);
  const own = await j("/api/companies/" + cid, { token: clTok });
  ok("their own company row is fetchable by id, listed or not", own.data.company?.id === cid);
  ok("with the logo their header shows", own.data.company?.logo_url === LOGO);
} else {
  ok("cleaner registration produced an account", false, "no row — invite flow changed");
}

console.log("\n── the screens no longer depend on the filtered list ──");
{
  const fs = await import("fs");
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const store = fs.readFileSync(new URL("../src/store.jsx", import.meta.url), "utf8");
  ok("the customer card prefers what the booking carries",
     /const co = \(b\.company_name \|\| b\.company_logo_url\)/.test(app));
  ok("the company name on that card no longer needs the lookup",
     /\{co\?\.name \|\| b\.company_name \|\| ""\}/.test(app));
  ok("the cleaner's own company is loaded by id, like the owner's is",
     /sess\.companyId \? api\("\/companies\/" \+ sess\.companyId\)/.test(store));
}

console.log("\n── a string where an array belongs cannot reach a screen ──");
{
  const fs = await import("fs");
  const store = fs.readFileSync(new URL("../src/store.jsx", import.meta.url), "utf8");
  ok("bookings are normalised on the way in", /next\.bookings = \(bookings \|\| \[\]\)\.map\(cleanBooking\)/.test(store));
  ok("services too", /\.map\(cleanService\)/.test(store));
  ok("tasks_done is always an array", /tasks_done: arr\(b\.tasks_done\)/.test(store));
  ok("and so is the snapshot's task list", /return \{ \.\.\.sn, tasks: arr\(sn\.tasks\) \}/.test(store));
  const count = (store.match(/\.map\(cleanBooking\)/g) || []).length;
  ok("every role's bookings go through it, not just the customer's", count === 4, `${count} of 4`);
}

console.log("\n── a discount is visible before you choose, not after ──");
{
  /* The saving used to appear only on the confirmation screen, after the
     customer had already picked. A discount nobody sees while choosing is a
     discount that changes nothing. */
  const fs = await import("fs");
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  ok("the service row shows the percentage off", /<Pill bg=\{C\.mintSoft\} color=\{C\.greenDeep\}>−\{effPct\(s\)\}% \{discountName\(s\)\}<\/Pill>/.test(app));
  ok("the old price is struck through beside the new one",
     /textDecoration: "line-through" \}\}>\{priceLabel\(s\)\}/.test(app));
  ok("and the cash saving is spelled out", /L\("You save \{0\}", "Megtakarítasz \{0\}"\)/.test(app));
  ok("the badge names WHICH discount it is", /const discountName = \(s\) =>/.test(app));
  ok("a student rate is never shown to someone who is not a student",
     /const stuPct = isStudent \? Number\(company\.student_discount\) \|\| 0 : 0;/.test(app));
  ok("the row uses the same best-of-three the server charges by",
     /const best = Math\.max\(svcPct, coPct, stuPct\);/.test(app));
  ok("an hourly saving says so, rather than looking like a total",
     /pricing_type === "hourly" \? L\("\/hr", "\/óra"\)/.test(app));
  ok("no service without a discount grows a badge", /\{effPct\(s\) > 0 && \(/.test(app));
}

console.log(`\n════ NOTHING VANISHES: ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
