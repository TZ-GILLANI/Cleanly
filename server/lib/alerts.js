import { sendEmail } from "./mailer.js";

/* ── Error monitoring & CEO alerts (2.4) ─────────────────────────────
   No external vendor: alerts go to the CEO inbox via the existing mailer.
   - alert():       fire-and-forget email, de-duplicated (same key ≤ 1/hour)
   - paymentAlert():dedicated wrapper for money events — these cost trust
   - wire():        process-level uncaught/unhandled hooks + weekly digest  */

const CEO = process.env.ALERT_EMAIL || "musagillani@tzmanufacturing.com";
const recent = new Map();            // key -> last sent ms
const counters = { errors: 0, paymentFails: 0, bookings: 0 };

export function bumpCounter(k) { if (k in counters) counters[k]++; }

export function alert(key, subject, detail) {
  try {
    const now = Date.now();
    if ((recent.get(key) || 0) > now - 3600e3) return;   // ≤1 email per key per hour
    recent.set(key, now);
    counters.errors++;
    const body = `<div style="font-family:monospace;font-size:13px;white-space:pre-wrap">${
      String(detail || "").slice(0, 4000).replace(/</g, "&lt;")}</div>
      <p style="font-family:sans-serif;color:#666">Cleano server · ${new Date().toISOString()}</p>`;
    sendEmail(CEO, `⚠️ Cleano: ${subject}`, body);
  } catch { /* alerting must never crash the app */ }
}

export function paymentAlert(kind, detail) {
  counters.paymentFails++;
  alert("pay:" + kind, `PAYMENT ${kind}`, detail);
}

export function wire() {
  /* Node crashes on an uncaught exception by default, and that default exists
     for a good reason: after one, the process state is undefined — a half-run
     handler may have left a transaction open or a lock held. Installing a
     listener silently turns that safety off, which is what happened here: the
     server kept answering /api/health from a broken state, so Render's health
     check never restarted it, and in the test suite a fatal error became an
     infinite hang instead of a failure. Twice today.

     So: alert, then let the process die and be replaced. Render restarts it in
     seconds; a corrupted one can run for days. */
  process.on("uncaughtException", (e) => {
    alert("uncaught", "uncaught exception", e?.stack || e);
    console.error("uncaught exception — exiting so a clean instance replaces this one:", e?.stack || e);
    setTimeout(() => process.exit(1), 1200);
  });
  process.on("unhandledRejection", (e) => {
    alert("unhandled", "unhandled rejection", e?.stack || e);
    console.error("unhandled rejection:", e?.stack || e);
  });
  // weekly digest — Monday ~07:00 server time
  setInterval(() => {
    const d = new Date();
    if (d.getUTCDay() === 1 && d.getUTCHours() === 6) {
      sendEmail(CEO, "Cleano weekly digest",
        `<p>Errors: ${counters.errors} · Payment failures: ${counters.paymentFails} · Bookings created: ${counters.bookings}</p>`);
      counters.errors = counters.paymentFails = counters.bookings = 0;
    }
  }, 55 * 60 * 1000);
}
