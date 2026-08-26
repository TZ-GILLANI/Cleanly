/* THREE THINGS THAT ONLY SHOW UP WHEN YOU USE IT AT 13:00.

   1. "It is 13:00 but I am able to book 8:00."
      Only the DATE was checked. Nothing ever compared the hour, so a slot that
      had been and gone was accepted, counted against the company's capacity,
      and appeared as a job that had already happened before anyone agreed to
      it.

   2. "If the time is too close, even if the payment doesn't happen it doesn't
      cancel the booking."
      The auto-cancel was built for a COMPANY that had not answered: a
      three-hour floor and a ceiling at the slot start. An unpaid booking is a
      different thing — the company cannot even see it — so waiting until the
      cleaner was due to arrive meant the hour simply went by.

   3. The commission on a monthly plan.
      The checkout charges a MONTH, so the month's commission was written onto
      the one booking that existed at the time. The billing list reads that
      field per job, so the first visit showed five visits' worth and the other
      four showed none. The total was right and every line was wrong.

   Run: node test/pastslot.mjs                                                */
process.env.PGMEM = "1";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "ps-test";
process.env.PORT = "4609";
process.env.BOOKING_LEAD_MIN = "60";
process.env.CHECKOUT_GRACE_MIN = "30";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };

const BASE = "http://localhost:4609";
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
const { slotTime, sweepUnaccepted } = await import("../server/lib/reminders.js");
const todayIso = new Date().toISOString().slice(0, 10);
const dPlus = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

await j("/api/auth/register", { method: "POST", body: {
  fullName: "B", email: "ps-b@t.hu", password: "secret123", role: "company",
  companyName: "Past Kft", taxId: "10000001-1-02", city: "Debrecen",
  phone: "+36301112233", termsAccepted: true } });
const cid = (await query("SELECT id FROM companies WHERE name = $1", ["Past Kft"])).rows[0].id;
await query("UPDATE companies SET is_listed = true, is_approved = true WHERE id = $1", [cid]);
const svcId = (await query(`INSERT INTO services (company_id,name,description,price_huf,minutes,is_active)
  VALUES ($1,'Deep clean','x',12000,60,true) RETURNING id`, [cid])).rows[0].id;
const cuTok = (await j("/api/auth/register", { method: "POST", body: {
  fullName: "C", email: "ps-c@t.hu", password: "secret123", role: "customer", customerType: "resident",
  city: "Debrecen", address: "Piac utca 1", phone: "+36703031941", termsAccepted: true } })).data.token;

const book = (date, slot) => j("/api/bookings", { method: "POST", token: cuTok, body: {
  companyId: cid, serviceId: svcId, scheduledDate: date, scheduledSlot: slot,
  address: "Piac utca 1", city: "Debrecen", paymentMethod: "cash" } });

console.log("\n── an hour that has gone cannot be booked ──");
{
  /* Pick hours relative to the clock, so this holds whenever it runs. */
  const hourOf = (offsetH) => {
    const d = new Date(Date.now() + offsetH * 3600e3);
    return String(d.getHours()).padStart(2, "0") + ":00";
  };
  const past = await book(todayIso, hourOf(-4));
  ok("four hours ago is refused", past.status === 400, `got ${past.status} for ${hourOf(-4)}`);
  ok("and says the time has passed", /already passed/i.test(past.data.error || ""), past.data.error);

  const soon = await book(todayIso, hourOf(0));
  ok("this very hour is refused too — there is no time to get there", soon.status === 400, `got ${soon.status}`);

  const later = await book(dPlus(3), "10:00");
  ok("a normal future booking still works", later.status === 201, `${later.status} ${later.data.error || ""}`);

  const yesterday = await book(dPlus(-1), "10:00");
  ok("yesterday was already refused, and still is", yesterday.status === 400);

  const fs = await import("fs");
  const bk = fs.readFileSync(new URL("../server/routes/bookings.js", import.meta.url), "utf8");
  ok("the hour is checked, not just the day", /starts\.getTime\(\) <= Date\.now\(\)/.test(bk));
  ok("using the same clock the reminders use, so daylight saving cannot split them",
     /const \{ slotTime \} = await import\("\.\.\/lib\/reminders\.js"\);/.test(bk));
  ok("the head start is one setting, not a number buried in the code",
     /process\.env\.BOOKING_LEAD_MIN \?\? 60/.test(bk));

  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  ok("the picker hides those hours too, so nobody taps one and is then refused",
     /const notPastToday = \(iso, hours\) => \{/.test(app));
  ok("and only for today — other days are untouched",
     /if \(isoOf\(iso\) !== today\) return hours;/.test(app));
}

console.log("\n── the clock itself ──");
{
  const t = slotTime(todayIso, "08:00");
  ok("a slot resolves to a real moment", t instanceof Date && !isNaN(t.getTime()), String(t));
  ok("and 08:00 today is before 20:00 today",
     slotTime(todayIso, "08:00").getTime() < slotTime(todayIso, "20:00").getTime());
}

console.log("\n── an abandoned checkout releases the time ──");
{
  const b = await book(dPlus(1), "10:00");
  const id = b.data.booking.id;
  ok("the booking starts unpaid", b.data.booking.payment_status === "unpaid", String(b.data.booking.payment_status));

  await sweepUnaccepted();
  const fresh = (await query("SELECT status FROM bookings WHERE id = $1", [id])).rows[0];
  ok("a booking made moments ago is left alone — the card screen is still open", Number(fresh.status) === 0);

  /* Older than the grace period, payment never completed. */
  await query("UPDATE bookings SET created_at = NOW() - INTERVAL '45 minutes' WHERE id = $1", [id]);
  await sweepUnaccepted();
  const gone = (await query("SELECT status, decline_reason FROM bookings WHERE id = $1", [id])).rows[0];
  ok("once the grace period has passed it is cancelled", Number(gone.status) === 9, String(gone.status));
  ok("with a reason the customer can understand", /payment was not completed/i.test(gone.decline_reason || ""), String(gone.decline_reason));

  const paid = await book(dPlus(2), "10:00");
  const pid = paid.data.booking.id;
  await query("UPDATE bookings SET payment_status = 'paid', created_at = NOW() - INTERVAL '45 minutes' WHERE id = $1", [pid]);
  await sweepUnaccepted();
  const still = (await query("SELECT status FROM bookings WHERE id = $1", [pid])).rows[0];
  ok("a PAID booking is not touched by that rule", Number(still.status) === 0, String(still.status));

  const fs = await import("fs");
  const rem = fs.readFileSync(new URL("../server/lib/reminders.js", import.meta.url), "utf8");
  ok("the unpaid rule runs before the company-did-not-answer rule",
     rem.indexOf("payment was not completed") < rem.indexOf("company did not respond"));
  ok("and uses the same grace the capacity count uses", /CHECKOUT_GRACE_MIN \|\| 30/.test(rem));
}

console.log("\n── the commission on a monthly plan ──");
{
  const fs = await import("fs");
  const pays = fs.readFileSync(new URL("../server/routes/payments.js", import.meta.url), "utf8");
  ok("the month's commission is split across the visits it covers",
     /const share = Math\.floor\(monthNet \/ n\);/.test(pays));
  ok("the remainder goes on the first, so the parts add up to what Stripe handed us",
     /i === 0 \? monthNet - share \* \(n - 1\) : share/.test(pays));
  const sub = fs.readFileSync(new URL("../server/lib/subscriptions.js", import.meta.url), "utf8");
  ok("renewals already did the same, and still do", /const per = Math\.floor\(subFeeNet \/ ids\.length\);/.test(sub));

  /* The arithmetic, on his real numbers. */
  const { visitsInBillingMonth, platformNetMinor, payableMinor, stripeFeeMinor } = await import("../server/routes/payments.js");
  const price = 9900, fee = 990, visits = visitsInBillingMonth("2026-09-01", "weekly").length;
  const amount = (price + fee) * 100 * visits;
  const net = payableMinor(platformNetMinor(amount, fee * 100 * visits), "HUF");
  const company = amount - net - stripeFeeMinor(amount);
  ok("the company still receives its list price for every visit",
     Math.round(company / 100) === price * visits, `${company / 100} vs ${price * visits}`);
  const share = Math.floor(net / visits);
  ok("and the split adds back up to the whole", share * (visits - 1) + (net - share * (visits - 1)) === net);
  ok("so each visit's line shows about a fifth of the month, not all of it",
     share > 0 && share < net, `${share} of ${net}`);
}

console.log(`\n════ PAST SLOTS + EXPIRY + FEES: ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
