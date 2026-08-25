import "dotenv/config";
import { startReminders } from "./lib/reminders.js";
import { wire as wireAlerts, alert } from "./lib/alerts.js";
import { startSubscriptions } from "./lib/subscriptions.js";
import { query } from "./db.js";
import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import path from "path";

import authRouter from "./routes/auth.js";
import companiesRouter from "./routes/companies.js";
import servicesRouter from "./routes/services.js";
import bookingsRouter from "./routes/bookings.js";
import employeesRouter from "./routes/employees.js";
import noticesRouter from "./routes/notices.js";
import reviewsRouter from "./routes/reviews.js";
import adminRouter from "./routes/admin.js";
import paymentsRouter, { stripeWebhook, simplepayIpn } from "./routes/payments.js";
import complaintsRouter from "./routes/complaints.js";
import notificationsRouter from "./routes/notifications.js";
import verifyRouter from "./routes/verify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

const corsOrigins = [
  "http://localhost:5173",
  "http://localhost:4173",
  "capacitor://localhost",   // iOS app webview
  "http://localhost",        // Android app webview
  "https://localhost",
  ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",").map(o => o.trim()) : []),
];
app.use(cors({ origin: corsOrigins, credentials: true }));

// Baseline security headers (tiny helmet)
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), payment=()");
  if (process.env.NODE_ENV === "production") res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});
// Stripe webhook must read the raw body — register it BEFORE the JSON parser.
app.post("/api/payments/stripe-webhook", express.raw({ type: "application/json" }), stripeWebhook);
app.post("/api/payments/simplepay-ipn", express.raw({ type: "application/json" }), simplepayIpn);
// Registration documents & company logos travel as data-URLs — raise the default 100kb cap.
app.use(express.json({ limit: "8mb" }));

/* ── API routes ──────────────────────────────────────────── */
app.use("/api/auth", authRouter);
app.use("/api/companies", companiesRouter);
app.use("/api/services", servicesRouter);
app.use("/api/bookings", bookingsRouter);
app.use("/api/employees", employeesRouter);
app.use("/api/notices", noticesRouter);
app.use("/api/reviews", reviewsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/complaints", complaintsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/verify", verifyRouter);
app.use("/api/subscriptions", (await import("./routes/subscriptions.js")).default);
app.use("/api/calendar", (await import("./routes/calendar.js")).default);
app.use("/api/invoices", (await import("./routes/invoices.js")).default);
app.use("/api/customer-reports", (await import("./routes/customer-reports.js")).default);

/* Where the apps report their own crashes.

   Server faults already reach ALERT_EMAIL. Client faults did not reach anyone:
   the screen went blank on someone's phone and that was the end of it. This is
   deliberately unauthenticated — a crash often happens before or during login,
   and a report we refuse is a report we never see — but it is rate-limited and
   truncated so it cannot become a way to fill an inbox. */
const crashSeen = new Map();
app.post("/api/client-error", async (req, res) => {
  res.json({ ok: true });                       // never make the app wait on this
  try {
    const b = req.body || {};
    const msg = String(b.message || "").slice(0, 300);
    if (!msg) return;
    /* One report per distinct message per 10 minutes. A crash loop on one
       phone would otherwise send thousands. */
    const key = msg.slice(0, 120);
    const now = Date.now();
    if (crashSeen.get(key) > now - 600e3) return;
    crashSeen.set(key, now);
    if (crashSeen.size > 200) crashSeen.clear();

    const { alert } = await import("./lib/alerts.js");
    alert("client-crash", `App crashed: ${msg}`,
      [`version: ${String(b.version || "?").slice(0, 20)}`,
       `platform: ${String(b.platform || "?").slice(0, 20)}`,
       `language: ${String(b.lang || "?").slice(0, 8)}`,
       "", String(b.component || "").slice(0, 800),
       "", String(b.stack || "").slice(0, 1200)].join("\n"));
  } catch { /* a failure here must never surface anywhere */ }
});

/* Health, and — more usefully — WHICH CODE IS RUNNING.

   We spent a long evening on a login failure whose whole cause was that the
   server was not running the commit that had been pushed. Nothing on the
   outside said so; the only way to tell was to notice a missing field in an
   unrelated response. `schemaLevel` names the last migration the code expects,
   so /api/health answers "did my deploy land, and has the database caught up?"
   in one request. */
const BUILD = { version: "7.2.0", schemaLevel: "service_areas+eu_vat+payment_error" };
app.get("/api/health", async (req, res) => {
  let schema = "unknown";
  try {
    await query("SELECT service_areas, eu_vat FROM companies LIMIT 0");
    schema = "ready";
  } catch (e) {
    schema = /does not exist|undefined column/i.test(e.message || "") ? "MIGRATION_PENDING" : "unknown";
  }
  res.json({ ok: true, ts: new Date().toISOString(), ...BUILD, schema });
});

/* ── 2.1 minimum supported app version. Old builds show a blocking update
      screen. Raise MIN_APP_VERSION only after the force-update screen has
      shipped and most users have moved. ── */
app.get("/api/app/version", (req, res) => res.json({
  min: process.env.MIN_APP_VERSION || "0.0.0",
  latest: process.env.LATEST_APP_VERSION || "7.0.0",
  iosUrl: process.env.APP_STORE_URL || "",
  androidUrl: process.env.PLAY_STORE_URL || "https://play.google.com/store/apps/details?id=com.cleano.app",
}));

/* Privacy policy — required by Google Play & the App Store */
app.get("/privacy", (req, res) => res.sendFile(path.join(__dirname, "privacy.html")));
app.get("/terms", (req, res) => res.sendFile(path.join(__dirname, "terms.html")));
app.get("/partner-terms", (req, res) => res.sendFile(path.join(__dirname, "partner-terms.html")));
/* Account-deletion instructions — REQUIRED by Google Play (Data safety → Delete account URL) */
app.get("/delete-account", (req, res) => res.sendFile(path.join(__dirname, "delete-account.html")));

/* Barion sends the customer back here after paying (web + in-app browser) */
app.get("/payment-result", (req, res) => {
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cleano — payment</title></head>
<body style="font-family:system-ui;display:flex;min-height:90vh;align-items:center;justify-content:center;text-align:center;background:#F4F6FE">
<div><div style="font-size:56px">🐙</div>
<h2 style="color:#1B2A6B">Payment received — you can close this window.</h2>
<p style="color:#5A6285">A fizetés megtörtént — ezt az ablakot bezárhatod.<br/>Return to the Cleano app to see your booking.</p></div>
</body></html>`);
});
// unknown /api paths must return JSON 404, never the SPA shell
app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

/* ── Cleano is not a website ──────────────────────────────────────────────
   This address used to serve the whole app to anyone who found the URL. That
   was never the product: Cleano ships through the App Store and Play Store,
   the apps are what get reviewed and updated, and a second unversioned copy on
   the open web is a support burden and an attack surface for no revenue.

   What still has to be public, because the stores require it or a payment
   provider redirects to it: the legal pages and /payment-result, both defined
   above. Everything else gets a plain page pointing at the stores.

   Set SERVE_WEB_APP=1 to put the browser build back — useful for a demo to a
   partner, and the one-line way to reverse this decision.                    */
if (process.env.SERVE_WEB_APP === "1") {
  const distPath = path.join(__dirname, "..", "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
} else {
  const IOS = process.env.APP_STORE_URL || "";
  const PLAY = process.env.PLAY_STORE_URL || "https://play.google.com/store/apps/details?id=com.cleano.app";
  const landing = `<!doctype html><html lang="hu"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cleano</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:radial-gradient(140% 100% at 20% 0%,#233073,#131A3D 75%);
       font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#fff;padding:28px}
  .c{max-width:360px;text-align:center}
  h1{font-size:26px;margin:0 0 10px;font-weight:700}
  p{color:#B9C0DF;font-size:15px;line-height:1.6;margin:0 0 22px}
  a.btn{display:block;margin:10px 0;padding:14px 18px;border-radius:14px;background:#fff;color:#131A3D;
        text-decoration:none;font-weight:700;font-size:15px}
  .f{margin-top:26px;font-size:12px;color:#7E88B5}
  .f a{color:#7E88B5;margin:0 7px}
</style></head><body><div class="c">
<h1>Cleano</h1>
<p>Takarítás, mosás és vasalás Debrecenben — a Cleano alkalmazásban.<br>
Cleaning, laundry and ironing in Debrecen — in the Cleano app.</p>
${IOS ? `<a class="btn" href="${IOS}">App Store</a>` : ""}
<a class="btn" href="${PLAY}">Google Play</a>
<div class="f"><a href="/terms">ÁSZF</a><a href="/privacy">Adatkezelés</a><a href="/partner-terms">Partner</a></div>
</div></body></html>`;

  app.get("/", (req, res) => res.type("html").send(landing));
  /* Anything else is not a page we publish. Say so plainly rather than handing
     back an app shell that then fails to load. */
  app.use((req, res) => res.status(404).type("html").send(
    `<!doctype html><meta charset="utf-8"><title>Cleano</title>
     <body style="font-family:system-ui;padding:40px;text-align:center;background:#131A3D;color:#B9C0DF">
     <p>Nincs ilyen oldal. / No such page.</p><p><a style="color:#fff" href="/">Cleano</a></p>`));
}

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  /* A file bigger than the body limit is the user's problem, not a server fault.
     Without this a partner uploading a large scanned invoice gets an opaque 500
     and no idea what to do about it. Not worth alerting on either. */
  if (err?.type === "entity.too.large" || err?.status === 413) {
    return res.status(413).json({ error: "That file is too large — please upload something smaller." });
  }
  /* Malformed JSON is likewise a bad request, not a crash. */
  if (err instanceof SyntaxError && "body" in (err || {})) {
    return res.status(400).json({ error: "That request could not be read." });
  }

  alert("express:" + (req.path || ""), `500 on ${req.method} ${req.path}`, err?.stack || err);
  res.status(500).json({ error: "Something went wrong on our side — we have been notified." });
});

wireAlerts();
app.listen(PORT, () => {
  console.log(`\n🐙 Cleano API running on http://localhost:${PORT}`);
  console.log(`   Mode: ${process.env.NODE_ENV || "development"}`);
  if (!process.env.DATABASE_URL) console.warn("   ⚠️  DATABASE_URL not set — set it in .env");
  if (process.env.JWT_SECRET === undefined) console.warn("   ⚠️  JWT_SECRET not set — using insecure default");
  // Day-of reminders (customer ~40min before, company at each booking time).
  if (!process.env.PGMEM) startReminders();
  startSubscriptions();

  /* Local walkthrough only. Both switches are required, and PGMEM means the
     database is in memory — there is no path from here to real data. */
  if (process.env.DEMO_SEED === "1" && process.env.PGMEM === "1") {
    import("../scripts/demo-seed.mjs")
      .then((m) => m.seedDemo())
      .catch((e) => console.error("demo seed failed:", e?.stack || e));
  }
});
