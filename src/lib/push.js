/* Cleano — real push notifications (Firebase Cloud Messaging via Capacitor).
   Fully dormant on the web and until google-services.json + the server's
   FIREBASE_SERVICE_ACCOUNT_B64 exist. Safe to call anytime. */
import { API_BASE } from "./api.js";

export async function initPush(authToken) {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return; // web build: do nothing
    const { PushNotifications } = await import("@capacitor/push-notifications");

    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt") perm = await PushNotifications.requestPermissions();
    if (perm.receive !== "granted") return;

    await PushNotifications.removeAllListeners();
    PushNotifications.addListener("registration", async (t) => {
      try {
        await fetch((API_BASE || "") + "/api/notifications/push-token", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
          body: JSON.stringify({ token: t.value, platform: Capacitor.getPlatform() }),
        });
      } catch {}
    });
    await PushNotifications.register();
  } catch {} // plugin missing / not synced yet — silently skip
}
