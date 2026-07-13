import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

/* Phone verification via Twilio Verify (WhatsApp channel, SMS fallback).
   Dormant until env vars exist:
     TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SID
   Setup (one-time, owner): twilio.com → Verify service → enable WhatsApp channel. */

const configured = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SID);
const auth = () => "Basic " + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");

router.get("/config", (req, res) => res.json({ enabled: configured() }));

router.post("/start", requireAuth, async (req, res) => {
  if (!configured()) return res.status(503).json({ error: "verification_not_configured" });
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

export default router;
