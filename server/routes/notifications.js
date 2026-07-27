import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

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
  try {
    const token = String(req.body?.token || "").slice(0, 512);
    if (!token) return res.status(400).json({ error: "token required" });
    await query("UPDATE users SET push_token = $1 WHERE id = $2", [token, req.user.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: "Could not save push token" }); }
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
    const audience = ["all", "customer", "company", "employee"].includes(req.body?.audience) ? req.body.audience : "all";
    if (!title) return res.status(400).json({ error: "Title is required" });
    if (title.length > 120 || body.length > 500) return res.status(400).json({ error: "Too long" });
    const r = await query(
      `INSERT INTO notifications (user_id, type, title, body)
       SELECT id, 'announcement', $1, $2 FROM users
       WHERE role != 'admin' AND ($3 = 'all' OR role::text = $3)`,
      [title, body || null, audience]
    );
    res.json({ ok: true, sent: r.rowCount });
  } catch (e) { res.status(500).json({ error: "Broadcast failed" }); }
});

export default router;
