import { Router } from "express";
import { query, hasColumn } from "../db.js";
import { slotProblem } from "../lib/availability.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { refundBookingPayment, chargeSavedCard, cancellationRefundPct, customerMayCancel } from "./payments.js";
import { bumpCounter } from "../lib/alerts.js";
import { notify } from "../lib/notify.js";
import { sendEmail } from "../lib/mailer.js";
import { isoDate } from "../lib/isodate.js";

const router = Router();

/* GET /api/bookings — role-aware */
router.get("/", requireAuth, async (req, res) => {
  try {
    let result;
    /* Who the company IS travels with the booking.

       The screens used to find it with companies.find(c => c.id ===
       b.company_id) against the list the app had loaded. For a customer that
       list is /companies?near=..., which is filtered by service area AND by
       is_listed AND by is_approved. So a company that un-lists itself, changes
       its areas, or simply sits outside the address the customer is standing
       at drops out of the list — and every booking they already have loses its
       name and its logo. The booking was fine; the lookup had nothing to find.

       And because the app re-runs that filtered query on every refresh, the
       logo was there, then gone, which is exactly what Musa kept seeing.

       The service already travels this way, as service_snapshot. The company
       now does too. */
    if (req.user.role === "customer") {
      result = await query(
        `SELECT b.*, u.full_name AS assigned_name,
                c.name AS company_name, c.logo_url AS company_logo_url,
                c.emoji AS company_emoji, c.contact_phone AS company_phone
         FROM bookings b
         LEFT JOIN users u ON u.id = b.assigned_to
         LEFT JOIN companies c ON c.id = b.company_id
         WHERE b.customer_id = $1
         ORDER BY b.created_at DESC`,
        [req.user.id]
      );
    } else if (req.user.role === "employee") {
      result = await query(
        /* The customer's phone travels with the job.

           The cleaner's card now offers Call alongside the directions, and a
           Call button with nothing behind it is worse than no button. The
           company's list has carried this for a while; the person actually
           standing at the door did not. */
        `SELECT b.*, cu.full_name AS customer_name, cu.phone AS customer_phone,
                c.name AS company_name, c.logo_url AS company_logo_url,
                c.emoji AS company_emoji
         FROM bookings b
         LEFT JOIN users cu ON cu.id = b.customer_id
         LEFT JOIN companies c ON c.id = b.company_id
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

  /* The HOUR, not just the day.

     Only the date was checked, so at one o'clock in the afternoon you could
     still book eight that morning. The booking was accepted, the slot counted
     against the company's capacity, and a job appeared that had already been
     and gone before anyone agreed to it.

     slotTime() comes from the reminder engine rather than being worked out
     again here — it already knows about Budapest's offset and daylight saving,
     and two versions of "when does this start" would drift apart the first time
     the clocks changed.

     BOOKING_LEAD_MIN is the head start a company gets. An hour by default:
     nobody dispatches a cleaner in ten minutes, and a booking that arrives
     with no time to answer it is a complaint waiting to happen. Set it to 0 if
     you would rather take same-hour work. */
  if (scheduledSlot) {
    const { slotTime } = await import("../lib/reminders.js");
    const starts = slotTime(dOnly, scheduledSlot);
    const leadMin = Math.max(0, Number(process.env.BOOKING_LEAD_MIN ?? 60));
    if (starts && starts.getTime() <= Date.now())
      return res.status(400).json({ error: "That time has already passed — please pick a later one." });
    if (starts && starts.getTime() < Date.now() + leadMin * 60000)
      return res.status(400).json({ error: `Please pick a time at least ${leadMin} minutes from now, so the company can get there.` });
  }

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

    /* Opening hours, blocked slots and capacity — one check, shared with the
       move-a-visit flow so the two can never disagree about what "available"
       means. See server/lib/availability.js. */
    {
      const why = await slotProblem({
        co, svc, companyId, serviceId, date: dOnly, slot: scheduledSlot, hours,
      });
      if (why) return res.status(400).json({ error: why });
    }

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

    /* One active subscription chain per customer per service — prevents
       double-charging chains.

       But a plan you never managed to PAY for is not one you have. The old
       clause counted any subscription booking at status 0-3, and a booking
       whose card was declined sits at status 0 forever: the customer was told
       "you already have an active subscription — cancel it first", for a
       subscription that had never started. There is nothing to cancel and no
       way forward, so the second attempt fails as surely as the first, and it
       looks like the payment bug striking twice.

       An unpaid booking is a dead attempt. Only a paid one, or one the company
       has already acted on, blocks a new plan. */
    if (svc.pricing_type === "subscription") {
      const dup = await query(
        `SELECT 1 FROM bookings
         WHERE customer_id = $1 AND service_id = $2 AND pricing_type = 'subscription'
           AND status BETWEEN 0 AND 3
           AND (payment_status IN ('paid','scheduled','retry') OR status > 0)
         LIMIT 1`,
        [req.user.id, serviceId]
      );
      if (dup.rows.length)
        return res.status(400).json({ error: "You already have an active subscription for this service — cancel it first under Bookings." });

      /* And clear the dead attempts out of the way, so the customer's own list
         does not fill up with plans that never began. */
      /* cancelled_at belongs to the subscriptions table, not this one — every
         other cancellation here is status 9 and nothing else. Writing a column
         that does not exist would have thrown, and a .catch() would have
         swallowed it in silence, which is how the last three bugs like this
         survived. So: no catch, and status alone. */
      await query(
        `UPDATE bookings SET status = 9
         WHERE customer_id = $1 AND service_id = $2 AND pricing_type = 'subscription'
           AND status = 0 AND payment_status NOT IN ('paid','scheduled','retry')`,
        [req.user.id, serviceId]
      );
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
    let companyShare = gross - discount;

    /* The floor, applied where every discount finally lands.

       Services are checked when they are priced, but three separate discounts
       meet here — the service's own offer, the company promo, and the student
       rate — and any of them can take the charge below the point where our
       commission covers Stripe's cut. Past that point the shortfall comes out
       of the PARTNER's money, which is exactly what Partner Terms 3.4 says
       cannot happen.

       The discount is trimmed rather than the booking refused. Refusing would
       punish a customer for a number the company chose, and the alternative —
       letting it through — quietly pays the partner less than they listed. The
       customer still gets the largest discount that can actually be honoured. */
    {
      const { minimumServicePriceHuf } = await import("./payments.js");
      const floor = minimumServicePriceHuf();
      if (Number.isFinite(floor) && gross >= floor && companyShare < floor) {
        companyShare = floor;
        console.warn("discount trimmed to keep the partner whole:", serviceId, gross, "->", companyShare);
      }
    }

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
    : isoDate(dateStr);
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
      /* Cancelling does NOT move money on its own.

         It used to refund the moment the customer pressed cancel. That is one
         irreversible act triggered by another, with nobody looking: a mistaken
         tap, a change of mind two minutes later, a customer who cancels the
         wrong booking — all of it money already gone, and gone through Stripe,
         where getting it back is not a matter of pressing undo.

         So the booking is cancelled and the payment stays put. If they paid, a
         refund REQUEST is raised for them in the report system, where a person
         reads it and decides. The customer does not have to know to ask; the
         request appears on its own, attached to the booking, with the amount
         already on it. */
      if (b.payment_status === "paid") {
        try {
          const amount = Number(b.total_huf) || 0;
          await query(
            `INSERT INTO complaints (user_id, booking_id, subject, body)
             VALUES ($1, $2, $3, $4)`,
            [req.user.id, b.id, "Refund request — booking cancelled",
             `The customer cancelled this booking in time and has asked for the ${amount} Ft they paid to be returned. `
             + `Nothing has been refunded automatically. Approve or decline it here.`]);
          const oc = await query("SELECT owner_id FROM companies WHERE id = $1", [b.company_id]);
          if (oc.rows[0]) await notify(oc.rows[0].owner_id, "complaint",
            "A cancelled booking is waiting on a refund decision",
            "A customer cancelled in time and asked for their money back. Nothing has been refunded yet.", b.id).catch(() => {});
        } catch (e) { console.error("refund request on cancel:", e.message); }
      }
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
    const saved = { name: String(invoice.name).slice(0, 120), type: String(invoice.type || "application/pdf").slice(0, 80), data: invoice.data };
    const r = await query("UPDATE bookings SET invoice = $1 WHERE id = $2 RETURNING *",
      [JSON.stringify(saved), req.params.id]);

    /* Send it to the customer.

       The invoice was stored and nothing else happened. The company uploaded
       a document, the app said nothing had gone wrong, and the customer only
       ever found it if they went back into a finished booking and looked. An
       invoice that nobody is told about is not an invoice.

       Attached AND downloadable in the app: the attachment is what an
       accountant forwards, the app copy is what survives a lost email. */
    (async () => {
      try {
        const who = await query(
          `SELECT cu.email, cu.full_name, c.name AS company_name, b.order_no, b.scheduled_date, b.total_huf, b.service_snapshot
             FROM bookings b JOIN users cu ON cu.id = b.customer_id JOIN companies c ON c.id = b.company_id
            WHERE b.id = $1`, [req.params.id]);
        const w = who.rows[0];
        if (!w?.email) return;
        const svcName = (w.service_snapshot && w.service_snapshot.name) || "your cleaning";
        const base64 = String(saved.data).includes(",") ? String(saved.data).split(",").pop() : String(saved.data);
        await sendEmail(w.email,
          `Your invoice from ${w.company_name}${w.order_no ? ` — #${w.order_no}` : ""}`,
          `<div style="font-family:sans-serif;max-width:520px">
             <h2 style="color:#1B2A6B">Your invoice is ready</h2>
             <p>${w.company_name} has issued the invoice for <b>${svcName}</b> on ${isoDate(w.scheduled_date)}.</p>
             <p>It is attached, and it is also in the Cleano app under that booking.</p>
           </div>`,
          [{ filename: saved.name, content: base64 }]);
        await notify(r.rows[0].customer_id, "invoice", "Your invoice is ready 🧾",
          `${w.company_name} has sent the invoice for ${svcName}.`, req.params.id);
      } catch (e) { console.error("invoice email:", e.message); }
    })();

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

/* ════════════════════════════════════════════════════════════
   MOVING ONE VISIT

   A customer who cannot make Tuesday should not have to cancel a plan to
   escape it, and a company should not be handed a date it cannot work. So
   neither side sets the new date alone: the customer offers two or three they
   could manage, and the company takes whichever one it can actually serve.

   Nothing about the money moves. The visit keeps its price, its payment and
   its place in the plan — only the day and the hour change. The visits either
   side of it are untouched, because each occurrence is its own booking.
════════════════════════════════════════════════════════════ */

const MAX_OPTIONS = 3;

function openRequest(b) {
  const r = b?.reschedule;
  const v = typeof r === "string" ? (() => { try { return JSON.parse(r); } catch { return null; } })() : r;
  return v && v.status === "pending" ? v : null;
}

/* POST /api/bookings/:id/reschedule — the customer proposes dates */
router.post("/:id/reschedule", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    if (!(await hasColumn("bookings", "reschedule")))
      return res.status(503).json({ error: "Moving a visit is not available yet — the database is still being updated." });

    const bq = await query("SELECT * FROM bookings WHERE id = $1", [req.params.id]);
    const b = bq.rows[0];
    if (!b) return res.status(404).json({ error: "Booking not found" });
    if (b.customer_id !== req.user.id) return res.status(403).json({ error: "Forbidden" });
    if (Number(b.status) > 1) return res.status(400).json({ error: "The work has already started — call the company instead." });
    if ([8, 9].includes(Number(b.status))) return res.status(400).json({ error: "That booking is no longer active." });
    if (openRequest(b)) return res.status(400).json({ error: "You have already asked to move this visit — wait for the company, or withdraw it first." });

    const { slotTime } = await import("../lib/reminders.js");
    const leadMs = Math.max(0, Number(process.env.BOOKING_LEAD_MIN ?? 60)) * 60000;
    const farLimit = new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10);

    const raw = Array.isArray(req.body?.options) ? req.body.options : [];
    const seen = new Set();
    const options = [];
    for (const o of raw.slice(0, MAX_OPTIONS)) {
      const date = String(o?.date || "").slice(0, 10);
      const slot = String(o?.slot || "").slice(0, 5);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(slot)) continue;
      const key = date + slot;
      if (seen.has(key)) continue;                       // the same day twice is one option
      if (date === isoDate(b.scheduled_date) && slot === String(b.scheduled_slot || "").slice(0, 5)) continue;
      if (date < new Date().toISOString().slice(0, 10)) continue;
      /* The same two limits the booking endpoint enforces, which this route did
         not: the HOUR, and how far ahead.

         Only the date was compared, so proposing today at 06:00 at two in the
         afternoon slipped through — the very bug we fixed on the booking form,
         reappearing on the road that goes round it. And nothing capped the far
         end, so a customer could offer a date in 2031 and a company clicking
         through its options could park a paid job there indefinitely. */
      const starts = slotTime(date, slot);
      if (starts && starts.getTime() < Date.now() + leadMs) continue;
      if (date > farLimit) continue;
      seen.add(key);
      options.push({ date, slot });
    }
    if (options.length < 2)
      return res.status(400).json({ error: "Offer at least two different dates, so the company has a real choice." });

    /* Checked here as well as when the company answers. Offering a day the
       company is closed wastes both people's time, and the customer is the one
       who can still change it. */
    const co = (await query("SELECT * FROM companies WHERE id = $1", [b.company_id])).rows[0];
    const svc = (await query("SELECT * FROM services WHERE id = $1", [b.service_id])).rows[0];
    const checked = [];
    for (const o of options) {
      const why = await slotProblem({
        co, svc, companyId: b.company_id, serviceId: b.service_id,
        date: o.date, slot: o.slot, hours: b.hours, excludeBookingId: b.id,
      });
      checked.push({ ...o, ok: !why, why: why || null });
    }
    if (!checked.some((o) => o.ok))
      return res.status(400).json({ error: "None of those times work for this company — try other days.", options: checked });

    const request = {
      status: "pending",
      options: checked,
      note: String(req.body?.note || "").slice(0, 300) || null,
      from: { date: isoDate(b.scheduled_date), slot: b.scheduled_slot || null },
      requested_at: new Date().toISOString(),
    };
    await query("UPDATE bookings SET reschedule = $1 WHERE id = $2", [JSON.stringify(request), b.id]);

    const oc = await query("SELECT owner_id FROM companies WHERE id = $1", [b.company_id]);
    if (oc.rows[0]) await notify(oc.rows[0].owner_id, "reschedule",
      "A customer wants to move a visit",
      `${checked.filter((o) => o.ok).length} alternative dates offered for ${request.from.date}. Pick the one that suits you.`,
      b.id).catch(() => {});

    res.json({ ok: true, reschedule: request });
  } catch (e) {
    console.error("reschedule request:", e.message);
    res.status(500).json({ error: "Could not send that request" });
  }
});

/* DELETE /api/bookings/:id/reschedule — the customer changes their mind */
router.delete("/:id/reschedule", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    if (!(await hasColumn("bookings", "reschedule"))) return res.json({ ok: true });
    const bq = await query("SELECT * FROM bookings WHERE id = $1", [req.params.id]);
    const b = bq.rows[0];
    if (!b) return res.status(404).json({ error: "Booking not found" });
    if (b.customer_id !== req.user.id) return res.status(403).json({ error: "Forbidden" });
    if (!openRequest(b)) return res.json({ ok: true });
    await query("UPDATE bookings SET reschedule = NULL WHERE id = $1", [b.id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Could not withdraw that request" }); }
});

/* PUT /api/bookings/:id/reschedule — the company picks one, or declines */
router.put("/:id/reschedule", requireAuth, requireRole("company"), async (req, res) => {
  try {
    if (!(await hasColumn("bookings", "reschedule")))
      return res.status(503).json({ error: "Moving a visit is not available yet — the database is still being updated." });

    const bq = await query("SELECT * FROM bookings WHERE id = $1", [req.params.id]);
    const b = bq.rows[0];
    if (!b) return res.status(404).json({ error: "Booking not found" });
    if (b.company_id !== req.user.companyId) return res.status(403).json({ error: "Forbidden" });
    const request = openRequest(b);
    if (!request) return res.status(400).json({ error: "There is no open request on this booking." });

    if (req.body?.decline === true) {
      const done = { ...request, status: "declined", reason: String(req.body?.reason || "").slice(0, 300) || null, decided_at: new Date().toISOString() };
      await query("UPDATE bookings SET reschedule = $1 WHERE id = $2", [JSON.stringify(done), b.id]);
      await notify(b.customer_id, "reschedule", "Your visit stays as it is",
        `${b.company_name || "The company"} could not make any of the dates you offered. Your visit on ${isoDate(b.scheduled_date)} is unchanged.`,
        b.id).catch(() => {});
      return res.json({ ok: true, booking: b, reschedule: done });
    }

    /* The index must be a real number, not something that COERCES to one.

       Number("") is 0. So is Number(null), Number(false) and Number([]). With a
       plain Number() cast, a request that forgot to send a choice at all — or
       sent an empty field — silently selected the customer's first option and
       moved their booking. Accepting "0" is harmless in itself; accepting
       "nothing" as "the first one" is not. */
    const rawChoice = req.body?.choice;
    const i = typeof rawChoice === "number" ? rawChoice : NaN;
    const pick = Number.isInteger(i) && i >= 0 && i < (request.options || []).length ? request.options[i] : null;
    if (!pick) return res.status(400).json({ error: "Pick one of the dates the customer offered." });

    /* Re-checked here too. An option validated on Monday can be in the past by
       the time the company gets round to answering on Friday, and a request
       that has sat unanswered must not become a way to book a slot that has
       already gone. */
    {
      const { slotTime } = await import("../lib/reminders.js");
      const starts = slotTime(pick.date, pick.slot);
      const lead = Math.max(0, Number(process.env.BOOKING_LEAD_MIN ?? 60)) * 60000;
      if (starts && starts.getTime() < Date.now() + lead)
        return res.status(400).json({ error: "That time has passed since it was offered — ask the customer for new dates." });
    }

    /* Re-check at the moment of the decision. The options were validated when
       they were offered, and the company may have taken other work since. */
    const co = (await query("SELECT * FROM companies WHERE id = $1", [b.company_id])).rows[0];
    const svc = (await query("SELECT * FROM services WHERE id = $1", [b.service_id])).rows[0];
    const why = await slotProblem({
      co, svc, companyId: b.company_id, serviceId: b.service_id,
      date: pick.date, slot: pick.slot, hours: b.hours, excludeBookingId: b.id,
    });
    if (why) return res.status(400).json({ error: why });

    const done = { ...request, status: "moved", chosen: { date: pick.date, slot: pick.slot }, decided_at: new Date().toISOString() };
    const upd = await query(
      "UPDATE bookings SET scheduled_date = $1, scheduled_slot = $2, reschedule = $3 WHERE id = $4 RETURNING *",
      [pick.date, pick.slot, JSON.stringify(done), b.id]);

    await notify(b.customer_id, "reschedule", "Your visit has been moved",
      `It is now ${pick.date} at ${pick.slot}. Nothing has been charged again.`, b.id).catch(() => {});

    res.json({ ok: true, booking: upd.rows[0], reschedule: done });
  } catch (e) {
    console.error("reschedule decide:", e.message);
    res.status(500).json({ error: "Could not update that booking" });
  }
});

export default router;
