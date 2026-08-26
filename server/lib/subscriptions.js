import { query } from "../db.js";
import { notify } from "./notify.js";
import { paymentAlert } from "./alerts.js";
import { nextDateFrom } from "../routes/payments.js";
import { isoDate } from "./isodate.js";
import { slotProblem } from "./availability.js";

/* Walk a plain ISO date forward, without timezone surprises. */
const addDays = (iso, n) => {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/* ── 3.4 Subscription scheduler ─────────────────────────────────────
   Every 30 min:
   1. MATERIALISE — each active plan keeps its next 4 occurrences existing
      as ordinary bookings (payment_status 'scheduled', status 1/assigned-less).
      Calendar, company view and cleaner view need no special cases.
   2. CHARGE — occurrences 24–48h away are charged off-session on the saved
      card. Success → 'paid' + notifications. Failure → one retry next pass,
      then 'failed' + both sides notified. Never a silent loop.
   3. Plans stopped (cancelled/paused) generate nothing.                    */

/* How far ahead a plan fills the calendar.

   A flat four visits meant a weekly plan showed about a month and a monthly
   plan showed four — the same number, wildly different horizons. Musa wants
   roughly three months on the calendar whatever the cadence, so the count
   follows the frequency instead of being fixed.

   It is a rolling window, not a permanent booking: as each visit passes, one
   more is added at the end. Longer is not free — every materialised visit
   occupies a real slot in the company's capacity, so a year of a weekly plan
   would block fifty-two slots nobody can rearrange. */
const LOOKAHEAD_BY_FREQ = { weekly: 12, biweekly: 6, monthly: 3 };
const lookaheadFor = (freq) =>
  Math.max(1, Number(process.env.SUB_LOOKAHEAD) || LOOKAHEAD_BY_FREQ[freq] || 4);

async function getStripe() {
  const { default: Stripe } = await import("stripe");
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

/* materialise(subId) — one plan, or every plan if no id is given.

   Nothing used to call this except the half-hourly tick. So a customer could
   subscribe, pay, and then look at a calendar that showed a single visit for
   up to thirty minutes, because the visits after the first did not exist yet.
   The company saw the same gap: one job where there should have been a run of
   them, with no way to tell whether the plan had worked.

   It is now also called the moment a plan is created and the moment one is
   resumed, for that plan alone. */
export async function materialise(subId = null) {
  /* A second lock on the same door. Cancelling the plan at deletion time is the
     fix; this makes sure a plan belonging to a closed account can never generate
     work or charges even if it was somehow missed. */
  const subs = await query(
    subId
      ? `SELECT s.* FROM subscriptions s
         JOIN users cu ON cu.id = s.customer_id
         WHERE s.status = 'active' AND cu.is_active = true AND s.id = $1`
      : `SELECT s.* FROM subscriptions s
         JOIN users cu ON cu.id = s.customer_id
         WHERE s.status = 'active' AND cu.is_active = true`,
    subId ? [subId] : []);
  for (const s of subs.rows) {
    try {
      let date = s.next_booking_date instanceof Date
        ? s.next_booking_date.toISOString().slice(0, 10) : isoDate(s.next_booking_date);
      // how many future occurrences already exist?
      const cnt = await query(
        "SELECT COUNT(*)::int AS n FROM bookings WHERE subscription_id = $1 AND scheduled_date >= CURRENT_DATE AND status NOT IN (8,9)",
        [s.id]);
      let need = lookaheadFor(s.frequency) - (cnt.rows[0]?.n || 0);
      const coRow = await query("SELECT * FROM companies WHERE id = $1", [s.company_id]);
      const co = coRow.rows[0];
      while (need-- > 0) {
        const svc = await query("SELECT * FROM services WHERE id = $1", [s.service_id]);
        const cu = await query("SELECT customer_type FROM users WHERE id = $1", [s.customer_id]);
        const custType = cu.rows[0]?.customer_type || "resident";
        const snap = svc.rows[0] ? {
          id: svc.rows[0].id, name: svc.rows[0].name, emoji: svc.rows[0].emoji,
          tasks: svc.rows[0].tasks, pricing_type: "subscription", period: s.frequency,
        } : { name: "Cleaning", pricing_type: "subscription", period: s.frequency };
        // Price is locked to the subscription row, never re-read from the service —
        // a company raising its prices must not silently raise what existing
        // subscribers pay. Minor units are x100 for every currency we handle.
        const totalHuf = Math.round(Number(s.amount_minor) / 100);

        /* Does the company actually work that day?

           Until now this was pure arithmetic: first date plus seven, plus
           seven, plus seven. Nothing asked whether the company was open. So a
           week the owner had marked as time off still filled with visits, and
           so did a weekday they never work and an hour already full — jobs
           nobody could do, sitting in the calendar looking real, and charged
           for five days ahead like any other.

           So: try the date the rhythm asks for. If the company cannot take it,
           walk forward a day at a time to the first one they can — never past
           the following visit, or the plan would start eating itself. If there
           is nothing at all in that gap, skip the occurrence rather than book
           work that cannot happen.

           The rhythm is anchored on the date the arithmetic wanted, not on
           where the visit ended up, so one bank holiday shifts one visit and
           does not drag the whole plan a day later for ever. */
        const nominal = date;
        const limitIso = nextDateFrom(nominal, s.frequency);
        let placed = null;
        for (let day = nominal; day < limitIso; day = addDays(day, 1)) {
          const why = await slotProblem({
            co, svc: svc.rows[0], companyId: s.company_id, serviceId: s.service_id,
            date: day, slot: s.slot, hours: s.hours,
          });
          if (!why) { placed = day; break; }
        }
        if (!placed) {
          console.warn("materialise: no workable day for plan", s.id, "around", nominal);
          date = limitIso;
          continue;
        }
        date = placed;

        await query(
          `INSERT INTO bookings (customer_id, company_id, service_id, service_snapshot, scheduled_date, scheduled_slot,
             address, note, customer_type, total_huf, service_fee_huf, total_minor, service_fee_minor, currency,
             pricing_type, period, hours, status, payment_status, subscription_id, order_no)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'subscription',$15,$16,0,'scheduled',$17,
             (SELECT COALESCE(MAX(order_no),0)+1 FROM bookings))`,
          [s.customer_id, s.company_id, s.service_id, JSON.stringify(snap), date, s.slot,
           s.address, s.note, custType, totalHuf, Math.round(Number(s.fee_minor) / 100),
           s.amount_minor, s.fee_minor, s.currency, s.frequency, s.hours, s.id]);
        /* From the nominal date, never from where this one landed. */
        date = nextDateFrom(nominal, s.frequency);
      }
      await query("UPDATE subscriptions SET next_booking_date = $1 WHERE id = $2", [date, s.id]);
    } catch (e) { console.error("materialise sub", s.id, e.message); }
  }
}

/* MONTHLY BILLING, WHATEVER THE CLEANING CADENCE.

   This used to charge every visit separately, five days before each one — so a
   weekly customer's card was touched four or five times a month. Musa wants one
   monthly charge for every plan, and the customer wants one line on their
   statement.

   So: find the earliest visit still unpaid; if it is within the charging
   window, take ONE payment for every unpaid visit from that date up to the
   same day next month, and mark them all paid against that one PaymentIntent.
   Four-week months cost four cleans and five-week months cost five, because
   the batch is the visits themselves and never an average.

   Each booking keeps its own per-visit price. That is what the company is paid
   for it, and it is what makes a single cancelled visit refundable for its own
   amount out of a shared charge. */
export async function chargeDue() {
  if (!process.env.STRIPE_SECRET_KEY) return;
  const due = await query(
    `SELECT b.*, s.stripe_customer_id AS sub_cust, s.payment_method_id AS sub_pm,
            s.stripe_account_id AS sub_acct, s.fee_minor AS sub_fee
     FROM bookings b
     JOIN subscriptions s ON s.id = b.subscription_id
     JOIN users cu ON cu.id = b.customer_id
     WHERE b.payment_status IN ('scheduled','retry')
       AND s.status = 'active'
       AND cu.is_active = true
       AND b.scheduled_date <= $1
       AND b.scheduled_date >= CURRENT_DATE
       AND b.status NOT IN (8,9)`,
    /* Five days before the visit, not two.

       This used to be derived from CANCEL_FREE_H — charge at the moment the
       customer loses the right to cancel, so a refund could never be owed.
       Neat, but it left the business no room: a card that fails 48 hours out
       gets one retry and then it is the night before, with a cleaner rostered
       and nothing paid.

       Five days gives a declined card four more chances and gives the company
       time to re-roster if the plan lapses. A cancellation after the charge is
       already handled — /subscriptions/:id/cancel refunds every paid future
       occurrence in full, and a plan ending is not a late cancellation.

       The cutoff is worked out here rather than as `CURRENT_DATE + $1`.
       A bare parameter has no type until the database guesses one, and
       "date + text" is not an operator either engine will accept — the whole
       charging pass would have thrown on its first real run. Nothing caught it
       because chargeDue() returns early without a Stripe key, so every test to
       date walked straight past the query. A plain date has no such ambiguity. */
    [new Date(Date.now() + Math.max(1, Number(process.env.SUB_CHARGE_DAYS || 5)) * 864e5)
      .toISOString().slice(0, 10)]);
  /* One charge per plan, not per visit. The query above returns the visits
     whose date has come round; several of the same plan may qualify at once, so
     bill each plan from its earliest due visit and let that one payment cover
     the month. */
  const byPlan = new Map();
  for (const b of due.rows) {
    const cur = byPlan.get(b.subscription_id);
    if (!cur || isoDate(b.scheduled_date) < isoDate(cur.scheduled_date)) byPlan.set(b.subscription_id, b);
  }

  for (const b of byPlan.values()) {
    /* Declared out here because the catch below marks the same rows failed.
       Inside the try it would be out of scope by then, and a declined card —
       the one moment this code has to work — would throw instead. */
    let ids = [b.id];
    try {
      const stripe = await getStripe();
      const opts = b.sub_acct ? { stripeAccount: b.sub_acct } : {};

      /* Everything unpaid from this visit up to the same day next month. */
      const { visitsInBillingMonth } = await import("../routes/payments.js");
      const window = visitsInBillingMonth(b.scheduled_date, b.frequency || b.period || "weekly");
      const lastIso = window[window.length - 1];
      const batch = await query(
        `SELECT id, total_minor, total_huf, service_fee_minor, service_fee_huf
           FROM bookings
          WHERE subscription_id = $1 AND payment_status IN ('scheduled','retry')
            AND status NOT IN (8,9)
            AND scheduled_date >= $2 AND scheduled_date <= $3
          ORDER BY scheduled_date`,
        [b.subscription_id, isoDate(b.scheduled_date), lastIso]);
      const rows = batch.rows.length ? batch.rows : [b];
      ids = rows.map((r) => r.id);
      const sum = (f, g) => rows.reduce((a, r) => a + (Number(r[f]) || Number(r[g]) * 100 || 0), 0);
      const amountMinor = sum("total_minor", "total_huf");
      const { platformNetMinor, payableMinor } = await import("../routes/payments.js");
      const cur = String(b.currency || "HUF");
      /* Stripe refuses HUF amounts that are not divisible by 100. The renewal
         charge is a round price so it survives; the reduced commission is not,
         and without this every single renewal would have been declined by
         Stripe rather than by the customer's bank. Rounded down, so the
         difference is ours and never the partner's. */
      const feeForBatch = sum("service_fee_minor", "service_fee_huf") || (Number(b.sub_fee) || 0);
      const subFeeNet = payableMinor(b.sub_acct
        ? platformNetMinor(amountMinor, feeForBatch)
        : feeForBatch, cur);
      const pi = await stripe.paymentIntents.create({
        amount: payableMinor(amountMinor, cur),
        currency: cur.toLowerCase(),
        customer: b.sub_cust, payment_method: b.sub_pm,
        off_session: true, confirm: true,
        /* Cleano absorbs Stripe's cut on renewals too. The subscription row
           stores the headline commission; without reducing it here the partner
           would quietly pay the processing cost on every visit after the first,
           which is exactly what Partner Terms 3.4 promises they will not. */
        ...(b.sub_acct && subFeeNet > 0 ? { application_fee_amount: subFeeNet } : {}),
        metadata: { booking_id: b.id, cleano_subscription: b.subscription_id, cleano_visits: String(ids.length) },
      }, {
        ...opts,
        /* Charge this visit once, whatever happens to us.

           There was no idempotency key here. If Stripe took the money and the
           process then died before the row was marked paid — a crash, a dropped
           database connection, a Render restart mid-tick — the booking stayed
           'scheduled' and the next pass charged the customer a second time.
           Thirty minutes later, silently, on a card they had saved.

           The key includes the attempt state so a genuine decline can still be
           retried: 'scheduled' and 'retry' are different attempts and get
           different keys, while a duplicate within one attempt collapses onto
           the original charge. */
        /* Keyed on the plan and the month it is paying for, not on one visit:
           the batch is the unit of payment now. The attempt state stays in the
           key so a genuine decline can still be retried. */
        idempotencyKey: `cleano-sub-${b.subscription_id}-${isoDate(b.scheduled_date)}-${b.payment_status}`,
      });
      if (pi.status === "succeeded") {
        /* Every visit in the batch carries the same reference. That is what
           lets one cancelled visit be refunded for its own amount later,
           rather than clawing back the whole month. */
        /* An explicit IN list rather than = ANY($2::uuid[]).

           ANY(...) is perfectly good Postgres, but it silently matches nothing
           under the in-memory database the tests run on — so this line would
           have looked fine, passed every test, and left an entire month of
           visits marked unpaid AFTER taking the customer's money. Untestable
           SQL in the money path is not a risk worth the elegance. */
        await query(
          `UPDATE bookings SET payment_status = 'paid', barion_payment_id = $1
            WHERE id IN (${ids.map((_, i) => "$" + (i + 2)).join(",")})`,
          [(b.sub_acct ? `stripedcpi:${b.sub_acct}:` : "stripepi:") + pi.id, ...ids]);
        /* Record what we actually kept. A renewal is a payment like any other,
           so it owes the same commission — and without this line every visit
           after the first would show up on the billing list at the headline
           rate, with Stripe's cut quietly billed to the partner. */
        /* Split what we kept across the visits it covers, so each one's
           invoice line is its own share rather than the whole month's. */
        const per = Math.floor(subFeeNet / ids.length);
        for (let i = 0; i < ids.length; i++)
          await query("UPDATE bookings SET platform_net_minor = $1 WHERE id = $2",
            [i === 0 ? subFeeNet - per * (ids.length - 1) : per, ids[i]]);
        await notify(b.customer_id, "payment_confirmed", "Monthly cleaning charged 💳",
          `${ids.length} visit${ids.length === 1 ? "" : "s"} paid, starting ${isoDate(b.scheduled_date)}.`, b.id);
        /* The company is told too. A plan that renews silently is a job the
           partner has no reason to look at until the morning it happens. */
        try {
          const oc = await query("SELECT owner_id FROM companies WHERE id = $1", [b.company_id]);
          if (oc.rows[0]) await notify(oc.rows[0].owner_id, "booking", "Recurring visit paid 🧽",
            `A plan renewed for ${isoDate(b.scheduled_date)} at ${b.scheduled_slot || ""}.`, b.id);
        } catch {}
      } else throw new Error("pi status " + pi.status);
    } catch (e) {
      /* Some failures are not worth retrying.

         An off-session charge on a European card can come back with
         authentication_required: the bank wants the customer present, tapping
         their phone. That is not a decline and a second identical attempt will
         fail in exactly the same way — it just wastes one of the five days and
         delays telling the person who can actually fix it. Same for a card
         that has been removed from the wallet or revoked: the token is gone.

         This matters more now that the first payment can be Apple Pay. Apple's
         own terms allow the saved token to be charged ONLY while the customer
         is away; the moment the bank asks for authentication, the only way
         through is the customer opening the app and paying that one visit —
         which re-saves the card and re-arms the plan for next time. */
      const code = e?.code || e?.raw?.code || e?.decline_code || "";
      const needsCustomer = code === "authentication_required"
        || code === "payment_intent_authentication_failure"
        || code === "card_not_supported"
        || code === "payment_method_not_available";
      const already = b.payment_status === "retry" || needsCustomer;
      await query(
        `UPDATE bookings SET payment_status = $1
          WHERE id IN (${ids.map((_, i) => "$" + (i + 2)).join(",")})
            AND payment_status IN ('scheduled','retry')`,
        [already ? "failed" : "retry", ...ids]);
      if (already) {
        paymentAlert("subscription-charge-failed", `booking ${b.id}: [${code || "no-code"}] ${e.message}`);
        await notify(b.customer_id, "payment_failed",
          needsCustomer ? "Your bank needs you to confirm" : "Card charge failed",
          needsCustomer
            ? "Your bank wants you to approve this payment yourself. Open the booking and pay it — that also re-saves your card, so the visits after it go back to being automatic."
            : "We couldn't charge your card for the next cleaning. Open the booking and pay it — the card you use is saved for the visits after that.",
          b.id).catch(() => {});
        const oc = await query("SELECT owner_id FROM companies WHERE id = $1", [b.company_id]);
        if (oc.rows[0]) await notify(oc.rows[0].owner_id, "payment_failed", "Recurring payment failed",
          "A recurring booking's card charge failed — the customer has been asked to pay manually.", b.id).catch(() => {});
      }
    }
  }
}

let timer = null;
export function startSubscriptions() {
  if (timer) return;
  const tick = () => Promise.resolve().then(materialise).then(chargeDue)
    .catch((e) => console.error("subscriptions:", e.message));
  timer = setInterval(tick, 30 * 60 * 1000);
  setTimeout(tick, 45 * 1000);
  console.log("   🔁 Subscription scheduler started (every 30 min)");
}
