import { Router } from "express";
import crypto from "crypto";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { buildCalendar } from "../lib/ics.js";

const router = Router();

/* ─────────────────────────────────────────────────────────────────────────
   Calendar sync.

   Calendar apps cannot send an Authorization header, so a subscription feed
   has to authenticate with a secret in the URL. That secret is therefore:
     • separate from the login token (leaking it never risks the account)
     • random, 32 bytes
     • revocable in one tap, which rotates it and kills every old link
     • read-only, and scoped to exactly what that role may already see

   Each role gets its own view of the same data:
     customer → their own bookings
     company  → every booking for the company
     cleaner  → only the jobs assigned to them
   ───────────────────────────────────────────────────────────────────────── */

const FEED_WINDOW_DAYS = 120;   // past window; the future is unbounded

async function ensureToken(userId) {
  const cur = await query("SELECT calendar_token FROM users WHERE id = $1", [userId]);
  if (cur.rows[0]?.calendar_token) return cur.rows[0].calendar_token;
  const tok = crypto.randomBytes(24).toString("base64url");
  await query("UPDATE users SET calendar_token = $1 WHERE id = $2", [tok, userId]);
  return tok;
}

function baseUrl(req) {
  /* Accept either name — PUBLIC_BASE_URL is what the deployment already sets. */
  const env = process.env.PUBLIC_API_URL || process.env.PUBLIC_BASE_URL;
  if (env) return env.replace(/\/+$/, "");
  return `${req.protocol}://${req.get("host")}`;
}

/* GET /api/calendar/me — my subscription link (creates one on first ask) */
router.get("/me", requireAuth, async (req, res) => {
  try {
    const tok = await ensureToken(req.user.id);
    const url = `${baseUrl(req)}/api/calendar/feed/${tok}.ics`;
    res.json({
      url,
      webcal: url.replace(/^https?:/, "webcal:"),
      role: req.user.role,
    });
  } catch (e) {
    console.error("calendar/me:", e.message);
    res.status(500).json({ error: "Could not build your calendar link" });
  }
});

/* POST /api/calendar/reset — rotate the secret; every old link stops working */
router.post("/reset", requireAuth, async (req, res) => {
  try {
    const tok = crypto.randomBytes(24).toString("base64url");
    await query("UPDATE users SET calendar_token = $1 WHERE id = $2", [tok, req.user.id]);
    const url = `${baseUrl(req)}/api/calendar/feed/${tok}.ics`;
    res.json({ url, webcal: url.replace(/^https?:/, "webcal:") });
  } catch (e) {
    console.error("calendar/reset:", e.message);
    res.status(500).json({ error: "Could not reset the link" });
  }
});

/* Pull the right bookings for whoever owns this token. */
async function bookingsFor(user) {
  const since = new Date(Date.now() - FEED_WINDOW_DAYS * 864e5).toISOString().slice(0, 10);
  if (user.role === "customer") {
    const r = await query(
      `SELECT b.*, c.name AS company_name
         FROM bookings b LEFT JOIN companies c ON c.id = b.company_id
        WHERE b.customer_id = $1 AND b.scheduled_date >= $2
        ORDER BY b.scheduled_date ASC`, [user.id, since]);
    return { rows: r.rows, role: "customer", name: "Cleano — my cleanings" };
  }
  if (user.role === "employee") {
    const r = await query(
      `SELECT b.*, cu.full_name AS customer_name, cu.phone AS customer_phone
         FROM bookings b LEFT JOIN users cu ON cu.id = b.customer_id
        WHERE b.assigned_to = $1 AND b.scheduled_date >= $2
        ORDER BY b.scheduled_date ASC`, [user.id, since]);
    return { rows: r.rows, role: "employee", name: "Cleano — my jobs" };
  }
  if (user.role === "company" && user.company_id) {
    const r = await query(
      `SELECT b.*,
              CASE WHEN cu.deleted_name IS NOT NULL THEN 'Cleano customer' ELSE cu.full_name END AS customer_name,
              CASE WHEN cu.deleted_name IS NOT NULL THEN NULL ELSE cu.phone END AS customer_phone,
              u.full_name AS assigned_name
         FROM bookings b
         LEFT JOIN users cu ON cu.id = b.customer_id
         LEFT JOIN users u  ON u.id  = b.assigned_to
        WHERE b.company_id = $1 AND b.scheduled_date >= $2
          AND (b.payment_status IN ('paid','scheduled','retry') OR b.status <> 0)
        ORDER BY b.scheduled_date ASC`, [user.company_id, since]);
    return { rows: r.rows, role: "company", name: "Cleano — company schedule" };
  }
  return { rows: [], role: "customer", name: "Cleano" };
}

/* GET /api/calendar/feed/:token.ics — the live feed. No login: the token IS the key.
   Deliberately unauthenticated because that is the only thing calendar apps can do. */
router.get("/feed/:token.ics", async (req, res) => {
  try {
    const tok = String(req.params.token || "");
    /* Length check first, so a short or empty token never reaches the database. */
    if (tok.length < 20 || tok.length > 128) return res.status(404).type("text/plain").send("Not found");

    const u = await query(
      "SELECT id, role, company_id, is_active FROM users WHERE calendar_token = $1", [tok]);
    const user = u.rows[0];
    if (!user || user.is_active === false) return res.status(404).type("text/plain").send("Not found");

    const { rows, role, name } = await bookingsFor(user);
    const body = buildCalendar(rows, { role, name });

    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.set("Content-Disposition", 'inline; filename="cleano.ics"');
    /* Never let a proxy or CDN cache someone's private schedule. */
    res.set("Cache-Control", "no-store, private");
    res.send(body);
  } catch (e) {
    console.error("calendar feed:", e.message);
    res.status(500).type("text/plain").send("Calendar unavailable");
  }
});

/* GET /api/calendar/booking/:id.ics — one booking, for the "Add to calendar" button.
   Logged in, and you only get it if you are actually part of this booking. */
router.get("/booking/:id.ics", requireAuth, async (req, res) => {
  try {
    const r = await query(
      `SELECT b.*, c.name AS company_name,
              CASE WHEN cu.deleted_name IS NOT NULL THEN 'Cleano customer' ELSE cu.full_name END AS customer_name,
              CASE WHEN cu.deleted_name IS NOT NULL THEN NULL ELSE cu.phone END AS customer_phone,
              u.full_name AS assigned_name
         FROM bookings b
         LEFT JOIN companies c ON c.id = b.company_id
         LEFT JOIN users cu ON cu.id = b.customer_id
         LEFT JOIN users u  ON u.id  = b.assigned_to
        WHERE b.id = $1`, [req.params.id]);
    const b = r.rows[0];
    if (!b) return res.status(404).json({ error: "Booking not found" });

    const isCustomer = b.customer_id === req.user.id;
    const isCleaner  = b.assigned_to === req.user.id;
    const isCompany  = req.user.role === "company" && b.company_id === req.user.companyId;
    if (!isCustomer && !isCleaner && !isCompany && req.user.role !== "admin") {
      return res.status(403).json({ error: "Not your booking" });
    }
    const role = isCustomer ? "customer" : isCompany ? "company" : "employee";
    const body = buildCalendar([b], { role, name: "Cleano" });
    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="cleano-booking-${b.order_no || "1"}.ics"`);
    res.set("Cache-Control", "no-store, private");
    res.send(body);
  } catch (e) {
    console.error("calendar booking:", e.message);
    res.status(500).json({ error: "Could not build the calendar file" });
  }
});

export default router;
