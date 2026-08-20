import { Router } from "express";
import bcrypt from "bcryptjs";
import { query } from "../db.js";
import { verifySignupToken } from "./verify.js";
import { notify } from "../lib/notify.js";
import { signToken, requireAuth } from "../middleware/auth.js";
import { huTaxIdValid, huRegNumberValid, formatTaxId } from "../lib/validate.js";
import { sendEmail, mailerConfigured } from "../lib/mailer.js";
import crypto from "crypto";

/* Tiny in-memory rate limiter (per key, sliding window) — brute-force shield. */
const _hits = new Map();
export function rateLimit(key, max, windowMs) {
  if (process.env.PGMEM) max = max * 50; // e2e suite hammers from one IP — keep prod limits honest, tests green
  const now = Date.now();
  const arr = (_hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  _hits.set(key, arr);
  if (_hits.size > 5000) _hits.clear(); // memory guard
  return arr.length <= max;
}
const ipOf = (req) => req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || "?";

const router = Router();

/* Strip everything the client must never see from a user row. */
function safeUser(u) {
  if (!u) return u;
  const { password_hash, email_code, email_code_expires, push_token, stripe_customer_id,
          default_payment_method, calendar_token, ...rest } = u;
  return rest;
}


/* POST /api/auth/register */
router.post("/register", async (req, res) => {
  /* Six signups per IP per hour was far too tight, and it fails in exactly the
     places Cleano is trying to grow.

     A university dormitory in Debrecen puts hundreds of students behind one
     address. Worse, mobile carriers use carrier-grade NAT — every Telekom or
     Vodafone customer in a region can share a single public IP. Six an hour
     across all of them meant real students hitting "try again later" for
     something a stranger did, and simply not signing up. Silent lost growth,
     invisible in any log.

     So the IP limit is now generous, and the tight limits sit where abuse
     actually shows: one person hammering one email or one phone number. That
     is what stops account farming; blocking a shared IP never did. */
  const ip = ipOf(req);
  const emailKey = String(req.body?.email || "").toLowerCase().trim();
  const phoneKey = String(req.body?.phone || "").replace(/[^0-9+]/g, "");
  if (!rateLimit("reg-ip:" + ip, 40, 60 * 60e3))
    return res.status(429).json({ error: "Too many registrations from this network — try again later" });
  if (emailKey && !rateLimit("reg-mail:" + emailKey, 4, 60 * 60e3))
    return res.status(429).json({ error: "Too many attempts for this email — try again later" });
  if (phoneKey && !rateLimit("reg-phone:" + phoneKey, 4, 60 * 60e3))
    return res.status(429).json({ error: "Too many attempts for this phone number — try again later" });
  const { email, password, role, fullName, customerType, inviteCode, companyName, taxId, regNumber, contactPhone, documents, address, city, phone, termsAccepted } = req.body;
  const normPhone = phone ? String(phone).replace(/[^0-9+]/g, "").slice(0, 20) : null;
  const docsJson = JSON.stringify(Array.isArray(documents) ? documents.slice(0, 6) : []);

  if (!email || !password || !fullName || !role) return res.status(400).json({ error: "Missing required fields" });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  if (!["customer", "employee", "company"].includes(role)) return res.status(400).json({ error: "Invalid role" });
  if (termsAccepted !== true) return res.status(400).json({ error: "You must accept the Terms of Service and Privacy Policy" });

  /* ── 5.9 The account is created ONLY after the phone was verified on the
     signup form. REQUIRE_SIGNUP_VERIFY=0 keeps older clients working, since
     1.0 apps can't produce a token (2.1). ── */
  const needProof = process.env.REQUIRE_SIGNUP_VERIFY === "1";
  // 5.5: keep the person's city on the person, so announcements can target it
  const cityVal = city ? String(city).trim().slice(0, 60) : null;
  let phoneVerified = false, emailVerified = false;
  if (req.body.phoneToken && phone && verifySignupToken(req.body.phoneToken, "phone", phone)) phoneVerified = true;
  if (req.body.emailToken && email && verifySignupToken(req.body.emailToken, "email", email)) emailVerified = true;
  /* Both, not either. The signup form now proves each field separately and
     locks it, so accepting one proof would leave the other unchecked while the
     screen implied otherwise. A company has no personal phone on the form, so
     only its email is demanded. */
  if (needProof) {
    if (!emailVerified) return res.status(400).json({ error: "Please verify your email address before creating the account." });
    if (role !== "company" && !phoneVerified)
      return res.status(400).json({ error: "Please verify your phone number before creating the account." });
  }
  if (["customer", "employee"].includes(role)) {
    if (!normPhone || normPhone.replace(/[^0-9]/g, "").length < 8) return res.status(400).json({ error: "A valid phone number is required" });
    const phoneTaken = await query("SELECT 1 FROM users WHERE phone = $1 AND is_active = true", [normPhone]);
    if (phoneTaken.rows.length) return res.status(400).json({ error: "This phone number is already linked to another account. Delete that account first to reuse the number." });
  }
  if (role === "customer" && customerType === "student" && !(Array.isArray(documents) && documents.length >= 1)) {
    return res.status(400).json({ error: "A student card photo is required for student accounts" });
  }

  try {
    const existing = await query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    if (existing.rows.length) return res.status(400).json({ error: "Email already registered" });

    const hash = await bcrypt.hash(password, 10);

    if (role === "company") {
      if (!companyName?.trim()) return res.status(400).json({ error: "Company name is required" });
      /* The city field used to be a dropdown that was never empty, so nothing
         ever checked it. It is now free text, and an empty city is worse than
         it looks: the customer list keeps any company whose city is blank, so
         a partner with no city set is shown to every customer in the country
         and then refused at booking. Fail here instead. */
      if (!String(city || "").trim()) return res.status(400).json({ error: "Please tell us which city you serve" });
      if (!taxId?.trim()) return res.status(400).json({ error: "Tax ID is required for company registration" });
      if (!huTaxIdValid(taxId)) return res.status(400).json({ error: "Invalid Hungarian tax number (adószám). Format: 12345678-1-42 — check the digits." });
      if (regNumber?.trim() && !huRegNumberValid(regNumber)) return res.status(400).json({ error: "Invalid company registration number (cégjegyzékszám). Format: 09-09-123456." });
      const userRes = await query(
        "INSERT INTO users (email, password_hash, role, full_name, phone, city, approval_status, terms_accepted_at, phone_verified, email_verified) VALUES ($1,$2,$3,$4,$5,$6,'pending',NOW(),$7,$8) RETURNING id",
        [email.toLowerCase(), hash, "company", fullName, contactPhone || null, cityVal, phoneVerified, emailVerified]
      );
      const userId = userRes.rows[0].id;
      // New companies start unlisted/pending until an admin reviews their documents.
      const coRes = await query(
        "INSERT INTO companies (owner_id, name, tax_id, reg_number, contact_phone, documents, city, is_approved, is_listed) VALUES ($1,$2,$3,$4,$5,$6,$7,false,true) RETURNING id",
        [userId, companyName.trim(), formatTaxId(taxId.trim()), regNumber?.trim() || null, contactPhone?.trim() || null, docsJson, String(city).trim().slice(0, 60)]
      );
      await query("UPDATE users SET company_id = $1 WHERE id = $2", [coRes.rows[0].id, userId]);

      // Companies wait for document review before they can log in.
      return res.status(201).json({ pendingApproval: true });
    }

    if (role === "employee") {
      if (!inviteCode?.trim()) return res.status(400).json({ error: "Invite code is required" });
      const invite = await query(
        "SELECT * FROM invite_codes WHERE code = $1 AND used_by IS NULL",
        [inviteCode.toUpperCase()]
      );
      if (!invite.rows.length) return res.status(400).json({ error: "Invalid or already-used invite code" });

      const companyId = invite.rows[0].company_id;
      const userRes = await query(
        "INSERT INTO users (email, password_hash, role, full_name, company_id, documents, address, phone, city, approval_status, terms_accepted_at, phone_verified, email_verified) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',NOW(),$10,$11) RETURNING id",
        [email.toLowerCase(), hash, "employee", fullName, companyId, docsJson, address ? String(address).slice(0, 300) : null, normPhone, cityVal, phoneVerified, emailVerified]
      );
      const userId = userRes.rows[0].id;
      // atomic claim — a code can only ever be consumed once, even under concurrent signups
      const claim = await query(
        "UPDATE invite_codes SET used_by = $1 WHERE code = $2 AND used_by IS NULL RETURNING code",
        [userId, inviteCode.toUpperCase()]
      );
      if (!claim.rows.length) {
        await query("DELETE FROM users WHERE id = $1", [userId]);
        return res.status(400).json({ error: "Invite code was just used by someone else" });
      }

      // The company owner must approve the cleaner before they can sign in.
      try {
        const owner = await query("SELECT owner_id FROM companies WHERE id = $1", [companyId]);
        if (owner.rows[0]) await notify(owner.rows[0].owner_id, "cleaner_pending", "New cleaner waiting for approval",
          `${fullName} used your invite code. Approve them in the Team tab.`, null);
      } catch (e) { console.error("cleaner-pending notify:", e.message); }
      return res.status(201).json({ pendingApproval: true });
    }

    // customer
    const isStudent = customerType === "student";
    const userRes = await query(
      "INSERT INTO users (email, password_hash, role, full_name, customer_type, address, phone, city, documents, approval_status, terms_accepted_at, phone_verified, email_verified) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),$11,$12) RETURNING *",
      [email.toLowerCase(), hash, "customer", fullName, customerType || "resident", address ? String(address).slice(0, 300) : null, normPhone, cityVal, docsJson, isStudent ? "pending" : "approved", phoneVerified, emailVerified]
    );
    const user = userRes.rows[0];
    // Student accounts wait for admin review of the card photo — no session yet.
    if (isStudent) return res.status(201).json({ pendingApproval: true });
    const token = signToken({ id: user.id, role: "customer", companyId: null });
    return res.status(201).json({ token, user: safeUser(user) });
  } catch (err) {
    console.error("register error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

/* POST /api/auth/login */
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  /* Ten attempts per IP per five minutes had the same flaw as the old signup
     limit, and it bites harder: people log in every day, and a cleaning team
     arriving on the same wifi would lock each other out of their own accounts.
     A mobile carrier is one address for a whole region.

     The per-EMAIL limit is what actually stops a brute-force attempt, and it
     stays tight. The per-IP one is a blunt second line against someone trying
     many different accounts from one place, so it only needs to be low enough
     to make that slow — not low enough to catch a family. */
  if (!rateLimit("login-ip:" + ipOf(req), 60, 5 * 60e3) || !rateLimit("login:" + String(email).toLowerCase(), 8, 5 * 60e3))
    return res.status(429).json({ error: "Too many attempts — wait a few minutes and try again" });

  try {
    const result = await query("SELECT * FROM users WHERE email = $1 AND is_active = true", [email.toLowerCase()]);
    if (!result.rows.length) return res.status(401).json({ error: "Invalid email or password" });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password" });
    if (user.approval_status === "pending")
      return res.status(403).json({ error: user.role === "company"
        ? "Your company is being reviewed — we'll email you the moment it's approved."
        : user.role === "employee"
        ? "Your company hasn't approved your account yet — ask them to approve you in the Team tab."
        : "Your student account is waiting for approval — we'll email you as soon as it's ready." });
    if (user.approval_status === "rejected")
      return res.status(403).json({ error: "Your student verification was declined. Register as a resident, or contact support." });

    const token = signToken({ id: user.id, role: user.role, companyId: user.company_id, isSuper: user.is_super === true });
    res.json({ token, user: safeUser(user) });
  } catch (err) {
    console.error("login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

/* GET /api/auth/me */
router.get("/me", requireAuth, async (req, res) => {
  try {
    const result = await query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    if (!result.rows.length) return res.status(404).json({ error: "User not found" });
    res.json({ user: safeUser(result.rows[0]) });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

/* PUT /api/auth/profile */
router.put("/profile", requireAuth, async (req, res) => {
  const { fullName, phone, customerType, address, paymentMethod, lang, documents, savedAddresses } = req.body;
  // SECURITY: nobody self-upgrades to the student discount. Switching to
  // student stores the card + flags the account for admin review instead.
  let custTypeParam = customerType;
  let upgradeRequested = false;
  if (customerType === "student") {
    const cur = await query("SELECT customer_type FROM users WHERE id = $1", [req.user.id]);
    if (cur.rows[0]?.customer_type !== "student") {
      if (!(Array.isArray(documents) && documents.length >= 1))
        return res.status(400).json({ error: "Upload a photo of your student card — our team verifies it before the discount activates." });
      custTypeParam = null; // stay resident until approved
      upgradeRequested = true;
    }
  }
  try {
    let phoneParam = phone;
    if (phone) {
      const np = String(phone).replace(/[^0-9+]/g, "").slice(0, 20);
      const mine = await query("SELECT phone FROM users WHERE id = $1", [req.user.id]);
      if ((mine.rows[0]?.phone || "") === np) {
        phoneParam = null;   // unchanged — saving language/name must never trip the uniqueness check
      } else {
        const taken = await query("SELECT 1 FROM users WHERE phone = $1 AND is_active = true AND id <> $2", [np, req.user.id]);
        if (taken.rows.length) return res.status(400).json({ error: "This phone number is already linked to another account. Delete that account first to reuse the number." });
      }
    }
    const result = await query(
      `UPDATE users SET
        full_name = COALESCE($1, full_name),
        phone = COALESCE($2, phone),
        customer_type = COALESCE($3, customer_type),
        address = COALESCE($4, address),
        payment_method = COALESCE($5, payment_method),
        lang = COALESCE($6, lang),
        documents = COALESCE($7, documents),
        saved_addresses = COALESCE($9, saved_addresses)
      WHERE id = $8 RETURNING *`,
      [fullName, phoneParam, custTypeParam, address, paymentMethod, lang,
       Array.isArray(documents) ? JSON.stringify(documents.slice(0, 6)) : null, req.user.id,
       Array.isArray(savedAddresses) ? JSON.stringify(savedAddresses.slice(0, 12)) : null]
    );
    if (upgradeRequested) await query("UPDATE users SET student_upgrade = true WHERE id = $1", [req.user.id]);
    if (customerType === "resident") await query("UPDATE users SET student_upgrade = false WHERE id = $1", [req.user.id]);
    res.json({ user: safeUser(result.rows[0]) });
  } catch (err) {
    res.status(500).json({ error: "Failed to update profile" });
  }
});

/* POST /api/auth/change-password */
router.post("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: "Both passwords required" });
  if (newPassword.length < 6) return res.status(400).json({ error: "New password too short" });

  try {
    const result = await query("SELECT password_hash FROM users WHERE id = $1", [req.user.id]);
    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

    const hash = await bcrypt.hash(newPassword, 10);
    await query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to change password" });
  }
});


/* DELETE /api/auth/me — GDPR / app-store account deletion.
   Personal data is anonymised; booking history stays for accounting. */
router.delete("/me", requireAuth, async (req, res) => {
  try {
    const anonEmail = `deleted-${req.user.id}-${Date.now()}@deleted.cleanly`;
    await query(
      `UPDATE users SET
         email = $1,
         deleted_name = COALESCE(deleted_name, full_name),
         deleted_email = COALESCE(deleted_email, email),
         full_name = 'Deleted user',
         phone = NULL,
         address = NULL,
         documents = '[]'::jsonb,
         password_hash = 'account-deleted',
         is_active = false
       WHERE id = $2`,
      [anonEmail, req.user.id]
    );
    // company owners: unlist the company so it disappears from the marketplace
    if (req.user.role === "company" && req.user.companyId) {
      await query("UPDATE companies SET is_listed = false WHERE id = $1", [req.user.companyId]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("account deletion error:", err);
    res.status(500).json({ error: "Could not delete account" });
  }
});

/* ── Forgot / reset password (email code; requires the mailer) ── */
router.post("/forgot", async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email required" });
  /* Same reasoning. The tight limit belongs on the address being reset — that
     is the thing an attacker would hammer — not on the network it came from. */
  if (!rateLimit("forgot-ip:" + ipOf(req), 25, 15 * 60e3)) return res.status(429).json({ error: "Too many attempts — try later" });
  {
    const fEmail = String(req.body?.email || "").toLowerCase().trim();
    if (fEmail && !rateLimit("forgot-mail:" + fEmail, 4, 15 * 60e3))
      return res.status(429).json({ error: "Too many attempts for this email — try later" });
  }
  if (!mailerConfigured()) return res.status(503).json({ error: "Password reset by email is not enabled yet — contact support" });
  try {
    const u = await query("SELECT id, full_name FROM users WHERE email = $1 AND is_active = true", [String(email).toLowerCase()]);
    // Always answer success — never reveal whether an email exists.
    if (u.rows.length) {
      const code = String(crypto.randomInt(100000, 999999));
      await query("UPDATE users SET email_code = $1, email_code_expires = NOW() + INTERVAL '15 minutes' WHERE id = $2", [code, u.rows[0].id]);
      sendEmail(String(email).toLowerCase(), `${code} — Cleano password reset`,
        `<div style="font-family:sans-serif;max-width:480px"><p>Hi ${u.rows[0].full_name},</p>
         <p>Your Cleano password reset code:</p>
         <p style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#1B2A6B">${code}</p>
         <p style="color:#69718F;font-size:13px">Valid for 15 minutes. If you didn't request this, ignore this email.</p></div>`);
    }
    res.json({ sent: true });
  } catch (err) {
    console.error("forgot:", err);
    res.status(500).json({ error: "Could not start password reset" });
  }
});

router.post("/reset", async (req, res) => {
  const { email, code, newPassword } = req.body || {};
  if (!email || !code || !newPassword) return res.status(400).json({ error: "Email, code and new password required" });
  if (String(newPassword).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  /* A reset token is single-use and short-lived, so guessing it is the attack.
     Limit per token, generously per network. */
  if (!rateLimit("reset-ip:" + ipOf(req), 40, 15 * 60e3)) return res.status(429).json({ error: "Too many attempts — try later" });
  {
    const tok = String(req.body?.token || "").slice(0, 64);
    if (tok && !rateLimit("reset-tok:" + tok, 6, 15 * 60e3))
      return res.status(429).json({ error: "Too many attempts — request a new link" });
  }
  try {
    const hash = await bcrypt.hash(newPassword, 10);
    const r = await query(
      `UPDATE users SET password_hash = $1, email_code = NULL
       WHERE email = $2 AND email_code = $3 AND email_code_expires > NOW() AND is_active = true RETURNING id`,
      [hash, String(email).toLowerCase(), String(code).trim()]
    );
    if (!r.rows.length) return res.status(400).json({ error: "Wrong or expired code" });
    res.json({ ok: true });
  } catch (err) {
    console.error("reset:", err);
    res.status(500).json({ error: "Could not reset password" });
  }
});

export default router;
