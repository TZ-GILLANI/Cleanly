/* Cleano — real push notifications via Firebase Cloud Messaging.
   Talks to the native FirebaseMessaging plugin through Capacitor's bridge, so
   the heavy firebase web SDK is never bundled into the website. Native-only. */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { API_BASE } from "./api.js";

const FirebaseMessaging = registerPlugin("FirebaseMessaging");

/* Remember the last token we sent so we don't re-post it on every launch. */
const LAST_KEY = "cleanly_push_token";

async function sendToken(token, authToken, userId) {
  if (!token) return;
  // Cache per ACCOUNT — two people sharing a phone must each register.
  const cacheVal = String(userId || "") + ":" + token;
  try { if (localStorage.getItem(LAST_KEY) === cacheVal) return; } catch {}
  try {
    const res = await fetch((API_BASE || "") + "/api/notifications/push-token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
      body: JSON.stringify({ token, platform: Capacitor.getPlatform() }),
    });
    if (res.ok) { try { localStorage.setItem(LAST_KEY, cacheVal); } catch {} }
  } catch {}
}

export async function initPush(authToken, userId) {
  try {
    if (!Capacitor.isNativePlatform()) return;   // website: nothing to do

    // 1. permission (iOS shows the system prompt here)
    let perm = await FirebaseMessaging.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      perm = await FirebaseMessaging.requestPermissions();
    }
    if (perm.receive !== "granted") return;

    // 2. fresh listeners (a re-login must not stack duplicates)
    try { await FirebaseMessaging.removeAllListeners(); } catch {}

    // Firebase can rotate the token at any time — always re-register it.
    FirebaseMessaging.addListener("tokenReceived", (e) => sendToken(e && e.token, authToken, userId));

    // With the app open, iOS suppresses the system banner — show our own.
    FirebaseMessaging.addListener("notificationReceived", (e) => {
      const n = (e && e.notification) || {};
      if (!n.title) return;
      try { window.dispatchEvent(new CustomEvent("cleano-push", { detail: { title: n.title, body: n.body } })); } catch {}
    });

    // 3. register this device
    const res = await FirebaseMessaging.getToken();
    await sendToken(res && res.token, authToken, userId);
  } catch (e) {
    // plugin missing (web build) or Firebase not configured yet — stay silent
  }
}

/* Clear the cached token on logout so the next user registers their own. */
export function forgetPushToken() {
  try { localStorage.removeItem(LAST_KEY); } catch {}
}
