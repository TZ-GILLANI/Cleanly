import { Router } from "express";
import { query } from "../db.js";
import { sendPushDetailed, pushToMany } from "../lib/notify.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { rateLimit } from "./auth.js";

const router = Router();

/* GET /api/notifications — current user's feed + unread count.
   Lazy housekeeping: anything older than 48h is purged on read, so the
   in-app history never piles up (no cron needed). */
router.get("/", requireAuth, async (req, res) => {
  try {
    await query("DELETE FROM notifications WHERE user_id = $1 AND created_at < NOW() - INTERVAL '48 hours'", [req.user.id]);
    const r = await query(
      "SELECT id, type, title, body, booking_id, is_read, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50",
      [req.user.id]
    );
    const unread = r.rows.filter((n) => !n.is_read).length;
    res.json({ notifications: r.rows, unread });
  } catch (e) { res.status(500).json({ error: "Failed to fetch notifications" }); }
});

/* PUT /api/notifications/read — mark all read */
router.put("/read", requireAuth, async (req, res) => {
  try {
    await query("UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false", [req.user.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});

/* PUT /api/notifications/:id/read — mark one read */
router.put("/:id/read", requireAuth, async (req, res) => {
  try {
    await query("UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});

/* GET /api/notifications/push-status — did this account register a device? */
router.get("/push-status", requireAuth, async (req, res) => {
  try {
    const r = await query("SELECT push_token FROM users WHERE id = $1", [req.user.id]);
    const t = r.rows[0]?.push_token || null;
    res.json({ registered: !!t, preview: t ? String(t).slice(0, 12) + "…" : null });
  } catch (e) {
    // column missing => schema.sql has not been run yet
    res.json({ registered: false, schemaMissing: /push_token/.test(e.message || "") });
  }
});

/* POST /api/notifications/push-token — device registers for real push */
router.post("/push-token", requireAuth, async (req, res) => {
  if (!rateLimit("ptok:" + req.user.id, 10, 10 * 60e3)) return res.status(429).json({ error: "Too many attempts" });
  try {
    const token = String(req.body?.token || "").slice(0, 512);
    if (!token) return res.status(400).json({ error: "token required" });
    await query("UPDATE users SET push_token = $1 WHERE id = $2", [token, req.user.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: "Could not save push token" }); }
});

/* POST /api/notifications/push-test — fire a real push at YOUR OWN device and
   return Firebase's exact verdict, so delivery problems explain themselves. */
router.post("/push-test", requireAuth, async (req, res) => {
  if (!rateLimit("ptest:" + req.user.id, 6, 10 * 60e3)) return res.status(429).json({ error: "Too many tests — wait a few minutes" });
  try {
    const out = await sendPushDetailed(req.user.id, "Cleano test 🔔", "If you can read this on your phone, push works.");
    res.json(out);
  } catch (e) { res.json({ sent: false, reason: "server-error", detail: String(e.message || e).slice(0, 200) }); }
});

/* DELETE /api/notifications/push-token — this account stops receiving pushes
   on the current device (called at logout). */
router.delete("/push-token", requireAuth, async (req, res) => {
  try { await query("UPDATE users SET push_token = NULL WHERE id = $1", [req.user.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: "Could not unregister" }); }
});

/* DELETE /api/notifications — clear the current user's notification history */
router.delete("/", requireAuth, async (req, res) => {
  try {
    await query("DELETE FROM notifications WHERE user_id = $1", [req.user.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: "Could not clear notifications" }); }
});

/* POST /api/notifications/broadcast — admin announcement to all users or a segment.
   Body: { title, body, audience: "all" | "customer" | "company" | "employee" }
   Lands in every target user's in-app feed (top banner + history).
   PUSH ROADMAP: when FCM/OneSignal keys exist, fan the same payload out to
   device tokens right here — one hook point, no client changes needed. */
router.post("/broadcast", requireAuth, requireRole("admin"), async (req, res) => {
  if (!req.user.isSuper) return res.status(403).json({ error: "Only the CEO can send announcements" });
  try {
    const title = String(req.body?.title || "").trim();
    const body = String(req.body?.body || "").trim();
    if (!title) return res.status(400).json({ error: "Title is required" });
    if (title.length > 120 || body.length > 500) return res.status(400).json({ error: "Too long" });

    /* ── 5.5 Targeted audiences. Blasting everyone when you meant one city is
       a mistake you make once, so the caller must confirm a recipient count. ── */
    const { where, params } = audienceFilter(req.body || {});
    const preview = req.body?.preview === true;
    const cnt = await query(`SELECT COUNT(*)::int AS n FROM users WHERE ${where}`, params);
    if (preview) return res.json({ count: cnt.rows[0].n });
    if (!cnt.rows[0].n) return res.status(400).json({ error: "That audience matches nobody" });

    const r = await query(
      `INSERT INTO notifications (user_id, type, title, body)
       SELECT id, 'announcement', $${params.length + 1}, $${params.length + 2} FROM users WHERE ${where}`,
      [...params, title, body || null]);

    query(`SELECT id FROM users WHERE ${where} AND push_token IS NOT NULL`, params)
      .then((t) => pushToMany(t.rows.map((x) => x.id), title, body || ""))
      .catch((e) => console.error("broadcast push:", e.message));

    try {
      const { logAdmin } = await import("../lib/adminlog.js");
      await logAdmin(req, "broadcast.send", "notification", null,
        `audience=${JSON.stringify({ role: req.body?.audience, city: req.body?.city, country: req.body?.country, userId: req.body?.userId })} · recipients=${cnt.rows[0].n} · title="${title}"`);
    } catch {}

    res.json({ ok: true, sent: r.rowCount ?? cnt.rows[0].n, count: cnt.rows[0].n });
  } catch (e) {
    console.error("broadcast:", e.message);
    res.status(500).json({ error: "Broadcast failed" });
  }
});

/* Build the audience WHERE clause: everyone / role / city / country / one person. */
function audienceFilter(b) {
  const params = [];
  const parts = ["role != 'admin'", "is_active IS NOT false"];
  if (b.userId) { params.push(String(b.userId)); parts.push(`id = $${params.length}`); return { where: parts.join(" AND "), params }; }
  if (["customer", "company", "employee"].includes(b.audience)) { params.push(b.audience); parts.push(`role::text = $${params.length}`); }
  if (b.city) { params.push(String(b.city).trim()); parts.push(`LOWER(city) = LOWER($${params.length})`); }
  if (b.country) { params.push(String(b.country).toUpperCase().slice(0, 2)); parts.push(`country = $${params.length}`); }
  return { where: parts.join(" AND "), params };
}

export default router;
