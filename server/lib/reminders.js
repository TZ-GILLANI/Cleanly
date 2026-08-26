import { query } from "../db.js";
import { notify } from "./notify.js";
import { sendEmail } from "./mailer.js";
import { refundBookingPayment } from "../routes/payments.js";
import { isoDate } from "./isodate.js";

/* ── Day-of reminders ──────────────────────────────────────────────
   Runs every 5 minutes.

   • Customer  → ~40 minutes before their cleaning starts.
   • Company   → at the start time of each of today's bookings, one per booking,
                 so a company with 5 jobs today gets 5 timely nudges.

   Each reminder is stamped on the booking so it can never fire twice.
   Safe no-op when the app has no bookings or the mailer is dormant.        */

const MIN = 60 * 1000;

/* Booking times are HUNGARIAN local times, but the server runs in UTC.
   Parse "2026-07-27" + "14:30" as Europe/Budapest, DST handled. */
function budapestOffsetMs(dateStr) {
  try {
    const probe = new Date(`${dateStr}T12:00:00Z`);
    const fmt = new Intl.DateTimeFormat("en", { timeZone: "Europe/Budapest", timeZoneName: "shortOffset" });
    const part = fmt.formatToParts(probe).find((p) => p.type === "timeZoneName")?.value || "GMT+2";
    const m = part.match(/([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return 2 * 3600e3;
    const sign = m[1] === "-" ? -1 : 1;
    return sign * ((Number(m[2]) * 60 + Number(m[3] || 0)) * 60e3);
  } catch { return 2 * 3600e3; }
}
/* When a slot actually starts, in real time.

   Exported because the booking endpoint needs the same answer: "has this hour
   already gone?" is the same question as "when does this job begin", and two
   versions of it would drift the moment one of them learned about daylight
   saving and the other did not. */
export function slotTime(dateVal, slot) {
  try {
    const d = dateVal instanceof Date ? dateVal.toISOString().slice(0, 10) : isoDate(dateVal);
    const hm = String(slot || "09:00").match(/(\d{1,2}):(\d{2})/);
    if (!hm) return null;
    const utcMs = Date.parse(`${d}T${hm[1].padStart(2, "0")}:${hm[2]}:00Z`) - budapestOffsetMs(d);
    return isNaN(utcMs) ? null : new Date(utcMs);
  } catch { return null; }
}

/* The moment an unaccepted booking dies.

   A paid booking at status 0 is auto-cancelled and refunded when EITHER the
   company has sat on it for ACCEPT_TIMEOUT_H, OR the job itself is less than
   12 hours away — whichever comes first. The company could not see this clock
   at all, which meant losing paid work to a deadline nobody had mentioned. It
   is exported so the app can show the countdown, and used by the sweep below
   so the number on screen and the number enforced can never drift apart. */
/* When the company loses the job for not answering.

   This took the EARLIER of two times: twelve hours from booking, and twelve
   hours before the job starts. For anything booked less than twelve hours
   ahead — a Friday evening booking for Saturday morning, which is most of the
   short-notice work — the second was already in the past, so the deadline had
   expired before the company's phone finished buzzing. The sweep then
   cancelled and refunded on its next tick, and the partner saw an empty list
   and assumed the app was broken.

   A cutoff that has passed before anyone can act on it is not a cutoff, it is
   a bug. So: the company always gets ACCEPT_MIN_H to answer — never less,
   whatever the arithmetic says — bounded only by the job actually starting. */
export function acceptDeadline(b) {
  try {
    const killH = Number(process.env.ACCEPT_TIMEOUT_H || 12);
    const leadH = Number(process.env.ACCEPT_LEAD_H || 12);
    const minH  = Number(process.env.ACCEPT_MIN_H || 3);
    const created = new Date(b.created_at).getTime();
    if (isNaN(created)) return null;
    const start = slotTime(b.scheduled_date, b.scheduled_slot);

    const byAge   = created + killH * 3600e3;
    const byStart = start ? start.getTime() - leadH * 3600e3 : Infinity;
    let at = Math.min(byAge, byStart);

    /* The floor: however tight the job is, they get a real chance to say yes. */
    at = Math.max(at, created + minH * 3600e3);
    /* The ceiling: never past the moment the cleaner was due to arrive. */
    if (start) at = Math.min(at, start.getTime());

    return Number.isFinite(at) ? new Date(at).toISOString() : null;
  } catch { return null; }
}

async function todaysBookings() {
  const r = await query(
    `SELECT b.id, b.scheduled_date, b.scheduled_slot, b.address, b.customer_id, b.company_id,
            b.service_snapshot, b.status, b.assigned_to, b.reminder_customer_at, b.reminder_company_at, b.reminder_cleaner_at,
            cu.email AS customer_email, cu.full_name AS customer_name,
            co.name AS company_name, ow.id AS owner_id, ow.email AS owner_email
     FROM bookings b
     LEFT JOIN users cu ON cu.id = b.customer_id
     LEFT JOIN companies co ON co.id = b.company_id
     LEFT JOIN users ow ON ow.id = co.owner_id
     WHERE b.scheduled_date = CURRENT_DATE
       AND b.status NOT IN (4, 8, 9)`
  );
  return r.rows;
}

export async function runReminders() {
  let rows;
  try { rows = await todaysBookings(); } catch { return; }   // table not ready yet
  const now = Date.now();

  for (const b of rows) {
    const start = slotTime(b.scheduled_date, b.scheduled_slot);
    if (!start) continue;
    const svcName = b.service_snapshot?.name || "Cleaning";
    const when = b.scheduled_slot || "";

    // ── customer: 40 minutes before (fires inside a 40→0 min window) ──
    if (!b.reminder_customer_at) {
      const minsAway = (start.getTime() - now) / MIN;
      if (minsAway <= 40 && minsAway > -5) {
        try {
          await query("UPDATE bookings SET reminder_customer_at = NOW() WHERE id = $1 AND reminder_customer_at IS NULL", [b.id]);
          await notify(b.customer_id, "reminder", "Your cleaning is today",
            `${svcName} at ${when}${b.company_name ? " · " + b.company_name : ""}.`, b.id);
          if (b.customer_email) sendEmail(b.customer_email, `Reminder: your Cleano cleaning today at ${when}`,
            `<div style="font-family:sans-serif;max-width:520px"><h2 style="color:#1B2A6B">See you soon${b.customer_name ? ", " + b.customer_name : ""}!</h2>
             <p><b>${svcName}</b><br/>Today at ${when}<br/>${String(b.address || "").slice(0, 120)}</p></div>`);
        } catch (e) { console.error("customer reminder:", e.message); }
      }
    }

    // ── cleaner: 40 minutes before their assigned job ──
    if (!b.reminder_cleaner_at && b.assigned_to) {
      const minsAway = (start.getTime() - now) / MIN;
      if (minsAway <= 40 && minsAway > -5) {
        try {
          await query("UPDATE bookings SET reminder_cleaner_at = NOW() WHERE id = $1 AND reminder_cleaner_at IS NULL", [b.id]);
          await notify(b.assigned_to, "reminder", "Job in ~40 minutes 🧹",
            `${svcName} at ${when} · ${String(b.address || "").slice(0, 80)}`, b.id);
        } catch (e) { console.error("cleaner reminder:", e.message); }
      }
    }

    // ── company: at the booking's start time, one nudge per booking ──
    if (!b.reminder_company_at && b.owner_id) {
      const minsPast = (now - start.getTime()) / MIN;
      if (minsPast >= 0 && minsPast < 30) {
        try {
          await query("UPDATE bookings SET reminder_company_at = NOW() WHERE id = $1 AND reminder_company_at IS NULL", [b.id]);
          await notify(b.owner_id, "reminder", `Job starting now — ${when}`,
            `${svcName} · ${String(b.address || "").slice(0, 80)}`, b.id);
        } catch (e) { console.error("company reminder:", e.message); }
      }
    }
  }
}


/* ── 5.11 Unaccepted bookings must not hang forever ──────────────────
   A paid booking sitting at status 0 means the customer's money is taken and
   nobody has agreed to come. Nudge the company, then auto-cancel + refund.
   Env-tunable: ACCEPT_NUDGE_H (2), ACCEPT_TIMEOUT_H (12).                */
export async function sweepUnaccepted() {
  const nudgeH = Number(process.env.ACCEPT_NUDGE_H || 2);
  const killH = Number(process.env.ACCEPT_TIMEOUT_H || 12);
  let rows;
  try {
    const r = await query(
      `SELECT b.*, c.owner_id, c.name AS company_name
         FROM bookings b JOIN companies c ON c.id = b.company_id
        WHERE b.status = 0 AND b.scheduled_date >= (CURRENT_DATE - INTERVAL '1 day')
          AND b.payment_status IN ('paid','pending','unpaid')`);
    rows = r.rows;
  } catch { return; }
  const now = Date.now();
  for (const b of rows) {
    try {
      const created = new Date(b.created_at).getTime();
      const ageH = (now - created) / 3600e3;
      const start = slotTime(b.scheduled_date, b.scheduled_slot);
      const hoursToStart = start ? (start.getTime() - now) / 3600e3 : 999;

      // 1) nudge once
      if (ageH >= nudgeH && !b.accept_nudged_at) {
        await query("UPDATE bookings SET accept_nudged_at = NOW() WHERE id = $1 AND accept_nudged_at IS NULL", [b.id]);
        await notify(b.owner_id, "reminder", "A booking is waiting for you",
          "A customer is waiting for you to accept a booking. If you can't take it, decline so they can rebook.", b.id);
      }
      /* 1b) An abandoned checkout dies quickly, not at its own start time.

         acceptDeadline is about a COMPANY that has not answered, and it has a
         three-hour floor and a ceiling at the slot start. For a booking nobody
         paid for, both are wrong: the company cannot even see an unpaid job, so
         it is not failing to answer — and waiting until the cleaner was due to
         arrive means the customer sits looking at a booking that was never real
         while the hour goes by.

         The same grace the capacity count already uses: long enough to finish
         typing a card, short enough not to squat on a slot. After that the row
         is released and the customer is told plainly, so they can try again. */
      const graceMin = Math.max(5, Number(process.env.CHECKOUT_GRACE_MIN || 30));
      const unpaid = b.payment_status === "unpaid" || b.payment_status === "pending";
      if (unpaid && ageH * 60 >= graceMin) {
        await query("UPDATE bookings SET status = 9, decline_reason = $1 WHERE id = $2 AND status = 0 AND payment_status IN ('unpaid','pending')",
          ["auto-cancelled: payment was not completed", b.id]);
        await notify(b.customer_id, "cancelled", "Booking cancelled — not paid",
          "The payment for this booking was not completed, so we released the time. Nothing was charged — book again whenever you like.", b.id);
        continue;
      }

      // 2) auto-cancel + refund — same rule the company sees counting down
      const deadline = acceptDeadline(b);
      /* acceptDeadline is the single source of truth. The fallback only runs if
         it could not be computed at all, and it must not re-introduce the
         "already expired" rule it exists to replace. */
      if (deadline ? now >= Date.parse(deadline) : (ageH >= killH && ageH >= Number(process.env.ACCEPT_MIN_H || 3))) {
        // Try to refund, but never let a payment-provider failure keep the customer
        // trapped in a booking nobody is coming to. Cancel first, shout about the money.
        if (b.payment_status === "paid") {
          try { await refundBookingPayment(b, 100); }
          catch (e) {
            console.error("auto-cancel refund failed:", e.message);
            try {
              const { paymentAlert } = await import("./alerts.js");
              paymentAlert("auto-cancel refund failed", `booking ${b.id} (${b.company_name}) was auto-cancelled but the refund did not go through: ${e.message}`);
            } catch {}
          }
        }
        await query("UPDATE bookings SET status = 9, decline_reason = $1 WHERE id = $2 AND status = 0",
          ["auto-cancelled: company did not respond", b.id]);
        await notify(b.customer_id, "cancelled", "Booking cancelled — refunded",
          `${b.company_name} didn't confirm in time, so we cancelled it and refunded you in full. Other companies are available.`, b.id);
        await notify(b.owner_id, "cancelled", "Booking auto-cancelled",
          "You didn't respond in time, so a booking was cancelled and the customer refunded.", b.id);
      }
    } catch (e) { console.error("sweepUnaccepted:", e.message); }
  }
}

let timer = null;
export function startReminders() {
  if (timer) return;
  const tick = () => runReminders().then(sweepUnaccepted).catch((e) => console.error("reminders:", e.message));
  timer = setInterval(tick, 5 * MIN);
  setTimeout(tick, 30 * 1000);   // first pass shortly after boot
  console.log("   ⏰ Day-of reminders scheduler started (every 5 min)");
}
