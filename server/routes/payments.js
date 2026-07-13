import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

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
        sdkVersion: "Cleanly-1.0",
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
      // Marketplace split: if the company completed Stripe onboarding, their share
      // goes STRAIGHT to their account and Cleanly keeps only the service fee.
      // The exact fee stored on the booking (added on top of the company's price)
      const feeHuf = Number(booking.service_fee_huf) ||
        Math.round(amount * Math.min(Math.max(Number(process.env.COMMISSION_PCT || 10), 0), 50) / (100 + Number(process.env.COMMISSION_PCT || 10)));
      let split = null;
      if (booking.stripe_account_id) {
        try {
          const acct = await stripe.accounts.retrieve(booking.stripe_account_id);
          if (acct.charges_enabled) {
            split = {
              application_fee_amount: feeHuf * 100,
              transfer_data: { destination: booking.stripe_account_id },
            };
          }
        } catch (e) { console.warn("connect account check failed:", e.message); }
      }
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        locale: "hu",
        ...(split ? { payment_intent_data: split } : {}),
        line_items: [{
          price_data: {
            currency: "huf",
            unit_amount: amount * 100, // HUF: whole forints → *100 keeps Stripe's divisible-by-100 rule
            product_data: {
              name: (svc.name || "Cleaning service").slice(0, 250),
              description: `${booking.company_name} · ${String(booking.scheduled_date).slice(0, 10)} ${booking.scheduled_slot || ""}`.slice(0, 500),
            },
          },
          quantity: 1,
        }],
        metadata: { booking_id: booking.id },
        success_url: `${base}/payment-result?bookingId=${booking.id}`,
        cancel_url: `${base}/payment-result?status=cancel`,
      });
      await query("UPDATE bookings SET barion_payment_id = $1, payment_status = 'pending' WHERE id = $2", ["stripe:" + session.id, booking.id]);
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
    console.error("payment start error:", err);
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
      await query(
        "UPDATE bookings SET payment_status = 'paid' WHERE barion_payment_id = $1",
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
    res.status(502).json({ error: "Could not start Stripe onboarding" });
  }
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
  res.json({ feePct: Math.min(Math.max(Number(process.env.COMMISSION_PCT || 10), 0), 50), cardEnabled: configured(), provider: provider() || "none", env: provider() === "stripe" ? (String(process.env.STRIPE_SECRET_KEY).startsWith("sk_live") ? "live" : "sandbox") : (process.env.BARION_ENV === "prod" ? "live" : "sandbox") });
});

/* Stripe webhook — needs the RAW body for signature verification.
   Mounted in index.js BEFORE express.json(). */
export async function stripeWebhook(req, res) {
  if (!stripeConfigured() || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).json({ error: "not_configured" });
  try {
    const stripe = await getStripe();
    const event = await stripe.webhooks.constructEventAsync(req.body, req.headers["stripe-signature"] || "", process.env.STRIPE_WEBHOOK_SECRET);
    if (event.type === "checkout.session.completed") {
      const sess = event.data.object;
      const bookingId = sess.metadata?.booking_id;
      if (bookingId) await query("UPDATE bookings SET payment_status = 'paid' WHERE id = $1", [bookingId]);
    }
    res.json({ received: true });
  } catch (e) {
    console.error("stripe webhook:", e.message);
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
