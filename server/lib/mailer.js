/* Email via Resend (resend.com — free tier 100/day).
   Dormant until env vars exist: RESEND_API_KEY, EMAIL_FROM (e.g. "Cleano <hello@yourdomain.hu>").
   For testing before a domain is verified, EMAIL_FROM can be "onboarding@resend.dev". */
export const mailerConfigured = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

let lastEmailAlert = 0;
async function flagFailure(status, detail) {
  try {
    if (Date.now() - lastEmailAlert < 30 * 60e3) return;   // at most one every half hour
    lastEmailAlert = Date.now();
    const { alert } = await import("./alerts.js");
    alert("email-down", "Cleano cannot send email",
      `Resend replied ${status || "no response"}.\n\n${String(detail || "").slice(0, 600)}\n\n` +
      "Password resets, approval emails and verification codes are not arriving. " +
      "Usual causes: the sending domain is not verified, or the daily quota is spent.");
  } catch { /* never let the reporter break the sender */ }
}

/* attachments: [{ filename, content }] where content is bare base64.
   Used for the partner's invoice, which the customer should receive rather than
   having to open the app and go looking for. */
export async function sendEmail(to, subject, html, attachments) {
  if (!mailerConfigured()) return { skipped: true };
  try {
    const payload = { from: process.env.EMAIL_FROM, to, subject, html };
    if (Array.isArray(attachments) && attachments.length) {
      /* Resend rejects the whole message if an attachment is oversized, which
         would lose the email as well as the file. Drop anything implausible and
         still send the text — the invoice is also in the app. */
      const ok = attachments.filter((a) => a && a.content && String(a.content).length * 0.75 < 8e6);
      if (ok.length) payload.attachments = ok.map((a) => ({ filename: a.filename || "invoice.pdf", content: a.content }));
    }
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const body = await r.text();
      console.error("email send failed:", body);
      /* A silent email outage is the quiet kind of broken: password resets and
         approval mails simply stop arriving and nobody reports it, because the
         person who needed the mail cannot tell you they did not get it.
         Resend's usual causes are an unverified domain or a spent daily quota,
         both of which need a human. Rate-limited so a bad address cannot turn
         one problem into a thousand emails about it. */
      flagFailure(r.status, body);
    }
    return { sent: r.ok };
  } catch (e) {
    console.error("email error:", e.message);
    flagFailure(0, e.message);
    return { sent: false };
  }
}
