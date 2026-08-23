import { Router } from "express";
import { query } from "../db.js";
import { paymentAlert } from "../lib/alerts.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { notify } from "../lib/notify.js";


/* ── Billing the partner for our commission.

   There is no automatic invoicing. Cleano's own invoice to the partner is
   raised outside the app and its number recorded afterwards, which is why
   nothing here talks to an invoicing provider. What the code still owes the
   operator is the list: which finished, paid jobs have a commission that has
   not yet been billed. That lives in routes/invoices.js.

   The columns that used to hold an auto-issued number now hold the number the
   operator typed in, which is why they survive. ── */

/* ── Who pays Stripe's cut ────────────────────────────────────────────────
   On a direct charge the connected account is the merchant, so Stripe deducts
   its processing fee from THEM. Left alone, a partner who lists 5,000 Ft
   receives about 4,890 — and the Partner Terms would be promising something
   that does not happen.

   Cleano absorbs it instead: we reduce our own commission by Stripe's cut, so
   the partner's settlement lands on exactly their listed price. It costs us
   roughly a third of the commission, which is a deliberate startup choice —
   partners get a number they can trust and we take less.

   The rate is configurable because it varies by card: a domestic European card
   is far cheaper than an international one. Set STRIPE_FEE_PCT and
   STRIPE_FEE_FIXED_MINOR from your actual Stripe agreement. If the estimate is
   slightly off, the difference lands on us, never on the partner — which is the
   correct direction for the promise we are making. */
export function stripeFeeMinor(amountMinor) {
  /* Stripe Hungary standard pricing: 1.5% + 85 Ft for EEA cards, 2.5% + 85 Ft
     for UK cards. We assume the EEA rate because that is nearly all the volume;
     a UK or international card costs us more, and that difference comes out of
     our margin rather than the partner's price. Override from the Stripe
     agreement if the rate is ever renegotiated. */
  const pct = Number(process.env.STRIPE_FEE_PCT ?? 1.5);
  const fixed = Number(process.env.STRIPE_FEE_FIXED_MINOR ?? 8500);   // 85 Ft
  return Math.round((Number(amountMinor) || 0) * pct / 100) + fixed;
}

/* The lowest price at which the promise in Partner Terms 3.4 can actually be
   kept. We pay Stripe out of our commission, so if the commission is smaller
   than Stripe's cut there is nothing left to pay it with, and the partner would
   quietly receive less than they listed. With an 85 Ft fixed component that
   happens under roughly 1,000 Ft, so services must be priced above it.

   Derived from the live numbers rather than hard-coded, so it stays correct if
   the commission or the Stripe agreement changes. */
export function minimumServicePriceHuf() {
  const commissionPct = Math.min(Math.max(Number(process.env.COMMISSION_PCT || 10), 0), 50) / 100;
  const stripePct = Number(process.env.STRIPE_FEE_PCT ?? 1.5) / 100;
  const stripeFixedHuf = Number(process.env.STRIPE_FEE_FIXED_MINOR ?? 8500) / 100;
  /* commission >= stripe fee on the gross:
       p*c >= (p*(1+c))*sPct + sFixed        */
  const denom = commissionPct - (1 + commissionPct) * stripePct;
  if (denom <= 0) return Infinity;                      // commission can never cover it
  return Math.ceil((stripeFixedHuf / denom) / 50) * 50; // round up to a tidy 50 Ft
}

/* What Cleano actually keeps, after covering Stripe on the partner's behalf.
   Never negative: on a very small booking we simply earn nothing rather than
   charging the partner for the privilege of working with us. */
/* Stripe refuses HUF amounts that are not evenly divisible by 100.

   This is the rule that broke payments. A Hungarian price is always a round
   number of forints, so the charge itself was fine — but the commission is the
   headline percentage MINUS Stripe's own cut, and that subtraction lands on a
   non-round number more often than not. Five of nine realistic prices produced
   an application_fee_amount Stripe rejected outright, which surfaced to the
   customer as "Could not start payment" and, being price-dependent, worked
   perfectly in testing at some prices.

   Rounding DOWN, never up: the difference comes out of our commission rather
   than the partner's settlement. Same direction as every other rounding
   decision in this file. */
const NEEDS_100 = new Set(["huf", "twd", "ugx", "isk"]);
export function payableMinor(minor, currency) {
  const n = Math.max(0, Math.round(Number(minor) || 0));
  return NEEDS_100.has(String(currency || "").toLowerCase()) ? Math.floor(n / 100) * 100 : n;
}

export function platformNetMinor(totalMinor, commissionMinor) {
  return Math.max(0, Math.round(Number(commissionMinor) - stripeFeeMinor(totalMinor)));
}

const router = Router();

/* ════════════════════════════════════════════════════════════
   BARION CARD PAYMENTS (Hungarian provider, EUR/HUF, EU licensed)
   Sandbox: BARION_ENV=test + POSKey from sandbox.barion.com
   Live:    BARION_ENV=prod + POSKey from barion.com  (after merchant approval)
   Flow: app → POST /api/payments/start → Barion GatewayUrl opens in browser
         Barion → POST /api/payments/callback → we verify → booking marked paid
         app polls GET /api/payments/status/:bookingId until 'paid'
════════════════════════════════════════════════════════════ */

const BARION_BASE = process.env.BARION_ENV === "prod"
  ? "https://api.barion.com"
  : "https://api.test.barion.com";

/* Provider-agnostic: whichever keys exist decide the provider.
   STRIPE_SECRET_KEY → Stripe Checkout (recommended: same-day onboarding)
   BARION_POSKEY + BARION_PAYEE → Barion Smart Gateway */
const stripeConfigured = () => !!process.env.STRIPE_SECRET_KEY;
const barionConfigured = () => !!(process.env.BARION_POSKEY && process.env.BARION_PAYEE);
const simpleConfigured = () => !!(process.env.SIMPLEPAY_MERCHANT && process.env.SIMPLEPAY_SECRET_KEY);
const provider = () => {
  const forced = process.env.PAYMENT_PROVIDER; // optional explicit choice
  if (forced === "stripe" && stripeConfigured()) return "stripe";
  if (forced === "simplepay" && simpleConfigured()) return "simplepay";
  if (forced === "barion" && barionConfigured()) return "barion";
  return stripeConfigured() ? "stripe" : simpleConfigured() ? "simplepay" : barionConfigured() ? "barion" : null;
};
const configured = () => provider() !== null;

/* ── SimplePay (OTP) v2 helpers ── */
import crypto from "crypto";
const SIMPLE_BASE = process.env.SIMPLEPAY_ENV === "prod"
  ? "https://secure.simplepay.hu/payment/v2"
  : "https://sandbox.simplepay.hu/payment/v2";
const simpleSign = (body) =>
  crypto.createHmac("sha384", process.env.SIMPLEPAY_SECRET_KEY).update(body, "utf8").digest("base64");

let _stripe = null;
async function getStripe() {
  if (!_stripe) {
    const Stripe = (await import("stripe")).default;
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

/* Full refund (cleaning price + Cleano fee) when a company/admin cancels a PAID booking.
   No-op for non-Stripe or unpaid bookings. Never throws — logs and returns a result. */
/* Advance a YYYY-MM-DD by one period (weekly/biweekly/monthly). */
export function nextDateFrom(dateStr, period) {
  const [y, m, d] = String(dateStr).slice(0, 10).split("-").map(Number);
  let nd;
  if (period === "weekly") nd = new Date(Date.UTC(y, m - 1, d + 7));
  else if (period === "biweekly") nd = new Date(Date.UTC(y, m - 1, d + 14));
  else {
    // monthly: clamp to the target month's last day (Jan 31 → Feb 28, not Mar 3)
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    nd = new Date(Date.UTC(y, m, Math.min(d, lastDay)));
  }
  return nd.toISOString().slice(0, 10);
}

export async function refundBookingPayment(booking, pct = 100) {
  try {
    if (!booking || booking.payment_status !== "paid") return { refunded: false, reason: "not-paid" };
    if (pct <= 0) return { refunded: false, reason: "policy-zero" };
    const ref = booking.barion_payment_id || "";
    if (!process.env.STRIPE_SECRET_KEY) return { refunded: false, reason: "no-stripe" };

    /* Four reference shapes, not two.

       A first payment goes through Checkout and is stored as a SESSION:
         stripe:<session>              legacy destination charge
         stripedc:<acct>:<session>     direct charge on the company's account

       Every subscription RENEWAL is charged off-session and stores a
       PaymentIntent instead:
         stripepi:<pi>
         stripedcpi:<acct>:<pi>

       This function only recognised the two session forms, so it returned
       "no-stripe" for every renewal and moved no money — while the customer was
       told, in as many words, "you've been refunded in full". Cancel a
       recurring visit inside the free window and nothing came back. Order
       matters below: stripedcpi must be tested before stripedc, and stripepi
       before stripe, or the shorter prefix swallows the longer one. */
    let piId = null, sessionId = null, acct = null;
    if (ref.startsWith("stripedcpi:")) {
      const p = ref.split(":"); acct = p[1]; piId = p.slice(2).join(":");
    } else if (ref.startsWith("stripepi:")) {
      piId = ref.slice("stripepi:".length);
    } else if (ref.startsWith("stripe_pi:")) {
      /* A fifth spelling, written by chargeSavedCard. Kept rather than
         renamed because rows already carry it. */
      piId = ref.slice("stripe_pi:".length);
    } else if (ref.startsWith("stripedc:")) {
      const p = ref.split(":"); acct = p[1]; sessionId = p.slice(2).join(":");
    } else if (ref.startsWith("stripe:")) {
      sessionId = ref.slice("stripe:".length);
    } else {
      return { refunded: false, reason: "no-stripe" };
    }

    const stripe = await getStripe();
    const opts = acct ? { stripeAccount: acct } : {};
    let paymentIntent = piId;
    if (!paymentIntent) {
      const session = await stripe.checkout.sessions.retrieve(sessionId, opts);
      if (!session || !session.payment_intent) return { refunded: false, reason: "no-payment-intent" };
      paymentIntent = session.payment_intent;
    }

    const partial = pct < 100;
    const amountMinor = partial && booking.total_minor
      ? Math.round(Number(booking.total_minor) * pct / 100)
      : (partial ? Math.round(Number(booking.total_huf) * 100 * pct / 100) : null);
    await stripe.refunds.create({
      payment_intent: paymentIntent,
      /* A partial refund is a fraction of the price, so it lands on a non-round
         number the same way the commission does — and Stripe refuses it for the
         same reason. Rounding UP here, because this is the customer's money
         coming back: the rounding should favour them, not us. */
      ...(amountMinor ? { amount: payableMinor(amountMinor + 99, String(booking.currency || "HUF")) } : {}),
      refund_application_fee: true,               // proportional on partial refunds
      ...(acct ? {} : { reverse_transfer: true }),// only meaningful on destination charges
    }, opts);
    await query("UPDATE bookings SET payment_status = $1 WHERE id = $2",
      [partial ? "partly-refunded" : "refunded", booking.id]);
    return { refunded: true, pct };
  } catch (e) {
    console.error("refund failed:", e.message);
    paymentAlert("refund-failed", `booking ${booking?.id}: ${e.stack || e.message}`);
    return { refunded: false, error: e.message };
  }
}

/* ── 5.12 Cancellation policy. Env-tunable so Musa can change the numbers
      without a release: CANCEL_FREE_H (default 48). Company-side cancellations
      are always refunded in full, whenever they happen. ── */
/* ── Cancellation ────────────────────────────────────────────────────────
   One rule, deliberately: a customer may cancel up to CANCEL_FREE_H hours
   before the visit and get everything back. Inside that window they cannot
   cancel at all.

   There is no half-refund tier. A partial refund pleases nobody — the customer
   feels charged for nothing, the partner feels underpaid for a slot they can no
   longer fill — and it invites an argument every single time. A clear line the
   customer was shown before paying is easier to defend than a sliding scale.

   The company cancelling is a different matter entirely: that always refunds in
   full, whenever it happens. Same for a booking nobody accepted in time. */
export function hoursUntilBooking(booking, now = new Date()) {
  try {
    const d = booking.scheduled_date instanceof Date
      ? booking.scheduled_date.toISOString().slice(0, 10) : String(booking.scheduled_date).slice(0, 10);
    const hm = String(booking.scheduled_slot || "09:00").match(/(\d{1,2}):(\d{2})/) || [0, "9", "00"];
    const start = Date.parse(`${d}T${String(hm[1]).padStart(2, "0")}:${hm[2]}:00+02:00`);
    const h = (start - now.getTime()) / 3600e3;
    return Number.isFinite(h) ? h : null;   // null = we could not tell
  } catch { return null; }
}

/* May the CUSTOMER cancel this themselves right now? */
export function customerMayCancel(booking, now = new Date()) {
  const freeH = Number(process.env.CANCEL_FREE_H || 48);
  const h = hoursUntilBooking(booking, now);
  if (h === null) return true;            // unreadable date → let them, and refund fully
  return h >= freeH;
}

/* When a cancellation IS allowed, it is always the whole amount. */
export function cancellationRefundPct() { return 100; }


/* Charge a subscription renewal with the customer's saved card (off-session).
   Returns {charged:true} when Stripe took the money, otherwise a reason so the
   booking simply waits for the customer to pay manually. */
export async function chargeSavedCard(booking) {
  try {
    if (!stripeConfigured()) return { charged: false, reason: "stripe-off" };
    const u = await query("SELECT stripe_customer_id, default_payment_method FROM users WHERE id = $1", [booking.customer_id]);
    const cust = u.rows[0]?.stripe_customer_id, pm = u.rows[0]?.default_payment_method;
    if (!cust || !pm) return { charged: false, reason: "no-saved-card" };

    const stripe = await getStripe();
    const amount = Number(booking.total_huf) || 0;
    if (amount <= 0) return { charged: false, reason: "zero" };
    const feeHuf = Number(booking.service_fee_huf) || 0;

    // keep the marketplace split on renewals too
    let split = {};
    const co = await query("SELECT stripe_account_id FROM companies WHERE id = $1", [booking.company_id]);
    const acctId = co.rows[0]?.stripe_account_id;
    if (acctId) {
      try {
        const acct = await stripe.accounts.retrieve(acctId);
        if (acct.charges_enabled) split = { application_fee_amount: payableMinor(feeHuf * 100, "HUF"), transfer_data: { destination: acctId } };
      } catch {}
    }

    const pi = await stripe.paymentIntents.create({
      amount: payableMinor(amount * 100, "HUF"),
      currency: "huf",
      customer: cust,
      payment_method: pm,
      off_session: true,
      confirm: true,
      description: `Cleano renewal · ${(booking.service_snapshot && booking.service_snapshot.name) || "cleaning"}`,
      metadata: { booking_id: booking.id, renewal: "1" },
      ...split,
    }, {
      /* Same reason as the scheduler's charge: if Stripe takes the money and we
         die before recording it, the caller retries and the customer pays
         twice. Keyed on the booking, so a repeat collapses onto the original. */
      idempotencyKey: `cleano-renewal-${booking.id}`,
    });
    if (pi.status === "succeeded") {
      await query("UPDATE bookings SET payment_status = 'paid', barion_payment_id = $1 WHERE id = $2", ["stripe_pi:" + pi.id, booking.id]);
      return { charged: true };
    }
    return { charged: false, reason: pi.status };
  } catch (e) {
    paymentAlert("subscription-charge-failed", `booking ${booking?.id}: ${e.stack || e.message}`);
    console.warn("renewal charge failed:", e.message);
    return { charged: false, reason: e.message };
  }
}

/* POST /api/payments/start { bookingId } — customer only */
router.post("/start", requireAuth, requireRole("customer"), async (req, res) => {
  if (!configured()) {
    return res.status(503).json({ error: "payments_not_configured", message: "Card payments are not enabled yet — pay on completion instead." });
  }
  const { bookingId } = req.body || {};
  if (!bookingId) return res.status(400).json({ error: "bookingId required" });

  try {
    const r = await query(
      "SELECT b.*, c.name AS company_name, c.stripe_account_id FROM bookings b JOIN companies c ON c.id = b.company_id WHERE b.id = $1 AND b.customer_id = $2",
      [bookingId, req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Booking not found" });
    const booking = r.rows[0];
    if (booking.payment_status === "paid") return res.status(400).json({ error: "Already paid" });
    if (booking.status === 9 || booking.status === 8) return res.status(400).json({ error: "Booking is cancelled" });
    const amount = Number(booking.total_huf);
    if (!amount || amount < 1) return res.status(400).json({ error: "Nothing to charge" });

    const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const svc = booking.service_snapshot || {};

    if (provider() === "simplepay") {
      const payload = JSON.stringify({
        salt: crypto.randomBytes(16).toString("hex"),
        merchant: process.env.SIMPLEPAY_MERCHANT,
        orderRef: booking.id,
        currency: "HUF",
        customerEmail: req.user.email || "noreply@cleanly.app",
        language: "HU",
        sdkVersion: "Cleano-1.0",
        methods: ["CARD"],
        total: String(amount),
        timeout: new Date(Date.now() + 15 * 60e3).toISOString().replace(/\.\d{3}Z$/, "+00:00"),
        urls: {
          success: `${base}/payment-result?bookingId=${booking.id}`,
          fail: `${base}/payment-result?status=cancel`,
          cancel: `${base}/payment-result?status=cancel`,
          timeout: `${base}/payment-result?status=cancel`,
        },
      });
      const r = await fetch(`${SIMPLE_BASE}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Signature: simpleSign(payload) },
        body: payload,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.paymentUrl) {
        console.error("SimplePay start failed:", JSON.stringify(data.errorCodes || data));
        return res.status(502).json({ error: "Payment provider error — try again or pay on completion" });
      }
      await query("UPDATE bookings SET barion_payment_id = $1, payment_status = 'pending' WHERE id = $2", ["simplepay:" + data.transactionId, booking.id]);
      return res.json({ gatewayUrl: data.paymentUrl, paymentId: String(data.transactionId) });
    }

    if (provider() === "stripe") {
      const stripe = await getStripe();
      const feeHuf = Number(booking.service_fee_huf) ||
        Math.round(amount * Math.min(Math.max(Number(process.env.COMMISSION_PCT || 10), 0), 50) / (100 + Number(process.env.COMMISSION_PCT || 10)));
      const currency = String(booking.currency || "HUF").toLowerCase();
      const amountMinor = Number(booking.total_minor) || amount * 100;
      const feeMinor = Number(booking.service_fee_minor) || feeHuf * 100;
      const isSub = booking.pricing_type === "subscription";

      // ── 3.1 DIRECT CHARGE: the payment is created ON the company's Stripe
      //    account; the cleaning money never touches the platform. Cleano's
      //    commission arrives via application_fee_amount. Falls back to the
      //    legacy destination charge when the company has no usable account —
      //    which is also exactly what keeps 1.0-era behaviour alive (2.1). ──
      let directAcct = null;
      if (booking.stripe_account_id && process.env.DIRECT_CHARGES !== "0") {
        try {
          const acct = await stripe.accounts.retrieve(booking.stripe_account_id);
          if (acct.charges_enabled) directAcct = booking.stripe_account_id;
        } catch (e) { console.warn("connect account check failed:", e.message); }
      }

      const lineItems = [{
        price_data: {
          currency,
          unit_amount: payableMinor(amountMinor, currency),
          product_data: {
            name: (svc.name || "Cleaning service").slice(0, 250),
            description: `${booking.company_name} · ${String(booking.scheduled_date).slice(0, 10)} ${booking.scheduled_slot || ""}`.slice(0, 500),
          },
        },
        quantity: 1,
      }];

      if (directAcct) {
        // Customer (and any saved card for subscriptions) lives on the COMPANY's
        // account — a subscription always belongs to one company, so its card
        // stays where its charges happen. No cross-account cloning needed.
        const dcOpts = { stripeAccount: directAcct };
        let customerId = null;
        if (isSub) {
          const u = await query("SELECT email, full_name FROM users WHERE id = $1", [req.user.id]);
          const cust = await stripe.customers.create({
            email: u.rows[0]?.email || undefined,
            name: u.rows[0]?.full_name || undefined,
            metadata: { cleano_user: req.user.id },
          }, dcOpts);
          customerId = cust.id;
        }
        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          locale: "hu",
        /* Say what we take, rather than letting Stripe infer it.

           Live error, 23 Aug: "No valid payment method types for this Checkout
           Session." With nothing specified, Stripe picks from whatever is
           switched on in the dashboard for that currency — and for HUF, on a
           connected account, that set can be empty. The session then cannot be
           created at all and the customer sees "Could not start payment".

           Cards work in HUF everywhere Cleano operates, and card is the only
           method the app is built around: the saved-card renewals, the refund
           path and the payout split all assume one. Naming it explicitly makes
           the checkout independent of a dashboard toggle neither of us will
           remember to check again. */
        payment_method_types: ["card"],

          ...(customerId ? { customer: customerId } : {}),
          payment_intent_data: {
            /* Reduced by Stripe's cut so the partner's settlement equals their
               listed price exactly. See platformNetMinor above. */
            application_fee_amount: payableMinor(platformNetMinor(amountMinor, feeMinor), currency),
            ...(isSub ? { setup_future_usage: "off_session" } : {}),
          },
          line_items: lineItems,
          metadata: { booking_id: booking.id, cleano_direct: "1" },
          success_url: `${base}/payment-result?bookingId=${booking.id}`,
          cancel_url: `${base}/payment-result?status=cancel`,
        }, dcOpts);
        await query("UPDATE bookings SET barion_payment_id = $1, payment_status = 'pending' WHERE id = $2",
          [`stripedc:${directAcct}:${session.id}`, booking.id]);
        /* Remember what we actually asked Stripe to hand us, so the fee invoice
           is for the real figure rather than the headline commission. */
        await query("UPDATE bookings SET platform_net_minor = $1 WHERE id = $2",
          [payableMinor(platformNetMinor(amountMinor, feeMinor), currency), booking.id]);
        return res.json({ gatewayUrl: session.url, paymentId: session.id });
      }

      // ── LEGACY destination charge (kept alive deliberately — 2.1) ──
      let split = null;
      if (booking.stripe_account_id) {
        try {
          const acct = await stripe.accounts.retrieve(booking.stripe_account_id);
          /* Destination charge: Cleano is the merchant, so Stripe bills Cleano
             directly and the partner already receives their price in full. No
             adjustment needed — deducting again would charge them twice. */
          if (acct.charges_enabled) split = { application_fee_amount: payableMinor(feeMinor, currency), transfer_data: { destination: booking.stripe_account_id } };
        } catch {}
      }
      let customerId = null;
      if (isSub) {
        const u = await query("SELECT stripe_customer_id, email, full_name FROM users WHERE id = $1", [req.user.id]);
        customerId = u.rows[0]?.stripe_customer_id || null;
        if (!customerId) {
          const cust = await stripe.customers.create({
            email: u.rows[0]?.email || undefined, name: u.rows[0]?.full_name || undefined,
            metadata: { cleano_user: req.user.id },
          });
          customerId = cust.id;
          await query("UPDATE users SET stripe_customer_id = $1 WHERE id = $2", [customerId, req.user.id]);
        }
      }
      const piData = { ...(split || {}), ...(isSub ? { setup_future_usage: "off_session" } : {}) };
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        locale: "hu",
        /* Same reason as the direct-charge session above. */
        payment_method_types: ["card"],
        ...(customerId ? { customer: customerId } : {}),
        ...(Object.keys(piData).length ? { payment_intent_data: piData } : {}),
        line_items: lineItems,
        metadata: { booking_id: booking.id },
        success_url: `${base}/payment-result?bookingId=${booking.id}`,
        cancel_url: `${base}/payment-result?status=cancel`,
      });
      await query("UPDATE bookings SET barion_payment_id = $1, payment_status = 'pending' WHERE id = $2",
        ["stripe:" + session.id, booking.id]);
      return res.json({ gatewayUrl: session.url, paymentId: session.id });
    }

    const payload = {
      POSKey: process.env.BARION_POSKEY,
      PaymentType: "Immediate",
      GuestCheckOut: true,
      FundingSources: ["All"],
      PaymentRequestId: `cleanly-${booking.id}`,
      RedirectUrl: `${base}/payment-result?bookingId=${booking.id}`,
      CallbackUrl: `${base}/api/payments/callback`,
      Currency: "HUF",
      Locale: "hu-HU",
      Transactions: [
        {
          POSTransactionId: `booking-${booking.id}`,
          Payee: process.env.BARION_PAYEE,
          Total: amount,
          Items: [
            {
              Name: (svc.name || "Cleaning service").slice(0, 250),
              Description: `${booking.company_name} · ${booking.scheduled_date} ${booking.scheduled_slot || ""}`.slice(0, 500),
              Quantity: 1,
              Unit: "pcs",
              UnitPrice: amount,
              ItemTotal: amount,
            },
          ],
        },
      ],
    };

    const resp = await fetch(`${BARION_BASE}/v2/Payment/Start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok || !data.GatewayUrl) {
      console.error("Barion start failed:", JSON.stringify(data.Errors || data));
      return res.status(502).json({ error: "Payment provider error — try again or pay on completion" });
    }

    await query(
      "UPDATE bookings SET barion_payment_id = $1, payment_status = 'pending' WHERE id = $2",
      [data.PaymentId, booking.id]
    );
    res.json({ gatewayUrl: data.GatewayUrl, paymentId: data.PaymentId });
  } catch (err) {
    /* "Could not start payment" told the customer nothing and told us less.
       A payment that will not start is not one lost sale — it is every sale
       until someone notices. Stripe's own message names the reason exactly
       (a rejected amount, a key that is not set, an account that cannot take
       charges), so send it to the operator and keep the sentence for the
       customer. */
    console.error("payment start error:", err?.type, err?.code, err?.message, err?.param, err?.stack);
    import("../lib/alerts.js")
      .then(({ alert }) => alert("pay-start:" + (err?.code || err?.type || "unknown"),
        "Cleano: payments are failing to start",
        `A customer could not start a payment.\n\ntype: ${err?.type}\ncode: ${err?.code}\nparam: ${err?.param}\nmessage: ${err?.message}`))
      .catch(() => {});
    res.status(500).json({ error: "Could not start payment" });
  }
});

/* Barion server-to-server callback (also handles user hitting it manually) */
async function handleCallback(req, res) {
  const paymentId = req.body?.PaymentId || req.body?.paymentId || req.query?.paymentId;
  if (!paymentId) return res.status(400).json({ error: "paymentId missing" });
  try {
    const stateRes = await fetch(
      `${BARION_BASE}/v2/Payment/GetPaymentState?POSKey=${encodeURIComponent(process.env.BARION_POSKEY)}&PaymentId=${encodeURIComponent(paymentId)}`
    );
    const state = await stateRes.json();
    // Trust ONLY Barion's answer, never the caller.
    if (state.Status === "Succeeded") {
      const paidRow = await query(
        "UPDATE bookings SET payment_status = 'paid' WHERE barion_payment_id = $1 RETURNING id",
        [paymentId]
      );
    } else if (["Canceled", "Expired", "Failed"].includes(state.Status)) {
      await query(
        "UPDATE bookings SET payment_status = 'unpaid' WHERE barion_payment_id = $1 AND payment_status <> 'paid'",
        [paymentId]
      );
    }
    res.json({ received: true });
  } catch (err) {
    console.error("payment callback error:", err);
    res.status(500).json({ error: "callback failed" });
  }
}
router.post("/callback", handleCallback);
router.get("/callback", handleCallback);

/* GET /api/payments/status/:bookingId — polled by the app */
router.get("/status/:bookingId", requireAuth, async (req, res) => {
  try {
    const r = await query(
      "SELECT payment_status FROM bookings WHERE id = $1 AND customer_id = $2",
      [req.params.bookingId, req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Booking not found" });
    res.json({ paymentStatus: r.rows[0].payment_status || "unpaid" });
  } catch (err) {
    res.status(500).json({ error: "status check failed" });
  }
});

/* ── Stripe Connect: company onboarding for automatic payout splits ── */
router.post("/connect/onboard", requireAuth, requireRole("company"), async (req, res) => {
  if (!stripeConfigured()) return res.status(503).json({ error: "Card payments are not configured yet" });
  try {
    const stripe = await getStripe();
    const co = await query("SELECT * FROM companies WHERE id = $1", [req.user.companyId]);
    if (!co.rows.length) return res.status(404).json({ error: "Company not found" });
    let acctId = co.rows[0].stripe_account_id;
    if (!acctId) {
      const acct = await stripe.accounts.create({ type: "express", country: "HU", business_type: "company" });
      acctId = acct.id;
      await query("UPDATE companies SET stripe_account_id = $1 WHERE id = $2", [acctId, req.user.companyId]);
    }
    const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const link = await stripe.accountLinks.create({
      account: acctId,
      refresh_url: `${base}/payment-result?status=cancel`,
      return_url: `${base}/payment-result?status=connected`,
      type: "account_onboarding",
    });
    res.json({ url: link.url });
  } catch (e) {
    console.error("connect onboard:", e.message);
    const hint = /platform.profile|responsibilit|capabilit|review the responsibilities/i.test(e.message)
      ? " — The platform owner must first complete Stripe's Connect setup (Stripe dashboard → Settings → Connect)."
      : "";
    res.status(502).json({ error: (e.message || "Could not start Stripe onboarding").slice(0, 300) + hint });
  }
});

/* GET /api/payments/connect/dashboard — one-tap login link to the company's own
   Stripe Express dashboard (their payments, balance and payout dates). */
router.get("/connect/dashboard", requireAuth, requireRole("company"), async (req, res) => {
  if (!stripeConfigured()) return res.status(503).json({ error: "Payments not configured" });
  try {
    const co = await query("SELECT stripe_account_id FROM companies WHERE id = $1", [req.user.companyId]);
    const acctId = co.rows[0]?.stripe_account_id;
    if (!acctId) return res.status(400).json({ error: "Connect payouts first" });
    const stripe = await getStripe();
    const link = await stripe.accounts.createLoginLink(acctId);
    res.json({ url: link.url });
  } catch (e) { console.error("dashboard link:", e.message); res.status(500).json({ error: "Could not open the payout dashboard" }); }
});

router.get("/connect/status", requireAuth, requireRole("company"), async (req, res) => {
  if (!stripeConfigured()) return res.json({ available: false });
  try {
    const co = await query("SELECT stripe_account_id FROM companies WHERE id = $1", [req.user.companyId]);
    const acctId = co.rows[0]?.stripe_account_id;
    if (!acctId) return res.json({ available: true, connected: false });
    const stripe = await getStripe();
    const acct = await stripe.accounts.retrieve(acctId);
    res.json({ available: true, connected: true, chargesEnabled: !!acct.charges_enabled, payoutsEnabled: !!acct.payouts_enabled });
  } catch (e) {
    res.json({ available: true, connected: false });
  }
});

/* GET /api/payments/config — lets the app know if card is available */
router.get("/config", (req, res) => {
  res.json({ feePct: Math.min(Math.max(Number(process.env.COMMISSION_PCT || 10), 0), 50),
    // 5.12 — one source of truth for the cancellation policy, so the screen the
    // customer reads before paying can never drift from the refund we actually give.
    /* One number now: cancel freely before it, not at all after. */
    cancelPolicy: { freeH: Number(process.env.CANCEL_FREE_H || 48) },
    cardEnabled: configured(), provider: provider() || "none", env: provider() === "stripe" ? (String(process.env.STRIPE_SECRET_KEY).startsWith("sk_live") ? "live" : "sandbox") : (process.env.BARION_ENV === "prod" ? "live" : "sandbox") });
});

/* Stripe webhook — needs the RAW body for signature verification.
   Mounted in index.js BEFORE express.json(). */
export async function stripeWebhook(req, res) {
  /* Either secret is enough to be "configured". Requiring the platform one
     specifically meant a setup with only the Connect secret would refuse every
     event with a 503 — payments would succeed and no booking would ever be
     marked paid, with nothing in the logs that looked like a payment problem. */
  const anySecret = process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!stripeConfigured() || !anySecret) return res.status(503).json({ error: "not_configured" });
  try {
    const stripe = await getStripe();
    // Direct charges arrive as CONNECT events with their own signing secret.
    // Try the platform secret first, then the Connect one (if configured).
    let event = null;
    const sig = req.headers["stripe-signature"] || "";
    const secrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(Boolean);
    let lastErr = null;
    for (const sec of secrets) {
      try { event = await stripe.webhooks.constructEventAsync(req.body, sig, sec); break; }
      catch (e) { lastErr = e; }
    }
    if (!event) throw lastErr || new Error("no signature matched");
    const connectAcct = event.account || null;   // set on Connect (direct-charge) events
    if (event.type === "checkout.session.completed") {
      const sess = event.data.object;
      const bookingId = sess.metadata?.booking_id;
      if (bookingId) {
        /* Do not resurrect a booking that has already moved on.

           Stripe retries a webhook for up to three days. This wrote 'paid'
           unconditionally, so a retry arriving after the booking was cancelled
           and refunded flipped it back to paid — money returned to the
           customer, the job showing as paid to the company, and the billing
           list charging commission on it. The refund is the later truth.

           status 9 = cancelled, 8 = declined. */
        await query(
          `UPDATE bookings SET payment_status = 'paid'
            WHERE id = $1
              AND payment_status NOT IN ('refunded','partly-refunded')
              AND status NOT IN (8,9)`,
          [bookingId]);
        // Recurring plan: remember the card the customer just approved so the
        // next visit can be charged automatically without asking again.
        try {
          if (sess.customer && sess.payment_intent) {
            const stripe2 = await getStripe();
            const acctOpts = connectAcct ? { stripeAccount: connectAcct } : {};
            const pi = await stripe2.paymentIntents.retrieve(String(sess.payment_intent), acctOpts);
            const pmId = pi.payment_method;
            if (pmId) {
              const pm = await stripe2.paymentMethods.retrieve(String(pmId), acctOpts);
              await query(
                /* Only the customer on THIS booking.

                   The old clause also matched "OR stripe_customer_id = $1".
                   A Stripe customer id is unique per account, not globally, so
                   under direct charges the same string can belong to different
                   people on different connected accounts — and this would have
                   written one person's saved card onto another's record. The
                   booking already tells us exactly whose card it is. */
                "UPDATE users SET stripe_customer_id = $1, default_payment_method = $2, card_brand = $3, card_last4 = $4 WHERE id = (SELECT customer_id FROM bookings WHERE id = $5)",
                [String(sess.customer), String(pmId), pm.card?.brand || null, pm.card?.last4 || null, bookingId]
              );
            }
          }
          // 3.4: first subscription payment succeeded → create the schedule.
          try {
            const bq2 = await query("SELECT * FROM bookings WHERE id = $1", [bookingId]);
            const b2 = bq2.rows[0];
            if (b2 && b2.pricing_type === "subscription" && b2.period && !b2.subscription_id) {
              const pi2 = await (await getStripe()).paymentIntents.retrieve(String(sess.payment_intent), connectAcct ? { stripeAccount: connectAcct } : {});
              const subIns = await query(
                `INSERT INTO subscriptions (customer_id, company_id, service_id, frequency, slot, address, note, hours,
                   currency, amount_minor, fee_minor, stripe_customer_id, payment_method_id, stripe_account_id,
                   status, next_booking_date)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'active',$15) RETURNING id`,
                [b2.customer_id, b2.company_id, b2.service_id, b2.period, b2.scheduled_slot || "09:00",
                 b2.address, b2.note || null, b2.hours || null, b2.currency || "HUF",
                 Number(b2.total_minor) || Number(b2.total_huf) * 100,
                 Number(b2.service_fee_minor) || Number(b2.service_fee_huf || 0) * 100,
                 sess.customer ? String(sess.customer) : null,
                 pi2.payment_method ? String(pi2.payment_method) : null,
                 connectAcct,
                 nextDateFrom(String(b2.scheduled_date).slice(0, 10), b2.period)]
              );
              await query("UPDATE bookings SET subscription_id = $1 WHERE id = $2", [subIns.rows[0].id, bookingId]);
            }
          } catch (e) { console.warn("create subscription:", e.message); }
        } catch (e) { console.warn("save card:", e.message); }
        try {
          const bq = await query("SELECT b.customer_id, b.service_snapshot, c.owner_id, c.name AS company_name FROM bookings b JOIN companies c ON c.id = b.company_id WHERE b.id = $1", [bookingId]);
          const bn = bq.rows[0];
          if (bn) {
            const svcName = (bn.service_snapshot && bn.service_snapshot.name) || "your cleaning";
            await notify(bn.customer_id, "payment_confirmed", "Payment confirmed 💳", `Your booking for ${svcName} is confirmed.`, bookingId);
            await notify(bn.owner_id, "new_order", "New paid order 🧽", `${bn.company_name} has a new confirmed booking.`, bookingId);
          }
        } catch (e) { console.error("notify on paid:", e.message); }
      }
    }
    res.json({ received: true });
  } catch (e) {
    console.error("stripe webhook:", e.message);
    paymentAlert("webhook-rejected", e.stack || e.message);
    res.status(400).json({ error: "bad_signature" });
  }
}

/* SimplePay IPN — signed JSON callback; must be echoed back with receiveDate + our signature. */
export async function simplepayIpn(req, res) {
  if (!simpleConfigured()) return res.status(503).json({ error: "not_configured" });
  try {
    const raw = req.body.toString("utf8");
    const theirSig = req.headers.signature || req.headers.Signature;
    if (!theirSig || simpleSign(raw) !== theirSig) return res.status(400).json({ error: "bad_signature" });
    const ipn = JSON.parse(raw);
    if (ipn.status === "FINISHED" || ipn.status === "SUCCESS" || ipn.status === "AUTHORISED") {
      await query("UPDATE bookings SET payment_status = 'paid' WHERE id = $1", [ipn.orderRef]);
    }
    const reply = JSON.stringify({ ...ipn, receiveDate: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00") });
    res.set("Signature", simpleSign(reply)).type("application/json").send(reply);
  } catch (e) {
    console.error("simplepay ipn:", e.message);
    res.status(500).json({ error: "ipn failed" });
  }
}

export default router;
