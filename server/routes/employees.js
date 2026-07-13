import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

/* GET /api/employees — company's own staff */
router.get("/", requireAuth, requireRole("company"), async (req, res) => {
  try {
    const result = await query(
      "SELECT id, full_name, phone, is_active, company_id, created_at FROM users WHERE company_id = $1 AND role = 'employee' ORDER BY full_name ASC",
      [req.user.companyId]
    );
    res.json({ employees: result.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch employees" });
  }
});

/* GET /api/employees/invites */
router.get("/invites", requireAuth, requireRole("company"), async (req, res) => {
  try {
    const result = await query(
      "SELECT * FROM invite_codes WHERE company_id = $1 ORDER BY created_at DESC",
      [req.user.companyId]
    );
    res.json({ invites: result.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch invites" });
  }
});

/* Generate a clean, fixed-length, unambiguous invite/reference code (e.g. SPARK-7K4D). */
const INVITE_WORDS = ["SPARK", "CLEAN", "FRESH", "MINT", "SHINE", "GLEAM", "CRISP", "PURE"];
const INVITE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I/L
function makeInviteCode() {
  const word = INVITE_WORDS[Math.floor(Math.random() * INVITE_WORDS.length)];
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += INVITE_CHARS[Math.floor(Math.random() * INVITE_CHARS.length)];
  return `${word}-${suffix}`;
}

/* POST /api/employees/invites */
router.post("/invites", requireAuth, requireRole("company"), async (req, res) => {
  const { label } = req.body;
  try {
    // retry on the (rare) chance of a primary-key collision
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = makeInviteCode();
      const dupe = await query("SELECT 1 FROM invite_codes WHERE code = $1", [code]);
      if (dupe.rows.length) continue;
      const result = await query(
        "INSERT INTO invite_codes (code, company_id, label) VALUES ($1,$2,$3) RETURNING *",
        [code, req.user.companyId, label || null]
      );
      return res.status(201).json({ invite: result.rows[0] });
    }
    res.status(500).json({ error: "Could not generate a unique code, please try again" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create invite" });
  }
});

/* DELETE /api/employees/invites/:code */
router.delete("/invites/:code", requireAuth, requireRole("company"), async (req, res) => {
  try {
    const invite = await query("SELECT * FROM invite_codes WHERE code = $1", [req.params.code]);
    if (!invite.rows.length) return res.status(404).json({ error: "Invite not found" });
    if (invite.rows[0].company_id !== req.user.companyId) return res.status(403).json({ error: "Forbidden" });
    if (invite.rows[0].used_by) return res.status(400).json({ error: "Cannot revoke a used invite" });
    await query("DELETE FROM invite_codes WHERE code = $1", [req.params.code]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete invite" });
  }
});

export default router;
