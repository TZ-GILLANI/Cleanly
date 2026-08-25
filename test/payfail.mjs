/* WHEN A PAYMENT FAILS.

   Musa hit the same wall three times: a booking, Stripe's own page, and a
   generic "an error occurred while processing the request" that appeared
   nowhere afterwards. Two separate faults were hiding behind that one
   sentence.

   1. Nothing listened for payment_intent.payment_failed. Stripe fires that
      event and nothing else when a card is refused — no session event at all.
      So the booking stayed 'pending', no reason was stored, and the only
      record of what went wrong lived in the Stripe dashboard.

   2. A subscription whose payment failed LOCKED THE CUSTOMER OUT. The
      duplicate guard counted any subscription booking at status 0-3 as an
      active plan, and a declined one sits at status 0 forever. The second
      attempt was refused with "you already have an active subscription —
      cancel it first", for a subscription that had never begun. There was
      nothing to cancel, so it looked exactly like the payment bug again.

   Run: node test/payfail.mjs                                                 */
process.env.PGMEM = "1";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "pf-test";
process.env.PORT = "4603";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };

const BASE = "http://localhost:4603";
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
  fullName: "B", email: "pf-boss@t.hu", password: "secret123", role: "company",
  companyName: "PayFail Kft", taxId: "10000001-1-02", city: "Debrecen",
  phone: "+36301112233", termsAccepted: true } });
const cid = (await query("SELECT id FROM companies WHERE name = $1", ["PayFail Kft"])).rows[0].id;
await query("UPDATE companies SET is_listed = true, is_approved = true WHERE id = $1", [cid]);
const SUB = (await query(`INSERT INTO services (company_id,name,description,price_huf,minutes,is_active,pricing_type,period)
  VALUES ($1,'Weekly plan','x',9900,120,true,'subscription','weekly') RETURNING id`, [cid])).rows[0].id;
const ONE = (await query(`INSERT INTO services (company_id,name,description,price_huf,minutes,is_active)
  VALUES ($1,'One off','x',12000,120,true) RETURNING id`, [cid])).rows[0].id;
const tok = (await j("/api/auth/register", { method: "POST", body: {
  fullName: "C", email: "pf-c@t.hu", password: "secret123", role: "customer", customerType: "resident",
  city: "Debrecen", address: "Piac utca 1", phone: "+36703031941", termsAccepted: true } })).data.token;

const book = (serviceId, d) => j("/api/bookings", { method: "POST", token: tok, body: {
  companyId: cid, serviceId, scheduledDate: dPlus(d), scheduledSlot: "10:00",
  address: "Piac utca 1", city: "Debrecen", paymentMethod: "card" } });

console.log("\n── a declined card must not lock the plan ──");
const first = await book(SUB, 7);
ok("the first subscription booking is created", first.status === 201, `got ${first.status}`);
const firstId = (first.data.booking || first.data).id;

/* Exactly what Stripe leaves behind when the card is refused. */
await query("UPDATE bookings SET payment_status = 'unpaid', payment_error = $2 WHERE id = $1",
  [firstId, "Your card was declined."]);

const retry = await book(SUB, 8);
ok("the customer can try again after a decline", retry.status === 201,
   `${retry.status} ${retry.data.error || ""}`);
const deadRow = await query("SELECT status FROM bookings WHERE id = $1", [firstId]);
ok("and the dead attempt is cleared away, not left in their list", deadRow.rows[0].status === 9,
   String(deadRow.rows[0].status));

const retryId = (retry.data.booking || retry.data).id;
await query("UPDATE bookings SET payment_status = 'paid' WHERE id = $1", [retryId]);
const third = await book(SUB, 9);
ok("but a plan that IS paid still blocks a second one", third.status === 400, `got ${third.status}`);
ok("with the message that tells them what to do", /already have an active subscription/i.test(third.data.error || ""));

console.log("\n── the customer is told what actually went wrong ──");
{
  const mine = await j("/api/bookings", { token: tok });
  const rows = mine.data.bookings || [];
  const declined = rows.find((b) => b.id === firstId);
  ok("the reason travels to the app with the booking", declined?.payment_error === "Your card was declined.",
     String(declined?.payment_error));
  ok("and it is Stripe's sentence, not ours", !/could not start/i.test(declined?.payment_error || ""));
}

console.log("\n── the webhook that was never listened for ──");
{
  const fs = await import("fs");
  const src = fs.readFileSync(new URL("../server/routes/payments.js", import.meta.url), "utf8");
  ok("payment_intent.payment_failed is handled", /event\.type === "payment_intent\.payment_failed"/.test(src));
  ok("the booking id rides on the PaymentIntent, not just the session",
     /payment_intent_data:[\s\S]{0,900}?metadata: \{ booking_id: booking\.id \}/.test(src));
  ok("Stripe's own message is what gets stored", /last_payment_error\?\.message/.test(src));
  ok("the booking goes back to unpaid so it can be retried",
     /payment_status = 'unpaid', payment_error = \$2/.test(src));
  ok("and it degrades safely if the column is not there yet",
     /hasColumn\("bookings", "payment_error"\)/.test(src));
  ok("Musa is alerted, with the code and the decline code",
     /alert\("pay-failed:/.test(src) && /decline_code/.test(src));

  const schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
  ok("schema.sql creates the column", /ALTER TABLE bookings\s+ADD COLUMN IF NOT EXISTS payment_error TEXT;/.test(schema));
}

console.log("\n── nothing writes a column that does not exist ──");
{
  /* The first version of the cleanup wrote bookings.cancelled_at. That column
     belongs to the subscriptions table. It threw, and a .catch(() => {}) ate
     the error — so the cleanup would have done nothing in production and
     passed every test. */
  const fs = await import("fs");
  const src = fs.readFileSync(new URL("../server/routes/bookings.js", import.meta.url), "utf8");
  ok("the cleanup does not touch cancelled_at", !/UPDATE bookings SET status = 9, cancelled_at/.test(src));
  const ran = await query(
    `UPDATE bookings SET status = 9
     WHERE pricing_type = 'subscription' AND status = 0 AND payment_status NOT IN ('paid','scheduled','retry')`);
  ok("and the statement it does run is valid SQL", ran.rowCount >= 0, String(ran.rowCount));
}

console.log("\n── a one-off booking is untouched by any of this ──");
{
  const a = await book(ONE, 11);
  ok("a normal booking still works", a.status === 201, `got ${a.status}`);
  const b = await book(ONE, 12);
  ok("and you can book the same service twice — only plans are limited", b.status === 201, `got ${b.status}`);
}

console.log("\n── the screen says a plan has not begun ──");
{
  const fs = await import("fs");
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  ok("an unpaid plan is labelled, not shown as live",
     /Not started — pay to begin/.test(app));
  ok("the failure reason is shown on the customer's booking card",
     /L\("Payment failed:", "A fizetés nem sikerült:"\)/.test(app));
  ok("and on the admin's booking row", /<span style=\{\{ color: C\.coral \}\}>\{b\.payment_error\}<\/span>/.test(app));
}

console.log(`\n════ PAYMENT FAILURE: ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
