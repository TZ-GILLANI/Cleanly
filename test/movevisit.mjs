/* MOVING ONE VISIT.

   A customer who cannot make Tuesday should not have to cancel a whole plan to
   escape it, and a company should never be handed a date it cannot work. So
   neither side sets the new date alone: the customer offers two or three they
   could manage, and the company takes whichever one it can actually serve.

   The rule that matters most here is that "available" means the same thing on
   both paths. Booking and moving now share server/lib/availability.js, because
   two code paths with two opinions is exactly how the service-area bug worked:
   a listing that showed a company and a booking endpoint that then refused you.

   Run: node test/movevisit.mjs                                                */
process.env.PGMEM = "1";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "mv-test";
process.env.PORT = "4606";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };

const BASE = "http://localhost:4606";
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
/* A DATE column comes back as a Date object, so String(...).slice(0,10) gives
   "Fri Sep 04". The server has a helper for this; the test uses the same one
   rather than repeating the mistake it is checking for. */
const { isoDate } = await import("../server/lib/isodate.js");

await j("/api/auth/register", { method: "POST", body: {
  fullName: "B", email: "mv-b@t.hu", password: "secret123", role: "company",
  companyName: "Move Kft", taxId: "10000001-1-02", city: "Debrecen",
  phone: "+36301112233", termsAccepted: true } });
const cid = (await query("SELECT id FROM companies WHERE name = $1", ["Move Kft"])).rows[0].id;
await query("UPDATE companies SET is_listed = true, is_approved = true WHERE id = $1", [cid]);
await query("UPDATE users SET approval_status = 'approved' WHERE email = $1", ["mv-b@t.hu"]);
const coTok = (await j("/api/auth/login", { method: "POST", body: { email: "mv-b@t.hu", password: "secret123" } })).data.token;
const svcId = (await query(`INSERT INTO services (company_id,name,description,price_huf,minutes,is_active)
  VALUES ($1,'Deep clean','x',12000,60,true) RETURNING id`, [cid])).rows[0].id;
const cuTok = (await j("/api/auth/register", { method: "POST", body: {
  fullName: "C", email: "mv-c@t.hu", password: "secret123", role: "customer", customerType: "resident",
  city: "Debrecen", address: "Piac utca 1", phone: "+36703031941", termsAccepted: true } })).data.token;
const otherTok = (await j("/api/auth/register", { method: "POST", body: {
  fullName: "D", email: "mv-d@t.hu", password: "secret123", role: "customer", customerType: "resident",
  city: "Debrecen", address: "Piac utca 2", phone: "+36703031942", termsAccepted: true } })).data.token;

const book = async (d, slot = "10:00", token = cuTok) => (await j("/api/bookings", { method: "POST", token, body: {
  companyId: cid, serviceId: svcId, scheduledDate: d, scheduledSlot: slot,
  address: "Piac utca 1", city: "Debrecen", paymentMethod: "cash" } }));

const bk = await book(dPlus(10));
const bid = bk.data.booking.id;
await query("UPDATE bookings SET payment_status = 'paid' WHERE id = $1", [bid]);
const row = async () => (await query("SELECT * FROM bookings WHERE id = $1", [bid])).rows[0];

console.log("\n── the customer offers dates, they do not choose one ──");
{
  const one = await j(`/api/bookings/${bid}/reschedule`, { method: "POST", token: cuTok, body: {
    options: [{ date: dPlus(14), slot: "10:00" }] } });
  ok("one date alone is refused — that is picking, not offering", one.status === 400, `got ${one.status}`);
  ok("and it says why", /at least two/i.test(one.data.error || ""), one.data.error);

  const same = await j(`/api/bookings/${bid}/reschedule`, { method: "POST", token: cuTok, body: {
    options: [{ date: dPlus(14), slot: "10:00" }, { date: dPlus(14), slot: "10:00" }] } });
  ok("the same slot twice does not count as two options", same.status === 400, `got ${same.status}`);

  const past = await j(`/api/bookings/${bid}/reschedule`, { method: "POST", token: cuTok, body: {
    options: [{ date: dPlus(-3), slot: "10:00" }, { date: dPlus(-2), slot: "10:00" }] } });
  ok("dates in the past are dropped", past.status === 400, `got ${past.status}`);

  const good = await j(`/api/bookings/${bid}/reschedule`, { method: "POST", token: cuTok, body: {
    options: [{ date: dPlus(14), slot: "10:00" }, { date: dPlus(15), slot: "14:00" }, { date: dPlus(16), slot: "09:00" }],
    note: "Away that week" } });
  ok("two or three real dates are accepted", good.status === 200, JSON.stringify(good.data).slice(0, 140));
  ok("at most three are kept", (good.data.reschedule?.options || []).length <= 3);
  ok("the note travels with it", good.data.reschedule?.note === "Away that week");
  ok("the original date is remembered, so it can be shown as 'moved from'",
     good.data.reschedule?.from?.date === dPlus(10), JSON.stringify(good.data.reschedule?.from));
  ok("nothing has moved yet", isoDate((await row()).scheduled_date) === dPlus(10));

  const again = await j(`/api/bookings/${bid}/reschedule`, { method: "POST", token: cuTok, body: {
    options: [{ date: dPlus(20), slot: "10:00" }, { date: dPlus(21), slot: "10:00" }] } });
  ok("a second request while one is open is refused", again.status === 400, `got ${again.status}`);
}

console.log("\n── nobody else can touch it ──");
{
  const stranger = await j(`/api/bookings/${bid}/reschedule`, { method: "POST", token: otherTok, body: {
    options: [{ date: dPlus(14), slot: "10:00" }, { date: dPlus(15), slot: "10:00" }] } });
  ok("another customer cannot ask to move your booking", stranger.status === 403, `got ${stranger.status}`);
  const asCustomer = await j(`/api/bookings/${bid}/reschedule`, { method: "PUT", token: cuTok, body: { choice: 0 } });
  ok("the customer cannot answer their own request", asCustomer.status === 403, `got ${asCustomer.status}`);
  const anon = await j(`/api/bookings/${bid}/reschedule`, { method: "PUT", body: { choice: 0 } });
  ok("nor can a logged-out caller", anon.status === 401, `got ${anon.status}`);
}

console.log("\n── the company picks one of the offered dates, and only those ──");
{
  const invented = await j(`/api/bookings/${bid}/reschedule`, { method: "PUT", token: coTok, body: {
    choice: 9 } });
  ok("it cannot pick an option that was never offered", invented.status === 400, `got ${invented.status}`);
  ok("and is told to choose one of the customer's", /offered/i.test(invented.data.error || ""), invented.data.error);

  const moved = await j(`/api/bookings/${bid}/reschedule`, { method: "PUT", token: coTok, body: { choice: 1 } });
  ok("picking the second option works", moved.status === 200, JSON.stringify(moved.data).slice(0, 140));
  const r = await row();
  ok("the visit is now on that date", isoDate(r.scheduled_date) === dPlus(15), String(r.scheduled_date));
  ok("and at that hour", String(r.scheduled_slot).slice(0, 5) === "14:00", String(r.scheduled_slot));
  const rs = typeof r.reschedule === "string" ? JSON.parse(r.reschedule) : r.reschedule;
  ok("the exchange is recorded as settled", rs.status === "moved");
  ok("with the date it came from", rs.from?.date === dPlus(10));

  const done = await j(`/api/bookings/${bid}/reschedule`, { method: "PUT", token: coTok, body: { choice: 0 } });
  ok("a settled request cannot be answered twice", done.status === 400, `got ${done.status}`);
}

console.log("\n── the money does not move ──");
{
  const r = await row();
  ok("the visit is still paid", r.payment_status === "paid", String(r.payment_status));
  ok("for the same amount", Number(r.total_huf) === 13200, String(r.total_huf));
  ok("and the commission is unchanged", Number(r.service_fee_huf) === 1200, String(r.service_fee_huf));
}

console.log("\n── a date the company cannot work is never offered as pickable ──");
{
  const b2 = await book(dPlus(20));
  const id2 = b2.data.booking.id;
  const closed = dPlus(24);
  await query("UPDATE companies SET availability = $1 WHERE id = $2",
    [JSON.stringify({ paused: false, days: { 0:{on:true,slots:["09:00","10:00","14:00"]},1:{on:true,slots:["09:00","10:00","14:00"]},2:{on:true,slots:["09:00","10:00","14:00"]},3:{on:true,slots:["09:00","10:00","14:00"]},4:{on:true,slots:["09:00","10:00","14:00"]},5:{on:true,slots:["09:00","10:00","14:00"]},6:{on:true,slots:["09:00","10:00","14:00"]} }, closed: [closed], busy: {}, busyServices: {} }), cid]);

  const mixed = await j(`/api/bookings/${id2}/reschedule`, { method: "POST", token: cuTok, body: {
    options: [{ date: closed, slot: "10:00" }, { date: dPlus(25), slot: "10:00" }] } });
  ok("a request with one closed day still goes through", mixed.status === 200, JSON.stringify(mixed.data).slice(0, 120));
  const opts = mixed.data.reschedule.options;
  ok("the closed day is marked unavailable, not silently dropped",
     opts.find((o) => o.date === closed)?.ok === false, JSON.stringify(opts));
  ok("with the reason the company will read", /closed/i.test(opts.find((o) => o.date === closed)?.why || ""));
  ok("the workable day is marked available", opts.find((o) => o.date === dPlus(25))?.ok === true);

  const pickClosed = await j(`/api/bookings/${id2}/reschedule`, { method: "PUT", token: coTok, body: { choice: opts.findIndex((o) => o.date === closed) } });
  ok("and the company cannot pick the closed day even if it tries", pickClosed.status === 400, `got ${pickClosed.status}`);
  ok("because the check runs again at the moment of the decision",
     /closed/i.test(pickClosed.data.error || ""), pickClosed.data.error);

  const allBad = await j(`/api/bookings/${id2}/reschedule`, { method: "DELETE", token: cuTok });
  ok("the customer can withdraw", allBad.status === 200);
  const none = await j(`/api/bookings/${id2}/reschedule`, { method: "POST", token: cuTok, body: {
    options: [{ date: closed, slot: "10:00" }, { date: closed, slot: "14:00" }] } });
  ok("offering only days the company is shut is refused outright", none.status === 400, `got ${none.status}`);
  ok("rather than sending them a request with nothing to pick",
     /none of those times/i.test(none.data.error || ""), none.data.error);
  await query("UPDATE companies SET availability = NULL WHERE id = $1", [cid]);
}

console.log("\n── declining leaves the visit exactly where it was ──");
{
  const b3 = await book(dPlus(30));
  const id3 = b3.data.booking.id;
  await j(`/api/bookings/${id3}/reschedule`, { method: "POST", token: cuTok, body: {
    options: [{ date: dPlus(31), slot: "10:00" }, { date: dPlus(32), slot: "10:00" }] } });
  const dec = await j(`/api/bookings/${id3}/reschedule`, { method: "PUT", token: coTok, body: { decline: true, reason: "Fully booked that week" } });
  ok("the company can decline them all", dec.status === 200, JSON.stringify(dec.data).slice(0, 120));
  const r3 = (await query("SELECT * FROM bookings WHERE id = $1", [id3])).rows[0];
  ok("the date is untouched", isoDate(r3.scheduled_date) === dPlus(30), String(r3.scheduled_date));
  const rs3 = typeof r3.reschedule === "string" ? JSON.parse(r3.reschedule) : r3.reschedule;
  ok("and the customer is left a reason", rs3.reason === "Fully booked that week", String(rs3.reason));
}

console.log("\n── a visit already under way cannot be moved ──");
{
  const b4 = await book(dPlus(35));
  const id4 = b4.data.booking.id;
  await query("UPDATE bookings SET status = 2 WHERE id = $1", [id4]);
  const late = await j(`/api/bookings/${id4}/reschedule`, { method: "POST", token: cuTok, body: {
    options: [{ date: dPlus(36), slot: "10:00" }, { date: dPlus(37), slot: "10:00" }] } });
  ok("once the cleaner is on the way, moving is refused", late.status === 400, `got ${late.status}`);
  ok("and the customer is told to call instead", /call the company/i.test(late.data.error || ""), late.data.error);
}

console.log("\n── one shared idea of 'available' ──");
{
  const fs = await import("fs");
  const bk2 = fs.readFileSync(new URL("../server/routes/bookings.js", import.meta.url), "utf8");
  const av = fs.readFileSync(new URL("../server/lib/availability.js", import.meta.url), "utf8");
  ok("booking asks the shared checker", /const why = await slotProblem\(\{/.test(bk2));
  ok("so does the move", (bk2.match(/await slotProblem\(\{/g) || []).length >= 3, "book + offer + decide");
  ok("the visit being moved does not block itself",
     /excludeBookingId && r\.id === excludeBookingId/.test(av));
  ok("and the endpoints pass their own id in", /excludeBookingId: b\.id/.test(bk2));
  ok("the column is optional, so an un-migrated database just says so",
     /hasColumn\("bookings", "reschedule"\)/.test(bk2));
  const schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
  ok("schema.sql creates it", /ALTER TABLE bookings\s+ADD COLUMN IF NOT EXISTS reschedule JSONB;/.test(schema));
}

console.log("\n── both sides can see and act on it ──");
{
  const fs = await import("fs");
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  ok("the customer has a way to ask", /function MoveVisitSheet\(\{ booking, close \}\)/.test(app));
  ok("offering fewer than two is not even submittable", /const enough = new Set\(filled\.map/.test(app));
  ok("the button sits on the booking card", /L\("Move this visit", "Áthelyezés"\)/.test(app));
  ok("and disappears while a request is open", /!\(b\.reschedule && b\.reschedule\.status === "pending"\)/.test(app));
  ok("the customer sees they are waiting", /Waiting for the company to pick a time/.test(app));
  ok("and sees a refusal too", /The company couldn't make any of those times/.test(app));
  ok("the company answers on the job card", /asked to move this visit/.test(app));
  ok("choosing an option calls the decide endpoint", /decideReschedule\(b\.id, \{ choice: i \}\)/.test(app));
  ok("and there is a way to say none of them work", /decideReschedule\(b\.id, \{ decline: true \}\)/.test(app));
  ok("an unworkable option is greyed with its reason, not hidden",
     /\{dayLabel\(o\.date\)\} · \{o\.slot\} — \{o\.why\}/.test(app));
}

console.log(`\n════ MOVING A VISIT: ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
