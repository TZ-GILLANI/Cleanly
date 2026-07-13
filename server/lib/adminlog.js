import { query } from "../db.js";

/* Records an admin decision with the acting admin's signature.
   Non-fatal: a logging failure must never break the action itself. */
export async function logAdmin(req, action, targetType, targetId, detail) {
  try {
    const u = await query("SELECT email, full_name FROM users WHERE id = $1", [req.user.id]);
    const row = u.rows[0] || {};
    await query(
      "INSERT INTO admin_log (admin_id, admin_email, admin_name, action, target_type, target_id, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [req.user.id, row.email || null, row.full_name || null, action,
       targetType || null, targetId != null ? String(targetId) : null, detail != null ? String(detail) : null]
    );
  } catch (e) { console.error("admin_log failed:", e.message); }
}
