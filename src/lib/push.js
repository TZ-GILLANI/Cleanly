/* Cleano — real push notifications via Firebase Cloud Messaging.
   Talks to the native FirebaseMessaging plugin directly through Capacitor's
   bridge, so the heavy firebase web SDK is never bundled. Native-only. */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { API_BASE } from "./api.js";

const FirebaseMessaging = registerPlugin("FirebaseMessaging");

export async function initPush(authToken) {
  try {
    if (!Capacitor.isNativePlatform()) return; // web: do nothing
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
  } catch (e) { /* native plugin not present (e.g. web) — skip */ }
}
