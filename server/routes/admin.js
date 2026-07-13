import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireRole, requireSuper } from "../middleware/auth.js";
import { sendEmail } from "../lib/mailer.js";
import { logAdmin } from "../lib/adminlog.js";

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
    const co = result.rows[0];
    // Approving a company unlocks the owner's login and emails them.
    if (isApproved === true) {
      const owner = await query(
        "UPDATE users SET approval_status = 'approved' WHERE id = $1 RETURNING email, full_name",
        [co.owner_id]
      );
      if (owner.rows.length) {
        sendEmail(owner.rows[0].email, `${co.name} is approved on Cleanly ✅`,
          `<div style="font-family:sans-serif;max-width:520px"><h2 style="color:#1B2A6B">Welcome aboard, ${co.name}! 🐙</h2>
           <p>Your company has been verified and approved — you can now log in, list your services and receive bookings.</p>
           <p><a href="${process.env.PUBLIC_BASE_URL || "https://cleanly-2x9z.onrender.com"}" style="background:#1B2A6B;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Log in to Cleanly</a></p>
           <p style="color:#69718F;font-size:13px">Tip: open Settings and tap "Set up automatic payouts" so card payments land straight in your bank.</p></div>`);
      }
    }
    if (isApproved === false) {
      await query("UPDATE users SET approval_status = 'pending' WHERE id = $1", [co.owner_id]);
    }
    if (isApproved === true) logAdmin(req, "company_approved", "company", co.id, co.name);
    else if (isApproved === false) logAdmin(req, "company_rejected", "company", co.id, co.name);
    if (isListed === true) logAdmin(req, "company_listed", "company", co.id, co.name);
    else if (isListed === false) logAdmin(req, "company_unlisted", "company", co.id, co.name);
    res.json({ company: co });
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
  const { isActive, makeAdmin, approvalStatus } = req.body || {};
  try {
    if (approvalStatus !== undefined) {
      if (!["approved", "rejected", "pending"].includes(approvalStatus)) return res.status(400).json({ error: "Invalid approval status" });
      const r = await query("UPDATE users SET approval_status = $1 WHERE id = $2 RETURNING id, email, full_name, approval_status", [approvalStatus, req.params.id]);
      if (!r.rows.length) return res.status(404).json({ error: "User not found" });
      const u = r.rows[0];
      if (approvalStatus === "approved") {
        sendEmail(u.email, "Your Cleanly student account is approved 🎓",
          `<div style="font-family:sans-serif;max-width:520px"><h2 style="color:#1B2A6B">Welcome to Cleanly, ${u.full_name}! 🐙</h2>
           <p>Your student card has been verified — your account is now active and your student discount is live.</p>
           <p><a href="${process.env.PUBLIC_BASE_URL || "https://cleanly-2x9z.onrender.com"}" style="background:#1B2A6B;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Log in and book your first clean</a></p>
           <p style="color:#69718F;font-size:13px">Cleanly · Hungary · Eight arms, zero dust</p></div>`);
      }
      logAdmin(req, approvalStatus === "approved" ? "student_approved" : approvalStatus === "rejected" ? "student_rejected" : "student_pending", "user", u.id, `${u.full_name} (${u.email})`);
      return res.json({ user: u });
    }
    if (makeAdmin !== undefined) {
      if (req.params.id === req.user.id) return res.status(400).json({ error: "You cannot change your own admin access" });
      const target = await query("SELECT role FROM users WHERE id = $1", [req.params.id]);
      if (!target.rows.length) return res.status(404).json({ error: "User not found" });
      if (target.rows[0].role === "company") return res.status(400).json({ error: "Company owners cannot become platform admins" });
      const newRole = makeAdmin ? "admin" : "customer";
      const r = await query("UPDATE users SET role = $1 WHERE id = $2 RETURNING id, role", [newRole, req.params.id]);
      logAdmin(req, makeAdmin ? "admin_granted" : "admin_revoked", "user", req.params.id, newRole);
      return res.json({ user: r.rows[0] });
    }
    if (typeof isActive !== "boolean") return res.status(400).json({ error: "isActive must be boolean" });
    if (req.params.id === req.user.id && !isActive) return res.status(400).json({ error: "You cannot deactivate yourself" });
    const r = await query("UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, is_active", [isActive, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: "User not found" });
    logAdmin(req, isActive ? "user_activated" : "user_deactivated", "user", req.params.id, null);
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

router.delete("/users/:id", ...guard, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "You cannot delete your own account here" });
  try {
    const target = await query("SELECT id, email, full_name, role, company_id FROM users WHERE id = $1", [req.params.id]);
    if (!target.rows.length) return res.status(404).json({ error: "User not found" });
    const u = target.rows[0];
    const anonEmail = `deleted-${u.id}-${Date.now()}@deleted.cleanly`;
    await query(
      `UPDATE users SET email = $1, full_name = 'Deleted user', phone = NULL, address = NULL, documents = '[]'::jsonb, password_hash = 'account-deleted', is_active = false WHERE id = $2`,
      [anonEmail, u.id]
    );
    if (u.role === "company" && u.company_id) await query("UPDATE companies SET is_listed = false WHERE id = $1", [u.company_id]);
    logAdmin(req, "account_deleted", "user", u.id, `${u.full_name} (${u.email})`);
    res.json({ ok: true });
  } catch (err) {
    console.error("admin delete error:", err);
    res.status(500).json({ error: "Could not delete account" });
  }
});

router.get("/log", ...guard, async (req, res) => {
  try {
    const result = await query(
      "SELECT id, admin_email, admin_name, action, target_type, target_id, detail, created_at FROM admin_log ORDER BY created_at DESC LIMIT 300"
    );
    res.json({ log: result.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch log" });
  }
});

export default router;
