import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

/* GET /api/notices */
router.get("/", requireAuth, async (req, res) => {
  try {
    let result;
    if (req.user.role === "employee") {
      result = await query(
        "SELECT n.*, c.name AS company_name, c.emoji AS company_emoji, c.cover AS company_cover FROM notices n JOIN companies c ON c.id = n.company_id WHERE n.to_employee = $1 ORDER BY n.created_at DESC",
        [req.user.id]
      );
    } else if (req.user.role === "company") {
      result = await query(
        "SELECT n.*, u.full_name AS employee_name FROM notices n JOIN users u ON u.id = n.to_employee WHERE n.company_id = $1 ORDER BY n.created_at DESC",
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
    const emp = await query("SELECT id FROM users WHERE id = $1 AND company_id = $2", [toEmployee, req.user.companyId]);
    if (!emp.rows.length) return res.status(403).json({ error: "Employee not in your company" });

    const result = await query(
      "INSERT INTO notices (company_id, to_employee, body) VALUES ($1,$2,$3) RETURNING *",
      [req.user.companyId, toEmployee, body]
    );
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
      "UPDATE notices SET is_read = true WHERE id = $1 AND to_employee = $2 RETURNING *",
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Notice not found" });
    res.json({ notice: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to update notice" });
  }
});

export default router;
