import { Router } from "express";
import bcrypt from "bcryptjs";
import { query } from "../db.js";
import { signToken, requireAuth } from "../middleware/auth.js";
import { huTaxIdValid, huRegNumberValid, formatTaxId } from "../lib/validate.js";

const router = Router();

/* POST /api/auth/register */
router.post("/register", async (req, res) => {
  const { email, password, role, fullName, customerType, inviteCode, companyName, taxId, regNumber, contactPhone, documents, address, city, phone } = req.body;
  const normPhone = phone ? String(phone).replace(/[^0-9+]/g, "").slice(0, 20) : null;
  const docsJson = JSON.stringify(Array.isArray(documents) ? documents.slice(0, 6) : []);

  if (!email || !password || !fullName || !role) return res.status(400).json({ error: "Missing required fields" });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  if (!["customer", "employee", "company"].includes(role)) return res.status(400).json({ error: "Invalid role" });
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
      if (!taxId?.trim()) return res.status(400).json({ error: "Tax ID is required for company registration" });
      if (!huTaxIdValid(taxId)) return res.status(400).json({ error: "Invalid Hungarian tax number (adószám). Format: 12345678-1-42 — check the digits." });
      if (regNumber?.trim() && !huRegNumberValid(regNumber)) return res.status(400).json({ error: "Invalid company registration number (cégjegyzékszám). Format: 09-09-123456." });
      const userRes = await query(
        "INSERT INTO users (email, password_hash, role, full_name, phone, approval_status) VALUES ($1,$2,$3,$4,$5,'pending') RETURNING id",
        [email.toLowerCase(), hash, "company", fullName, contactPhone || null]
      );
      const userId = userRes.rows[0].id;
      // New companies start unlisted/pending until an admin reviews their documents.
      const coRes = await query(
        "INSERT INTO companies (owner_id, name, tax_id, reg_number, contact_phone, documents, city, is_approved, is_listed) VALUES ($1,$2,$3,$4,$5,$6,$7,false,true) RETURNING id",
        [userId, companyName.trim(), formatTaxId(taxId.trim()), regNumber?.trim() || null, contactPhone?.trim() || null, docsJson, city ? String(city).slice(0, 60) : 'Debrecen']
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
        "INSERT INTO users (email, password_hash, role, full_name, company_id, documents, address, phone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
        [email.toLowerCase(), hash, "employee", fullName, companyId, docsJson, address ? String(address).slice(0, 300) : null, normPhone]
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

      const user = (await query("SELECT * FROM users WHERE id = $1", [userId])).rows[0];
      const token = signToken({ id: userId, role: "employee", companyId });
      return res.status(201).json({ token, user });
    }

    // customer
    const isStudent = customerType === "student";
    const userRes = await query(
      "INSERT INTO users (email, password_hash, role, full_name, customer_type, address, phone, documents, approval_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
      [email.toLowerCase(), hash, "customer", fullName, customerType || "resident", address ? String(address).slice(0, 300) : null, normPhone, docsJson, isStudent ? "pending" : "approved"]
    );
    const user = userRes.rows[0];
    // Student accounts wait for admin review of the card photo — no session yet.
    if (isStudent) return res.status(201).json({ pendingApproval: true });
    const token = signToken({ id: user.id, role: "customer", companyId: null });
    return res.status(201).json({ token, user });
  } catch (err) {
    console.error("register error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

/* POST /api/auth/login */
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  try {
    const result = await query("SELECT * FROM users WHERE email = $1 AND is_active = true", [email.toLowerCase()]);
    if (!result.rows.length) return res.status(401).json({ error: "Invalid email or password" });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password" });
    if (user.approval_status === "pending")
      return res.status(403).json({ error: user.role === "company"
        ? "Your company is being reviewed — we'll email you the moment it's approved."
        : "Your student account is waiting for approval — we'll email you as soon as it's ready." });
    if (user.approval_status === "rejected")
      return res.status(403).json({ error: "Your student verification was declined. Register as a resident, or contact support." });

    const token = signToken({ id: user.id, role: user.role, companyId: user.company_id, isSuper: user.is_super === true });
    res.json({ token, user });
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
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

/* PUT /api/auth/profile */
router.put("/profile", requireAuth, async (req, res) => {
  const { fullName, phone, customerType, address, paymentMethod, lang, documents } = req.body;
  try {
    if (phone) {
      const np = String(phone).replace(/[^0-9+]/g, "").slice(0, 20);
      const taken = await query("SELECT 1 FROM users WHERE phone = $1 AND is_active = true AND id <> $2", [np, req.user.id]);
      if (taken.rows.length) return res.status(400).json({ error: "This phone number is already linked to another account. Delete that account first to reuse the number." });
    }
    const result = await query(
      `UPDATE users SET
        full_name = COALESCE($1, full_name),
        phone = COALESCE($2, phone),
        customer_type = COALESCE($3, customer_type),
        address = COALESCE($4, address),
        payment_method = COALESCE($5, payment_method),
        lang = COALESCE($6, lang),
        documents = COALESCE($7, documents)
      WHERE id = $8 RETURNING *`,
      [fullName, phone, customerType, address, paymentMethod, lang,
       Array.isArray(documents) ? JSON.stringify(documents.slice(0, 6)) : null, req.user.id]
    );
    res.json({ user: result.rows[0] });
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

export default router;
