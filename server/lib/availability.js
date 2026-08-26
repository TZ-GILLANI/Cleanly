import { query } from "../db.js";
import { isoDate } from "./isodate.js";

/* CAN THIS COMPANY DO THIS SERVICE AT THIS TIME?

   One answer, in one place. It used to live inline inside POST /api/bookings —
   fine while booking was the only way a job could land on a date. It is not any
   more: a customer can now propose new dates for a visit and the company picks
   one, and if that path had its own idea of "available" the two would drift.
   That is the exact shape of the service-area bug — a listing that showed a
   company and a booking endpoint that then refused you.

   Returns a sentence to show the person, or null when the slot is fine.

   excludeBookingId matters for a move: the visit being moved must not count
   itself against the company's capacity. Without it a one-person company could
   never move a job at all — its own booking would block every alternative.   */
export async function slotProblem({ co, svc, companyId, serviceId, date, slot, hours, excludeBookingId = null }) {
  const dOnly = isoDate(date);
  const slotStr = String(slot || "").slice(0, 5);

  /* -- The company's own opening rules -- */
  const av = co?.availability;
  if (av) {
    if (av.paused) return "This company is not taking new bookings right now.";
    if (Array.isArray(av.closed) && av.closed.includes(dOnly))
      return "The company is closed on that date — please pick another day.";

    const dow = String(new Date(dOnly + "T12:00:00Z").getUTCDay());
    const rule = (av.days || {})[dow] || {};
    let offered = Array.isArray(rule.slots) ? rule.slots : null;
    if (!offered && rule.from && rule.to) {
      offered = [];
      for (let h = 0; h < 24; h++) {
        const t = String(h).padStart(2, "0") + ":00";
        if (t >= rule.from && t < rule.to) offered.push(t);
      }
    }
    if (rule.on === false || (offered && offered.length === 0))
      return "The company doesn't work on that day — please pick another.";

    if (slotStr) {
      const blocked = (av.busy || {})[dOnly];
      if (Array.isArray(blocked) && blocked.includes(slotStr))
        return "That time slot is already taken — please pick another.";
      /* Per-service block: cleaning can be full at 10:00 while laundry is free. */
      const svcBlocked = ((av.busyServices || {})[serviceId] || {})[dOnly];
      if (Array.isArray(svcBlocked) && svcBlocked.includes(slotStr))
        return "That time is already taken for this service — please pick another.";
      if (offered && !offered.includes(slotStr))
        return "The company doesn't offer that time — please pick one of their available hours.";
    }
  }

  /* -- Capacity: a company can only be in as many places at once as it has
     people. Counted per service, over the hours a job actually lasts. -- */
  const capRow = await query(
    `SELECT GREATEST(1, COUNT(*)::int) AS n FROM users
      WHERE company_id = $1 AND role::text = 'employee'
        AND approval_status::text = 'approved' AND is_active IS NOT false`, [companyId]);
  const cap = svc?.slot_capacity != null ? Number(svc.slot_capacity) : capRow.rows[0].n;

  const graceMin = Math.max(5, Number(process.env.CHECKOUT_GRACE_MIN || 30));
  const mins = (b) => {
    const h = Number(b?.hours);
    if (Number.isFinite(h) && h > 0) return Math.round(h * 60);
    const m = Number(b?.service_minutes ?? b?.minutes);
    return Number.isFinite(m) && m > 0 ? Math.round(m) : 60;
  };
  const startMin = (s) => {
    const [hh, mm] = String(s || "").slice(0, 5).split(":").map(Number);
    return Number.isFinite(hh) ? hh * 60 + (mm || 0) : null;
  };

  const sameDay = await query(
    `SELECT b.id, b.scheduled_slot, b.hours, s.minutes AS service_minutes
       FROM bookings b LEFT JOIN services s ON s.id = b.service_id
      WHERE b.company_id = $1 AND b.scheduled_date = $2
        AND b.service_id = $3 AND b.status NOT IN (8, 9)
        AND NOT (b.payment_status = 'unpaid' AND b.created_at < NOW() - ($4 || ' minutes')::interval)`,
    [companyId, dOnly, serviceId, String(graceMin)]);

  const wantFrom = startMin(slotStr);
  const wantTo = wantFrom == null ? null : wantFrom + mins({ hours, minutes: svc?.minutes });
  let overlapping = 0;
  if (wantFrom != null) {
    for (const r of sameDay.rows) {
      if (excludeBookingId && r.id === excludeBookingId) continue;
      const from = startMin(r.scheduled_slot);
      if (from == null) continue;
      const to = from + mins(r);
      if (wantFrom < to && from < wantTo) overlapping++;   // half-open ranges
    }
  }
  if (overlapping >= cap) return "That time has just been taken — please pick another.";

  return null;
}
