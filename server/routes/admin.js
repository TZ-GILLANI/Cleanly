import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const guard = [requireAuth, requireRole("admin")];

/* GET /api/admin/stats */
router.get("/stats", ...guard, async (req, res) => {
  try {
    const [users, companies, bookings, revenue] = await Promise.all([
      query("SELECT COUNT(*) FROM users WHERE role != 'admin'"),
      query("SELECT COUNT(*) FROM companies"),
      query("SELECT COUNT(*), status FROM bookings GROUP BY status"),
      query("SELECT COALESCE(SUM(total_huf),0) AS total FROM bookings WHERE status = 4"),
    ]);

    const bookingsByStatus = {};
    bookings.rows.forEach((r) => { bookingsByStatus[r.status] = parseInt(r.count); });

    res.json({
      stats: {
        totalUsers: parseInt(users.rows[0].count),
        totalCompanies: parseInt(companies.rows[0].count),
        totalBookings: Object.values(bookingsByStatus).reduce((a, b) => a + b, 0),
        completedBookings: bookingsByStatus[4] || 0,
        activeBookings: (bookingsByStatus[1] || 0) + (bookingsByStatus[2] || 0) + (bookingsByStatus[3] || 0),
        totalRevenue: parseInt(revenue.rows[0].total),
        bookingsByStatus,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

/* GET /api/admin/companies */
router.get("/companies", ...guard, async (req, res) => {
  try {
    const result = await query(
      `SELECT c.*, u.email AS owner_email, u.full_name AS owner_name,
        (SELECT COUNT(*) FROM bookings b WHERE b.company_id = c.id) AS booking_count,
        (SELECT COALESCE(SUM(b.total_huf),0) FROM bookings b WHERE b.company_id = c.id AND b.status = 4) AS revenue
       FROM companies c
       JOIN users u ON u.id = c.owner_id
       ORDER BY c.created_at DESC`
    );
    res.json({ companies: result.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch companies" });
  }
});

/* PUT /api/admin/companies/:id */
router.put("/companies/:id", ...guard, async (req, res) => {
  const { isApproved, isListed } = req.body;
  try {
    const result = await query(
      "UPDATE companies SET is_approved = COALESCE($1, is_approved), is_listed = COALESCE($2, is_listed) WHERE id = $3 RETURNING *",
      [isApproved, isListed, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Company not found" });
    res.json({ company: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to update company" });
  }
});

/* GET /api/admin/users */
router.get("/users", ...guard, async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.email, u.role, u.full_name, u.is_active, u.created_at, u.documents,
        c.name AS company_name
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       WHERE u.role != 'admin'
       ORDER BY u.created_at DESC`
    );
    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

/* PUT /api/admin/users/:id */
router.put("/users/:id", ...guard, async (req, res) => {
  const { isActive, makeAdmin } = req.body || {};
  try {
    if (makeAdmin !== undefined) {
      if (req.params.id === req.user.id) return res.status(400).json({ error: "You cannot change your own admin access" });
      const target = await query("SELECT role FROM users WHERE id = $1", [req.params.id]);
      if (!target.rows.length) return res.status(404).json({ error: "User not found" });
      if (target.rows[0].role === "company") return res.status(400).json({ error: "Company owners cannot become platform admins" });
      const newRole = makeAdmin ? "admin" : "customer";
      const r = await query("UPDATE users SET role = $1 WHERE id = $2 RETURNING id, role", [newRole, req.params.id]);
      return res.json({ user: r.rows[0] });
    }
    if (typeof isActive !== "boolean") return res.status(400).json({ error: "isActive must be boolean" });
    if (req.params.id === req.user.id && !isActive) return res.status(400).json({ error: "You cannot deactivate yourself" });
    const r = await query("UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, is_active", [isActive, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: "User not found" });
    res.json({ user: r.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update user" });
  }
});

/* GET /api/admin/bookings */
router.get("/bookings", ...guard, async (req, res) => {
  try {
    const result = await query(
      `SELECT b.*, c.name AS company_name, c.emoji AS company_emoji,
        cu.full_name AS customer_full_name, cu.email AS customer_email,
        emp.full_name AS employee_name
       FROM bookings b
       JOIN companies c ON c.id = b.company_id
       JOIN users cu ON cu.id = b.customer_id
       LEFT JOIN users emp ON emp.id = b.assigned_to
       ORDER BY b.created_at DESC
       LIMIT 200`
    );
    res.json({ bookings: result.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
});

/* GET /api/admin/revenue — revenue by day (last 30 days) */
router.get("/revenue", ...guard, async (req, res) => {
  try {
    const result = await query(
      `SELECT scheduled_date::TEXT AS date, COUNT(*) AS bookings, COALESCE(SUM(total_huf),0) AS revenue
       FROM bookings
       WHERE status = 4 AND scheduled_date >= NOW() - INTERVAL '30 days'
       GROUP BY scheduled_date
       ORDER BY scheduled_date ASC`
    );
    res.json({ revenue: result.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch revenue" });
  }
});

export default router;
