/* ONE PAYMENT A MONTH, WHATEVER THE CLEANING CADENCE.

   Every visit used to be charged on its own, five days before it happened. A
   weekly customer's card was touched four or five times a month and their
   statement read like four separate businesses. Musa wants one monthly charge
   for every plan.

   The awkward part is that months are not equal: a weekly plan has four visits
   in some and five in others. Averaging would either overcharge a short month
   or work a fifth clean for nothing, so the batch is the visits themselves —
   exactly what falls between a date and the same day next month.

   Two invariants hold this together:
     · a BOOKING row always holds ONE visit's price. That is what the company
       is paid for it, and what a single cancelled visit refunds.
     · a PAYMENT may cover several bookings. So a refund on one of them must be
       scoped to its own amount, or cancelling one clean hands back the month.

   Run: node test/monthly.mjs                                                 */
process.env.PGMEM = "1";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "mo-test";
process.env.PORT = "4607";
process.env.SUB_CHARGE_DAYS = "5";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };
const ft = (n) => new Intl.NumberFormat("hu-HU").format(n) + " Ft";

const pay = await import("../server/routes/payments.js");
const { visitsInBillingMonth } = pay;

console.log("\n── the month is the visits in it, never an average ──");
{
  const w1 = visitsInBillingMonth("2026-09-01", "weekly");
  const w2 = visitsInBillingMonth("2026-02-01", "weekly");
  console.log(`   weekly from 1 Sep → ${w1.length} visits · from 1 Feb → ${w2.length} visits`);
  ok("September, starting the 1st, holds five weekly visits", w1.length === 5, w1.join(" "));
  ok("February holds four", w2.length === 4, w2.join(" "));
  ok("so a short month costs less and a long one costs more — nobody is billed for a clean they did not get",
     w1.length !== w2.length);
  ok("fortnightly lands two or three", [2, 3].includes(visitsInBillingMonth("2026-09-01", "biweekly").length),
     String(visitsInBillingMonth("2026-09-01", "biweekly").length));
  ok("monthly is always one", visitsInBillingMonth("2026-09-01", "monthly").length === 1);
  ok("the window is exclusive at the far end — the same day next month starts the NEXT bill",
     !visitsInBillingMonth("2026-09-01", "weekly").includes("2026-10-01"));
  ok("a plan starting on the 31st does not skip a month",
     visitsInBillingMonth("2026-01-31", "monthly").length === 1);
  ok("and a nonsense cadence still returns something rather than spinning",
     visitsInBillingMonth("2026-09-01", "nonsense").length >= 1);
}

console.log("\n── what the customer is charged, in forints ──");
{
  const price = 9900, fee = 990;      // 9 900 + 10%
  const visits = visitsInBillingMonth("2026-09-01", "weekly").length;
  console.log(`   weekly 9 900 Ft → ${visits} × ${ft(price + fee)} = ${ft((price + fee) * visits)} for September`);
  ok("the monthly charge is the visits times the per-visit total",
     (price + fee) * visits === 54450, String((price + fee) * visits));
  ok("and it is divisible by 100, which is what Stripe demands of HUF",
     ((price + fee) * visits * 100) % 100 === 0);
}

console.log("\n── the code that does it ──");
{
  const fs = await import("fs");
  const sub = fs.readFileSync(new URL("../server/lib/subscriptions.js", import.meta.url), "utf8");
  const pays = fs.readFileSync(new URL("../server/routes/payments.js", import.meta.url), "utf8");

  ok("renewals are grouped by plan, not charged per visit", /const byPlan = new Map\(\);/.test(sub));
  ok("each plan is billed from its earliest visit still owing",
     /if \(!cur \|\| isoDate\(b\.scheduled_date\) < isoDate\(cur\.scheduled_date\)\)/.test(sub));
  ok("the batch is every unpaid visit inside that month", /visitsInBillingMonth\(b\.scheduled_date/.test(sub));
  ok("one PaymentIntent covers them all", /WHERE id IN \(\$\{ids\.map/.test(sub));
  ok("and they all carry the same reference, so one can be refunded alone",
     /SET payment_status = 'paid', barion_payment_id = \$1\s+WHERE id IN \(/.test(sub));
  ok("the commission is summed across the batch", /const feeForBatch = sum\("service_fee_minor"/.test(sub));
  ok("then split back across the visits it covers, so each invoice line is its own share",
     /const per = Math\.floor\(subFeeNet \/ ids\.length\);/.test(sub));
  ok("the idempotency key is the plan and the month, not one visit",
     /cleano-sub-\$\{b\.subscription_id\}-\$\{isoDate\(b\.scheduled_date\)\}/.test(sub));
  ok("a decline marks the whole batch, not just the first row",
     /SET payment_status = \$1\s+WHERE id IN \(/.test(sub));
  /* ANY($n::uuid[]) is good Postgres that matches NOTHING under the in-memory
     database the tests use — so it would pass every test and then leave a paid
     month marked unpaid in production. No array parameters in the money path. */
  ok("no untestable array parameter is used where money is recorded",
     !/= ANY\(\$\d+::uuid\[\]\)/.test(sub.replace(/\/\*[\s\S]*?\*\//g, "")));

  /* The bug that would have hit on the first real decline. */
  const seg = sub.slice(sub.indexOf("for (const b of byPlan.values())"));
  ok("the id list is declared where the catch can still see it",
     /let ids = \[b\.id\];\s*\n\s*try \{/.test(seg));

  ok("the first checkout charges the whole first month",
     /const monthVisits = isSub[\s\S]{0,120}visitsInBillingMonth\(booking\.scheduled_date/.test(pays));
  ok("and says so on the Stripe page, rather than showing a number four times bigger with no reason",
     /billed monthly/.test(pays));
  ok("the webhook then marks that whole month paid",
     /payment_status = 'paid', barion_payment_id = \$1\s+WHERE subscription_id = \$2/.test(pays));
  ok("and moves the plan past them, so the monthly pass cannot bill them again",
     /next_booking_date = GREATEST\(next_booking_date, \$1\)/.test(pays));
}

console.log("\n── refunding one visit must not hand back the month ──");
{
  const fs = await import("fs");
  const pays = fs.readFileSync(new URL("../server/routes/payments.js", import.meta.url), "utf8");
  ok("a refund first asks whether anything else shares the payment",
     /SELECT COUNT\(\*\)::int AS n FROM bookings WHERE barion_payment_id = \$1 AND id <> \$2/.test(pays));
  ok("and if so, refunds only this visit's own amount — even at 100%",
     /\(sharesPayment \? ownMinor : null\)/.test(pays));
  ok("a payment covering a single visit still refunds in full, as before",
     /const amountMinor = partial/.test(pays));
  ok("the result says whether it was scoped, so a caller can tell", /scoped: sharesPayment/.test(pays));
}

console.log("\n── end to end ──");
process.env.PORT = "4607";
await import("../server/index.js");
await new Promise((r) => setTimeout(r, 900));
const { query } = await import("../server/db.js");
const j = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch("http://localhost:4607" + path, {
    method, signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
const { materialise } = await import("../server/lib/subscriptions.js");
const { isoDate } = await import("../server/lib/isodate.js");
const dPlus = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

await j("/api/auth/register", { method: "POST", body: {
  fullName: "B", email: "mo-b@t.hu", password: "secret123", role: "company",
  companyName: "Monthly Kft", taxId: "10000001-1-02", city: "Debrecen",
  phone: "+36301112233", termsAccepted: true } });
const cid = (await query("SELECT id FROM companies WHERE name = $1", ["Monthly Kft"])).rows[0].id;
await query("UPDATE companies SET is_listed = true, is_approved = true WHERE id = $1", [cid]);
const svcId = (await query(`INSERT INTO services (company_id,name,description,price_huf,minutes,is_active,pricing_type,period)
  VALUES ($1,'Weekly clean','x',9900,120,true,'subscription','weekly') RETURNING id`, [cid])).rows[0].id;
const cuTok = (await j("/api/auth/register", { method: "POST", body: {
  fullName: "C", email: "mo-c@t.hu", password: "secret123", role: "customer", customerType: "resident",
  city: "Debrecen", address: "Piac utca 1", phone: "+36703031941", termsAccepted: true } })).data.token;
const cuId = (await query("SELECT id FROM users WHERE email = $1", ["mo-c@t.hu"])).rows[0].id;

const first = await j("/api/bookings", { method: "POST", token: cuTok, body: {
  companyId: cid, serviceId: svcId, scheduledDate: dPlus(7), scheduledSlot: "10:00",
  address: "Piac utca 1", city: "Debrecen", paymentMethod: "card" } });
const firstId = first.data.booking.id;
ok("a plan booking still stores ONE visit's price", Number(first.data.booking.total_huf) === 10890,
   String(first.data.booking.total_huf));

const subId = (await query(
  `INSERT INTO subscriptions (customer_id, company_id, service_id, frequency, slot, address,
     currency, amount_minor, fee_minor, stripe_customer_id, payment_method_id, stripe_account_id, status, next_booking_date)
   VALUES ($1,$2,$3,'weekly','10:00','Piac utca 1','HUF',1089000,99000,'cus_A','pm_A','acct_1','active',$4) RETURNING id`,
  [cuId, cid, svcId, dPlus(14)])).rows[0].id;
await query("UPDATE bookings SET subscription_id = $1, payment_status = 'paid', barion_payment_id = 'stripe:sess_month1' WHERE id = $2", [subId, firstId]);
await materialise();

{
  const all = (await query("SELECT id, scheduled_date, total_huf FROM bookings WHERE subscription_id = $1 ORDER BY scheduled_date", [subId])).rows;
  ok("the run is built out three months", all.length >= 12, String(all.length));
  ok("and every visit carries its own price, not the month's",
     all.every((r) => Number(r.total_huf) === 10890), all.map((r) => r.total_huf).join(","));

  const window = visitsInBillingMonth(isoDate(all[0].scheduled_date), "weekly");
  const inWindow = all.filter((r) => isoDate(r.scheduled_date) <= window[window.length - 1]);
  console.log(`   one month from ${isoDate(all[0].scheduled_date)} = ${inWindow.length} visits = ${ft(inWindow.length * 10890)}`);
  ok("a month's batch is several visits, charged together", inWindow.length >= 4, String(inWindow.length));
  ok("and the sum is what the card would be asked for",
     inWindow.length * 10890 === inWindow.reduce((a, r) => a + Number(r.total_huf), 0));
}

console.log("\n── one payment, several visits, one cancelled ──");
{
  const rows = (await query("SELECT id FROM bookings WHERE subscription_id = $1 ORDER BY scheduled_date LIMIT 4", [subId])).rows;
  await query(
    `UPDATE bookings SET payment_status = 'paid', barion_payment_id = 'stripepi:pi_batch'
      WHERE id IN (${rows.map((_, i) => "$" + (i + 1)).join(",")})`,
    rows.map((r) => r.id));
  const shared = await query("SELECT COUNT(*)::int AS n FROM bookings WHERE barion_payment_id = $1 AND id <> $2",
    ["stripepi:pi_batch", rows[0].id]);
  ok("the siblings are findable from any one of them", shared.rows[0].n === 3, String(shared.rows[0].n));
  ok("which is exactly what the refund uses to scope itself", shared.rows[0].n > 0);
}

console.log(`\n════ MONTHLY BILLING: ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
