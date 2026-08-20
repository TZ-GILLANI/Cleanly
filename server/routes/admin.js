import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireRole, requireSuper } from "../middleware/auth.js";
import { sendEmail } from "../lib/mailer.js";
import { logAdmin } from "../lib/adminlog.js";
import { notify } from "../lib/notify.js";

const router = Router();
const guard = [requireAuth, requireRole("admin")];

/* GET /api/admin/stats */
router.get("/stats", ...guard, async (req, res) => {
  try {
    const [users, companies, bookings, revenue] = await Promise.all([
      query("SELECT COUNT(*) FROM users WHERE role != 'admin' AND password_hash <> 'account-deleted'"),
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
/* GET /api/admin/companies/:id/services — every listing of a company, hidden ones included */
router.get("/companies/:id/services", ...guard, async (req, res) => {
  try {
    const r = await query("SELECT * FROM services WHERE company_id = $1 ORDER BY created_at ASC", [req.params.id]);
    res.json({ services: r.rows });
  } catch (err) { res.status(500).json({ error: "Failed to fetch services" }); }
});

router.get("/companies", ...guard, async (req, res) => {
  try {
    const result = await query(
      /* One grouped pass instead of two correlated subqueries per company.
         Postgres runs both fine; the reason this changed is that the in-memory
         database the tests use cannot resolve a correlated alias, so this
         endpoint returned 500 under test and the admin Companies screen could
         never be rendered by the suite — it was the only admin screen with no
         coverage, and the one that had already shipped a crash. */
      `SELECT c.*, u.email AS owner_email, u.full_name AS owner_name,
        COALESCE(b.cnt, 0)  AS booking_count,
        COALESCE(b.rev, 0)  AS revenue
       FROM companies c
       JOIN users u ON u.id = c.owner_id
       LEFT JOIN (
         SELECT company_id,
                COUNT(*) AS cnt,
                SUM(CASE WHEN status = 4 THEN total_huf ELSE 0 END) AS rev
         FROM bookings GROUP BY company_id
       ) b ON b.company_id = c.id
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
        sendEmail(owner.rows[0].email, `${co.name} is approved on Cleano ✅`,
          `<div style="font-family:sans-serif;max-width:520px"><h2 style="color:#1B2A6B">Welcome aboard, ${co.name}! 🐙</h2>
           <p>Your company has been verified and approved — you can now log in, list your services and receive bookings.</p>
           <p><a href="${process.env.PUBLIC_BASE_URL || "https://cleanly-2x9z.onrender.com"}" style="background:#1B2A6B;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Log in to Cleanly</a></p>
           <p style="color:#69718F;font-size:13px">Tip: open Settings and tap "Set up automatic payouts" so card payments land straight in your bank.</p></div>`);
      }
    }
    if (isApproved === false) {
      await query("UPDATE users SET approval_status = 'pending' WHERE id = $1", [co.owner_id]);
    }
    if (isApproved === true) { logAdmin(req, "company_approved", "company", co.id, co.name); notify(co.owner_id, "approval", "Company approved ✅", "Your company is verified — you can receive bookings now.", null); }
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
      `SELECT u.id, u.email, u.role, u.full_name, u.is_active, u.is_super, u.approval_status, u.student_upgrade, u.customer_type, u.phone, u.address, u.email_verified, u.phone_verified, u.deleted_name, u.deleted_email, u.created_at, u.documents,
        c.name AS company_name
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       WHERE u.password_hash <> 'account-deleted'
       ORDER BY (u.role = 'admin') DESC, u.created_at DESC`
    );
    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

/* PUT /api/admin/users/:id */
router.put("/users/:id", ...guard, async (req, res) => {
  const { isActive, makeAdmin, approvalStatus, upgradeDecision } = req.body || {};
  try {
    if (upgradeDecision !== undefined) {
      if (!["approve", "reject"].includes(upgradeDecision)) return res.status(400).json({ error: "Invalid decision" });
      const r = await query(
        upgradeDecision === "approve"
          ? "UPDATE users SET customer_type = 'student', student_upgrade = false WHERE id = $1 AND student_upgrade = true RETURNING id, email, full_name"
          : "UPDATE users SET student_upgrade = false WHERE id = $1 AND student_upgrade = true RETURNING id, email, full_name",
        [req.params.id]
      );
      if (!r.rows.length) return res.status(404).json({ error: "No upgrade request on this user" });
      const u = r.rows[0];
      logAdmin(req, upgradeDecision === "approve" ? "student_upgrade_approved" : "student_upgrade_rejected", "user", u.id, `${u.full_name} (${u.email})`);
      notify(u.id, "approval", upgradeDecision === "approve" ? "Student discount activated 🎓" : "Student verification declined",
        upgradeDecision === "approve" ? "Your student card is verified — student pricing is now live on your account. Log out and back in to see it." : "We could not verify your student card. You can try again with a clearer photo.", null);
      if (upgradeDecision === "approve") sendEmail(u.email, "Your Cleano student discount is active 🎓",
        `<div style="font-family:sans-serif;max-width:520px"><h2 style="color:#1B2A6B">Verified, ${u.full_name}! 🐙</h2><p>Your student card checked out — student pricing is now active. Log out and back in, then book away.</p></div>`);
      return res.json({ user: u });
    }
  } catch (err) { console.error(err); return res.status(500).json({ error: "Failed to update user" }); }

  try {
    if (approvalStatus !== undefined) {
      if (!["approved", "rejected", "pending"].includes(approvalStatus)) return res.status(400).json({ error: "Invalid approval status" });
      const r = await query("UPDATE users SET approval_status = $1 WHERE id = $2 RETURNING id, email, full_name, approval_status", [approvalStatus, req.params.id]);
      if (!r.rows.length) return res.status(404).json({ error: "User not found" });
      const u = r.rows[0];
      if (approvalStatus === "approved") {
        sendEmail(u.email, "Your Cleano student account is approved 🎓",
          `<div style="font-family:sans-serif;max-width:520px"><h2 style="color:#1B2A6B">Welcome to Cleano, ${u.full_name}! 🐙</h2>
           <p>Your student card has been verified — your account is now active and your student discount is live.</p>
           <p><a href="${process.env.PUBLIC_BASE_URL || "https://cleanly-2x9z.onrender.com"}" style="background:#1B2A6B;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Log in and book your first clean</a></p>
           <p style="color:#69718F;font-size:13px">Cleano · Hungary · Eight arms, zero dust</p></div>`);
      }
      logAdmin(req, approvalStatus === "approved" ? "student_approved" : approvalStatus === "rejected" ? "student_rejected" : "student_pending", "user", u.id, `${u.full_name} (${u.email})`);
      if (approvalStatus === "approved") notify(u.id, "approval", "Account approved 🎓", "Your student account is verified — your discount is live.", null);
      return res.json({ user: u });
    }
    if (makeAdmin !== undefined) {
      if (!req.user.isSuper) return res.status(403).json({ error: "Only the CEO can grant or remove admin access" });
      if (req.params.id === req.user.id) return res.status(400).json({ error: "You cannot change your own admin access" });
      const target = await query("SELECT role, is_super FROM users WHERE id = $1", [req.params.id]);
      if (!target.rows.length) return res.status(404).json({ error: "User not found" });
      if (target.rows[0].is_super) return res.status(403).json({ error: "The CEO account cannot be modified" });
      if (target.rows[0].role === "company") return res.status(400).json({ error: "Company owners cannot become platform admins" });
      const newRole = makeAdmin ? "admin" : "customer";
      const r = await query("UPDATE users SET role = $1 WHERE id = $2 RETURNING id, role", [newRole, req.params.id]);
      logAdmin(req, makeAdmin ? "admin_granted" : "admin_revoked", "user", req.params.id, newRole);
      return res.json({ user: r.rows[0] });
    }
    if (typeof isActive !== "boolean") return res.status(400).json({ error: "isActive must be boolean" });
    if (req.params.id === req.user.id && !isActive) return res.status(400).json({ error: "You cannot deactivate yourself" });
    const tgt = await query("SELECT role, is_super FROM users WHERE id = $1", [req.params.id]);
    if (!tgt.rows.length) return res.status(404).json({ error: "User not found" });
    if (tgt.rows[0].is_super) return res.status(403).json({ error: "The CEO account cannot be deactivated" });
    if (tgt.rows[0].role === "admin" && !req.user.isSuper) return res.status(403).json({ error: "Only the CEO can deactivate admins" });
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
      /* No ::TEXT cast: db.js registers a type parser that hands DATE back as a
         plain 'YYYY-MM-DD' string already, precisely so the front end never
         receives a JS Date and re-reads it in the browser's timezone. */
      `SELECT scheduled_date AS date, COUNT(*) AS bookings, COALESCE(SUM(total_huf),0) AS revenue
       FROM bookings
       -- CURRENT_DATE, not NOW(): scheduled_date is a DATE, and comparing it
       -- against a timestamptz drags the server's timezone into the answer —
       -- the last day of the window slides depending on the hour you ask.
       -- Date against date is both correct and the same in every timezone.
       WHERE status = 4 AND scheduled_date >= CURRENT_DATE - 30
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
    const target = await query("SELECT id, email, full_name, role, company_id, is_super FROM users WHERE id = $1", [req.params.id]);
    if (!target.rows.length) return res.status(404).json({ error: "User not found" });
    const u = target.rows[0];
    if (u.is_super) return res.status(403).json({ error: "The CEO account cannot be deleted from the panel" });
    if (u.role === "admin" && !req.user.isSuper) return res.status(403).json({ error: "Only the CEO can delete admin accounts" });
    const anonEmail = `deleted-${u.id}-${Date.now()}@deleted.cleanly`;
    await query(
      `UPDATE users SET deleted_name = COALESCE(deleted_name, full_name), deleted_email = COALESCE(deleted_email, email), email = $1, full_name = 'Deleted user', phone = NULL, address = NULL, documents = '[]'::jsonb, password_hash = 'account-deleted', is_active = false WHERE id = $2`,
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


/* ── 5.10a Full user record. Support work needs the whole picture in one
      place. Secrets stay out — safeUser-style stripping is enforced by the
      explicit column list below. ── */
router.get("/users/:id/full", ...guard, async (req, res) => {
  try {
    const u = await query(
      `SELECT id, email, full_name, role, phone, address, city, country, customer_type,
              approval_status, is_active, is_super, phone_verified, email_verified,
              lang, documents, company_id, created_at, card_brand, card_last4
         FROM users WHERE id = $1`, [req.params.id]);
    if (!u.rows.length) return res.status(404).json({ error: "User not found" });

    const [bookings, reviews, complaints, company] = await Promise.all([
      query(`SELECT b.id, b.order_no, b.scheduled_date, b.scheduled_slot, b.status, b.payment_status,
                    b.enroute_at, b.started_at, b.finished_at, b.collected_at, b.returned_at, b.fulfilment,
                    b.total_huf, b.total_minor, b.currency, b.address, b.service_snapshot,
                    c.name AS company_name
               FROM bookings b LEFT JOIN companies c ON c.id = b.company_id
              WHERE b.customer_id = $1 OR b.assigned_to = $1
              ORDER BY b.scheduled_date DESC LIMIT 200`, [req.params.id]),
      query(`SELECT r.id, r.stars, r.body, r.created_at, r.removed_at, c.name AS company_name
               FROM reviews r LEFT JOIN companies c ON c.id = r.company_id
              WHERE r.customer_id = $1 ORDER BY r.created_at DESC LIMIT 100`, [req.params.id]),
      query(`SELECT id, subject, body, status, resolution, created_at FROM complaints
              WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [req.params.id]).catch(() => ({ rows: [] })),
      // company-role users own their company via owner_id; company_id may be unset
      query(`SELECT id, name, tagline, area, city, country, contact_phone, tax_id, reg_number,
                    service_radius_km, service_lat, service_lng, currency, rating, review_count,
                    emoji, is_approved, is_listed, created_at,
                    (stripe_account_id IS NOT NULL) AS stripe_ready
               FROM companies WHERE id = $1 OR owner_id = $2 LIMIT 1`,
             [u.rows[0].company_id || null, req.params.id]),
    ]);
    res.json({
      user: u.rows[0],
      bookings: bookings.rows,
      reviews: reviews.rows,
      complaints: complaints.rows,
      company: company.rows[0] || null,
    });
  } catch (e) {
    console.error("admin user full:", e.message);
    res.status(500).json({ error: "Could not load the user" });
  }
});

/* ── 5.10b Admin edits a company. Deliberately NOT editable: the Stripe
      account id (would redirect their money), their password, and their
      prices/services (their business decision — unlist instead). Every
      change is logged field-by-field with before → after. ── */
const ADMIN_EDITABLE = ["name", "tagline", "area", "city", "country", "contact_phone",
  "tax_id", "reg_number", "emoji", "logo_url", "cover", "service_radius_km",
  "service_lat", "service_lng", "is_listed", "is_approved"];

router.put("/companies/:id/details", ...guard, async (req, res) => {
  try {
    const before = await query("SELECT * FROM companies WHERE id = $1", [req.params.id]);
    if (!before.rows.length) return res.status(404).json({ error: "Company not found" });
    const b = before.rows[0];

    const sets = [], vals = [];
    const changes = [];
    for (const key of ADMIN_EDITABLE) {
      if (!(key in (req.body || {}))) continue;
      let v = req.body[key];
      if (v === "" ) v = null;
      if (String(b[key] ?? "") === String(v ?? "")) continue;
      vals.push(v);
      sets.push(`${key} = $${vals.length}`);
      changes.push(`${key}: "${String(b[key] ?? "").slice(0, 60)}" → "${String(v ?? "").slice(0, 60)}"`);
    }
    if (!sets.length) return res.json({ company: b, changed: 0 });
    vals.push(req.params.id);
    const upd = await query(`UPDATE companies SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`, vals);
    await logAdmin(req, "company.edit", "company", req.params.id, changes.join(" · "));
    res.json({ company: upd.rows[0], changed: changes.length });
  } catch (e) {
    console.error("admin company edit:", e.message);
    res.status(500).json({ error: "Could not save the changes" });
  }
});

export default router;
