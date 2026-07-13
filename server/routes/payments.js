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

const configured = () => !!(process.env.BARION_POSKEY && process.env.BARION_PAYEE);

/* POST /api/payments/start { bookingId } — customer only */
router.post("/start", requireAuth, requireRole("customer"), async (req, res) => {
  if (!configured()) {
    return res.status(503).json({ error: "payments_not_configured", message: "Card payments are not enabled yet — pay on completion instead." });
  }
  const { bookingId } = req.body || {};
  if (!bookingId) return res.status(400).json({ error: "bookingId required" });

  try {
    const r = await query(
      "SELECT b.*, c.name AS company_name FROM bookings b JOIN companies c ON c.id = b.company_id WHERE b.id = $1 AND b.customer_id = $2",
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

/* GET /api/payments/config — lets the app know if card is available */
router.get("/config", (req, res) => {
  res.json({ cardEnabled: configured(), provider: "barion", env: process.env.BARION_ENV === "prod" ? "live" : "sandbox" });
});

export default router;
