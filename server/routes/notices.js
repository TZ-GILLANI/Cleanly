import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { sendEmail } from "../lib/mailer.js";

const router = Router();

/* GET /api/notices */
router.get("/", requireAuth, async (req, res) => {
  try {
    let result;
    if (req.user.role === "employee") {
      result = await query(
        "SELECT n.*, c.name AS company_name, c.emoji AS company_emoji, c.cover AS company_cover FROM notices n JOIN companies c ON c.id = n.company_id WHERE n.to_employee = $1 AND n.deleted_by_employee = false ORDER BY n.created_at DESC",
        [req.user.id]
      );
    } else if (req.user.role === "company") {
      result = await query(
        "SELECT n.*, u.full_name AS employee_name FROM notices n JOIN users u ON u.id = n.to_employee WHERE n.company_id = $1 AND n.deleted_by_company = false ORDER BY n.created_at DESC",
        [req.user.companyId]
      );
    } else {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json({ notices: result.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch notices" });
  }
});

/* POST /api/notices */
router.post("/", requireAuth, async (req, res) => {
  if (req.user.role !== "company") return res.status(403).json({ error: "Company only" });
  const { toEmployee, body } = req.body;
  if (!toEmployee || !body) return res.status(400).json({ error: "Missing fields" });

  try {
    const emp = await query("SELECT id, email, full_name FROM users WHERE id = $1 AND company_id = $2", [toEmployee, req.user.companyId]);
    if (!emp.rows.length) return res.status(403).json({ error: "Employee not in your company" });

    const result = await query(
      "INSERT INTO notices (company_id, to_employee, body) VALUES ($1,$2,$3) RETURNING *",
      [req.user.companyId, toEmployee, body]
    );
    
    sendEmail(emp.rows[0].email, "New notice from your company 🧽",
      `<div style="font-family:sans-serif;max-width:520px"><p>Hi ${emp.rows[0].full_name},</p><p>You have a new notice in Cleanly:</p><blockquote style="border-left:3px solid #5EE6A8;padding-left:12px;color:#333">${String(body).slice(0, 500)}</blockquote><p><a href="${process.env.PUBLIC_BASE_URL || "https://cleanly-2x9z.onrender.com"}">Open Cleanly</a></p></div>`);
res.status(201).json({ notice: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to send notice" });
  }
});

/* PUT /api/notices/:id/read */
router.put("/:id/read", requireAuth, async (req, res) => {
  if (req.user.role !== "employee") return res.status(403).json({ error: "Employee only" });
  try {
    const result = await query(
      "UPDATE notices SET is_read = true, read_at = COALESCE(read_at, NOW()) WHERE id = $1 AND to_employee = $2 RETURNING *",
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Notice not found" });
    res.json({ notice: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to update notice" });
  }
});

/* DELETE /api/notices/:id — clears from YOUR side; hard-deletes once both cleared */
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    let r;
    if (req.user.role === "employee") {
      r = await query("UPDATE notices SET deleted_by_employee = true WHERE id = $1 AND to_employee = $2 RETURNING *", [req.params.id, req.user.id]);
    } else if (req.user.role === "company") {
      r = await query("UPDATE notices SET deleted_by_company = true WHERE id = $1 AND company_id = $2 RETURNING *", [req.params.id, req.user.companyId]);
    } else {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (!r.rows.length) return res.status(404).json({ error: "Not found" });
    const n = r.rows[0];
    if (n.deleted_by_company && n.deleted_by_employee) {
      await query("DELETE FROM notices WHERE id = $1", [n.id]);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete notice" });
  }
});

export default router;
