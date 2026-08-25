import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { refundBookingPayment, chargeSavedCard, cancellationRefundPct, customerMayCancel } from "./payments.js";
import { bumpCounter } from "../lib/alerts.js";
import { notify } from "../lib/notify.js";
import { sendEmail } from "../lib/mailer.js";

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
      /* 'pending' belongs in the list below.

         It used to show only paid work, so a brand-new booking — status 0, the
         customer still at the card screen — was invisible to the company. The
         acceptance clock ran down against a job they could not see, and then
         the booking cancelled and refunded itself. From the partner's side the
         app simply never showed them any work at all.

         A customer at the card screen has committed, and the company needs to
         know a job is coming. If the payment never lands, the sweep cancels it
         anyway, so nothing is held on a promise. A genuinely abandoned
         checkout stays 'unpaid' and stays hidden.

         This explanation lives out here on purpose. The same text placed inside
         the SQL string broke the query outright: an em dash inside a SQL block
         comment is more than the parser will lex, and the endpoint answered
         500 to every company. Prose belongs in JavaScript, not in a query. */
      result = await query(
      /* A company sees work that has been PAID for, or that it has already
         acted on. Not work someone merely started paying for.

         'pending' used to be in this list. But payments.js sets pending the
         moment a Stripe Checkout session is CREATED — before the customer has
         typed a card number. So a payment that then failed left a job sitting
         in the company's list that nobody had paid for, which is what Musa hit:
         card declined, job still visible. 'scheduled' and 'retry' stay, because
         those are subscription occurrences that are genuinely due. */
        `SELECT b.*, u.full_name AS assigned_name,
                CASE WHEN cu.deleted_name IS NOT NULL
                     THEN 'Cleano customer'
                     ELSE cu.full_name END AS customer_name,
                (cu.deleted_name IS NOT NULL) AS customer_deleted,
                cu.customer_type AS customer_kind, cu.phone AS customer_phone
         FROM bookings b
         LEFT JOIN users u ON u.id = b.assigned_to
         LEFT JOIN users cu ON cu.id = b.customer_id
         WHERE b.company_id = $1
           AND (b.payment_status IN ('paid','scheduled','retry') OR b.status <> 0)
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

    /* Companies get the acceptance countdown attached. Everyone else has no
       use for it, and the customer certainly should not be shown a clock on
       somebody else's obligation. */
    let rows = result.rows;
    if (req.user.role === "company" && rows.some((b) => Number(b.status) === 0)) {
      try {
        const { acceptDeadline } = await import("../lib/reminders.js");
        rows = rows.map((b) => (Number(b.status) === 0 ? { ...b, accept_deadline: acceptDeadline(b) } : b));
      } catch { /* the list matters more than the countdown */ }
    }
    res.json({ bookings: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
});

/* POST /api/bookings — price is computed SERVER-SIDE from the service row */
router.post("/", requireAuth, async (req, res) => {
  if (req.user.role !== "customer") return res.status(403).json({ error: "Customers only" });
  const { companyId, serviceId, scheduledDate, scheduledSlot, address, note, hours, units } = req.body;
  if (!companyId || !serviceId || !scheduledDate || !scheduledSlot || !address)
    return res.status(400).json({ error: "Missing required fields" });

  /* A cleaning cannot happen yesterday. Without this a stale phone — or anyone
     poking the API — can create a booking nobody can attend and nobody can cancel
     within the refund window. Compared as plain dates, so "today" is always fine. */
  const dOnly = String(scheduledDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dOnly)) return res.status(400).json({ error: "Invalid date" });
  const todayStr = new Date().toISOString().slice(0, 10);
  if (dOnly < todayStr) return res.status(400).json({ error: "That date has already passed — please pick another." });
  /* Nobody books a clean two years out; it is far more likely to be a mistake. */
  const maxAhead = new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10);
  if (dOnly > maxAhead) return res.status(400).json({ error: "That date is too far in the future." });

  try {
    const svcRes = await query("SELECT * FROM services WHERE id = $1 AND is_active = true", [serviceId]);
    if (!svcRes.rows.length) return res.status(400).json({ error: "Service not found" });
    const svc = svcRes.rows[0];
    if (svc.company_id !== companyId) return res.status(400).json({ error: "Service does not belong to that company" });

    const coRes = await query("SELECT * FROM companies WHERE id = $1 AND is_approved = true AND is_listed = true", [companyId]);
    if (!coRes.rows.length) return res.status(400).json({ error: "Company is not currently accepting bookings" });
    const co = coRes.rows[0];

    /* ── The service area, actually enforced ──────────────────────────────
       The company sets a pin and a radius, and the settings screen tells them
       "Only customers inside the circle can book you." Nothing checked it. The
       radius was stored, distanceKm() was written, and neither was ever used —
       so a Debrecen company with a 5 km radius could be booked from Budapest,
       and a cleaner would find out when the address loaded.

       Geocoding is cached and can fail (a new address, a provider outage). When
       we genuinely cannot place the address we allow the booking: refusing a
       real customer because a third-party lookup was slow is the worse error,
       and the company can still decline. */
    /* A company that names your city serves your city. No distance is measured,
       because none would be right: 30 km covers four towns around a village and
       still clips the edge of a big one, and a company working Debrecen and
       Nyíregyháza is not a circle at all. */
    /* One function decides this, and the company listing calls the same one.
       They used to be separate code paths, which meant a company could appear
       in your list and then refuse your booking. */
    const { areaCovers, areaSummary } = await import("./companies.js");

    let bookerCity = "";
    try {
      const meRow = await query("SELECT city FROM users WHERE id = $1", [req.user.id]);
      bookerCity = String(meRow.rows[0]?.city || "").trim();
    } catch { /* no city on file — the coordinates below still decide */ }

    let here = null;
    try {
      const { geocode } = await import("../lib/geocode.js");
      here = await geocode(`${address}, ${bookerCity || co.city || ""}`.trim().replace(/,\s*$/, ""));
    } catch (e) { console.error("service-area geocode:", e.message); }

    /* areaCovers() already allows the slack a hand-dropped pin deserves, and
       the listing calls the same function — so if it says no here, the company
       was never in this customer's list either. */
    const verdict = areaCovers(co, { city: bookerCity, lat: here?.lat, lng: here?.lng });
    if (!verdict.covered) {
      const how = verdict.km != null ? ` (about ${Math.round(verdict.km)} km away)` : "";
      return res.status(400).json({
        error: `That address is outside this company's service area${how}. They work in: ${areaSummary(co) || co.city || "their own area"}.`,
      });
    }

    // ── Respect the company's availability (server-side, so a stale app can't
    //    slip a booking into a time they don't work) ──
    const av = co.availability;
    if (av) {
      if (av.paused) return res.status(400).json({ error: "This company is not taking new bookings right now." });
      const dstr = String(scheduledDate).slice(0, 10);
      if (Array.isArray(av.closed) && av.closed.includes(dstr))
        return res.status(400).json({ error: "The company is closed on that date — please pick another day." });

      const dow = String(new Date(dstr + "T12:00:00Z").getUTCDay());
      const rule = (av.days || {})[dow] || {};
      // the hours this company offers on that weekday (legacy from/to still honoured)
      let offered = Array.isArray(rule.slots) ? rule.slots : null;
      if (!offered && rule.from && rule.to) {
        offered = [];
        for (let h = 0; h < 24; h++) {
          const t = String(h).padStart(2, "0") + ":00";
          if (t >= rule.from && t < rule.to) offered.push(t);
        }
      }
      if (rule.on === false || (offered && offered.length === 0))
        return res.status(400).json({ error: "The company doesn't work on that day — please pick another." });

      if (scheduledSlot) {
        const t = String(scheduledSlot).slice(0, 5);
        const blocked = (av.busy || {})[dstr];
        if (Array.isArray(blocked) && blocked.includes(t))
          return res.status(400).json({ error: "That time slot is already taken — please pick another." });
        /* Per-service block: cleaning can be full at 10:00 while laundry is free. */
        const svcBlocked = ((av.busyServices || {})[serviceId] || {})[dstr];
        if (Array.isArray(svcBlocked) && svcBlocked.includes(t))
          return res.status(400).json({ error: "That time is already taken for this service — please pick another." });
        if (offered && !offered.includes(t))
          return res.status(400).json({ error: "The company doesn't offer that time — please pick one of their available hours." });

      }
    }

    /* ── Capacity. Marking a slot busy by hand is not something a company should
       have to remember, and until now two customers could book the same hour and
       both be told yes. A company can only be in as many places at once as it has
       people, so that is the cap: active cleaners, or 1 for a one-person business.
       This runs whether or not the company has set opening hours — a company that
       has not configured availability needs protecting most of all. Cancelled and
       declined bookings (8, 9) do not hold a slot. ── */
    /* Retrying an abandoned checkout reuses the row it abandoned.

       The booking is created before payment, so a failed or closed card screen
       leaves an unpaid row behind. Pressing Confirm again used to create a
       SECOND row for the same slot — which then counted against the company's
       capacity, so a customer could lock themselves out of the very
       appointment they were trying to pay for, and be told "that time has just
       been taken".

       Returning the existing booking keeps one row per intention, keeps the
       availability count honest for everyone else, and sends the customer
       straight back to paying for the thing they already chose.

       The address is part of the match on purpose. Same customer, same hour,
       DIFFERENT address is not a retry — it is a laundry van calling at two
       houses, which is exactly what a collection service is for. */
    {
      const slotStr0 = String(scheduledSlot).slice(0, 5);
      const mine = await query(
        `SELECT * FROM bookings
          WHERE customer_id = $1 AND company_id = $2 AND service_id = $3
            AND scheduled_date = $4 AND scheduled_slot = $5
            AND address = $6
            AND payment_status = 'unpaid' AND status = 0
          ORDER BY created_at DESC LIMIT 1`,
        [req.user.id, companyId, serviceId, dOnly, slotStr0, address]);
      if (mine.rows.length) return res.status(200).json({ booking: mine.rows[0], reused: true });
    }

    {
      const slotStr = String(scheduledSlot).slice(0, 5);
      /* A cleaning slot is exclusive: one team, one house, one hour. A collection
         round is not — the same van calls at several addresses. So a service may
         override the cap; otherwise it is the size of the team. */
      const capRow = await query(
        `SELECT GREATEST(1, COUNT(*)::int) AS n FROM users
          WHERE company_id = $1 AND role::text = 'employee'
            AND approval_status::text = 'approved' AND is_active IS NOT false`, [companyId]);
      const cap = { rows: [{ n: svc.slot_capacity != null ? Number(svc.slot_capacity) : capRow.rows[0].n }] };
      /* Capacity is counted PER SERVICE. A company that cleans and also does
         laundry can genuinely do both at 10:00 — different work, often different
         people or somewhere else entirely. What it cannot do is take the same
         service twice over with only one team. A company that wants an hour
         blocked outright uses the company-wide busy list instead. */
      /* An abandoned checkout must not hold the slot for ever.

         The booking row is created BEFORE payment, which is right — the price,
         the address and the time all have to exist before there is anything to
         pay for. But it meant every failed or abandoned payment attempt left a
         row occupying the slot, counted here as if it were a real job. Try to
         pay three times and fail, and you have locked yourself out of your own
         appointment; the customer is then told "that time has just been taken",
         which is true and completely baffling.

         Two exclusions:
           · anyone's unpaid attempt older than the grace period — long enough
             to finish a card payment, short enough not to squat on a slot;
           A retry of the customer's OWN abandoned attempt is handled earlier by
           reusing that row rather than creating a second one — see above. That
           is better than forgiving it here: excusing a customer's unpaid rows
           from the count would let one person quietly hold a whole morning. */
      const graceMin = Math.max(5, Number(process.env.CHECKOUT_GRACE_MIN || 30));

      /* A job occupies the hours it actually lasts, not just the hour it starts.

         This compared scheduled_slot for exact equality, so a three-hour clean
         booked at 10:00 left 11:00 and 12:00 looking free. One team could be
         sold the same morning three times over, and nobody found out until a
         cleaner was expected in two places at once.

         Length comes from the booking where the customer chose it (hourly
         work) and from the service otherwise. Anything we cannot read falls
         back to one hour, which is the old behaviour — never worse. */
      const mins = (b) => {
        const h = Number(b?.hours);
        if (Number.isFinite(h) && h > 0) return Math.round(h * 60);
        const m = Number(b?.service_minutes ?? b?.minutes);
        return Number.isFinite(m) && m > 0 ? Math.round(m) : 60;
      };
      const startMin = (slot) => {
        const [hh, mm] = String(slot || "").slice(0, 5).split(":").map(Number);
        return Number.isFinite(hh) ? hh * 60 + (mm || 0) : null;
      };

      const sameDay = await query(
        `SELECT b.scheduled_slot, b.hours, s.minutes AS service_minutes
           FROM bookings b LEFT JOIN services s ON s.id = b.service_id
          WHERE b.company_id = $1 AND b.scheduled_date = $2
            AND b.service_id = $3 AND b.status NOT IN (8, 9)
            AND NOT (b.payment_status = 'unpaid' AND b.created_at < NOW() - ($4 || ' minutes')::interval)`,
        [companyId, dOnly, serviceId, String(graceMin)]);

      const wantFrom = startMin(slotStr);
      const wantTo = wantFrom == null ? null : wantFrom + mins({ hours, minutes: svc.minutes });
      let overlapping = 0;
      if (wantFrom != null) {
        for (const r of sameDay.rows) {
          const from = startMin(r.scheduled_slot);
          if (from == null) continue;
          const to = from + mins(r);
          if (wantFrom < to && from < wantTo) overlapping++;   // half-open ranges
        }
      }
      if (overlapping >= cap.rows[0].n)
        return res.status(400).json({ error: "That time has just been taken — please pick another." });
    }

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
    let effUnits = null;
    let gross;
    if (svc.pricing_type === "unit") {
      /* Laundry by the kilo, carpets by the square metre. The customer picks a
         quantity exactly as they pick hours, and it is clamped to what the
         company offers so nobody books 900 kg of washing. */
      const raw = Number(units);
      const mn = Number(svc.min_units) || 1;
      const mx = Number(svc.max_units) || 50;
      if (!Number.isFinite(raw) || raw <= 0) return res.status(400).json({ error: "Choose how much you need cleaned" });
      effUnits = Math.min(Math.max(Math.round(raw * 100) / 100, mn), mx);
      gross = Math.round((svc.unit_price_huf || 0) * effUnits);
    } else if (svc.pricing_type === "hourly") {
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
    const svcPromo = Math.min(Math.max(parseInt(svc.promo_pct, 10) || 0, 0), 90);
    const discount = Math.round(gross * Math.max(promo, studPct, svcPromo) / 100); // best single discount, never stacked
    const companyShare = gross - discount;
    // Cleano service fee is ADDED ON TOP and shown to the customer:
    // company's listed price stays fully theirs.
    const feePct = Math.min(Math.max(Number(process.env.COMMISSION_PCT || 10), 0), 50);
    const serviceFee = Math.round(companyShare * feePct / 100);
    const total = companyShare + serviceFee;
    /* A zero or negative total cannot be charged by any card processor, so a
       booking like this would sit unpaid forever. Refuse it at the door. */
    if (!(total > 0)) return res.status(400).json({ error: "This service is not priced correctly — please contact the company." });

    /* For a collection service the job is not finished when we drive away — the
       customer wants to know when their things come back. Work it out now, from
       the company's stated turnaround, so it is on the booking from the start. */
    const isCollection = svc.fulfilment === "collection";
    let returnDate = null;
    if (isCollection) {
      const d = new Date(dOnly + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + (Number(svc.turnaround_days) || 3));
      returnDate = d.toISOString().slice(0, 10);
    }

    const snapshot = {
      id: svc.id, name: svc.name, description: svc.description, icon: svc.icon,
      price_huf: svc.price_huf, hourly_rate_huf: svc.hourly_rate_huf, minutes: svc.minutes,
      tasks: svc.tasks, pricing_type: svc.pricing_type, period: svc.period,
      unit_label: svc.unit_label, unit_price_huf: svc.unit_price_huf,
      fulfilment: svc.fulfilment, turnaround_days: svc.turnaround_days,
    };

    const onq = await query("SELECT COALESCE(MAX(order_no),0)+1 AS n FROM bookings");
    const orderNo = onq.rows[0].n;
    const result = await query(
      `INSERT INTO bookings
        (customer_id, company_id, service_id, service_snapshot, scheduled_date, scheduled_slot, address, note, customer_type, total_huf, service_fee_huf, pricing_type, hours, period, order_no, currency, total_minor, service_fee_minor, requirements_ack_at, fulfilment, return_date, units, unit_label)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *`,
      [req.user.id, companyId, serviceId, JSON.stringify(snapshot), scheduledDate, scheduledSlot, address, note || null,
       customerType, total, serviceFee, svc.pricing_type, effHours, svc.pricing_type === "subscription" ? svc.period : null, orderNo,
       co.currency || "HUF", total * 100, serviceFee * 100, req.body.requirementsAck === true ? new Date() : null,
       isCollection ? "collection" : "onsite", returnDate, effUnits, effUnits != null ? svc.unit_label : null]
    );
    const nb = result.rows[0];
    // Tell the company immediately: in-app banner + email (works while app is closed)
    (async () => {
      try {
        const oc = await query("SELECT u.id AS owner_id, u.email, c.name FROM companies c JOIN users u ON u.id = c.owner_id WHERE c.id = $1", [companyId]);
        if (oc.rows[0]) {
          await notify(oc.rows[0].owner_id, "booking", `New booking #${orderNo} 🧹`, `${svc.name} · ${scheduledDate} ${scheduledSlot} · ${huf(total)} Ft`, nb.id);
          sendEmail(oc.rows[0].email, `New Cleano booking #${orderNo} — ${svc.name}`,
            `<div style="font-family:sans-serif;max-width:520px"><h2 style="color:#1B2A6B">New booking! 🐙</h2>
             <p><b>${svc.name}</b><br/>${scheduledDate} at ${scheduledSlot}<br/>${String(address).slice(0, 120)}</p>
             <p>Total to you: <b>${huf(total - serviceFee)} Ft</b></p>
             <p><a href="${process.env.PUBLIC_BASE_URL || "https://cleanly-2x9z.onrender.com"}" style="background:#1B2A6B;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Open Cleano and assign a cleaner</a></p></div>`);
        }
      } catch (e) { console.error("booking notify:", e.message); }
    })();
    bumpCounter("bookings");
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

const huf = (n) => new Intl.NumberFormat("hu-HU").format(Math.round(n || 0));
/* onsite      0 New  1 Assigned  2 On the way  3 Cleaning        4 Done
   collection  0 New  1 Assigned  2 On the way  5 Collected
                                  3 In progress 6 Out for return  4 Returned
   8 Declined and 9 Cancelled apply to both. */
const VALID_STATUSES = [0, 1, 2, 3, 4, 5, 6, 8, 9];

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
      /* Inside the cancellation window it is simply not allowed. The customer
         was shown this before they paid, so it should never be a surprise. */
      if (!customerMayCancel(b)) {
        const freeH = Number(process.env.CANCEL_FREE_H || 48);
        return res.status(400).json({
          error: `Bookings can only be cancelled more than ${freeH} hours before the visit. Please contact the company directly.`,
        });
      }
      // Cancelling in time refunds the whole amount.
      if (b.payment_status === "paid") await refundBookingPayment(b, cancellationRefundPct());
    } else if (req.user.role === "employee") {
      if (b.assigned_to !== req.user.id) return res.status(403).json({ error: "Forbidden" });
      /* A cleaner advances their own job, but the two kinds of job have different
         ladders, and a step must follow the one before it — otherwise a laundry
         round could be marked "returned" before anything was ever collected. */
      const LADDER = b.fulfilment === "collection" ? [1, 2, 5, 3, 6, 4] : [1, 2, 3, 4];
      const at = LADDER.indexOf(Number(b.status));
      const to = LADDER.indexOf(Number(status));
      if (to === -1) return res.status(403).json({ error: "Cleaners can only advance job progress" });
      if (at === -1) return res.status(400).json({ error: "Job is not active" });
      if (to <= at) return res.status(400).json({ error: "That step has already been done" });
      if (to > at + 1) return res.status(400).json({ error: "Finish the step before that one first" });
    } else if (req.user.role === "company") {
      if (b.company_id !== req.user.companyId) return res.status(403).json({ error: "Forbidden" });

      /* A company had an ownership check and nothing else, while its own
         cleaners were held to a strict step-by-step ladder. So a partner could
         take a booking straight from "waiting to be accepted" to "completed"
         without anyone attending, which tells the customer their cleaning is
         done and asks them for a review; could reopen a finished job after the
         invoice for it had been issued, leaving the accounting describing
         something that no longer existed; and could decline a job that had
         already been carried out, refunding work their own cleaner had done.

         Forward is allowed to skip a step, because real work does: a cleaner
         who is already on site does not need "on the way" recorded first.
         Backwards is not, and neither is walking away from work that has
         started. Admin is deliberately exempt below — correcting the record is
         precisely what an operator is for. */
      const cur = Number(b.status), want = Number(status);
      const LADDER = b.fulfilment === "collection" ? [0, 1, 2, 5, 3, 6, 4] : [0, 1, 2, 3, 4];
      const iCur = LADDER.indexOf(cur), iWant = LADDER.indexOf(want);

      if (want === 8) {
        if (cur > 1) return res.status(400).json({ error: "The job has already started — you can no longer decline it." });
      } else if (want === 9) {
        if (cur > 2) return res.status(400).json({ error: "The job has already started — it cannot be cancelled here." });
      } else if (cur === 8 || cur === 9) {
        return res.status(400).json({ error: "This booking was already declined or cancelled." });
      } else if (cur === 0 && want !== 1) {
        /* Accepting is the only way out of "waiting". Otherwise a booking the
           customer is still waiting on could be reported as finished, with the
           acceptance clock never stopped and the customer asked to review a
           cleaning nobody agreed to do. */
        return res.status(400).json({ error: "Accept the booking first, then update its progress." });
      } else if (iCur !== -1 && iWant !== -1 && iWant <= iCur) {
        return res.status(400).json({ error: "That step is already done — a job cannot go backwards." });
      }
    } else if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    // decline (8) is a company/admin action, and the only status that stores a reason
    if (status === 8 && !["company", "admin"].includes(req.user.role))
      return res.status(403).json({ error: "Only the company can decline" });

    const result = await query(
      /* Stamp the real clock as the job moves. Booked-for is what was promised;
         these are what happened, and they are what settles an argument later. */
      `UPDATE bookings SET status = $1, decline_reason = $2,
         enroute_at   = CASE WHEN $1 = 2 AND enroute_at IS NULL THEN NOW() ELSE enroute_at END,
         started_at   = CASE WHEN $1 = 3 AND started_at IS NULL THEN NOW() ELSE started_at END,
         finished_at  = CASE WHEN $1 = 4 AND finished_at IS NULL THEN NOW() ELSE finished_at END,
         collected_at = CASE WHEN $1 = 5 AND collected_at IS NULL THEN NOW() ELSE collected_at END,
         returned_at  = CASE WHEN $1 = 4 AND fulfilment = 'collection' AND returned_at IS NULL THEN NOW() ELSE returned_at END
       WHERE id = $3 RETURNING *`,
      /* An empty reason is stored as NULL, not as an English sentence.

         Whatever goes in this column is shown verbatim to the CUSTOMER, who
         may not read the language the company was using — so a default typed
         here freezes one person's language into another person's screen. NULL
         lets the app render the fallback in whatever language the reader has. */
      [status, status === 8 ? (String(declineReason || "").trim() || null) : b.decline_reason, req.params.id]
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
      // keep the company in the loop on live progress
      if ([2, 3, 4].includes(status)) {
        try {
          const oc2 = await query("SELECT owner_id FROM companies WHERE id = $1", [b.company_id]);
          if (oc2.rows[0]) {
            const svcN = (b.service_snapshot && b.service_snapshot.name) || "Cleaning";
            const msg = status === 2 ? ["Cleaner on the way 🚗", `${svcN} · your cleaner is heading out.`]
              : status === 3 ? ["Cleaning started ✨", `${svcN} · work has begun on site.`]
              : ["Job completed ✅", `${svcN} · finished. Awaiting the customer's review.`];
            await notify(oc2.rows[0].owner_id, "status", msg[0], msg[1], b.id);
          }
        } catch (e) { console.error("owner status notify:", e.message); }
      }
      if (status === 9 && req.user.role === "customer") {
        const oc = await query("SELECT owner_id FROM companies WHERE id = $1", [b.company_id]);
        if (oc.rows[0]) await notify(oc.rows[0].owner_id, "cancelled", "Booking cancelled", "A customer cancelled a booking.", b.id);
      }
    } catch (e) { console.error("notify status:", e.message); }

    /* Subscription recurrence: completing a visit schedules the next one. */
    let next = null;
    /* (old subscription CHAIN removed — the scheduler in lib/subscriptions.js
       now materialises and charges occurrences ahead of time) */

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
    const ab = result.rows[0];
    if (employeeId) {
      const when = `${ab.scheduled_date instanceof Date ? ab.scheduled_date.toISOString().slice(0, 10) : ab.scheduled_date} ${ab.scheduled_slot}`;
      notify(employeeId, "assigned", "New job for you 🧹", `${ab.service_snapshot?.name || "Cleaning"} · ${when}`, ab.id).catch(() => {});
      (async () => {
        try {
          const emp = await query("SELECT email, full_name FROM users WHERE id = $1", [employeeId]);
          if (emp.rows[0]) sendEmail(emp.rows[0].email, `New Cleano job — ${when}`,
            `<div style="font-family:sans-serif;max-width:520px"><h2 style="color:#1B2A6B">You have a new job, ${emp.rows[0].full_name}! 🧹</h2>
             <p><b>${ab.service_snapshot?.name || "Cleaning"}</b><br/>${when}<br/>${String(ab.address || "").slice(0, 120)}</p>
             <p><a href="${process.env.PUBLIC_BASE_URL || "https://cleanly-2x9z.onrender.com"}" style="background:#1B2A6B;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Open Cleano — see the details</a></p></div>`);
        } catch (e) { console.error("assign email:", e.message); }
      })();
    }
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

/* PUT /api/bookings/:id/hide-identity — company/admin removes the deleted-user
   name shown on this booking (kept for accounting until they clear it). */
router.put("/:id/hide-identity", requireAuth, async (req, res) => {
  try {
    const r = await query("SELECT company_id FROM bookings WHERE id = $1", [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: "Not found" });
    const allowed = req.user.role === "admin" || (req.user.role === "company" && r.rows[0].company_id === req.user.companyId);
    if (!allowed) return res.status(403).json({ error: "Forbidden" });
    await query("UPDATE bookings SET hide_deleted_identity = true WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: "Could not update booking" }); }
});

export default router;
