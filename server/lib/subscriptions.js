import { query } from "../db.js";
import { notify } from "./notify.js";
import { paymentAlert } from "./alerts.js";
import { nextDateFrom } from "../routes/payments.js";

/* ── 3.4 Subscription scheduler ─────────────────────────────────────
   Every 30 min:
   1. MATERIALISE — each active plan keeps its next 4 occurrences existing
      as ordinary bookings (payment_status 'scheduled', status 1/assigned-less).
      Calendar, company view and cleaner view need no special cases.
   2. CHARGE — occurrences 24–48h away are charged off-session on the saved
      card. Success → 'paid' + notifications. Failure → one retry next pass,
      then 'failed' + both sides notified. Never a silent loop.
   3. Plans stopped (cancelled/paused) generate nothing.                    */

const LOOKAHEAD = 4;

async function getStripe() {
  const { default: Stripe } = await import("stripe");
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

export async function materialise() {
  /* A second lock on the same door. Cancelling the plan at deletion time is the
     fix; this makes sure a plan belonging to a closed account can never generate
     work or charges even if it was somehow missed. */
  const subs = await query(
    `SELECT s.* FROM subscriptions s
     JOIN users cu ON cu.id = s.customer_id
     WHERE s.status = 'active' AND cu.is_active = true`);
  for (const s of subs.rows) {
    try {
      let date = s.next_booking_date instanceof Date
        ? s.next_booking_date.toISOString().slice(0, 10) : String(s.next_booking_date).slice(0, 10);
      // how many future occurrences already exist?
      const cnt = await query(
        "SELECT COUNT(*)::int AS n FROM bookings WHERE subscription_id = $1 AND scheduled_date >= CURRENT_DATE AND status NOT IN (8,9)",
        [s.id]);
      let need = LOOKAHEAD - (cnt.rows[0]?.n || 0);
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
        await query(
          `INSERT INTO bookings (customer_id, company_id, service_id, service_snapshot, scheduled_date, scheduled_slot,
             address, note, customer_type, total_huf, service_fee_huf, total_minor, service_fee_minor, currency,
             pricing_type, period, hours, status, payment_status, subscription_id, order_no)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'subscription',$15,$16,0,'scheduled',$17,
             (SELECT COALESCE(MAX(order_no),0)+1 FROM bookings))`,
          [s.customer_id, s.company_id, s.service_id, JSON.stringify(snap), date, s.slot,
           s.address, s.note, custType, totalHuf, Math.round(Number(s.fee_minor) / 100),
           s.amount_minor, s.fee_minor, s.currency, s.frequency, s.hours, s.id]);
        date = nextDateFrom(date, s.frequency);
      }
      await query("UPDATE subscriptions SET next_booking_date = $1 WHERE id = $2", [date, s.id]);
    } catch (e) { console.error("materialise sub", s.id, e.message); }
  }
}

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
       AND b.scheduled_date <= CURRENT_DATE + $1
       AND b.scheduled_date >= CURRENT_DATE
       AND b.status NOT IN (8,9)`,
    /* Charge exactly when the customer loses the right to cancel — never before.
       Derived from CANCEL_FREE_H so the two can never drift apart: if the window
       is widened to 72 hours, the charge moves with it automatically. */
    [Math.max(1, Math.ceil(Number(process.env.CANCEL_FREE_H || 48) / 24))]);
  for (const b of due.rows) {
    try {
      const stripe = await getStripe();
      const opts = b.sub_acct ? { stripeAccount: b.sub_acct } : {};
      const amountMinor = Number(b.total_minor) || Number(b.total_huf) * 100;
      const { platformNetMinor, payableMinor } = await import("../routes/payments.js");
      const cur = String(b.currency || "HUF");
      /* Stripe refuses HUF amounts that are not divisible by 100. The renewal
         charge is a round price so it survives; the reduced commission is not,
         and without this every single renewal would have been declined by
         Stripe rather than by the customer's bank. Rounded down, so the
         difference is ours and never the partner's. */
      const subFeeNet = payableMinor(b.sub_acct
        ? platformNetMinor(amountMinor, Number(b.sub_fee) || 0)
        : Number(b.sub_fee) || 0, cur);
      const pi = await stripe.paymentIntents.create({
        amount: payableMinor(amountMinor, cur),
        currency: cur.toLowerCase(),
        customer: b.sub_cust, payment_method: b.sub_pm,
        off_session: true, confirm: true,
        /* Cleano absorbs Stripe's cut on renewals too. The subscription row
           stores the headline commission; without reducing it here the partner
           would quietly pay the processing cost on every visit after the first,
           which is exactly what Partner Terms 3.4 promises they will not. */
        ...(b.sub_acct ? { application_fee_amount: subFeeNet } : {}),
        metadata: { booking_id: b.id, cleano_subscription: b.subscription_id },
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
        idempotencyKey: `cleano-sub-${b.id}-${b.payment_status}`,
      });
      if (pi.status === "succeeded") {
        await query("UPDATE bookings SET payment_status = 'paid', barion_payment_id = $1 WHERE id = $2",
          [(b.sub_acct ? `stripedcpi:${b.sub_acct}:` : "stripepi:") + pi.id, b.id]);
        /* Record what we actually kept. A renewal is a payment like any other,
           so it owes the same commission — and without this line every visit
           after the first would show up on the billing list at the headline
           rate, with Stripe's cut quietly billed to the partner. */
        await query("UPDATE bookings SET platform_net_minor = $1 WHERE id = $2", [subFeeNet, b.id]);
        await notify(b.customer_id, "payment_confirmed", "Recurring cleaning charged 💳",
          `Your next visit on ${String(b.scheduled_date).slice(0, 10)} is confirmed.`, b.id);
      } else throw new Error("pi status " + pi.status);
    } catch (e) {
      const already = b.payment_status === "retry";
      await query("UPDATE bookings SET payment_status = $1 WHERE id = $2", [already ? "failed" : "retry", b.id]);
      if (already) {
        paymentAlert("subscription-charge-failed", `booking ${b.id}: ${e.message}`);
        await notify(b.customer_id, "payment_failed", "Card charge failed",
          "We couldn't charge your card for the next cleaning. Open the booking to pay manually or update your card.", b.id).catch(() => {});
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
