import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

/* GET /api/notifications — current user's feed + unread count */
router.get("/", requireAuth, async (req, res) => {
  try {
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

export default router;
