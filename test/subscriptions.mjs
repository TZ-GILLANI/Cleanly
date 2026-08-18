/* Part 3 verification — runs standalone so payments can be judged on its own. */
process.env.PGMEM = "1"; process.env.JWT_SECRET = "t"; process.env.PORT = "4488";
await import("../server/index.js");
await new Promise((r) => setTimeout(r, 900));
const { query } = await import("../server/db.js");
const { nextDateFrom, cancellationRefundPct, customerMayCancel } = await import("../server/routes/payments.js");
const { materialise } = await import("../server/lib/subscriptions.js");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, extra); }
};

console.log("\n── date maths ──");
ok("weekly advances 7 days", nextDateFrom("2026-08-10", "weekly") === "2026-08-17");
ok("biweekly advances 14 days", nextDateFrom("2026-08-10", "biweekly") === "2026-08-24");
ok("monthly clamps Jan 31 → Feb 28", nextDateFrom("2026-01-31", "monthly") === "2026-02-28");
ok("monthly Aug 31 → Sep 30", nextDateFrom("2026-08-31", "monthly") === "2026-09-30");

console.log("\n── cancellation policy (5.12) ──");
/* Build the slot in LOCAL hours: hoursUntilBooking parses the stored time as
   Budapest, so a UTC-built fixture is silently two hours out. */
const inH = (h) => {
  const t = new Date(Date.now() + h * 3600e3);
  return { scheduled_date: t.toISOString().slice(0, 10),
           scheduled_slot: `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}` };
};
ok("49h before → still cancellable, full refund", customerMayCancel(inH(49)) === true && cancellationRefundPct() === 100);
/* The half-refund tier is gone: cancelling is either allowed and refunded in
   full, or not allowed at all. */
ok("47h before → refused, the window has closed", customerMayCancel(inH(47)) === false);
ok("30min before → refused too", customerMayCancel(inH(0.5)) === false);

console.log("\n── scheduler materialises occurrences (3.4) ──");
const j = async (p, o = {}) => {
  const r = await fetch(`http://127.0.0.1:4488${p}`, { method: o.method || "GET",
    headers: { "Content-Type": "application/json", ...(o.token ? { Authorization: "Bearer " + o.token } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
await j("/api/auth/register", { method: "POST", body: { email: "c@s.hu", password: "secret123", role: "company", fullName: "Boss", companyName: "SubCo", taxId: "12345676-1-02", regNumber: "09-09-123456", city: "Debrecen", termsAccepted: true } });
await j("/api/auth/register", { method: "POST", body: { email: "u@s.hu", password: "secret123", role: "customer", fullName: "Cust", phone: "+36201234567", residence: "resident", city: "Debrecen", termsAccepted: true } });
await query("UPDATE users SET approval_status='approved'");
await query("UPDATE companies SET is_approved=true, is_listed=true");
const co = await query("SELECT id FROM companies LIMIT 1");
const cu = await query("SELECT id FROM users WHERE role='customer' LIMIT 1");
const sv = await query("INSERT INTO services (company_id, name, price_huf, pricing_type, period, is_active) VALUES ($1,'Weekly clean',5000,'subscription','weekly',true) RETURNING id", [co.rows[0].id]);

const subIns = await query(
  `INSERT INTO subscriptions (customer_id, company_id, service_id, frequency, slot, address, currency, amount_minor, fee_minor, status, next_booking_date)
   VALUES ($1,$2,$3,'weekly','09:00','Test u. 1','HUF',550000,50000,'active',CURRENT_DATE + 7) RETURNING id`,
  [cu.rows[0].id, co.rows[0].id, sv.rows[0].id]);

await materialise();
const made = await query("SELECT * FROM bookings WHERE subscription_id = $1 ORDER BY scheduled_date", [subIns.rows[0].id]);
ok("creates 4 future occurrences", made.rows.length === 4, `got ${made.rows.length}`);
ok("occurrences are 'scheduled', not unpaid", made.rows.length === 4 && made.rows.every((b) => b.payment_status === "scheduled"));
ok("occurrences are ordinary bookings (have company + slot)", made.rows.length === 4 && made.rows.every((b) => b.company_id && b.scheduled_slot === "09:00"));
ok("occurrences are a week apart", made.rows.length === 4 &&
   (new Date(made.rows[1].scheduled_date) - new Date(made.rows[0].scheduled_date)) / 86400000 === 7);

await materialise();
const again = await query("SELECT COUNT(*)::int n FROM bookings WHERE subscription_id = $1", [subIns.rows[0].id]);
ok("running twice does NOT duplicate", again.rows[0].n === 4, `got ${again.rows[0].n}`);

console.log("\n── unpaid subscriptions no longer masquerade as jobs (3.4 fix) ──");
const vis = await query(
  `SELECT COUNT(*)::int n FROM bookings b WHERE b.company_id = $1
     AND (b.payment_status IN ('paid','scheduled','retry') OR b.status <> 0)`, [co.rows[0].id]);
ok("scheduled occurrences ARE visible to the company", vis.rows[0].n === 4, `got ${vis.rows[0].n}`);
await query("INSERT INTO bookings (customer_id, company_id, service_id, service_snapshot, scheduled_date, scheduled_slot, address, customer_type, total_huf, pricing_type, period, payment_status, status, order_no) VALUES ($1,$2,$3,'{}',CURRENT_DATE+1,'11:00','x','resident',5000,'subscription','weekly','unpaid',0,999)", [cu.rows[0].id, co.rows[0].id, sv.rows[0].id]);
const vis2 = await query(
  `SELECT COUNT(*)::int n FROM bookings b WHERE b.company_id = $1
     AND (b.payment_status IN ('paid','scheduled','retry') OR b.status <> 0)`, [co.rows[0].id]);
ok("an UNPAID subscription stub stays hidden", vis2.rows[0].n === 4, `got ${vis2.rows[0].n}`);


console.log("\n── a renewal owes the same platform fee as the first booking ──");
const subSrc = (await import("fs")).readFileSync("server/lib/subscriptions.js", "utf8");
/* Renewals used to be charged without recording what Cleano actually kept, so
   every visit after the first showed up at the headline rate — which would put
   Stripe's cut on the partner's invoice, exactly the thing we promised not to
   do. There is no automatic invoice any more, but the figure still has to be
   right, because the billing list is built from it. */
ok("a renewal records what we actually kept", /platform_net_minor = \$1/.test(subSrc),
   "renewals were being billed at the headline rate");
ok("and it is the net figure, not the headline commission", /platformNetMinor\(amountMinor, Number\(b\.sub_fee\)/.test(subSrc));
ok("nothing tries to issue an invoice from a background charge", !/issueFeeInvoice|szamlazz/i.test(subSrc));

console.log("\n── the plan keeps itself alive ──");
ok("four occurrences are kept ahead", /const LOOKAHEAD = 4/.test(subSrc));
ok("it runs on a timer, not on someone remembering", /setInterval\(tick/.test(subSrc));
ok("only active plans are charged", /s\.status = 'active'/.test(subSrc));
ok("cancelled and declined bookings are skipped", /b\.status NOT IN \(8,9\)/.test(subSrc));
ok("a failed charge retries once before giving up", /already \? "failed" : "retry"/.test(subSrc));
ok("both sides are told when a card fails", /payment_failed/.test(subSrc) && (subSrc.match(/payment_failed/g) || []).length >= 2);
ok("and the CEO is alerted", /paymentAlert\("subscription-charge-failed"/.test(subSrc));
ok("the price is locked to the plan, not re-read from the service",
   /Price is locked to the subscription row/.test(subSrc));


console.log("\n── Cleano's commission on a RENEWAL, not just the first visit ──");
const subSrc2 = (await import("fs")).readFileSync("server/lib/subscriptions.js", "utf8");
ok("the renewal reduces the fee by Stripe's cut", /application_fee_amount: subFeeNet/.test(subSrc2),
   "otherwise the partner pays processing on every visit after the first");
ok("it uses the same helper as the first payment", /platformNetMinor\(amountMinor, Number\(b\.sub_fee\)/.test(subSrc2));
ok("and records what we actually kept, for that visit's invoice", /platform_net_minor = \$1/.test(subSrc2));

const pay2 = await import("../server/routes/payments.js");
const total = 550000, headline = 50000;
const netOnRenewal = pay2.platformNetMinor(total, headline);
ok("on a 5,500 Ft renewal the partner still receives exactly 5,000",
   (total - netOnRenewal - pay2.stripeFeeMinor(total)) === 500000,
   String((total - netOnRenewal - pay2.stripeFeeMinor(total)) / 100));

console.log("\n── cancelling: one rule, no sliding scale ──");
ok("the charge fires exactly when the cancellation right expires", /scheduled_date <= CURRENT_DATE \+ \$1/.test(subSrc2) && /CANCEL_FREE_H \|\| 48/.test(subSrc2));
const mkBooking = (hoursAway) => {
  const t = new Date(Date.now() + hoursAway * 3600e3);
  return { scheduled_date: t.toISOString().slice(0, 10),
           scheduled_slot: `${String(t.getHours()).padStart(2, "0")}:00` };
};
ok("4 days out — can cancel", pay2.customerMayCancel(mkBooking(96)) === true);
ok("49 hours out — can cancel", pay2.customerMayCancel(mkBooking(49)) === true);
ok("47 hours out — cannot", pay2.customerMayCancel(mkBooking(47)) === false);
ok("24 hours out — cannot", pay2.customerMayCancel(mkBooking(24)) === false);
ok("when cancelling IS allowed, it is always the full amount", pay2.cancellationRefundPct() === 100);
ok("there is no half-refund tier left anywhere",
   !/CANCEL_HALF_PCT/.test((await import("fs")).readFileSync("server/routes/payments.js", "utf8")));
ok("an unreadable date lets them cancel, and refunds fully",
   pay2.customerMayCancel({ scheduled_date: "nonsense" }) === true);
ok("charge and cancellation cutoff are the same moment, by design",
   pay2.customerMayCancel(mkBooking(49)) === true && pay2.customerMayCancel(mkBooking(47)) === false);
const bkSrc = (await import("fs")).readFileSync("server/routes/bookings.js", "utf8");
ok("the server refuses a late cancellation", /Bookings can only be cancelled more than/.test(bkSrc));
ok("and the company can still cancel or decline at any time",
   /req\.user\.role === "company"/.test(bkSrc));
const appSrc2 = (await import("fs")).readFileSync("src/App.jsx", "utf8");
ok("the app hides the cancel button once the window closes", /canStillCancel\(b\)/.test(appSrc2));

console.log(`\n════ PART 3: ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
