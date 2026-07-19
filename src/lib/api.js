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
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const isApiMode = import.meta.env.VITE_USE_API === "true";
