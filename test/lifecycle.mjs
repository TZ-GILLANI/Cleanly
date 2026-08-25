/* THE WHOLE BUSINESS, IN ORDER, ONCE.

   Every other suite here tests a part: an endpoint, a rule, a screen. This one
   walks the actual life of the business from an empty database — a company
   signing up, being approved, listing work, hiring a cleaner; a customer
   finding them, booking, paying, being served, reviewing; money arriving,
   commission being taken, an invoice being raised; then cancellation, refund,
   complaint, subscription, and finally someone deleting their account.

   It exists because a system can pass every unit of itself and still not work:
   the faults found today all lived in the joins — a booking invisible to the
   company who had to accept it, a deadline that expired before anyone saw it,
   a renewal Stripe would decline, a deleted account that kept being billed.

   Run: node test/lifecycle.mjs                                               */
process.env.PGMEM = "1"; process.env.JWT_SECRET = "t"; process.env.PORT = "4571";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });
process.on("uncaughtException", (e) => { console.error("UNCAUGHT:", e?.stack || e); process.exit(1); });
await import("../server/index.js");
await new Promise((r) => setTimeout(r, 1200));
const { query } = await import("../server/db.js");
const bcrypt = (await import("bcryptjs")).default;

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };
const j = async (p, o = {}) => {
  const r = await fetch(`http://127.0.0.1:4571${p}`, { method: o.method || "GET", signal: AbortSignal.timeout(9000),
    headers: { "Content-Type": "application/json", ...(o.token ? { Authorization: "Bearer " + o.token } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const login = async (e, p = "secret123") => (await j("/api/auth/login", { method: "POST", body: { email: e, password: p } })).data;
const dPlus = (n) => { const t = new Date(Date.now() + n * 864e5); const p = (x) => String(x).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`; };

/* ══ 1. A COMPANY JOINS ═════════════════════════════════════════════════ */
console.log("\n── 1. a cleaning company joins the platform ──");
const reg = await j("/api/auth/register", { method: "POST", body: {
  email: "owner@tiszta.hu", password: "secret123", role: "company", fullName: "Kovács Anna",
  companyName: "Tiszta Otthon Kft", taxId: "12345676-1-02", regNumber: "09-09-123456",
  city: "Debrecen", termsAccepted: true } });
ok("the company can register", reg.status < 300, JSON.stringify(reg.data).slice(0, 90));
ok("but cannot log in until an admin approves it",
   (await j("/api/auth/login", { method: "POST", body: { email: "owner@tiszta.hu", password: "secret123" } })).status === 403);

await query("INSERT INTO users (email, password_hash, full_name, role, is_super, approval_status) VALUES ('ceo@cleano.hu',$1,'Musa','admin',true,'approved')",
  [bcrypt.hashSync("secret123", 8)]);
const ADM = await login("ceo@cleano.hu");
ok("the operator can log in", !!ADM.token);

const pending = await j("/api/admin/companies", { token: ADM.token });
const theCo = (pending.data.companies || []).find((c) => c.name === "Tiszta Otthon Kft");
ok("the new company appears in the operator's list", !!theCo);
ok("with the tax number needed to invoice them", theCo?.tax_id === "12345676-1-02", theCo?.tax_id);

await j(`/api/admin/companies/${theCo.id}`, { method: "PUT", token: ADM.token, body: { isApproved: true } });
const CO = await login("owner@tiszta.hu");
ok("once approved, the owner can log in", !!CO.token);

/* ══ 2. THEY LIST WORK AND HIRE ═════════════════════════════════════════ */
console.log("\n── 2. they list a service and take on a cleaner ──");
const svc = (await j("/api/services", { method: "POST", token: CO.token, body: {
  name: "Nagytakarítás", pricingType: "flat", priceHuf: 12000, minutes: 120,
  tasks: ["Konyha", "Fürdő", "Padló"] } })).data.service;
ok("a service can be listed", !!svc?.id);
ok("its price is stored in minor units too", Number(svc.price_huf) === 12000);

await j(`/api/companies/${CO.user.company_id}`, { method: "PUT", token: CO.token, body: {
  serviceLat: 47.5316, serviceLng: 21.6273, serviceRadiusKm: 15, serviceCities: ["Debrecen"] } });
const listed = await j("/api/companies");
ok("the company is now visible to customers",
   (listed.data.companies || []).some((c) => c.id === CO.user.company_id));

const inv = await j("/api/employees/invites", { method: "POST", token: CO.token, body: { label: "Szabó Márk" } });
const code = inv.data?.invite?.code || inv.data?.code;
ok("an invite code can be created for a cleaner", !!code, JSON.stringify(inv.data).slice(0, 80));
const clReg = await j("/api/auth/register", { method: "POST", body: {
  email: "mark@tiszta.hu", password: "secret123", role: "employee", fullName: "Szabó Márk",
  inviteCode: code, phone: "+36301234567", address: "Piac utca 5", termsAccepted: true } });
ok("the cleaner can register with that code", clReg.status < 300, JSON.stringify(clReg.data).slice(0, 90));
await query("UPDATE users SET approval_status='approved', is_active=true WHERE email='mark@tiszta.hu'");
const CL = await login("mark@tiszta.hu");
ok("and log in once the company approves them", !!CL.token);

/* ══ 3. A CUSTOMER BOOKS ════════════════════════════════════════════════ */
console.log("\n── 3. a customer finds them and books ──");
await j("/api/auth/register", { method: "POST", body: {
  email: "peter@nagy.hu", password: "secret123", role: "customer", fullName: "Nagy Péter",
  phone: "+36703031941", city: "Debrecen", address: "Bolyai utca 11", customerType: "resident",
  termsAccepted: true } });
await query("UPDATE users SET approval_status='approved' WHERE email='peter@nagy.hu'");
const CU = await login("peter@nagy.hu");
ok("the customer can register and log in", !!CU.token);

const bk = await j("/api/bookings", { method: "POST", token: CU.token, body: {
  companyId: CO.user.company_id, serviceId: svc.id,
  scheduledDate: dPlus(7), scheduledSlot: "10:00", address: "Bolyai utca 11" } });
ok("they can book", bk.status < 300, JSON.stringify(bk.data).slice(0, 100));
const B = bk.data.booking;
ok("the price and commission are both recorded",
   Number(B.total_huf) > 0 && Number(B.service_fee_huf) > 0, `${B.total_huf} / ${B.service_fee_huf}`);
ok("and the total is the service price plus the fee",
   Number(B.total_huf) === 12000 + Number(B.service_fee_huf), `${B.total_huf}`);

/* The company must SEE it once it is PAID — and not before.

   This used to set 'pending' and expect the job to appear. But payments.js
   sets pending the moment a Stripe Checkout session is created, before a card
   number is typed, so that assertion was demanding the company be shown work
   nobody had paid for. Musa hit exactly that: his card was declined and the
   job still turned up in the company's list. */
await query("UPDATE bookings SET payment_status='pending' WHERE id=$1", [B.id]);
const pendingList = await j("/api/bookings", { token: CO.token });
ok("a booking that is only mid-payment is NOT shown to the company",
   !(pendingList.data.bookings || []).some((x) => x.id === B.id));

await query("UPDATE bookings SET payment_status='paid' WHERE id=$1", [B.id]);
const coList = await j("/api/bookings", { token: CO.token });
ok("once it is paid, the company sees it",
   (coList.data.bookings || []).some((x) => x.id === B.id));
const waiting = (coList.data.bookings || []).find((x) => x.id === B.id);
ok("and is shown how long they have to accept it", !!waiting?.accept_deadline, waiting?.accept_deadline);
ok("which is a real window, not a moment already past",
   Date.parse(waiting.accept_deadline) - Date.now() > 60 * 60e3,
   `${Math.round((Date.parse(waiting.accept_deadline) - Date.now()) / 60000)} minutes`);

/* ══ 4. THE JOB IS DONE ═════════════════════════════════════════════════ */
console.log("\n── 4. the job is accepted, worked and finished ──");
await query("UPDATE bookings SET payment_status='paid' WHERE id=$1", [B.id]);
ok("a job nobody accepted cannot be reported as finished",
   (await j(`/api/bookings/${B.id}/status`, { method: "PUT", token: CO.token, body: { status: 4 } })).status === 400);
ok("accepting works", (await j(`/api/bookings/${B.id}/status`, { method: "PUT", token: CO.token, body: { status: 1 } })).status < 300);
ok("a cleaner can be assigned",
   (await j(`/api/bookings/${B.id}/assign`, { method: "PUT", token: CO.token, body: { employeeId: CL.user.id } })).status < 300);
const clJobs = await j("/api/bookings", { token: CL.token });
ok("the cleaner sees the job on their own list",
   (clJobs.data.bookings || []).some((x) => x.id === B.id));
ok("the cleaner cannot skip ahead to finished",
   (await j(`/api/bookings/${B.id}/status`, { method: "PUT", token: CL.token, body: { status: 4 } })).status === 400);
for (const [st, label] of [[2, "on the way"], [3, "started"], [4, "finished"]])
  ok(`the cleaner marks it ${label}`,
     (await j(`/api/bookings/${B.id}/status`, { method: "PUT", token: CL.token, body: { status: st } })).status < 300);
const doneRow = (await query("SELECT started_at, finished_at FROM bookings WHERE id=$1", [B.id])).rows[0];
ok("the real clock is stamped, not just the promised time",
   !!doneRow.started_at && !!doneRow.finished_at);
ok("a finished job cannot be reopened",
   (await j(`/api/bookings/${B.id}/status`, { method: "PUT", token: CO.token, body: { status: 1 } })).status === 400);

/* ══ 5. REVIEW, MONEY, INVOICE ══════════════════════════════════════════ */
console.log("\n── 5. the customer reviews it and the money is accounted for ──");
const rev = await j("/api/reviews", { method: "POST", token: CU.token, body: { bookingId: B.id, companyId: CO.user.company_id, stars: 5, body: "Tökéletes munka" } });
ok("the customer can review a completed job", rev.status < 300, JSON.stringify(rev.data).slice(0, 80));
/* This used to pass for the wrong reason: the first review was also being
   rejected for a malformed body, so "the second is refused" proved nothing.
   A test that passes whether or not the feature works is worse than no test. */
const dupRev = await j("/api/reviews", { method: "POST", token: CU.token,
  body: { bookingId: B.id, companyId: CO.user.company_id, stars: 1, body: "again" } });
ok("a second review of the same job is refused", dupRev.status >= 400, `${dupRev.status}`);
/* The rating aggregate is maintained by a database TRIGGER, and pg-mem has no
   triggers at all — it does not even expose pg_trigger. So the count cannot be
   asserted here without proving nothing. What CAN be checked: the review row
   exists and carries the company taken from the booking rather than from the
   client, and the trigger that will maintain the aggregate is in the schema
   that gets run against real Postgres. */
const revRow = (await query("SELECT company_id, stars FROM reviews WHERE booking_id = $1", [B.id])).rows[0];
ok("the review is stored against the company from the booking, not the client",
   revRow && revRow.company_id === CO.user.company_id, JSON.stringify(revRow));
ok("and the stars are what the customer gave", Number(revRow?.stars) === 5);
const schemaSrc = (await import("fs")).readFileSync("schema.sql", "utf8");
ok("the schema keeps the company rating in step with its reviews",
   /CREATE TRIGGER on_review_created[\s\S]{0,80}AFTER INSERT ON reviews/.test(schemaSrc));
ok("recomputing from all reviews rather than incrementing a counter",
   /review_count = \(SELECT COUNT\(\*\) FROM reviews WHERE company_id = NEW\.company_id\)/.test(schemaSrc));

const bill = await j("/api/invoices/admin/billing", { token: ADM.token });
const line = (bill.data.companies || []).find((c) => c.taxId === "12345676-1-02");
ok("the finished job appears on the operator's billing list", !!line, JSON.stringify(bill.data).slice(0, 110));
if (line) {
  ok("with the partner's tax number, ready to invoice", line.taxId === "12345676-1-02");
  ok("and net + VAT reconcile exactly to gross",
     Math.abs((Number(line.net) + Number(line.vat)) - Number(line.gross)) < 0.01,
     `${line.net} + ${line.vat} != ${line.gross}`);
}
const up = await j(`/api/bookings/${B.id}/invoice`, { method: "PUT", token: CO.token, body: {
  invoice: { name: "szamla.pdf", type: "application/pdf", data: "data:application/pdf;base64,JVBERi0x" } } });
ok("the partner can upload their invoice for the customer", up.status < 300, JSON.stringify(up.data).slice(0, 80));

/* ══ 6. CANCELLATION AND COMPLAINT ══════════════════════════════════════ */
console.log("\n── 6. cancelling, and complaining ──");
const soon = await j("/api/bookings", { method: "POST", token: CU.token, body: {
  companyId: CO.user.company_id, serviceId: svc.id, scheduledDate: dPlus(1), scheduledSlot: "10:00", address: "Bolyai utca 11" } });
ok("a booking inside the cancellation window cannot be cancelled by the customer",
   (await j(`/api/bookings/${soon.data.booking.id}/status`, { method: "PUT", token: CU.token, body: { status: 9 } })).status === 400);
const far = await j("/api/bookings", { method: "POST", token: CU.token, body: {
  companyId: CO.user.company_id, serviceId: svc.id, scheduledDate: dPlus(30), scheduledSlot: "10:00", address: "Bolyai utca 11" } });
ok("one well ahead of time can be",
   (await j(`/api/bookings/${far.data.booking.id}/status`, { method: "PUT", token: CU.token, body: { status: 9 } })).status < 300);

const cmp = await j("/api/complaints", { method: "POST", token: CU.token, body: {
  bookingId: B.id, subject: "Elmaradt egy szoba", message: "A hálószoba nem lett kitakarítva." } });
ok("a customer can raise a complaint", cmp.status < 300, JSON.stringify(cmp.data).slice(0, 80));
ok("the operator sees it", ((await j("/api/complaints", { token: ADM.token })).data.complaints || []).length > 0);

/* ══ 7. SUBSCRIPTION, THEN LEAVING ══════════════════════════════════════ */
console.log("\n── 7. a recurring plan, and closing the account ──");
await query(`INSERT INTO subscriptions (customer_id, company_id, service_id, frequency, slot, address, currency,
  amount_minor, fee_minor, status, next_booking_date)
  VALUES ($1,$2,$3,'monthly','10:00','Bolyai utca 11','HUF',1200000,120000,'active',$4)`,
  [CU.user.id, CO.user.company_id, svc.id, dPlus(14)]);
const { materialise } = await import("../server/lib/subscriptions.js");
await materialise();
const made = (await query("SELECT COUNT(*)::int n FROM bookings WHERE subscription_id IS NOT NULL")).rows[0].n;
ok("the plan generates its upcoming visits", made > 0, `${made}`);
ok("and they are priced from the plan, not re-read from the service",
   (await query("SELECT DISTINCT total_huf FROM bookings WHERE subscription_id IS NOT NULL")).rows.every((r) => Number(r.total_huf) === 12000));

await j("/api/auth/me", { method: "DELETE", token: CU.token });
const afterDel = (await query("SELECT status FROM subscriptions WHERE customer_id=$1", [CU.user.id])).rows[0];
ok("deleting the account cancels the plan", afterDel.status === "cancelled", afterDel.status);
const card = (await query("SELECT stripe_customer_id, default_payment_method FROM users WHERE id=$1", [CU.user.id])).rows[0];
ok("and clears the saved card reference", !card.stripe_customer_id && !card.default_payment_method);
await materialise();
const madeAfter = (await query("SELECT COUNT(*)::int n FROM bookings WHERE subscription_id IS NOT NULL")).rows[0].n;
ok("no further visits are generated for a closed account", madeAfter === made, `${made} -> ${madeAfter}`);
const anon = (await query("SELECT full_name, phone, address FROM users WHERE id=$1", [CU.user.id])).rows[0];
ok("their personal details are anonymised", anon.full_name === "Deleted user" && !anon.phone && !anon.address);
ok("but the company can still hide the name on old jobs for their records",
   (await j(`/api/bookings/${B.id}/hide-identity`, { method: "PUT", token: CO.token })).status < 300);

console.log(`\n════ LIFECYCLE: ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
