/* THE TWO REPORT BUTTONS, AND THE MISSING STARS.

   "Report this customer" and "report this review" both refused to work. The
   buttons were fine and so were the endpoints — they write to a table and to
   columns that sit near the END of schema.sql, added after the live database
   was first built and never run since, because the full file times out in the
   Supabase editor. There was nowhere to put the report.

   And neither told an ADMIN. Both have a moderation queue; nothing ever said
   go and look at it. A report that reaches no one is the same as no report.

   The stars were a third thing: stars(n) was "★".repeat(n) until the emoji
   trim removed the characters, leaving "".repeat(n). Every rating rendered as
   an empty string, so a company could read a review with no idea whether it
   was five stars or one.

   Run: node test/reports.mjs                                                 */
process.env.PGMEM = "1";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "rep-test";
process.env.PORT = "4615";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };
import fs from "fs";

const BASE = "http://localhost:4615";
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

await j("/api/auth/register", { method: "POST", body: {
  fullName: "Boss", email: "rep-b@t.hu", password: "secret123", role: "company",
  companyName: "Report Kft", taxId: "10000001-1-02", city: "Debrecen",
  phone: "+36301112233", termsAccepted: true } });
const cid = (await query("SELECT id FROM companies WHERE name = $1", ["Report Kft"])).rows[0].id;
await query("UPDATE companies SET is_listed = true, is_approved = true WHERE id = $1", [cid]);
await query("UPDATE users SET approval_status = 'approved' WHERE email = $1", ["rep-b@t.hu"]);
const coTok = (await j("/api/auth/login", { method: "POST", body: { email: "rep-b@t.hu", password: "secret123" } })).data.token;
const svcId = (await query(`INSERT INTO services (company_id,name,description,price_huf,minutes,is_active)
  VALUES ($1,'Deep clean','x',12000,60,true) RETURNING id`, [cid])).rows[0].id;
const cuTok = (await j("/api/auth/register", { method: "POST", body: {
  fullName: "Ana", email: "rep-c@t.hu", password: "secret123", role: "customer", customerType: "resident",
  city: "Debrecen", address: "Piac utca 1", phone: "+36703031941", termsAccepted: true } })).data.token;

await query(`INSERT INTO users (email,password_hash,role,full_name,city,approval_status,terms_accepted_at)
  VALUES ('rep-admin@t.hu','x','admin','Admin','Debrecen','approved',NOW())`);
const adminId = (await query("SELECT id FROM users WHERE email = $1", ["rep-admin@t.hu"])).rows[0].id;

const bk = await j("/api/bookings", { method: "POST", token: cuTok, body: {
  companyId: cid, serviceId: svcId, scheduledDate: dPlus(4), scheduledSlot: "10:00",
  address: "Piac utca 1", city: "Debrecen", paymentMethod: "cash" } });
const bid = bk.data.booking.id;
await query("UPDATE bookings SET status = 4, payment_status = 'paid' WHERE id = $1", [bid]);

console.log("\n── the tables both buttons need ──");
{
  const tbl = await query("SELECT id FROM customer_reports LIMIT 0").then(() => true).catch(() => false);
  ok("customer_reports exists", tbl);
  const cols = await query("SELECT reported_at, reported_reason, removed_at FROM reviews LIMIT 0").then(() => true).catch(() => false);
  ok("reviews carries the moderation columns", cols);

  /* The file Musa actually pastes into Supabase lives in the repo root, so it
     travels with the code and can be checked here. */
  const sqlFile = fs.readFileSync(new URL("../RUN-THIS-IN-SUPABASE.sql", import.meta.url), "utf8");
  ok("and the file Musa runs creates them", /CREATE TABLE IF NOT EXISTS customer_reports/.test(sqlFile)
     && /ADD COLUMN IF NOT EXISTS reported_at/.test(sqlFile));
  const idx = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  ok("the health check would have caught this", /FROM customer_reports LIMIT 0/.test(idx)
     && /reported_at, removed_at FROM reviews/.test(idx));
}

console.log("\n── report this customer ──");
{
  const r = await j("/api/customer-reports", { method: "POST", token: coTok, body: {
    bookingId: bid, category: "abusive", detail: "Shouted at the cleaner and refused entry." } });
  ok("the company can file it", r.status === 201, JSON.stringify(r.data).slice(0, 140));

  const row = await query("SELECT * FROM customer_reports WHERE booking_id = $1", [bid]);
  ok("it is stored", row.rows.length === 1);
  ok("against the right customer", !!row.rows[0]?.customer_id);
  ok("and it is open, waiting on an admin", row.rows[0]?.status === "open");

  const notes = await query("SELECT * FROM notifications WHERE user_id = $1", [adminId]);
  ok("an ADMIN is told about it", notes.rows.some((n) => /reported a customer/i.test(n.title || "")),
     JSON.stringify(notes.rows.map((n) => n.title)).slice(0, 140));

  const dup = await j("/api/customer-reports", { method: "POST", token: coTok, body: {
    bookingId: bid, category: "abusive", detail: "Same thing again, reported twice." } });
  ok("the same booking cannot be reported twice", dup.status === 400, `got ${dup.status}`);

  const asCust = await j("/api/customer-reports", { method: "POST", token: cuTok, body: {
    bookingId: bid, category: "abusive", detail: "Reporting myself for a laugh." } });
  ok("a customer cannot file one", asCust.status === 403, `got ${asCust.status}`);

  const short = await j("/api/customer-reports", { method: "POST", token: coTok, body: {
    bookingId: bid, category: "abusive", detail: "bad" } });
  ok("a one-word report is refused", short.status === 400, `got ${short.status}`);
}

console.log("\n── report this review ──");
{
  const rv = await j("/api/reviews", { method: "POST", token: cuTok, body: {
    bookingId: bid, companyId: cid, stars: 1, body: "Terrible, never again" } });
  ok("the customer can leave a review", rv.status === 200 || rv.status === 201, `got ${rv.status}`);
  const rid = (await query("SELECT id FROM reviews WHERE booking_id = $1", [bid])).rows[0].id;

  const before = (await query("SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1", [adminId])).rows[0].n;
  const rep = await j(`/api/reviews/${rid}/report`, { method: "POST", token: coTok, body: {
    reason: "This is about a different company entirely." } });
  ok("the company can report it", rep.status === 200, JSON.stringify(rep.data).slice(0, 140));

  const row = (await query("SELECT reported_at, reported_reason FROM reviews WHERE id = $1", [rid])).rows[0];
  ok("the report is recorded on the review", !!row.reported_at, String(row.reported_at));
  ok("with the reason given", /different company/.test(row.reported_reason || ""), String(row.reported_reason));

  const after = (await query("SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1", [adminId])).rows[0].n;
  ok("an ADMIN is told about this one too", after > before, `${before} → ${after}`);

  const queue = await query("SELECT id FROM reviews WHERE reported_at IS NOT NULL AND removed_at IS NULL");
  ok("and it lands in the moderation queue", queue.rows.some((x) => x.id === rid));

  const asCust = await j(`/api/reviews/${rid}/report`, { method: "POST", token: cuTok, body: { reason: "I changed my mind about this" } });
  ok("a customer cannot report a review", asCust.status === 403, `got ${asCust.status}`);
  const empty = await j(`/api/reviews/${rid}/report`, { method: "POST", token: coTok, body: { reason: "no" } });
  ok("and a two-letter reason is refused", empty.status === 400, `got ${empty.status}`);
}

console.log("\n── the stars are visible again ──");
{
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  ok("stars are drawn as shapes, not repeated characters",
     /const stars = \(n\) => \{/.test(app) && /<Star key=\{i\} filled=\{i < filled\}/.test(app));
  ok("the hollowed-out version is gone", !/"".repeat\(Math\.round\(n \|\| 0\)\)/.test(app));
  ok("a rating is clamped to five", /Math\.min\(5, Math\.round\(Number\(n\) \|\| 0\)\)/.test(app));
  ok("and it carries a label for a screen reader", /aria-label=\{`\$\{filled\} \/ 5`\}/.test(app));

  const rvRoute = fs.readFileSync(new URL("../server/routes/reviews.js", import.meta.url), "utf8");
  ok("the company's review list actually sends the rating", /rv\.stars AS rating/.test(rvRoute));
  const list = await j("/api/reviews/company", { token: coTok });
  ok("and it arrives", (list.data.reviews || []).every((r) => Number.isFinite(Number(r.rating))),
     JSON.stringify((list.data.reviews || []).map((r) => r.rating)));
  ok("with the star count the customer chose", (list.data.reviews || [])[0]?.rating === 1,
     String((list.data.reviews || [])[0]?.rating));
}

console.log("\n── subscribers count live plans, not attempts ──");
{
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  ok("a plan counts only once it exists", /if \(b\.pricing_type !== "subscription" \|\| !b\.subscription_id\) return false;/.test(app));
  ok("and each plan counts once, not once per visit", /if \(seen\.has\(b\.subscription_id\)\) return false;/.test(app));
  /* Tightened after Musa saw "1 active subscriber" survive a cancellation:
     a cancelled plan keeps its paid visits (status < 8), so open visits were
     never the honest test. The plan's own status is. */
  ok("a cancelled plan's leftover visits do not count as a subscriber",
     /if \(b\.subscription_status && b\.subscription_status !== "active"\) return false;/.test(app));
  ok("the client list uses the same test",
     /b\.subscription_id && b\.status < 8 &&\n\s*\(!b\.subscription_status \|\| b\.subscription_status === "active"\)/.test(app));
  const srv = fs.readFileSync(new URL("../server/routes/bookings.js", import.meta.url), "utf8");
  ok("and the server actually sends the plan's status with each visit",
     /s\.status AS subscription_status/.test(srv) && /LEFT JOIN subscriptions s ON s\.id = b\.subscription_id/.test(srv));
  ok("the banner is gone when there are none", /\{subs\.length > 0 && \(/.test(app));
}

console.log(`\n════ REPORTS, STARS, SUBSCRIBERS: ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
