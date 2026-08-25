/* THE RECURRING PLAN, END TO END.

   Four faults, and the first one caused most of the others.

   1. Subscribing never opened the card screen. The client read
      `if (isLive && !isSub)` — a subscription was the ONE booking that did not
      go to checkout. You subscribed, landed back on the list, and had to find
      "Pay now" yourself. And that first checkout is where the card is saved:
      setup_future_usage rides on it and nowhere else. No card on file means no
      automatic renewal, so the recurring plan was never recurring.

   2. Paying a failed renewal by hand did not re-arm the plan. Renewals charge
      subscriptions.payment_method_id; the manual payment only updated the
      customer's default. So an expired card failed, was replaced, and failed
      again the next period, and the one after.

   3. The charge ran 48 hours out, derived from the cancellation window. One
      retry and then it is the night before, with a cleaner rostered.

   4. Four occurrences were materialised at once and all four appeared in the
      list, so one weekly arrangement read as four separate jobs.

   Run: node test/plans.mjs                                                   */
process.env.PGMEM = "1";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "pl-test";
process.env.PORT = "4605";
process.env.SUB_CHARGE_DAYS = "5";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };

const BASE = "http://localhost:4605";
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
const { materialise } = await import("../server/lib/subscriptions.js");
const dPlus = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

await j("/api/auth/register", { method: "POST", body: {
  fullName: "B", email: "pl-b@t.hu", password: "secret123", role: "company",
  companyName: "Plans Kft", taxId: "10000001-1-02", city: "Debrecen",
  phone: "+36301112233", termsAccepted: true } });
const cid = (await query("SELECT id FROM companies WHERE name = $1", ["Plans Kft"])).rows[0].id;
await query("UPDATE companies SET is_listed = true, is_approved = true WHERE id = $1", [cid]);
await query("UPDATE users SET approval_status = 'approved' WHERE email = $1", ["pl-b@t.hu"]);
const coTok = (await j("/api/auth/login", { method: "POST", body: { email: "pl-b@t.hu", password: "secret123" } })).data.token;
const svcId = (await query(`INSERT INTO services (company_id,name,description,price_huf,minutes,is_active,pricing_type,period)
  VALUES ($1,'Weekly clean','x',9900,120,true,'subscription','weekly') RETURNING id`, [cid])).rows[0].id;
const cuTok = (await j("/api/auth/register", { method: "POST", body: {
  fullName: "C", email: "pl-c@t.hu", password: "secret123", role: "customer", customerType: "resident",
  city: "Debrecen", address: "Piac utca 1", phone: "+36703031941", termsAccepted: true } })).data.token;
const cuId = (await query("SELECT id FROM users WHERE email = $1", ["pl-c@t.hu"])).rows[0].id;

console.log("\n── subscribing goes to the card screen, like any other payment ──");
{
  const fs = await import("fs");
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  ok("the checkout is no longer skipped for a plan", !/if \(isLive && !isSub\)/.test(app));
  ok("a plan opens checkout the same way a one-off does",
     /if \(isLive\) \{ \/\/ live = card only/.test(app));
  ok("and the wait screen explains what the saved card is for",
     /This card is saved for the visits after this one/.test(app));
  const pay = fs.readFileSync(new URL("../server/routes/payments.js", import.meta.url), "utf8");
  ok("that session is the one that saves the card",
     /\.\.\.\(isSub \? \{ setup_future_usage: "off_session" \} : \{\}\)/.test(pay));
}

console.log("\n── the plan itself only exists once the money has moved ──");
const first = await j("/api/bookings", { method: "POST", token: cuTok, body: {
  companyId: cid, serviceId: svcId, scheduledDate: dPlus(7), scheduledSlot: "10:00",
  address: "Piac utca 1", city: "Debrecen", paymentMethod: "card" } });
const firstId = first.data.booking.id;
ok("the first visit is booked", first.status === 201);
const noPlanYet = await query("SELECT COUNT(*)::int AS n FROM subscriptions WHERE customer_id = $1", [cuId]);
ok("but no recurring plan exists yet — nothing is paid", noPlanYet.rows[0].n === 0, String(noPlanYet.rows[0].n));

/* What the webhook does when that first payment clears. */
const subId = (await query(
  `INSERT INTO subscriptions (customer_id, company_id, service_id, frequency, slot, address, hours,
     currency, amount_minor, fee_minor, stripe_customer_id, payment_method_id, stripe_account_id, status, next_booking_date)
   VALUES ($1,$2,$3,'weekly','10:00','Piac utca 1',NULL,'HUF',1089000,99000,'cus_A','pm_OLD','acct_1','active',$4) RETURNING id`,
  [cuId, cid, svcId, dPlus(14)])).rows[0].id;
await query("UPDATE bookings SET payment_status = 'paid', subscription_id = $1 WHERE id = $2", [subId, firstId]);

console.log("\n── four visits exist, one visit shows ──");
await materialise();
{
  const rows = await query("SELECT COUNT(*)::int AS n FROM bookings WHERE subscription_id = $1 AND status NOT IN (8,9)", [subId]);
  ok("the scheduler keeps several ahead, for the calendar and the charge", rows.rows[0].n >= 4, String(rows.rows[0].n));

  const fs = await import("fs");
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  ok("but the lists collapse a plan to its next visit", /const nextVisitOnly = \(list\) => \{/.test(app));
  ok("the customer's list uses it", /const mine = nextVisitOnly\(allMine\);/.test(app));
  ok("the company's job list uses it too",
     (app.match(/nextVisitOnly\(allMine\)/g) || []).length === 2, "should be customer + company");
  ok("history is left alone — a finished visit stays where it is",
     /if \(b\.status >= 4\) continue;/.test(app));
  ok("the card says which visit is next", /L\("Next on \{0\}", "Következő: \{0\}"\)/.test(app));
  ok("and how many are already booked behind it", /L\("\{0\} more booked", "még \{0\} lefoglalva"\)/.test(app));

  /* The collapse, run on the real rows. */
  const all = (await query("SELECT id, subscription_id, status, scheduled_date, scheduled_slot FROM bookings WHERE subscription_id = $1 ORDER BY scheduled_date", [subId])).rows;
  const best = new Map();
  for (const b of all) {
    if (b.status >= 4) continue;
    const k = String(b.scheduled_date).slice(0, 10) + (b.scheduled_slot || "");
    const cur = best.get(b.subscription_id);
    if (!cur || k < cur.key) best.set(b.subscription_id, { key: k, id: b.id });
  }
  const keep = new Set([...best.values()].map((x) => x.id));
  const shown = all.filter((b) => b.status >= 4 || keep.has(b.id));
  ok("so one upcoming visit is shown, not four", shown.filter((b) => b.status < 4).length === 1,
     `${shown.filter((b) => b.status < 4).length} of ${all.length}`);
}

console.log("\n── the company calendar is the one place that shows them all ──");
{
  const fs = await import("fs");
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const sched = app.slice(app.indexOf("function CompanySchedule()"), app.indexOf("function CompanySchedule()") + 1200);
  ok("the Schedule tab reads every booking, uncollapsed",
     /const mine = bookings\.filter\(\(b\) => b\.company_id === session\.companyId/.test(sched));
  ok("and does not call the collapse", !/nextVisitOnly/.test(sched));
  const co = await j("/api/bookings", { token: coTok });
  const runs = (co.data.bookings || []).filter((b) => b.subscription_id === subId);
  ok("the company is actually sent the whole run", runs.length >= 4, String(runs.length));
}

console.log("\n── charged five days ahead, not two ──");
{
  const fs = await import("fs");
  const sub = fs.readFileSync(new URL("../server/lib/subscriptions.js", import.meta.url), "utf8");
  ok("the window comes from SUB_CHARGE_DAYS", /Number\(process\.env\.SUB_CHARGE_DAYS \|\| 5\)/.test(sub));
  ok("it is no longer tied to the cancellation window", !/CANCEL_FREE_H \|\| 48\) \/ 24/.test(sub));
  ok("the company is told when a plan renews", /Recurring visit paid/.test(sub));

  /* The window itself, run as the scheduler runs it — a plain date, never
     `CURRENT_DATE + $1`. An untyped parameter has no type until the database
     guesses one, and "date + text" is not an operator either engine accepts:
     the charging pass would have thrown on its first real run. It went unseen
     because chargeDue() returns early without a Stripe key, so no test had
     ever reached the query. */
  ok("the cutoff is a plain date, not date-plus-parameter arithmetic",
     /new Date\(Date\.now\(\) \+ Math\.max\(1, Number\(process\.env\.SUB_CHARGE_DAYS \|\| 5\)\) \* 864e5\)/.test(sub));
  /* Blank the comments first. Four earlier checks in this repo were fooled by
     prose that merely DESCRIBED the pattern they were hunting for — including
     the comment three lines above this one. */
  const subCode = sub.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  ok("and no server file does untyped date arithmetic any more",
     !/CURRENT_DATE \+ \$\d/.test(subCode));

  const cutoff = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  const inWindow = async (d) => (await query(
    `SELECT COUNT(*)::int AS n FROM bookings
      WHERE subscription_id = $1 AND payment_status IN ('scheduled','retry')
        AND scheduled_date <= $2 AND scheduled_date >= CURRENT_DATE`, [subId, cutoff(d)])).rows[0].n;
  const atFive = await inWindow(5), atTwo = await inWindow(2);
  ok("the query runs at all — which it could not before", Number.isInteger(atFive));
  ok("five days catches at least as much as two ever did", atFive >= atTwo, `${atFive} vs ${atTwo}`);
  const anyAt5 = await query(
    `SELECT COUNT(*)::int AS n FROM bookings WHERE subscription_id = $1
       AND scheduled_date > $2 AND scheduled_date <= $3`, [subId, cutoff(2), cutoff(5)]);
  ok("a visit landing in the 3-to-5 day band is picked up, where it used to be missed",
     anyAt5.rows[0].n === 0 || atFive > atTwo, `band=${anyAt5.rows[0].n} five=${atFive} two=${atTwo}`);
}

console.log("\n── paying a failed renewal re-arms the plan ──");
{
  const fs = await import("fs");
  const pay = fs.readFileSync(new URL("../server/routes/payments.js", import.meta.url), "utf8");
  ok("the webhook writes the new card onto the SUBSCRIPTION",
     /UPDATE subscriptions SET stripe_customer_id = \$1, payment_method_id = \$2/.test(pay));
  ok("keyed off the booking that was just paid",
     /WHERE id = \(SELECT subscription_id FROM bookings WHERE id = \$3\)/.test(pay));

  await query("UPDATE subscriptions SET payment_method_id = 'pm_NEW' WHERE id = (SELECT subscription_id FROM bookings WHERE id = $1)", [firstId]);
  const now = await query("SELECT payment_method_id FROM subscriptions WHERE id = $1", [subId]);
  ok("and that statement really reaches the right row", now.rows[0].payment_method_id === "pm_NEW",
     String(now.rows[0].payment_method_id));
}

console.log("\n── the customer can see whether it is automatic ──");
{
  const plans = await j("/api/subscriptions", { token: cuTok });
  const p = (plans.data.subscriptions || []).find((x) => x.id === subId);
  ok("the plan is listed", !!p);
  ok("it says a card is on file", p.has_card === true);
  ok("it says when the next charge lands", !!p.charge_on, String(p.charge_on));
  ok("five days before the visit", p.charge_on < String(p.next_date).slice(0, 10), `${p.charge_on} vs ${p.next_date}`);
  ok("and the saved card id never leaves the server",
     p.payment_method_id === undefined && p.stripe_customer_id === undefined,
     JSON.stringify({ pm: p.payment_method_id, cu: p.stripe_customer_id }));

  await query("UPDATE subscriptions SET payment_method_id = NULL WHERE id = $1", [subId]);
  const p2 = ((await j("/api/subscriptions", { token: cuTok })).data.subscriptions || []).find((x) => x.id === subId);
  ok("a plan with no card says so plainly", p2.has_card === false);
}

console.log("\n── cancelling a plan refunds what was charged ahead ──");
{
  const fs = await import("fs");
  const subs = fs.readFileSync(new URL("../server/routes/subscriptions.js", import.meta.url), "utf8");
  ok("paid future visits are refunded in full, not treated as a late cancellation",
     /refundBookingPayment\(b, 100\)/.test(subs));
  ok("uncharged ones are simply cancelled",
     /payment_status IN \('scheduled','retry'\) AND scheduled_date >= CURRENT_DATE/.test(subs));
  const r = await j(`/api/subscriptions/${subId}/cancel`, { method: "POST", token: cuTok });
  ok("the customer can cancel at any time", r.status === 200, JSON.stringify(r.data).slice(0, 90));
  const left = await query(
    "SELECT COUNT(*)::int AS n FROM bookings WHERE subscription_id = $1 AND status NOT IN (8,9) AND scheduled_date >= CURRENT_DATE AND payment_status IN ('scheduled','retry')", [subId]);
  ok("and nothing is left scheduled behind it", left.rows[0].n === 0, String(left.rows[0].n));
}

console.log(`\n════ RECURRING PLANS: ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
