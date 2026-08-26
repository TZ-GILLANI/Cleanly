/* THREE THINGS MUSA FOUND BY USING THE APP.

   1. "The rate this clean button keeps on appearing again and again."
      GET /api/reviews never selected booking_id, so the check the screen uses
      — reviews.some(r => r.booking_id === b.id) — was always false after a
      refresh. The button came back on every poll, every 25 seconds, for a
      review already left. The server had been refusing the duplicate all
      along; only the screen was wrong.

   2. "There is no place to upload the invoice."
      There was, but it rendered nothing at all unless the job was BOTH
      completed and paid — two silent early returns. On the jobs he was looking
      at there genuinely was no upload box and nothing said why. And the simple
      /bookings/:id/invoice route stored the file and emailed nobody.

   3. "The cleaner doesn't have the option to see the customer's location."
      They had the address as a line of text. No map, no directions, and the
      cleaner's own booking row did not even carry the customer's phone number.

   Run: node test/threefixes.mjs                                              */
process.env.PGMEM = "1";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "3f-test";
process.env.PORT = "4608";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };

const BASE = "http://localhost:4608";
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
  fullName: "B", email: "3f-b@t.hu", password: "secret123", role: "company",
  companyName: "Three Kft", taxId: "10000001-1-02", city: "Debrecen",
  phone: "+36301112233", termsAccepted: true } });
const cid = (await query("SELECT id FROM companies WHERE name = $1", ["Three Kft"])).rows[0].id;
await query("UPDATE companies SET is_listed = true, is_approved = true WHERE id = $1", [cid]);
await query("UPDATE users SET approval_status = 'approved' WHERE email = $1", ["3f-b@t.hu"]);
const coTok = (await j("/api/auth/login", { method: "POST", body: { email: "3f-b@t.hu", password: "secret123" } })).data.token;
const svcId = (await query(`INSERT INTO services (company_id,name,description,price_huf,minutes,is_active)
  VALUES ($1,'Deep clean','x',12000,60,true) RETURNING id`, [cid])).rows[0].id;
const cuTok = (await j("/api/auth/register", { method: "POST", body: {
  fullName: "Ana", email: "3f-c@t.hu", password: "secret123", role: "customer", customerType: "resident",
  city: "Debrecen", address: "Piac utca 1", phone: "+36703031941", termsAccepted: true } })).data.token;

const bk = await j("/api/bookings", { method: "POST", token: cuTok, body: {
  companyId: cid, serviceId: svcId, scheduledDate: dPlus(5), scheduledSlot: "10:00",
  address: "Piac utca 1, Debrecen", city: "Debrecen", paymentMethod: "cash" } });
const bid = bk.data.booking.id;
await query("UPDATE bookings SET status = 4, payment_status = 'paid' WHERE id = $1", [bid]);

console.log("\n── 1. the review prompt stops nagging ──");
{
  const posted = await j("/api/reviews", { method: "POST", token: cuTok, body: {
    bookingId: bid, companyId: cid, stars: 5, body: "Spotless" } });
  ok("the customer can leave a review", posted.status === 200 || posted.status === 201, `got ${posted.status}`);

  /* Exactly what the app does on its next 25-second poll. */
  const list = await j("/api/reviews");
  const mine = (list.data.reviews || []).find((r) => r.booking_id === bid);
  ok("the review comes back carrying its booking id", !!mine, JSON.stringify((list.data.reviews || [])[0] || {}).slice(0, 120));
  ok("so the screen can tell this booking is already rated", (list.data.reviews || []).some((r) => r.booking_id === bid));

  const again = await j("/api/reviews", { method: "POST", token: cuTok, body: {
    bookingId: bid, companyId: cid, stars: 3, body: "again" } });
  ok("and a second review is refused, as it always was", again.status === 400, `got ${again.status}`);

  const fs = await import("fs");
  const rev = fs.readFileSync(new URL("../server/routes/reviews.js", import.meta.url), "utf8");
  ok("booking_id is in the SELECT, not just the table", /SELECT r\.id, r\.booking_id, r\.company_id/.test(rev));
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  ok("the screen still decides from that field", /const reviewed = reviews\.some\(\(r\) => r\.booking_id === b\.id\);/.test(app));
}

console.log("\n── 2. the invoice reaches the customer ──");
{
  const fs = await import("fs");
  const bkSrc = fs.readFileSync(new URL("../server/routes/bookings.js", import.meta.url), "utf8");
  ok("uploading an invoice now emails it", /Your invoice from \$\{w\.company_name\}/.test(bkSrc));
  ok("with the file attached, not just a link", /\[\{ filename: saved\.name, content: base64 \}\]/.test(bkSrc));
  ok("the data-URL prefix is stripped, or the attachment is unreadable",
     /String\(saved\.data\)\.includes\(","\) \? String\(saved\.data\)\.split\(","\)\.pop\(\)/.test(bkSrc));
  ok("and the customer gets an in-app notification too", /"Your invoice is ready/.test(bkSrc));
  /* Fire and forget: the partner should not watch a spinner while an SMTP
     server thinks about it, and a mail outage must not fail the upload. */
  {
    const route = bkSrc.slice(bkSrc.indexOf('router.put("/:id/invoice"'));
    const iife = route.indexOf("(async () => {");
    const respond = route.indexOf("res.json({ booking: r.rows[0] })");
    ok("the email is sent without awaiting it", iife > -1 && /invoice email:/.test(route.slice(iife, respond)));
    ok("and the response goes back first", respond > iife, `${respond} vs ${iife}`);
  }

  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  ok("an unpaid finished job explains why it cannot be invoiced yet",
     /You can upload the invoice once this job is paid\./.test(app));
  ok("rather than rendering nothing at all", !/if \(booking\.status !== 4 \|\| booking\.payment_status !== "paid"\) return null;/.test(app));
  ok("and a slow lookup says it is checking", /Checking invoice…/.test(app));

  /* The route the upload box actually posts to. */
  const inv = fs.readFileSync(new URL("../server/routes/invoices.js", import.meta.url), "utf8");
  ok("the partner-invoice route emails the customer as well", /sendEmail\(row\.email/.test(inv));

  const early = await j(`/api/bookings/${bid}/invoice`, { method: "PUT", token: coTok, body: {
    invoice: { name: "szamla.pdf", type: "application/pdf", data: "data:application/pdf;base64,SGVsbG8=" } } });
  ok("a completed, paid job accepts the upload", early.status === 200, JSON.stringify(early.data).slice(0, 120));
  const stored = (await query("SELECT invoice FROM bookings WHERE id = $1", [bid])).rows[0].invoice;
  const parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
  ok("and it is stored against the booking", parsed?.name === "szamla.pdf", JSON.stringify(parsed).slice(0, 80));
  const seen = ((await j("/api/bookings", { token: cuTok })).data.bookings || []).find((b) => b.id === bid);
  ok("the customer can see it in the app as well as their inbox", !!seen?.invoice);
}

console.log("\n── 3. the cleaner can find the customer ──");
{
  const inv = await j("/api/employees/invites", { method: "POST", token: coTok, body: { note: "t" } }).catch(() => ({ data: {} }));
  await j("/api/auth/register", { method: "POST", body: {
    fullName: "Cl", email: "3f-cl@t.hu", password: "secret123", role: "employee",
    phone: "+36302223344", city: "Debrecen", companyId: cid,
    inviteCode: inv?.data?.invite?.code, termsAccepted: true } });
  const clRow = await query("SELECT id FROM users WHERE email = $1", ["3f-cl@t.hu"]);
  ok("a cleaner exists to test with", clRow.rows.length === 1);
  await query("UPDATE users SET approval_status = 'approved' WHERE email = $1", ["3f-cl@t.hu"]);
  const clTok = (await j("/api/auth/login", { method: "POST", body: { email: "3f-cl@t.hu", password: "secret123" } })).data.token;
  await query("UPDATE bookings SET assigned_to = $1, status = 1 WHERE id = $2", [clRow.rows[0].id, bid]);

  const job = ((await j("/api/bookings", { token: clTok })).data.bookings || []).find((b) => b.id === bid);
  ok("the cleaner sees the job", !!job);
  ok("with the full address to navigate to", job?.address === "Piac utca 1, Debrecen", String(job?.address));
  ok("and the customer's phone number, so Call is not a dead button",
     job?.customer_phone === "+36703031941", String(job?.customer_phone));
  ok("and the customer's name", job?.customer_name === "Ana", String(job?.customer_name));

  const fs = await import("fs");
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  ok("there is a directions block", /function GoThere\(\{ address, phone, compact \}\)/.test(app));
  ok("it offers Apple Maps", /https:\/\/maps\.apple\.com\/\?daddr=\$\{q\}/.test(app));
  ok("and Google Maps", /https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=\$\{q\}/.test(app));
  ok("both open directions rather than just dropping a pin",
     /dirflg=d/.test(app) && /maps\/dir\//.test(app));
  ok("the phone's own map app is offered first", /isApple \? \[apple, google\] : \[google, apple\]/.test(app));
  ok("it is on the cleaner's job card", /<GoThere address=\{b\.address\} phone=\{b\.customer_phone\} \/>/.test(app));
  /* Slice to the NEXT top-level function rather than a guessed number of
     characters — a magic window silently stops meaning anything the moment the
     component grows, which is how a check ends up passing for the wrong
     reason. */
  {
    const start = app.indexOf("function EmployeeJobs(");
    const rest = app.slice(start + 20);
    const end = start + 20 + rest.search(/\nfunction [A-Z]/);
    const emp = app.slice(start, end);
    ok("inside the cleaner's own screen, not somewhere else", /<GoThere/.test(emp));
    ok("and the slice really is that component", /function EmployeeJobs\(/.test(emp) && !/function EmployeeNotices/.test(emp));
  }
  ok("and it does nothing at all without an address", /if \(!address\) return null;/.test(app));
}

console.log(`\n════ THREE FIXES: ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
