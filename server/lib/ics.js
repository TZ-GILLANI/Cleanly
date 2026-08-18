/* Calendar files (RFC 5545).

   Two things use this:
     • a single booking, downloaded once — "Add to my calendar"
     • a live feed the phone re-reads on its own, so a moved or cancelled
       booking updates in the calendar without anyone doing anything

   TIME ZONES — deliberate choice. A booking is a date plus a slot like "10:00"
   with no zone attached, because "ten o'clock" means ten o'clock where the
   cleaning happens. We therefore emit FLOATING time (no Z, no TZID), which every
   calendar app reads as local time on the device. The customer, the company and
   the cleaner are in the same city, so this is both simpler and more correct
   than guessing a zone and being wrong for anyone who travels.                */

const CRLF = "\r\n";

/* RFC 5545 §3.3.11 — commas, semicolons, backslashes and newlines are special. */
function esc(v) {
  return String(v == null ? "" : v)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/* Lines longer than 75 octets must be folded, or strict parsers reject the file. */
function fold(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 73) return line;
  const out = [];
  let cur = Buffer.alloc(0);
  for (const ch of [...line]) {
    const b = Buffer.from(ch, "utf8");
    if (cur.length + b.length > 73) { out.push(cur.toString("utf8")); cur = Buffer.alloc(0); }
    cur = Buffer.concat([cur, b]);
  }
  if (cur.length) out.push(cur.toString("utf8"));
  return out.join(CRLF + " ");
}

const pad = (n) => String(n).padStart(2, "0");

/* YYYYMMDDTHHMMSS, floating (see the note above). */
function localStamp(dateStr, slot, addMinutes = 0) {
  // Postgres hands back a Date for DATE columns and a string elsewhere; both arrive here.
  const d = dateStr instanceof Date
    ? dateStr.toISOString().slice(0, 10)
    : String(dateStr).slice(0, 10);
  const [y, m, day] = d.split("-").map(Number);
  const [hh, mm] = String(slot || "09:00").split(":").map(Number);
  const t = new Date(Date.UTC(y, m - 1, day, hh || 0, mm || 0, 0));
  t.setUTCMinutes(t.getUTCMinutes() + addMinutes);
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}00`;
}

/* UTC stamp, for DTSTAMP / LAST-MODIFIED which must be absolute. */
function utcStamp(d = new Date()) {
  const t = new Date(d);
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}Z`;
}

/* Bumping SEQUENCE is what tells a calendar "this event changed, replace it".
   Without it a moved booking keeps showing at the old time forever. */
function sequenceOf(b) {
  const base = b.updated_at || b.created_at;
  if (!base) return 0;
  return Math.max(0, Math.floor(new Date(base).getTime() / 60000) % 2147483647);
}

/* One VEVENT. `role` decides how much detail we are allowed to show. */
export function bookingEvent(b, { role = "customer", domain = "cleano.hu" } = {}) {
  const minutes = Number(b.service_snapshot?.minutes) || Number(b.minutes) || 120;
  const svcName = b.service_snapshot?.name || "Cleaning";
  const cancelled = Number(b.status) === 9 || Number(b.status) === 8;

  const title = role === "customer"
    ? `${svcName}${b.company_name ? " · " + b.company_name : ""}`
    : `${svcName}${b.customer_name ? " · " + b.customer_name : ""}`;

  const lines = [];
  const desc = [];
  if (b.order_no != null) desc.push(`Booking #${b.order_no}`);
  if (role !== "customer" && b.customer_name) desc.push(`Customer: ${b.customer_name}`);
  if (role === "customer" && b.company_name) desc.push(`Company: ${b.company_name}`);
  if (role === "company" && b.assigned_name) desc.push(`Cleaner: ${b.assigned_name}`);
  /* Phone numbers only go to the people who need to turn up or let someone in. */
  if (role !== "customer" && b.customer_phone) desc.push(`Phone: ${b.customer_phone}`);
  if (b.note) desc.push(`Note: ${b.note}`);
  if (cancelled) desc.push("This booking was cancelled.");

  lines.push("BEGIN:VEVENT");
  lines.push(`UID:booking-${b.id}@${domain}`);
  lines.push(`DTSTAMP:${utcStamp()}`);
  lines.push(`DTSTART:${localStamp(b.scheduled_date, b.scheduled_slot)}`);
  lines.push(`DTEND:${localStamp(b.scheduled_date, b.scheduled_slot, minutes)}`);
  lines.push(`SUMMARY:${esc(title)}`);
  if (desc.length) lines.push(`DESCRIPTION:${esc(desc.join("\n"))}`);
  if (b.address) lines.push(`LOCATION:${esc(b.address)}`);
  lines.push(`STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`);
  lines.push(`SEQUENCE:${sequenceOf(b)}`);
  lines.push(`LAST-MODIFIED:${utcStamp(b.updated_at || b.created_at || new Date())}`);
  lines.push("TRANSP:OPAQUE");
  /* A quiet nudge an hour before. Cancelled events get no alarm. */
  if (!cancelled) {
    lines.push("BEGIN:VALARM");
    lines.push("ACTION:DISPLAY");
    lines.push("TRIGGER:-PT1H");
    lines.push(`DESCRIPTION:${esc(title)}`);
    lines.push("END:VALARM");
  }
  lines.push("END:VEVENT");
  return lines;
}

export function buildCalendar(bookings, { role = "customer", name = "Cleano", domain = "cleano.hu" } = {}) {
  const out = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cleano//Bookings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name)}`,
    "X-WR-TIMEZONE:Europe/Budapest",
    /* Ask subscribers to re-check every hour — this is what makes it "live". */
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const b of bookings) out.push(...bookingEvent(b, { role, domain }));
  out.push("END:VCALENDAR");
  return out.map(fold).join(CRLF) + CRLF;
}
