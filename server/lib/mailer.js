/* Email via Resend (resend.com — free tier 100/day).
   Dormant until env vars exist: RESEND_API_KEY, EMAIL_FROM (e.g. "Cleano <hello@yourdomain.hu>").
   For testing before a domain is verified, EMAIL_FROM can be "onboarding@resend.dev". */
export const mailerConfigured = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export async function sendEmail(to, subject, html) {
  if (!mailerConfigured()) return { skipped: true };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, html }),
    });
    if (!r.ok) console.error("email send failed:", await r.text());
    return { sent: r.ok };
  } catch (e) {
    console.error("email error:", e.message);
    return { sent: false };
  }
}
