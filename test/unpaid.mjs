/* WORK NOBODY HAS PAID FOR.

   Musa's card was declined at Stripe Checkout, and the job still turned up in
   the company's list. payments.js sets payment_status = 'pending' the moment a
   Checkout SESSION IS CREATED — before a card number has been typed — and the
   company's query treated 'pending' as work in flight. So a failed payment left
   a job somebody might have driven to.

   Also here: a complaint has to carry the booking it is about, and the company
   that job belongs to, or support has to look it up by hand.

   Run: node test/unpaid.mjs                                                   */
process.env.PGMEM = "1"; process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "unpaid"; process.env.PORT = "4663";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };
const j = async (p, { method = "GET", token, body } = {}) => {
  const r = await fetch("http://localhost:4663" + p, { method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
await import("../server/index.js");
await new Promise((r) => setTimeout(r, 900));
const { query } = await import("../server/db.js");
const dPlus = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const boss = await j("/api/auth/register", { method: "POST", body: {
  fullName: "Boss", email: "up-boss@t.hu", password: "secret123", role: "company",
  companyName: "Unpaid Kft", taxId: "10000001-1-02", city: "Debrecen",
  phone: "+36301112233", termsAccepted: true } });
ok("company registers", boss.status < 300, `got ${boss.status}`);
const cid = (await query("SELECT id FROM companies WHERE name = $1", ["Unpaid Kft"])).rows[0].id;
await query("UPDATE companies SET is_listed = true, is_approved = true WHERE id = $1", [cid]);
await query("UPDATE users SET approval_status = 'approved' WHERE email = $1", ["up-boss@t.hu"]);
const btok = (await j("/api/auth/login", { method: "POST", body: { email: "up-boss@t.hu", password: "secret123" } })).data.token;
const svc = await query(`INSERT INTO services (company_id,name,description,price_huf,minutes,is_active)
  VALUES ($1,'Deep clean','x',12000,60,true) RETURNING id`, [cid]);

const cu = await j("/api/auth/register", { method: "POST", body: {
  fullName: "Ana", email: "up-ana@t.hu", password: "secret123", role: "customer",
  customerType: "resident", city: "Debrecen", address: "Piac utca 1",
  phone: "+36703031941", termsAccepted: true } });
const ctok = cu.data.token;

const bk = await j("/api/bookings", { method: "POST", token: ctok, body: {
  companyId: cid, serviceId: svc.rows[0].id, scheduledDate: dPlus(2), scheduledSlot: "09:00",
  address: "Piac utca 1", city: "Debrecen", paymentMethod: "card" } });
ok("the customer creates a booking", bk.status < 300, `${bk.status} ${JSON.stringify(bk.data).slice(0,110)}`);
const bid = bk.data.booking.id;

const companySees = async () => {
  const r = await j("/api/bookings", { token: btok });
  return (r.data.bookings || []).some((b) => b.id === bid);
};

console.log("\n── before any money moves ──");
await query("UPDATE bookings SET payment_status = 'unpaid', status = 0 WHERE id = $1", [bid]);
ok("an unpaid booking is NOT in the company's list", !(await companySees()));

console.log("\n── checkout opened, card not yet typed ──");
await query("UPDATE bookings SET payment_status = 'pending', status = 0 WHERE id = $1", [bid]);
ok("a booking merely PENDING payment is still not shown", !(await companySees()),
   "this is the bug: pending is set when the session is created, not when it is paid");

console.log("\n── the card is declined ──");
await query("UPDATE bookings SET payment_status = 'unpaid' WHERE id = $1", [bid]);
ok("after a failed payment it stays hidden", !(await companySees()));

console.log("\n── the card goes through ──");
await query("UPDATE bookings SET payment_status = 'paid' WHERE id = $1", [bid]);
ok("a PAID booking appears", await companySees());

console.log("\n── things the company already acted on stay visible ──");
await query("UPDATE bookings SET payment_status = 'pending', status = 1 WHERE id = $1", [bid]);
ok("an accepted job is shown even while payment settles", await companySees());
await query("UPDATE bookings SET payment_status = 'scheduled', status = 0 WHERE id = $1", [bid]);
ok("a subscription occurrence that is due is shown", await companySees());

console.log("\n── an abandoned checkout does not linger ──");
{
  const src = (await import("fs")).readFileSync(new URL("../server/routes/payments.js", import.meta.url), "utf8");
  ok("expired sessions are handled", /checkout\.session\.expired/.test(src));
  ok("as are asynchronous failures", /checkout\.session\.async_payment_failed/.test(src));
  ok("and they put it back to unpaid, not paid",
     /payment_status = 'unpaid'\s*\n?\s*WHERE id = \$1 AND payment_status = 'pending'/.test(src));
}

console.log("\n── a complaint carries its booking ──");
const comp = await j("/api/complaints", { method: "POST", token: ctok, body: {
  bookingId: bid, subject: "Nobody came", body: "Waited all morning" } });
ok("the customer can file it", comp.status < 300, `${comp.status} ${JSON.stringify(comp.data).slice(0,110)}`);
/* The seeded root admin only exists under DEMO_SEED, which this file does not
   use. Promote a real account instead — that is how a live admin is made. */
await j("/api/auth/register", { method: "POST", body: {
  fullName: "Root", email: "up-root@t.hu", password: "secret123", role: "customer",
  customerType: "resident", city: "Debrecen", address: "Piac utca 9",
  phone: "+36703031999", termsAccepted: true } });
await query("UPDATE users SET role = 'admin', is_super = true, approval_status = 'approved' WHERE email = $1", ["up-root@t.hu"]);
const admin = await j("/api/auth/login", { method: "POST", body: { email: "up-root@t.hu", password: "secret123" } });
const atok = admin.data.token;
ok("an admin can log in", !!atok, JSON.stringify(admin.data).slice(0, 90));
if (atok) {
  const list = await j("/api/complaints", { token: atok });
  const row = (list.data.complaints || [])[0];
  ok("the admin sees the complaint", !!row);
  ok("…with the booking's company attached", row?.booking_company_id === cid, String(row?.booking_company_id));
  ok("…and its name, so it can be shown", row?.booking_company_name === "Unpaid Kft", String(row?.booking_company_name));
  ok("…and when the job was", !!row?.scheduled_date, String(row?.scheduled_date));
  ok("…and where", row?.booking_address === "Piac utca 1", String(row?.booking_address));
}

console.log("\n── the screen pre-selects it ──");
{
  const app = (await import("fs")).readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  ok("the assign dropdown defaults to the booking's company",
     /useState\(complaint\.booking_company_id \|\| ""\)/.test(app));
  ok("and the booking is shown next to the complaint",
     /The booking this is about/.test(app));
}


console.log("\n── the app notices changes without being restarted ──");
{
  /* refreshData() existed and nothing called it, so the app only fetched at
     launch: a company accepting a job, a reply on a complaint, a service
     edited — none of it appeared until you killed the app and reopened it. */
  const stRaw = (await import("fs")).readFileSync(new URL("../src/store.jsx", import.meta.url), "utf8");
  /* Comments out, line numbers kept. The paragraph explaining why the import is
     wrong quotes the import, and the first run of this check flagged it. */
  const st = stRaw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
                  .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
  ok("something refreshes when the app returns to the foreground",
     /addEventListener\("visibilitychange", onVisible\)/.test(st));
  ok("…including on a real device, via the Capacitor bridge",
     /window\.Capacitor\?\.Plugins\?\.App/.test(st));
  ok("…and it does not import a package this project lacks",
     !/import\("@capacitor\/app"\)/.test(st), "the bundler externalises it and it can never resolve");
  ok("there is also a slow poll while you are looking at it", /setInterval\(safeRefresh, POLL_MS\)/.test(st));
  ok("a refresh cannot stack on a slow network", /if \(refreshingRef\.current\) return;/.test(st));
  ok("and it stays quiet when the screen is hidden", /document\.visibilityState === "hidden"/.test(st));
  ok("and when nobody is logged in", /if \(!isApiMode \|\| !session\) return;[\s\S]{0,200}refreshingRef/.test(st));
  ok("the listeners are torn down again", /clearInterval\(timer\)/.test(st) && /removeEventListener/.test(st));
}


console.log("\n── a commission that rounds to nothing ──");
{
  /* Musa's 990 Ft booking at the default 10% commission: Stripe's own cut eats
     the whole fee, payableMinor floors HUF to a whole forint, and the result is
     exactly 0. `application_fee_amount: 0` is not the same as omitting it —
     Stripe rejects it, and because the rejection happens on Stripe's own page
     the customer sees a generic processing error and nothing reaches our logs.
     Price-dependent, so it works at most prices and fails at some. */
  const pay = await import("../server/routes/payments.js");
  const total = 99000;                                  // 990.00 Ft
  const commission = Math.round(total * 0.10);          // the default rate
  const net = pay.platformNetMinor(total, commission);
  ok("on a 990 Ft booking at 10% the fee really does round to zero",
     pay.payableMinor(net, "HUF") === 0, String(pay.payableMinor(net, "HUF")));

  const zero = pay.feeSplit(net, "HUF", "acct_123");
  ok("so the fee key is left out entirely", !("application_fee_amount" in zero), JSON.stringify(zero));
  ok("…while the partner still gets the money", zero.transfer_data?.destination === "acct_123");

  const big = pay.feeSplit(pay.platformNetMinor(500000, 75000), "HUF", "acct_123");
  ok("a booking large enough to earn on still carries a fee",
     big.application_fee_amount > 0, JSON.stringify(big));
  ok("and it is a whole number of forints", big.application_fee_amount % 100 === 0, String(big.application_fee_amount));
  ok("no destination means no split at all", JSON.stringify(pay.feeSplit(5000, "HUF", null)) === "{}");

  const src = (await import("fs")).readFileSync(new URL("../server/routes/payments.js", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  ok("no code path still hands Stripe a bare zero fee",
     !/application_fee_amount: 0\b/.test(src));
  const subs = (await import("fs")).readFileSync(new URL("../server/lib/subscriptions.js", import.meta.url), "utf8");
  ok("recurring charges are guarded the same way", /subFeeNet > 0 \? \{ application_fee_amount/.test(subs));
}

console.log(`\n════ UNPAID WORK: ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
