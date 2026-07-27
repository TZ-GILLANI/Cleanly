import { query } from "../db.js";
import jwt from "jsonwebtoken";

/* ── Firebase Cloud Messaging (dormant until FIREBASE_SERVICE_ACCOUNT_B64 is set) ──
   Env var = base64 of the service-account JSON downloaded from Firebase console
   (Project settings → Service accounts → Generate new private key). */
let fcmCache = { token: null, exp: 0, sa: undefined };
function serviceAccount() {
  if (fcmCache.sa !== undefined) return fcmCache.sa;
  try {
    const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
    fcmCache.sa = b64 ? JSON.parse(Buffer.from(b64, "base64").toString("utf8")) : null;
  } catch (e) { console.error("FCM service account unreadable:", e.message); fcmCache.sa = null; }
  return fcmCache.sa;
}
async function fcmAccessToken() {
  const sa = serviceAccount();
  if (!sa) return null;
  if (fcmCache.token && Date.now() < fcmCache.exp - 60e3) return fcmCache.token;
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    { iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 },
    sa.private_key, { algorithm: "RS256" }
  );
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const d = await r.json();
  if (!r.ok) { console.error("FCM token:", d.error_description || d.error); return null; }
  fcmCache.token = d.access_token; fcmCache.exp = Date.now() + (d.expires_in || 3600) * 1000;
  return fcmCache.token;
}
async function sendPush(userId, title, body) {
  try {
    const sa = serviceAccount();
    if (!sa) return; // dormant
    const u = await query("SELECT push_token FROM users WHERE id = $1", [userId]);
    const token = u.rows[0]?.push_token;
    if (!token) return;
    const access = await fcmAccessToken();
    if (!access) return;
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: "POST", headers: { Authorization: "Bearer " + access, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body: body || "" },
          // iOS needs an explicit APNs payload or the phone stays silent when
          // the app is closed; sound+badge also make it behave like a real app.
          apns: {
            headers: { "apns-priority": "10", "apns-push-type": "alert" },
            payload: { aps: { alert: { title, body: body || "" }, sound: "default", badge: 1, "content-available": 1 } },
          },
          android: { priority: "high", notification: { sound: "default", default_sound: true } },
        },
      }),
    });
    if (r.status === 404 || r.status === 410) { // token dead — clean it up
      await query("UPDATE users SET push_token = NULL WHERE id = $1", [userId]);
      console.warn("push: token expired, cleared for user", userId);
    } else if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.error("push send failed", r.status, txt.slice(0, 300));
    }
  } catch (e) { console.error("push failed:", e.message); }
}

/* In-app notification + real phone push (when Firebase is configured).
   Non-fatal: never breaks the action that triggered it. */
export async function notify(userId, type, title, body, bookingId) {
  try {
    if (!userId) return;
    await query(
      "INSERT INTO notifications (user_id, type, title, body, booking_id) VALUES ($1,$2,$3,$4,$5)",
      [userId, type, title || "", body || null, bookingId || null]
    );
    sendPush(userId, title, body); // fire-and-forget
  } catch (e) { console.error("notify failed:", e.message); }
}
