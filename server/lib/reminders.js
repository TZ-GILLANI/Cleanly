import { query } from "../db.js";
import { notify } from "./notify.js";
import { sendEmail } from "./mailer.js";

/* ── Day-of reminders ──────────────────────────────────────────────
   Runs every 5 minutes.

   • Customer  → ~40 minutes before their cleaning starts.
   • Company   → at the start time of each of today's bookings, one per booking,
                 so a company with 5 jobs today gets 5 timely nudges.

   Each reminder is stamped on the booking so it can never fire twice.
   Safe no-op when the app has no bookings or the mailer is dormant.        */

const MIN = 60 * 1000;

/* "2026-07-27" + "14:30" → Date (server timezone) */
function slotTime(dateVal, slot) {
  try {
    const d = dateVal instanceof Date ? dateVal.toISOString().slice(0, 10) : String(dateVal).slice(0, 10);
    const hm = String(slot || "09:00").match(/(\d{1,2}):(\d{2})/);
    if (!hm) return null;
    const t = new Date(`${d}T${hm[1].padStart(2, "0")}:${hm[2]}:00`);
    return isNaN(t.getTime()) ? null : t;
  } catch { return null; }
}

async function todaysBookings() {
  const r = await query(
    `SELECT b.id, b.scheduled_date, b.scheduled_slot, b.address, b.customer_id, b.company_id,
            b.service_snapshot, b.status, b.reminder_customer_at, b.reminder_company_at,
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

let timer = null;
export function startReminders() {
  if (timer) return;
  const tick = () => runReminders().catch((e) => console.error("reminders:", e.message));
  timer = setInterval(tick, 5 * MIN);
  setTimeout(tick, 30 * 1000);   // first pass shortly after boot
  console.log("   ⏰ Day-of reminders scheduler started (every 5 min)");
}
