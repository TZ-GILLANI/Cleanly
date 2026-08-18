/* Cleano API client — wraps fetch('/api/*') with auth headers */

// Web build: same origin ("").  Mobile (Capacitor) build: the app runs from the
// phone, so it needs the FULL server URL — set VITE_API_BASE in .env.production.
export const API_BASE = import.meta.env.VITE_API_BASE || "";

let _token = typeof window !== "undefined" ? localStorage.getItem("cleanly_jwt") : null;

export const getToken = () => _token;
export const setToken = (t) => {
  _token = t;
  if (t) localStorage.setItem("cleanly_jwt", t);
  else localStorage.removeItem("cleanly_jwt");
};

export async function api(path, { method = "GET", body, ...opts } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (_token) headers["Authorization"] = `Bearer ${_token}`;
  const res = await fetch(API_BASE + "/api" + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    /* The server answers in English on the wire — logs, tests and 1.0 clients all
       depend on that. Translate at the moment it becomes something a person reads,
       through the same dictionary the rest of the UI uses. Anything we have not
       translated falls through as English rather than disappearing. */
    const raw = data.error || `HTTP ${res.status}`;
    let msg = raw;
    try {
      const { getLang } = await import("./i18n.js");
      const { xl } = await import("./translations.js");
      const lg = getLang();
      if (lg && lg !== "en") msg = xl(lg, raw) || raw;
    } catch { /* never let a translation problem hide the real error */ }
    const err = new Error(msg);
    err.rawMessage = raw;          // keep the English for logging and matching
    err.status = res.status;
    throw err;
  }
  return data;
}

export const isApiMode = import.meta.env.VITE_USE_API === "true";
