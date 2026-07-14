import { query } from "../db.js";

/* In-app notification. Non-fatal: never breaks the action that triggered it. */
export async function notify(userId, type, title, body, bookingId) {
  try {
    if (!userId) return;
    await query(
      "INSERT INTO notifications (user_id, type, title, body, booking_id) VALUES ($1,$2,$3,$4,$5)",
      [userId, type, title || "", body || null, bookingId || null]
    );
  } catch (e) { console.error("notify failed:", e.message); }
}
