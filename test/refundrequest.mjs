/* MONEY DOES NOT MOVE ON ITS OWN.

   Cancelling used to refund the moment the customer pressed the button. That
   is one irreversible act triggering another with nobody looking: a mistaken
   tap, a change of mind, the wrong booking — all of it gone through Stripe,
   where there is no undo.

   Now: the booking is cancelled, the payment stays put, and a refund REQUEST
   is raised in the report system with the amount on it. A person decides.

   Two cases deliberately still refund by themselves, and this suite pins that
   distinction: when the COMPANY never answered, and when the company DECLINED.
   The customer paid for something that will now never happen and did not
   cancel anything — holding their money pending review would be indefensible.

   Run: node test/refundrequest.mjs                                           */
process.env.PGMEM = "1";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "rr-test";
process.env.PORT = "4614";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };

const BASE = "http://localhost:4614";
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
  fullName: "B", email: "rr-b@t.hu", password: "secret123", role: "company",
  companyName: "Refund Kft", taxId: "10000001-1-02", city: "Debrecen",
  phone: "+36301112233", termsAccepted: true } });
const cid = (await query("SELECT id FROM companies WHERE name = $1", ["Refund Kft"])).rows[0].id;
await query("UPDATE companies SET is_listed = true, is_approved = true WHERE id = $1", [cid]);
await query("UPDATE users SET approval_status = 'approved' WHERE email = $1", ["rr-b@t.hu"]);
const svcId = (await query(`INSERT INTO services (company_id,name,description,price_huf,minutes,is_active)
  VALUES ($1,'Deep clean','x',12000,60,true) RETURNING id`, [cid])).rows[0].id;
const subSvc = (await query(`INSERT INTO services (company_id,name,description,price_huf,minutes,is_active,pricing_type,period)
  VALUES ($1,'Weekly','x',9900,120,true,'subscription','weekly') RETURNING id`, [cid])).rows[0].id;
const cuTok = (await j("/api/auth/register", { method: "POST", body: {
  fullName: "Ana", email: "rr-c@t.hu", password: "secret123", role: "customer", customerType: "resident",
  city: "Debrecen", address: "Piac utca 1", phone: "+36703031941", termsAccepted: true } })).data.token;
const cuId = (await query("SELECT id FROM users WHERE email = $1", ["rr-c@t.hu"])).rows[0].id;

const book = async (sid = svcId, d = 20) => (await j("/api/bookings", { method: "POST", token: cuTok, body: {
  companyId: cid, serviceId: sid, scheduledDate: dPlus(d), scheduledSlot: "10:00",
  address: "Piac utca 1", city: "Debrecen", paymentMethod: "card" } })).data.booking;

console.log("\n── a paid booking the customer cancels ──");
{
  const b = await book();
  await query("UPDATE bookings SET payment_status = 'paid' WHERE id = $1", [b.id]);
  const before = (await query("SELECT COUNT(*)::int AS n FROM complaints WHERE user_id = $1", [cuId])).rows[0].n;

  const r = await j(`/api/bookings/${b.id}/status`, { method: "PUT", token: cuTok, body: { status: 9 } });
  ok("the customer can still cancel", r.status === 200, JSON.stringify(r.data).slice(0, 120));

  const row = (await query("SELECT status, payment_status FROM bookings WHERE id = $1", [b.id])).rows[0];
  ok("the booking is cancelled", Number(row.status) === 9, String(row.status));
  ok("but the payment is untouched — no automatic refund",
     row.payment_status === "paid", String(row.payment_status));

  const after = await query(
    "SELECT * FROM complaints WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [cuId]);
  ok("a refund request appears in the report system", after.rows.length === 1 && (await query("SELECT COUNT(*)::int AS n FROM complaints WHERE user_id = $1", [cuId])).rows[0].n === before + 1);
  ok("it names itself clearly", /Refund request/i.test(after.rows[0]?.subject || ""), String(after.rows[0]?.subject));
  ok("it is attached to the booking", after.rows[0]?.booking_id === b.id);
  ok("it carries the amount, so nobody has to look it up", /13200 Ft/.test(after.rows[0]?.body || ""), String(after.rows[0]?.body || "").slice(0, 120));
  ok("and it is open, waiting on a person", after.rows[0]?.status === "open", String(after.rows[0]?.status));
}

console.log("\n── an UNPAID booking cancelled raises nothing ──");
{
  const before = (await query("SELECT COUNT(*)::int AS n FROM complaints WHERE user_id = $1", [cuId])).rows[0].n;
  const b = await book(svcId, 21);
  await j(`/api/bookings/${b.id}/status`, { method: "PUT", token: cuTok, body: { status: 9 } });
  const after = (await query("SELECT COUNT(*)::int AS n FROM complaints WHERE user_id = $1", [cuId])).rows[0].n;
  ok("nothing was paid, so there is nothing to ask for", after === before, `${before} → ${after}`);
}

console.log("\n── cancelling a plan stops the future, requests the paid month ──");
{
  const subId = (await query(
    `INSERT INTO subscriptions (customer_id, company_id, service_id, frequency, slot, address,
       currency, amount_minor, fee_minor, status, next_booking_date)
     VALUES ($1,$2,$3,'weekly','10:00','Piac utca 1','HUF',1089000,99000,'active',$4) RETURNING id`,
    [cuId, cid, subSvc, dPlus(30)])).rows[0].id;

  const paidIds = [], schedIds = [];
  for (let i = 0; i < 3; i++) {
    const r = await query(
      `INSERT INTO bookings (customer_id,company_id,service_id,service_snapshot,scheduled_date,scheduled_slot,
         address,customer_type,total_huf,service_fee_huf,pricing_type,period,payment_status,status,subscription_id,order_no)
       VALUES ($1,$2,$3,'{}',$4,'10:00','Piac utca 1','resident',10890,990,'subscription','weekly','paid',0,$5,
         (SELECT COALESCE(MAX(order_no),0)+1 FROM bookings)) RETURNING id`,
      [cuId, cid, subSvc, dPlus(30 + i * 7), subId]);
    paidIds.push(r.rows[0].id);
  }
  for (let i = 3; i < 6; i++) {
    const r = await query(
      `INSERT INTO bookings (customer_id,company_id,service_id,service_snapshot,scheduled_date,scheduled_slot,
         address,customer_type,total_huf,service_fee_huf,pricing_type,period,payment_status,status,subscription_id,order_no)
       VALUES ($1,$2,$3,'{}',$4,'10:00','Piac utca 1','resident',10890,990,'subscription','weekly','scheduled',0,$5,
         (SELECT COALESCE(MAX(order_no),0)+1 FROM bookings)) RETURNING id`,
      [cuId, cid, subSvc, dPlus(30 + i * 7), subId]);
    schedIds.push(r.rows[0].id);
  }

  const before = (await query("SELECT COUNT(*)::int AS n FROM complaints WHERE user_id = $1", [cuId])).rows[0].n;
  const r = await j(`/api/subscriptions/${subId}/cancel`, { method: "POST", token: cuTok });
  ok("the plan can be cancelled", r.status === 200, JSON.stringify(r.data).slice(0, 120));

  const sched = await query(
    `SELECT COUNT(*)::int AS n FROM bookings WHERE id IN (${schedIds.map((_, i) => "$" + (i + 1)).join(",")}) AND status = 9`, schedIds);
  ok("every visit not yet charged is dropped", sched.rows[0].n === 3, String(sched.rows[0].n));

  const paidRows = await query(
    `SELECT status, payment_status FROM bookings WHERE id IN (${paidIds.map((_, i) => "$" + (i + 1)).join(",")})`, paidIds);
  ok("the paid visits are cancelled too, so the company is not left holding work",
     paidRows.rows.every((x) => Number(x.status) === 9));
  ok("but none of them was refunded automatically",
     paidRows.rows.every((x) => x.payment_status === "paid"),
     paidRows.rows.map((x) => x.payment_status).join(","));

  const after = await query("SELECT * FROM complaints WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [cuId]);
  const count = (await query("SELECT COUNT(*)::int AS n FROM complaints WHERE user_id = $1", [cuId])).rows[0].n;
  ok("exactly ONE refund request covers the lot, not one per visit", count === before + 1, `${before} → ${count}`);
  ok("and it says how many visits and how much", /3 visit\(s\)/.test(after.rows[0]?.body || "") && /32670 Ft/.test(after.rows[0]?.body || ""),
     String(after.rows[0]?.body || "").slice(0, 150));
  ok("the response tells the app a request was raised", r.data.refundRequested === true, JSON.stringify(r.data));
}

console.log("\n── the two cases that still refund by themselves ──");
{
  const fs = await import("fs");
  const rem = fs.readFileSync(new URL("../server/lib/reminders.js", import.meta.url), "utf8");
  const bk = fs.readFileSync(new URL("../server/routes/bookings.js", import.meta.url), "utf8");
  ok("a company that never answered still refunds the customer", /refundBookingPayment\(b, 100\)/.test(rem));
  ok("and a company that DECLINED a paid booking still refunds it", /if \(status === 8 && b\.payment_status === "paid"\)/.test(bk));
  ok("but the customer's own cancel no longer does",
     !/if \(b\.payment_status === "paid"\) await refundBookingPayment/.test(bk));
  const subs = fs.readFileSync(new URL("../server/routes/subscriptions.js", import.meta.url), "utf8");
  ok("nor does cancelling a plan", !/await refundBookingPayment\(b, 100\)/.test(subs));
}

/* ── AND THE OTHER HALF: someone has to be able to say yes ────────────────
   A request nobody can act on is a note. The admin — not the company, not
   the customer, not a timer — presses once and the money goes back. ── */
console.log("\n── an admin can actually issue the refund ──");
{
  /* A real admin account — the auth middleware re-reads the role from the
     database on every request, so a borrowed token cannot fake one. */
  await j("/api/auth/register", { method: "POST", body: {
    fullName: "Root", email: "rr-a@t.hu", password: "secret123", role: "customer", customerType: "resident",
    city: "Debrecen", address: "Piac utca 2", phone: "+36703031942", termsAccepted: true } });
  await query("UPDATE users SET role = 'admin', is_super = true WHERE email = $1", ["rr-a@t.hu"]);
  const adTok = (await j("/api/auth/login", { method: "POST",
    body: { email: "rr-a@t.hu", password: "secret123" } })).data.token;
  const coTok = (await j("/api/auth/login", { method: "POST",
    body: { email: "rr-b@t.hu", password: "secret123" } })).data.token;

  const b = await book(svcId, 24);
  await query("UPDATE bookings SET payment_status = 'paid' WHERE id = $1", [b.id]);
  await j(`/api/bookings/${b.id}/status`, { method: "PUT", token: cuTok, body: { status: 9 } });
  const req = (await query(
    "SELECT * FROM complaints WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1", [b.id])).rows[0];
  ok("the cancel raised a request to act on", !!req);

  const asCustomer = await j(`/api/complaints/${req.id}/refund`, { method: "POST", token: cuTok });
  ok("the customer cannot refund themselves", asCustomer.status === 403, String(asCustomer.status));
  const asCompany = await j(`/api/complaints/${req.id}/refund`, { method: "POST", token: coTok });
  ok("nor can the company reach into the platform's Stripe account", asCompany.status === 403, String(asCompany.status));
  ok("and nothing moved while they tried",
     (await query("SELECT payment_status FROM bookings WHERE id = $1", [b.id])).rows[0].payment_status === "paid");

  const done = await j(`/api/complaints/${req.id}/refund`, { method: "POST", token: adTok, body: { pct: 100 } });
  ok("the admin can", done.status === 200, JSON.stringify(done.data).slice(0, 140));
  const after = (await query("SELECT payment_status FROM bookings WHERE id = $1", [b.id])).rows[0];
  ok("and the booking is now refunded", after.payment_status === "refunded", String(after.payment_status));
  const cl = (await query("SELECT status, resolution FROM complaints WHERE id = $1", [req.id])).rows[0];
  ok("the request closes itself — no second chore", cl.status === "resolved", String(cl.status));
  ok("with a record of what was sent", /Refunded 100%/.test(cl.resolution || ""), String(cl.resolution));

  const twice = await j(`/api/complaints/${req.id}/refund`, { method: "POST", token: adTok });
  ok("pressing it twice cannot pay twice", twice.status === 400, JSON.stringify(twice.data).slice(0, 120));

  const unpaid = await book(svcId, 25);
  const c2 = (await query(
    `INSERT INTO complaints (user_id, booking_id, subject, body) VALUES ($1,$2,'x','y') RETURNING id`,
    [cuId, unpaid.id])).rows[0].id;
  const none = await j(`/api/complaints/${c2}/refund`, { method: "POST", token: adTok });
  ok("a booking that was never paid refuses politely", none.status === 400 && /Nothing to refund/.test(none.data.error || ""), JSON.stringify(none.data).slice(0, 120));

  const detached = (await query(
    `INSERT INTO complaints (user_id, subject, body) VALUES ($1,'no booking','y') RETURNING id`, [cuId])).rows[0].id;
  const nb = await j(`/api/complaints/${detached}/refund`, { method: "POST", token: adTok });
  ok("a report with no booking on it says so", nb.status === 400, JSON.stringify(nb.data).slice(0, 120));

  const partialB = await book(svcId, 26);
  await query("UPDATE bookings SET payment_status = 'paid' WHERE id = $1", [partialB.id]);
  const c3 = (await query(
    `INSERT INTO complaints (user_id, booking_id, subject, body) VALUES ($1,$2,'half','y') RETURNING id`,
    [cuId, partialB.id])).rows[0].id;
  const half = await j(`/api/complaints/${c3}/refund`, { method: "POST", token: adTok, body: { pct: 50 } });
  ok("a half refund is possible when only half went wrong", half.status === 200 && half.data.pct === 50, JSON.stringify(half.data).slice(0, 120));
}

console.log("\n── the admin screen offers it, and only where money exists ──");
{
  const fs = await import("fs");
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  ok("the refund control is in the complaint sheet", /adminIssueRefund\(complaint\.id, refundPct\)/.test(app));
  ok("only for an admin", /role === "admin" && complaint\.booking_id && complaint\.booking_payment_status === "paid"/.test(app));
  ok("and it asks before sending", /window\.confirm\(fill\(L\("Send \{0\}% of this booking back/.test(app));
  const co = fs.readFileSync(new URL("../server/routes/complaints.js", import.meta.url), "utf8");
  ok("the list tells the screen whether it was paid", /b\.payment_status AS booking_payment_status/.test(co));
}

console.log("\n── the screens no longer promise a refund that will not happen ──");
{
  const fs = await import("fs");
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  ok("the plan-cancel dialog says a request is raised", /we raise a refund request for you/.test(app));
  ok("it no longer says 'refunded in full'", !/refunded in full\.", "A jövőbeli/.test(app));
  ok("the booking-cancel dialog warns a paid customer", /Your payment is not returned automatically/.test(app));
  ok("and only when they actually paid", /confirmCancel\.payment_status === "paid"/.test(app));
}

console.log(`\n════ REFUND REQUESTS: ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
