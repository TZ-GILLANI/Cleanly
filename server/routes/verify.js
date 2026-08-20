import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "./auth.js";
import { sendEmail, mailerConfigured } from "../lib/mailer.js";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { isValidPhoneNumber } from "libphonenumber-js";

const router = Router();

/* Phone verification via Twilio Verify (WhatsApp channel, SMS fallback).
   Dormant until env vars exist:
     TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SID
   Setup (one-time, owner): twilio.com → Verify service → enable WhatsApp channel. */

const configured = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SID);
const auth = () => "Basic " + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");

router.get("/config", (req, res) => res.json({ enabled: configured(), emailEnabled: mailerConfigured() }));

router.post("/start", requireAuth, async (req, res) => {
  if (!configured()) return res.status(503).json({ error: "verification_not_configured" });
  // SMS costs money — cap sends hard (per user AND per day) against pumping abuse.
  if (!rateLimit("vstart:" + req.user.id, 3, 10 * 60e3) || !rateLimit("vday:" + req.user.id, 8, 24 * 3600e3))
    return res.status(429).json({ error: "Too many codes requested — try again later" });
  const { channel } = req.body || {};
  try {
    const me = await query("SELECT phone FROM users WHERE id = $1", [req.user.id]);
    const phone = me.rows[0]?.phone;
    if (!phone) return res.status(400).json({ error: "No phone number on your account" });
    if (phoneIsWrong(phone)) return res.status(400).json({ error: badPhoneMsg });
    const body = new URLSearchParams({ To: phone, Channel: channel === "sms" ? "sms" : "whatsapp" });
    const r = await fetch(`https://verify.twilio.com/v2/Services/${process.env.TWILIO_VERIFY_SID}/Verifications`, {
      method: "POST", headers: { Authorization: auth(), "Content-Type": "application/x-www-form-urlencoded" }, body,
    });
    const data = await r.json();
    if (!r.ok) return sendFailure(res, data, "verify-start");
    res.json({ sent: true, channel: data.channel });
  } catch (err) {
    console.error("verify start:", err);
    res.status(500).json({ error: "Verification failed to start" });
  }
});

router.post("/check", requireAuth, async (req, res) => {
  if (!rateLimit("vcheck:" + req.user.id, 10, 10 * 60e3)) return res.status(429).json({ error: "Too many attempts — try again later" });
  if (!configured()) return res.status(503).json({ error: "verification_not_configured" });
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: "Code required" });
  try {
    const me = await query("SELECT phone FROM users WHERE id = $1", [req.user.id]);
    const phone = me.rows[0]?.phone;
    const body = new URLSearchParams({ To: phone, Code: String(code) });
    const r = await fetch(`https://verify.twilio.com/v2/Services/${process.env.TWILIO_VERIFY_SID}/VerificationCheck`, {
      method: "POST", headers: { Authorization: auth(), "Content-Type": "application/x-www-form-urlencoded" }, body,
    });
    const data = await r.json();
    if (data.status === "approved") {
      await query("UPDATE users SET phone_verified = true WHERE id = $1", [req.user.id]);
      return res.json({ verified: true });
    }
    res.status(400).json({ error: "Wrong or expired code" });
  } catch (err) {
    res.status(500).json({ error: "Verification check failed" });
  }
});

/* ── Email verification codes (dormant until Resend is configured) ── */
router.post("/email/start", requireAuth, async (req, res) => {
  if (!rateLimit("evstart:" + req.user.id, 3, 10 * 60e3)) return res.status(429).json({ error: "Too many codes requested — try again later" });
  if (!mailerConfigured()) return res.status(503).json({ error: "email_not_configured" });
  try {
    const code = String(crypto.randomInt(100000, 999999));
    await query("UPDATE users SET email_code = $1, email_code_expires = NOW() + INTERVAL '15 minutes' WHERE id = $2", [code, req.user.id]);
    const me = await query("SELECT email, full_name FROM users WHERE id = $1", [req.user.id]);
    await sendEmail(me.rows[0].email, `${code} — your Cleano verification code`,
      `<div style="font-family:sans-serif;max-width:480px"><p>Hi ${me.rows[0].full_name},</p>
       <p>Your Cleano verification code:</p>
       <p style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#1B2A6B">${code}</p>
       <p style="color:#69718F;font-size:13px">Valid for 15 minutes. If you didn't request this, ignore this email.</p></div>`);
    res.json({ sent: true });
  } catch (err) {
    console.error("email verify start:", err);
    res.status(500).json({ error: "Could not send code" });
  }
});

router.post("/email/check", requireAuth, async (req, res) => {
  if (!rateLimit("evcheck:" + req.user.id, 10, 10 * 60e3)) return res.status(429).json({ error: "Too many attempts — try again later" });
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: "Code required" });
  try {
    const r = await query(
      "UPDATE users SET email_verified = true, email_code = NULL WHERE id = $1 AND email_code = $2 AND email_code_expires > NOW() RETURNING id",
      [req.user.id, String(code).trim()]
    );
    if (!r.rows.length) return res.status(400).json({ error: "Wrong or expired code" });
    res.json({ verified: true });
  } catch (err) {
    res.status(500).json({ error: "Verification check failed" });
  }
});


/* ── 5.9 SIGNUP verification — unauthenticated by design ─────────────
   Verification happens ON the signup form, before any account exists, so a
   mistyped number can simply be corrected instead of creating a dead account.
   Returns a short-lived signed token proving "this exact number was verified";
   /auth/register then requires that token.

   These endpoints send SMS without a login, so the abuse limits below are
   mandatory, not optional — every message costs real money.               */

const signupToken = (kind, value) => jwt.sign(
  { k: kind, v: String(value).toLowerCase().trim(), t: "signup-verify" },
  process.env.JWT_SECRET, { expiresIn: "15m" });

export function verifySignupToken(token, kind, value) {
  try {
    const d = jwt.verify(String(token || ""), process.env.JWT_SECRET);
    return d && d.t === "signup-verify" && d.k === kind &&
           d.v === String(value || "").toLowerCase().trim();
  } catch { return false; }
}

/* ── Check the number before spending an SMS on it ────────────────────────
   Nothing validated the phone. Anything the field produced went straight to
   Twilio, and Twilio's rejection was handed back to the customer verbatim:

       Invalid parameter `To`: +3670303194149

   Two failures in one line. The number was malformed because the app never
   cleaned it up, and the person was shown an API diagnostic — English, in
   Twilio's vocabulary, about a parameter they have never heard of.

   E.164: a leading +, then 8 to 15 digits, first digit non-zero. */
/* Google's phone metadata, not a table we maintain.

   The version this replaces knew twenty-one dial codes and one length each. It
   caught the number from the bug report, and would have waved through a
   thirteen-digit Austrian number (Austria has four valid lengths) and refused a
   perfectly good Portuguese one, because Portugal was not on the list.

   libphonenumber-js covers 245 territories including which ranges exist at all,
   so this rejects numbers that are the right length but not real. */
function phoneIsWrong(raw) {
  const s = String(raw || "").trim();
  if (!/^\+[1-9][0-9]{6,14}$/.test(s)) return true;   // not even E.164-shaped
  try { return !isValidPhoneNumber(s); } catch { return true; }
}

const badPhoneMsg = "That phone number doesn't look right. Check the country code and remove any leading zero.";

/* Twilio's own text is for us, not for the customer. Log it, return a sentence
   a human can act on. */
function sendFailure(res, data, where) {
  console.error(`twilio ${where}:`, data?.code, data?.message);
  if (String(data?.code) === "60200") return res.status(400).json({ error: badPhoneMsg });
  if (String(data?.code) === "60203") return res.status(429).json({ error: "Too many attempts for this number — try again later." });
  if (String(data?.code) === "60205") return res.status(400).json({ error: "We can't send SMS to that number. Try a mobile number." });
  return res.status(502).json({ error: "We couldn't send the code just now. Please try again in a moment." });
}

router.post("/signup/start", async (req, res) => {
  const { phone, email } = req.body || {};
  const target = phone || email;
  if (!target) return res.status(400).json({ error: "Phone or email required" });
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || "ip";

  // hard caps: per target, per IP, per day — SMS pumping is a real attack
  if (!rateLimit("su:t:" + target, 3, 60 * 60e3))
    return res.status(429).json({ error: "Too many codes for this number — try again in an hour" });
  if (!rateLimit("su:ip:" + ip, 10, 60 * 60e3))
    return res.status(429).json({ error: "Too many attempts — try again later" });
  if (!rateLimit("su:tday:" + target, 6, 24 * 3600e3))
    return res.status(429).json({ error: "Daily limit reached for this number" });

  try {
    if (phone) {
      if (phoneIsWrong(phone)) return res.status(400).json({ error: badPhoneMsg });
      const dup = await query("SELECT 1 FROM users WHERE phone = $1", [String(phone).trim()]);
      if (dup.rows.length) return res.status(409).json({ error: "That phone number already has an account" });
      if (!configured()) {
        /* REQUIRE_SIGNUP_VERIFY=1 means no account can be created without a
           code. If the SMS provider is not configured or its credentials have
           been rotated, that is not a degraded feature — it is every signup in
           the country failing, silently, until somebody complains. */
        if (process.env.REQUIRE_SIGNUP_VERIFY === "1") {
          const { alert } = await import("../lib/alerts.js");
          alert("verify-unconfigured", "Cleano: signups are blocked",
                "REQUIRE_SIGNUP_VERIFY is on but Twilio is not configured, so nobody can create an account. Check TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_VERIFY_SID in Render.");
        }
        return res.status(503).json({ error: "verification_not_configured" });
      }
      const body = new URLSearchParams({ To: String(phone).trim(), Channel: req.body.channel === "sms" ? "sms" : "whatsapp" });
      const r = await fetch(`https://verify.twilio.com/v2/Services/${process.env.TWILIO_VERIFY_SID}/Verifications`, {
        method: "POST", headers: { Authorization: auth(), "Content-Type": "application/x-www-form-urlencoded" }, body });
      const data = await r.json();
      if (!r.ok) return sendFailure(res, data, "signup-start");
      return res.json({ sent: true, channel: data.channel });
    }
    // email path — 6-digit code held in a short-lived signed cookie-free token
    const dup = await query("SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)", [String(email).trim()]);
    if (dup.rows.length) return res.status(409).json({ error: "That email already has an account" });
    if (!mailerConfigured()) return res.status(503).json({ error: "verification_not_configured" });
    const code = String(crypto.randomInt(100000, 999999));
    const ticket = jwt.sign({ e: String(email).toLowerCase().trim(), c: code, t: "signup-code" },
      process.env.JWT_SECRET, { expiresIn: "15m" });
    sendEmail(String(email).trim(), "Your Cleano code",
      `<div style="font-family:sans-serif"><p>Your Cleano verification code:</p>
       <p style="font-size:28px;font-weight:800;letter-spacing:4px">${code}</p>
       <p style="color:#777">It expires in 15 minutes. If you didn't request it, ignore this email.</p></div>`);
    res.json({ sent: true, ticket });
  } catch (e) {
    console.error("signup verify start:", e.message);
    res.status(500).json({ error: "Could not send the code" });
  }
});

router.post("/signup/check", async (req, res) => {
  const { phone, email, code, ticket } = req.body || {};
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || "ip";
  if (!rateLimit("suc:ip:" + ip, 20, 60 * 60e3))
    return res.status(429).json({ error: "Too many attempts — try again later" });
  try {
    if (phone) {
      if (!configured()) return res.status(503).json({ error: "verification_not_configured" });
      const body = new URLSearchParams({ To: String(phone).trim(), Code: String(code || "").trim() });
      const r = await fetch(`https://verify.twilio.com/v2/Services/${process.env.TWILIO_VERIFY_SID}/VerificationCheck`, {
        method: "POST", headers: { Authorization: auth(), "Content-Type": "application/x-www-form-urlencoded" }, body });
      const data = await r.json();
      if (!r.ok || data.status !== "approved") return res.status(400).json({ error: "That code didn't match" });
      return res.json({ verified: true, token: signupToken("phone", phone) });
    }
    const d = jwt.verify(String(ticket || ""), process.env.JWT_SECRET);
    if (!d || d.t !== "signup-code" || d.e !== String(email || "").toLowerCase().trim())
      return res.status(400).json({ error: "Please request a new code" });
    if (String(d.c) !== String(code || "").trim()) return res.status(400).json({ error: "That code didn't match" });
    res.json({ verified: true, token: signupToken("email", email) });
  } catch {
    res.status(400).json({ error: "That code didn't match, or it expired" });
  }
});

export default router;
