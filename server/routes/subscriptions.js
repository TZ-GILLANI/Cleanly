import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { refundBookingPayment } from "./payments.js";
import { notify } from "../lib/notify.js";

const router = Router();

/* Customer's own plans, with the next occurrence attached. */
router.get("/", requireAuth, async (req, res) => {
  try {
    const r = await query(
      `SELECT s.*, c.name AS company_name, c.emoji AS company_emoji
       FROM subscriptions s JOIN companies c ON c.id = s.company_id
       WHERE s.customer_id = $1 ORDER BY s.created_at DESC`, [req.user.id]);
    // next occurrence per plan — a second grouped query rather than a
    // correlated subselect (portable, and one index scan instead of N).
    const nx = await query(
      `SELECT subscription_id, MIN(scheduled_date) AS next_date
         FROM bookings
        WHERE customer_id = $1 AND subscription_id IS NOT NULL
          AND scheduled_date >= CURRENT_DATE AND status NOT IN (8,9)
        GROUP BY subscription_id`, [req.user.id]);
    const nextBy = Object.fromEntries(nx.rows.map((x) => [x.subscription_id, x.next_date]));
    const chargeDays = Math.max(1, Number(process.env.SUB_CHARGE_DAYS || 5));
    res.json({ subscriptions: r.rows.map((x) => {
      const next = nextBy[x.id] || null;
      /* Whether the plan can actually charge itself is the single most useful
         thing on this card, and the customer had no way to see it. A plan with
         no saved card is not automatic — it will ask, every time, and the
         customer only finds out when the reminder arrives. */
      /* A DATE column comes back as a Date object, not a string. String(next)
         on one gives "Tue Sep 01 2026 …", whose first ten characters are
         "Tue Sep 01" — an invalid date, and toISOString() then throws and takes
         the whole endpoint down with it. Handle both shapes. */
      const iso = next instanceof Date ? next.toISOString().slice(0, 10) : String(next).slice(0, 10);
      const t = Date.parse(iso + "T00:00:00Z");
      const chargeOn = next && Number.isFinite(t)
        ? new Date(t - chargeDays * 864e5).toISOString().slice(0, 10)
        : null;
      return {
        ...x,
        payment_method_id: undefined,      // never leave the account by the front door
        stripe_customer_id: undefined,
        next_date: next ? iso : null,
        has_card: !!x.payment_method_id,
        charge_days: chargeDays,
        charge_on: chargeOn,
      };
    }) });
  } catch (e) { res.status(500).json({ error: "Could not load plans" }); }
});

async function ownPlan(req, res) {
  const r = await query("SELECT * FROM subscriptions WHERE id = $1 AND customer_id = $2", [req.params.id, req.user.id]);
  if (!r.rows.length) { res.status(404).json({ error: "Plan not found" }); return null; }
  return r.rows[0];
}

router.post("/:id/pause", requireAuth, async (req, res) => {
  try {
    const s = await ownPlan(req, res); if (!s) return;
    if (s.status !== "active") return res.status(400).json({ error: "Only an active plan can be paused" });
    await query("UPDATE subscriptions SET status = 'paused' WHERE id = $1", [s.id]);
    // future UNCHARGED occurrences go away; paid ones stay (they're bought)
    await query("UPDATE bookings SET status = 9 WHERE subscription_id = $1 AND payment_status IN ('scheduled','retry') AND scheduled_date >= CURRENT_DATE", [s.id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Pause failed" }); }
});

router.post("/:id/resume", requireAuth, async (req, res) => {
  try {
    const s = await ownPlan(req, res); if (!s) return;
    if (s.status !== "paused") return res.status(400).json({ error: "Only a paused plan can resume" });
    // re-anchor: next occurrence starts one period from today
    const { nextDateFrom } = await import("./payments.js");
    await query("UPDATE subscriptions SET status = 'active', next_booking_date = $1 WHERE id = $2",
      [nextDateFrom(new Date().toISOString().slice(0, 10), s.frequency), s.id]);
    /* Pausing cancelled every future visit, so resuming has to rebuild them.
       Waiting for the next half-hourly tick meant "Resume" looked like it had
       done nothing at all. */
    try {
      const { materialise } = await import("../lib/subscriptions.js");
      await materialise(s.id);
    } catch (e) { console.error("materialise on resume:", e.message); }
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Resume failed" }); }
});

router.post("/:id/cancel", requireAuth, async (req, res) => {
  try {
    const s = await ownPlan(req, res); if (!s) return;
    if (s.status === "cancelled") return res.json({ ok: true });
    await query("UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1", [s.id]);
    // uncharged future occurrences: cancel outright (nothing was taken)
    await query("UPDATE bookings SET status = 9 WHERE subscription_id = $1 AND payment_status IN ('scheduled','retry') AND scheduled_date >= CURRENT_DATE", [s.id]);
    // charged future occurrences: cancel + full refund (plan cancellation ≠ late cancel)
    const paid = await query(
      "SELECT * FROM bookings WHERE subscription_id = $1 AND payment_status = 'paid' AND scheduled_date >= CURRENT_DATE AND status IN (0,1)", [s.id]);
    for (const b of paid.rows) {
      await refundBookingPayment(b, 100);
      await query("UPDATE bookings SET status = 9 WHERE id = $1", [b.id]);
    }
    const oc = await query("SELECT owner_id FROM companies WHERE id = $1", [s.company_id]);
    if (oc.rows[0]) await notify(oc.rows[0].owner_id, "cancelled", "Recurring plan cancelled",
      "A customer ended their recurring cleaning plan.", null).catch(() => {});
    res.json({ ok: true, refunded: paid.rows.length });
  } catch (e) { res.status(500).json({ error: "Cancel failed" }); }
});

export default router;
