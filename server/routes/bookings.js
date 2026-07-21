import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { refundBookingPayment } from "./payments.js";
import { notify } from "../lib/notify.js";

const router = Router();

/* GET /api/bookings — role-aware */
router.get("/", requireAuth, async (req, res) => {
  try {
    let result;
    if (req.user.role === "customer") {
      result = await query(
        `SELECT b.*, u.full_name AS assigned_name
         FROM bookings b
         LEFT JOIN users u ON u.id = b.assigned_to
         WHERE b.customer_id = $1
         ORDER BY b.created_at DESC`,
        [req.user.id]
      );
    } else if (req.user.role === "employee") {
      result = await query(
        `SELECT b.*, cu.full_name AS customer_name
         FROM bookings b
         LEFT JOIN users cu ON cu.id = b.customer_id
         WHERE b.assigned_to = $1
         ORDER BY b.scheduled_date ASC`,
        [req.user.id]
      );
    } else if (req.user.role === "company") {
      result = await query(
        `SELECT b.*, u.full_name AS assigned_name, cu.full_name AS customer_name, cu.customer_type AS customer_kind, cu.phone AS customer_phone
         FROM bookings b
         LEFT JOIN users u ON u.id = b.assigned_to
         LEFT JOIN users cu ON cu.id = b.customer_id
         WHERE b.company_id = $1
           AND (b.payment_status = 'paid' OR b.status <> 0 OR b.pricing_type = 'subscription')
         ORDER BY b.created_at DESC`,
        [req.user.companyId]
      );
    } else if (req.user.role === "admin") {
      result = await query(
        `SELECT b.*, c.name AS company_name, cu.full_name AS customer_name
         FROM bookings b
         LEFT JOIN companies c ON c.id = b.company_id
         LEFT JOIN users cu ON cu.id = b.customer_id
         ORDER BY b.created_at DESC`
      );
    }
    res.json({ bookings: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
});

/* POST /api/bookings — price is computed SERVER-SIDE from the service row */
router.post("/", requireAuth, async (req, res) => {
  if (req.user.role !== "customer") return res.status(403).json({ error: "Customers only" });
  const { companyId, serviceId, scheduledDate, scheduledSlot, address, note, hours } = req.body;
  if (!companyId || !serviceId || !scheduledDate || !scheduledSlot || !address)
    return res.status(400).json({ error: "Missing required fields" });

  try {
    const svcRes = await query("SELECT * FROM services WHERE id = $1 AND is_active = true", [serviceId]);
    if (!svcRes.rows.length) return res.status(400).json({ error: "Service not found" });
    const svc = svcRes.rows[0];
    if (svc.company_id !== companyId) return res.status(400).json({ error: "Service does not belong to that company" });

    const coRes = await query("SELECT * FROM companies WHERE id = $1 AND is_approved = true AND is_listed = true", [companyId]);
    if (!coRes.rows.length) return res.status(400).json({ error: "Company is not currently accepting bookings" });
    const co = coRes.rows[0];

    // One active subscription chain per customer per service — prevents double-charging chains.
    if (svc.pricing_type === "subscription") {
      const dup = await query(
        `SELECT 1 FROM bookings
         WHERE customer_id = $1 AND service_id = $2 AND pricing_type = 'subscription' AND status BETWEEN 0 AND 3
         LIMIT 1`,
        [req.user.id, serviceId]
      );
      if (dup.rows.length)
        return res.status(400).json({ error: "You already have an active subscription for this service — cancel it first under Bookings." });
    }

    const me = (await query("SELECT customer_type FROM users WHERE id = $1", [req.user.id])).rows[0];
    const customerType = me?.customer_type || "resident";

    let effHours = null;
    let gross;
    if (svc.pricing_type === "hourly") {
      const h = Math.round(Number(hours) || svc.min_hours || 2);
      effHours = Math.min(Math.max(h, svc.min_hours || 1), svc.max_hours || 12);
      gross = (svc.hourly_rate_huf || 0) * effHours;
    } else {
      gross = svc.price_huf || 0;
    }
    const promo = (() => {
      const p = co.promo;
      if (!p || !p.pct) return 0;
      if (p.until && new Date(p.until + "T23:59:59") < new Date()) return 0;
      return Math.min(Math.max(parseInt(p.pct, 10) || 0, 0), 90);
    })();
    const studPct = customerType === "student" ? (co.student_discount || 0) : 0;
    const discount = Math.round(gross * Math.max(promo, studPct) / 100); // better of the two, never stacked
    const companyShare = gross - discount;
    // Cleano service fee is ADDED ON TOP and shown to the customer:
    // company's listed price stays fully theirs.
    const feePct = Math.min(Math.max(Number(process.env.COMMISSION_PCT || 10), 0), 50);
    const serviceFee = Math.round(companyShare * feePct / 100);
    const total = companyShare + serviceFee;

    const snapshot = {
      id: svc.id, name: svc.name, description: svc.description, icon: svc.icon,
      price_huf: svc.price_huf, hourly_rate_huf: svc.hourly_rate_huf, minutes: svc.minutes,
      tasks: svc.tasks, pricing_type: svc.pricing_type, period: svc.period,
    };

    const onq = await query("SELECT COALESCE(MAX(order_no),0)+1 AS n FROM bookings");
    const orderNo = onq.rows[0].n;
    const result = await query(
      `INSERT INTO bookings
        (customer_id, company_id, service_id, service_snapshot, scheduled_date, scheduled_slot, address, note, customer_type, total_huf, service_fee_huf, pricing_type, hours, period, order_no)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [req.user.id, companyId, serviceId, JSON.stringify(snapshot), scheduledDate, scheduledSlot, address, note || null,
       customerType, total, serviceFee, svc.pricing_type, effHours, svc.pricing_type === "subscription" ? svc.period : null, orderNo]
    );
    res.status(201).json({ booking: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create booking" });
  }
});

/* Advance a YYYY-MM-DD date by one subscription period. */
function nextOccurrence(dateStr, period) {
  // tolerate both 'YYYY-MM-DD' strings (pg parser) and Date objects (drivers/emulators)
  const ymd = dateStr instanceof Date
    ? `${dateStr.getFullYear()}-${String(dateStr.getMonth() + 1).padStart(2, "0")}-${String(dateStr.getDate()).padStart(2, "0")}`
    : String(dateStr).slice(0, 10);
  const [y, m, d] = ymd.split("-").map(Number);
  let next;
  if (period === "weekly") next = new Date(y, m - 1, d + 7);
  else if (period === "biweekly") next = new Date(y, m - 1, d + 14);
  else next = new Date(y, m - 1 + 1, Math.min(d, 28)); // monthly: same day next month (clamped)
  const pad = (n) => String(n).padStart(2, "0");
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
}

const VALID_STATUSES = [0, 1, 2, 3, 4, 8, 9];

/* PUT /api/bookings/:id/status */
router.put("/:id/status", requireAuth, async (req, res) => {
  const { status, declineReason } = req.body;
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status" });
  try {
    const booking = await query("SELECT * FROM bookings WHERE id = $1", [req.params.id]);
    if (!booking.rows.length) return res.status(404).json({ error: "Booking not found" });
    const b = booking.rows[0];

    if (req.user.role === "customer") {
      if (b.customer_id !== req.user.id) return res.status(403).json({ error: "Forbidden" });
      if (status !== 9) return res.status(403).json({ error: "Customers can only cancel" });
      if (b.status > 1) return res.status(400).json({ error: "Cannot cancel — work has started" });
    } else if (req.user.role === "employee") {
      if (b.assigned_to !== req.user.id) return res.status(403).json({ error: "Forbidden" });
      // cleaners advance their own job: on-way → cleaning → done
      if (![2, 3, 4].includes(status)) return res.status(403).json({ error: "Cleaners can only advance job progress" });
      if (b.status < 1 || b.status > 3) return res.status(400).json({ error: "Job is not active" });
    } else if (req.user.role === "company") {
      if (b.company_id !== req.user.companyId) return res.status(403).json({ error: "Forbidden" });
    } else if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    // decline (8) is a company/admin action, and the only status that stores a reason
    if (status === 8 && !["company", "admin"].includes(req.user.role))
      return res.status(403).json({ error: "Only the company can decline" });

    const result = await query(
      "UPDATE bookings SET status = $1, decline_reason = $2 WHERE id = $3 RETURNING *",
      [status, status === 8 ? (declineReason || "Not available for this time") : b.decline_reason, req.params.id]
    );
    const updated = result.rows[0];

    // Company/admin declined a PAID booking -> refund the customer in full (price + fee).
    if (status === 8 && b.payment_status === "paid") {
      await refundBookingPayment(b);
    }

    // Notify the relevant party of the change.
    try {
      if (status === 1) await notify(b.customer_id, "status", "Cleaner assigned 🧹", "A cleaner has been assigned to your booking.", b.id);
      else if (status === 2) await notify(b.customer_id, "status", "On the way 🚗", "Your cleaner is on the way.", b.id);
      else if (status === 3) await notify(b.customer_id, "status", "Cleaning in progress ✨", "Your cleaning has started.", b.id);
      else if (status === 4 && b.status !== 4) await notify(b.customer_id, "status", "Job completed ✅", "Your cleaning is done — please leave a review.", b.id);
      else if (status === 8) await notify(b.customer_id, "declined", "Order declined", b.payment_status === "paid" ? "The company can't take this booking — you've been refunded in full." : "The company can't take this booking.", b.id);
      else if (status === 9 && req.user.role === "customer") {
        const oc = await query("SELECT owner_id FROM companies WHERE id = $1", [b.company_id]);
        if (oc.rows[0]) await notify(oc.rows[0].owner_id, "cancelled", "Booking cancelled", "A customer cancelled a booking.", b.id);
      }
    } catch (e) { console.error("notify status:", e.message); }

    /* Subscription recurrence: completing a visit schedules the next one. */
    let next = null;
    if (status === 4 && b.status !== 4 && b.pricing_type === "subscription" && b.period) {
      const nextDate = nextOccurrence(b.scheduled_date, b.period);
      // Guard: never create the same future visit twice (double-taps, status bounce, races)
      const dupe = await query(
        `SELECT 1 FROM bookings
         WHERE customer_id = $1 AND service_id = $2 AND pricing_type = 'subscription'
           AND scheduled_date = $3 AND status NOT IN (8, 9)
         LIMIT 1`,
        [b.customer_id, b.service_id, nextDate]
      );
      if (dupe.rows.length) return res.json({ booking: updated, next: null });
      const onq2 = await query("SELECT COALESCE(MAX(order_no),0)+1 AS n FROM bookings");
      const nextRes = await query(
        `INSERT INTO bookings
          (customer_id, company_id, service_id, service_snapshot, scheduled_date, scheduled_slot, address, note, customer_type, total_huf, service_fee_huf, pricing_type, hours, period, assigned_to, status, order_no)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [b.customer_id, b.company_id, b.service_id, JSON.stringify(b.service_snapshot), nextDate, b.scheduled_slot,
         b.address, b.note, b.customer_type, b.total_huf, b.service_fee_huf || 0, b.pricing_type, b.hours, b.period,
         b.assigned_to, b.assigned_to ? 1 : 0, onq2.rows[0].n]
      );
      next = nextRes.rows[0];
    }

    res.json({ booking: updated, next });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update status" });
  }
});

/* PUT /api/bookings/:id/assign */
router.put("/:id/assign", requireAuth, async (req, res) => {
  if (req.user.role !== "company") return res.status(403).json({ error: "Company only" });
  const { employeeId } = req.body;
  try {
    const booking = await query("SELECT * FROM bookings WHERE id = $1", [req.params.id]);
    if (!booking.rows.length) return res.status(404).json({ error: "Not found" });
    if (booking.rows[0].company_id !== req.user.companyId) return res.status(403).json({ error: "Forbidden" });

    // the assignee must be an active cleaner of THIS company
    const emp = await query(
      "SELECT 1 FROM users WHERE id = $1 AND role = 'employee' AND company_id = $2 AND is_active = true",
      [employeeId, req.user.companyId]
    );
    if (!emp.rows.length) return res.status(400).json({ error: "Not one of your active employees" });

    const newStatus = Math.max(booking.rows[0].status, 1);
    const result = await query(
      "UPDATE bookings SET assigned_to = $1, status = $2 WHERE id = $3 RETURNING *",
      [employeeId, newStatus, req.params.id]
    );
    res.json({ booking: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to assign booking" });
  }
});

/* PUT /api/bookings/:id/tasks */
router.put("/:id/tasks", requireAuth, async (req, res) => {
  if (req.user.role !== "employee") return res.status(403).json({ error: "Employee only" });
  const { tasksDone } = req.body;
  try {
    const booking = await query("SELECT * FROM bookings WHERE id = $1", [req.params.id]);
    if (!booking.rows.length) return res.status(404).json({ error: "Not found" });
    if (booking.rows[0].assigned_to !== req.user.id) return res.status(403).json({ error: "Forbidden" });

    const result = await query("UPDATE bookings SET tasks_done = $1 WHERE id = $2 RETURNING *", [JSON.stringify(tasksDone), req.params.id]);
    res.json({ booking: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to update tasks" });
  }
});

/* PUT /api/bookings/:id/invoice — company uploads the invoice for a completed job */
router.put("/:id/invoice", requireAuth, async (req, res) => {
  if (req.user.role !== "company") return res.status(403).json({ error: "Company only" });
  const { invoice } = req.body || {};
  if (!invoice || !invoice.data || !invoice.name) return res.status(400).json({ error: "Invoice file required" });
  if (String(invoice.data).length > 3 * 1024 * 1024) return res.status(400).json({ error: "Invoice too large (max ~2 MB)" });
  try {
    const b = await query("SELECT * FROM bookings WHERE id = $1", [req.params.id]);
    if (!b.rows.length) return res.status(404).json({ error: "Not found" });
    if (b.rows[0].company_id !== req.user.companyId) return res.status(403).json({ error: "Forbidden" });
    if (b.rows[0].status !== 4) return res.status(400).json({ error: "Invoices can be added to completed jobs only" });
    const r = await query("UPDATE bookings SET invoice = $1 WHERE id = $2 RETURNING *",
      [JSON.stringify({ name: String(invoice.name).slice(0, 120), type: String(invoice.type || "application/pdf").slice(0, 80), data: invoice.data }), req.params.id]);
    res.json({ booking: r.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save invoice" });
  }
});

/* PUT /api/bookings/:id/archive — company hides finished jobs from its board */
router.put("/:id/archive", requireAuth, async (req, res) => {
  if (req.user.role !== "company") return res.status(403).json({ error: "Company only" });
  try {
    const r = await query(
      "UPDATE bookings SET archived_by_company = true WHERE id = $1 AND company_id = $2 AND status IN (4, 8, 9) RETURNING id",
      [req.params.id, req.user.companyId]
    );
    if (!r.rows.length) return res.status(400).json({ error: "Only finished jobs can be archived" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to archive" });
  }
});

/* PUT /api/bookings/:id/location — the assigned cleaner shares live location */
router.put("/:id/location", requireAuth, async (req, res) => {
  const { lat, lng } = req.body || {};
  if (typeof lat !== "number" || typeof lng !== "number") return res.status(400).json({ error: "lat/lng required" });
  try {
    const b = await query("SELECT assigned_to FROM bookings WHERE id = $1", [req.params.id]);
    if (!b.rows.length) return res.status(404).json({ error: "Not found" });
    if (b.rows[0].assigned_to !== req.user.id) return res.status(403).json({ error: "Not your job" });
    await query("UPDATE bookings SET live_lat = $1, live_lng = $2, live_at = NOW() WHERE id = $3", [lat, lng, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: "Failed to update location" }); }
});

/* GET /api/bookings/:id/location — customer, assigned cleaner, the company, or admin */
router.get("/:id/location", requireAuth, async (req, res) => {
  try {
    const b = await query("SELECT customer_id, company_id, assigned_to, live_lat, live_lng, live_at, status, address FROM bookings WHERE id = $1", [req.params.id]);
    if (!b.rows.length) return res.status(404).json({ error: "Not found" });
    const row = b.rows[0];
    const allowed = row.customer_id === req.user.id || row.assigned_to === req.user.id || (req.user.role === "company" && row.company_id === req.user.companyId) || req.user.role === "admin";
    if (!allowed) return res.status(403).json({ error: "Forbidden" });
    res.json({ lat: row.live_lat, lng: row.live_lng, at: row.live_at, status: row.status, address: row.address });
  } catch (err) { res.status(500).json({ error: "Failed to fetch location" }); }
});

export default router;
