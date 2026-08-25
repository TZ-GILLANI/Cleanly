/* WHAT EVERY BOOKING ACTUALLY COSTS.

   Money is the one part of this app where "it runs" is not the question. Four
   pricing shapes (flat, by the hour, by the kilo, subscription), three
   discounts that must NEVER stack, a commission added on top, and a Stripe
   rule that rejects any HUF amount not divisible by 100.

   The bug this suite exists to prevent already happened once: a 990 Ft job at
   10% commission floored to an application_fee_amount of 0, which Stripe
   refuses — and it refuses it on Stripe's own page, so nothing reached our
   logs. It worked at most prices and failed at some, which is the worst kind
   of failure to find by hand.

   So: real bookings through the real endpoint, and the forints are printed.

   Run: node test/money.mjs                                                   */
process.env.PGMEM = "1";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "money-test";
process.env.PORT = "4599";
process.env.COMMISSION_PCT = "10";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };
const ft = (n) => new Intl.NumberFormat("hu-HU").format(n) + " Ft";

const BASE = "http://localhost:4599";
const j = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method, signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

const pay = await import("../server/routes/payments.js");
await import("../server/index.js");
await new Promise((r) => setTimeout(r, 900));
const { query } = await import("../server/db.js");
const dPlus = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

/* ── the company, the services, the two customers ── */
await j("/api/auth/register", { method: "POST", body: {
  fullName: "Boss", email: "mn-boss@t.hu", password: "secret123", role: "company",
  companyName: "Money Kft", taxId: "10000001-1-02", city: "Debrecen",
  phone: "+36301112233", termsAccepted: true } });
const cid = (await query("SELECT id FROM companies WHERE name = $1", ["Money Kft"])).rows[0].id;
await query("UPDATE companies SET is_listed = true, is_approved = true, student_discount = 0, promo = NULL WHERE id = $1", [cid]);
await query("UPDATE users SET approval_status = 'approved' WHERE email = $1", ["mn-boss@t.hu"]);

const svc = async (row) => (await query(
  `INSERT INTO services (company_id,name,description,price_huf,minutes,is_active,pricing_type,hourly_rate_huf,min_hours,max_hours,unit_price_huf,min_units,max_units,unit_label,period,promo_pct)
   VALUES ($1,$2,'x',$3,$4,true,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
  [cid, row.name, row.price || 0, row.minutes || 120, row.type, row.rate || null, row.minH || null, row.maxH || null,
   row.unitPrice || null, row.minU || null, row.maxU || null, row.unitLabel || null, row.period || null, row.promoPct || 0])).rows[0].id;

const FLAT = await svc({ name: "Deep clean", type: "flat", price: 12000 });
const HOURLY = await svc({ name: "By the hour", type: "hourly", rate: 3900, minH: 2, maxH: 8 });
const UNIT = await svc({ name: "Laundry", type: "unit", unitPrice: 1200, minU: 3, maxU: 20, unitLabel: "kg" });
const SUB = await svc({ name: "Weekly plan", type: "subscription", price: 9900, period: "weekly" });
const CHEAP = await svc({ name: "Quick tidy", type: "flat", price: 900 });
const FREE = await svc({ name: "Broken price", type: "flat", price: 0 });

/* A student account is NOT usable the moment it is created: the card photo
   goes to an admin, approval_status stays 'pending', and register hands back
   no token at all. So the discount cannot be claimed before a human has
   looked at the card — which is the point, and worth stating here because it
   is invisible from the outside. */
const mk = async (email, type) => {
  const r = await j("/api/auth/register", { method: "POST", body: {
    fullName: "C", email, password: "secret123", role: "customer", customerType: type,
    city: "Debrecen", address: "Piac utca 1", phone: "+3670303" + Math.floor(1000 + Math.random() * 8999),
    documents: type === "student" ? [{ name: "card.png", type: "image/png", data: "data:image/png;base64,iVBORw0KGgo=" }] : [],
    termsAccepted: true } });
  if (r.data.token) return r.data.token;
  ok(`a ${type} signup waits for a human`, r.data.pendingApproval === true, JSON.stringify(r.data).slice(0, 120));
  await query("UPDATE users SET approval_status = 'approved' WHERE email = $1", [email]);
  const li = await j("/api/auth/login", { method: "POST", body: { email, password: "secret123" } });
  return li.data.token;
};
console.log("\n── who may claim a student price ──");
const noCard = await j("/api/auth/register", { method: "POST", body: {
  fullName: "No card", email: "mn-nocard@t.hu", password: "secret123", role: "customer",
  customerType: "student", city: "Debrecen", address: "Piac utca 1", phone: "+36703039999", termsAccepted: true } });
ok("a student account without a card photo is refused outright", noCard.status === 400, `got ${noCard.status}`);
const resident = await mk("mn-res@t.hu", "resident");
const student = await mk("mn-stu@t.hu", "student");
ok("an approved student can log in", !!student);

let day = 3;
const book = async (token, serviceId, extra = {}) => {
  const r = await j("/api/bookings", { method: "POST", token, body: {
    companyId: cid, serviceId, scheduledDate: dPlus(day++), scheduledSlot: "10:00",
    address: "Piac utca 1", city: "Debrecen", paymentMethod: "cash", ...extra } });
  return r;
};

console.log("\n── the four shapes, in forints ──");
{
  const f = await book(resident, FLAT);
  const b = f.data.booking || f.data;
  console.log(`     flat: 12 000 → total ${ft(b.total_huf)}, Cleano fee ${ft(b.service_fee_huf)}, company keeps ${ft(b.total_huf - b.service_fee_huf)}`);
  ok("a flat price charges the listed price plus the fee", b.total_huf === 13200 && b.service_fee_huf === 1200,
     `${b.total_huf} / ${b.service_fee_huf}`);
  ok("the company keeps its full listed price", b.total_huf - b.service_fee_huf === 12000);
}
{
  const h = await book(resident, HOURLY, { hours: 3 });
  const b = h.data.booking || h.data;
  console.log(`   hourly: 3 900 × 3 h → total ${ft(b.total_huf)}, fee ${ft(b.service_fee_huf)}`);
  ok("three hours at 3 900 is 11 700 plus fee", b.total_huf === 12870 && b.hours === 3, `${b.total_huf} h=${b.hours}`);

  const over = await book(resident, HOURLY, { hours: 99 });
  const ob = over.data.booking || over.data;
  ok("nobody can book more hours than the company offers", ob.hours === 8, String(ob.hours));
  const under = await book(resident, HOURLY, { hours: 1 });
  const ub = under.data.booking || under.data;
  ok("…or fewer than its minimum", ub.hours === 2, String(ub.hours));
}
{
  const u = await book(resident, UNIT, { units: 5 });
  const b = u.data.booking || u.data;
  console.log(`     unit: 1 200 × 5 kg → total ${ft(b.total_huf)}, fee ${ft(b.service_fee_huf)}`);
  ok("five kilos at 1 200 is 6 000 plus fee", b.total_huf === 6600 && Number(b.units) === 5, `${b.total_huf} u=${b.units}`);
  ok("and the unit is recorded, so the invoice can say kg", b.unit_label === "kg", String(b.unit_label));
  const clamp = await book(resident, UNIT, { units: 500 });
  ok("an impossible quantity is clamped to the maximum", Number((clamp.data.booking || clamp.data).units) === 20);
  const none = await book(resident, UNIT, { units: 0 });
  ok("zero of something is refused, not billed as free", none.status === 400, `got ${none.status}`);
}
{
  const s = await book(resident, SUB);
  const b = s.data.booking || s.data;
  console.log(`      sub: 9 900 weekly → total ${ft(b.total_huf)}, fee ${ft(b.service_fee_huf)}`);
  ok("a subscription prices like a flat service", b.total_huf === 10890 && b.service_fee_huf === 990, String(b.total_huf));
  ok("and carries its period, so it can renew", b.period === "weekly", String(b.period));
}
{
  const z = await book(resident, FREE);
  ok("a service priced at zero cannot be booked at all", z.status === 400, `got ${z.status}`);
  ok("and the message points at the company, not the customer",
     /priced correctly/i.test(z.data.error || ""), z.data.error);
}

console.log("\n── the student discount, including the way it is set today ──");
{
  const zero = await book(student, FLAT);
  const zb = zero.data.booking || zero.data;
  console.log(`   student, discount 0% → total ${ft(zb.total_huf)} (same as a resident)`);
  ok("at 0% a student pays exactly what a resident pays", zb.total_huf === 13200, String(zb.total_huf));
  ok("the booking still records that they are a student", zb.customer_type === "student", String(zb.customer_type));

  await query("UPDATE companies SET student_discount = 20 WHERE id = $1", [cid]);
  const twenty = await book(student, FLAT);
  const tb = twenty.data.booking || twenty.data;
  console.log(`   student, discount 20% → total ${ft(tb.total_huf)}, company keeps ${ft(tb.total_huf - tb.service_fee_huf)}`);
  ok("at 20% the price drops by a fifth before the fee", tb.total_huf === 10560 && tb.service_fee_huf === 960,
     `${tb.total_huf} / ${tb.service_fee_huf}`);
  ok("the discount comes out of the company's share, not ours",
     tb.total_huf - tb.service_fee_huf === 9600);

  const resFull = await book(resident, FLAT);
  ok("a resident is unaffected by the student rate", (resFull.data.booking || resFull.data).total_huf === 13200);
}

console.log("\n── three discounts, only the best one ──");
{
  await query("UPDATE companies SET promo = $1 WHERE id = $2", [JSON.stringify({ pct: 10, until: dPlus(30) }), cid]);
  const both = await book(student, FLAT);
  const bb = both.data.booking || both.data;
  console.log(`   student 20% + company promo 10% → total ${ft(bb.total_huf)}  (20% only, not 30%)`);
  ok("a student with a promo running gets 20, not 30", bb.total_huf === 10560, String(bb.total_huf));

  await query("UPDATE companies SET promo = $1 WHERE id = $2", [JSON.stringify({ pct: 40, until: dPlus(30) }), cid]);
  const better = await book(student, FLAT);
  ok("when the promo beats the student rate, the promo wins",
     (better.data.booking || better.data).total_huf === 7920, String((better.data.booking || better.data).total_huf));

  await query("UPDATE companies SET promo = $1 WHERE id = $2", [JSON.stringify({ pct: 40, until: "2020-01-01" }), cid]);
  const expired = await book(student, FLAT);
  ok("an expired promo is ignored, and the student rate applies",
     (expired.data.booking || expired.data).total_huf === 10560, String((expired.data.booking || expired.data).total_huf));
  await query("UPDATE companies SET promo = NULL, student_discount = 0 WHERE id = $1", [cid]);
}

console.log("\n── the rule that broke payments ──");
{
  const c = await book(resident, CHEAP);
  const b = c.data.booking || c.data;
  console.log(`   a 900 Ft job → total ${ft(b.total_huf)}, our commission ${ft(b.service_fee_huf)}`);
  ok("the minor amount is the forint amount ×100", b.total_minor === b.total_huf * 100, `${b.total_minor}`);
  ok("and it is divisible by 100, which is what Stripe demands of HUF",
     b.total_minor % 100 === 0, String(b.total_minor));

  const feeMinor = pay.payableMinor(b.service_fee_minor, "HUF");
  console.log(`   commission in minor units: ${b.service_fee_minor} → payable ${feeMinor}`);
  ok("the commission is floored to a whole forint", feeMinor % 100 === 0, String(feeMinor));

  const split = pay.feeSplit(b.service_fee_minor, "HUF", "acct_test");
  ok("a real commission is sent as an application fee", split.application_fee_amount === feeMinor);
  ok("and it goes to the company's own Stripe account", split.transfer_data?.destination === "acct_test");

  /* The 990 Ft case: the commission floors all the way to nothing. */
  const nil = pay.feeSplit(0, "HUF", "acct_test");
  ok("a commission of zero is OMITTED, never sent as 0", !("application_fee_amount" in nil), JSON.stringify(nil));
  ok("but the money still transfers to the company", nil.transfer_data?.destination === "acct_test");
  ok("with no Stripe account connected, no split is attempted at all",
     Object.keys(pay.feeSplit(1000, "HUF", null)).length === 0);

  for (const amt of [99, 100, 149, 990, 1234, 99999]) {
    const p = pay.payableMinor(amt, "HUF");
    ok(`  ${amt} → ${p}, still divisible by 100`, p % 100 === 0 && p <= amt);
  }
  ok("a currency with real cents is left alone", pay.payableMinor(1234, "EUR") === 1234);
}

console.log("\n── what each side sees ──");
{
  const login = await j("/api/auth/login", { method: "POST", body: { email: "mn-boss@t.hu", password: "secret123" } });
  ok("the owner can log in", !!login.data.token, JSON.stringify(login.data).slice(0, 120));
  const before = await j("/api/bookings", { token: login.data.token });
  ok("an unpaid booking is invisible to the company — the whole point of that fix",
     (before.data.bookings || []).length === 0, String((before.data.bookings || []).length));

  /* Pay them all, and the same bookings appear. */
  await query("UPDATE bookings SET payment_status = 'paid' WHERE company_id = $1", [cid]);
  const list = await j("/api/bookings", { token: login.data.token });
  const rows = list.data.bookings || [];
  ok("once paid, the company sees them", rows.length > 0, String(rows.length));
  const bad = rows.filter((b) => b.total_huf - b.service_fee_huf <= 0);
  ok("no booking leaves the company with nothing", bad.length === 0, String(bad.length));
  const mismatched = rows.filter((b) => b.total_minor !== b.total_huf * 100);
  ok("every stored minor amount agrees with its forint amount", mismatched.length === 0, String(mismatched.length));
  const notRound = rows.filter((b) => b.total_minor % 100 !== 0 || b.service_fee_minor % 100 !== 0);
  ok("and every amount Stripe will see is divisible by 100", notRound.length === 0, String(notRound.length));
}

console.log(`\n════ MONEY: ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
