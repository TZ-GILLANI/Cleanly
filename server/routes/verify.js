import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "./auth.js";
import { sendEmail, mailerConfigured } from "../lib/mailer.js";
import crypto from "crypto";

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
    const body = new URLSearchParams({ To: phone, Channel: channel === "sms" ? "sms" : "whatsapp" });
    const r = await fetch(`https://verify.twilio.com/v2/Services/${process.env.TWILIO_VERIFY_SID}/Verifications`, {
      method: "POST", headers: { Authorization: auth(), "Content-Type": "application/x-www-form-urlencoded" }, body,
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: data.message || "Could not send code" });
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

export default router;
