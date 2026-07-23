/* Cleano — real push notifications via Firebase Cloud Messaging.
   Unified FCM tokens on iOS AND Android. Dormant on web and until the
   Firebase config files + server FIREBASE_SERVICE_ACCOUNT_B64 exist. */
import { API_BASE } from "./api.js";

export async function initPush(authToken) {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return; // web: do nothing
    const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");

    let perm = await FirebaseMessaging.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      perm = await FirebaseMessaging.requestPermissions();
    }
    if (perm.receive !== "granted") return;

    const { token } = await FirebaseMessaging.getToken();
    if (!token) return;
    await fetch((API_BASE || "") + "/api/notifications/push-token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
      body: JSON.stringify({ token, platform: Capacitor.getPlatform() }),
    });
  } catch (e) { /* plugin not synced yet — silently skip */ }
}
