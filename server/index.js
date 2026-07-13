import "dotenv/config";
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
app.use("/api/verify", verifyRouter);

app.get("/api/health", (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

/* Privacy policy — required by Google Play & the App Store */
app.get("/privacy", (req, res) => res.sendFile(path.join(__dirname, "privacy.html")));
app.get("/terms", (req, res) => res.sendFile(path.join(__dirname, "terms.html")));
app.get("/partner-terms", (req, res) => res.sendFile(path.join(__dirname, "partner-terms.html")));

/* Barion sends the customer back here after paying (web + in-app browser) */
app.get("/payment-result", (req, res) => {
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cleanly — payment</title></head>
<body style="font-family:system-ui;display:flex;min-height:90vh;align-items:center;justify-content:center;text-align:center;background:#F4F6FE">
<div><div style="font-size:56px">🐙</div>
<h2 style="color:#1B2A6B">Payment received — you can close this window.</h2>
<p style="color:#5A6285">A fizetés megtörtént — ezt az ablakot bezárhatod.<br/>Return to the Cleanly app to see your booking.</p></div>
</body></html>`);
});
// unknown /api paths must return JSON 404, never the SPA shell
app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

/* ── Serve built frontend in production ──────────────────── */
if (process.env.NODE_ENV === "production") {
  const distPath = path.join(__dirname, "..", "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
}

app.listen(PORT, () => {
  console.log(`\n🐙 Cleanly API running on http://localhost:${PORT}`);
  console.log(`   Mode: ${process.env.NODE_ENV || "development"}`);
  if (!process.env.DATABASE_URL) console.warn("   ⚠️  DATABASE_URL not set — set it in .env");
  if (process.env.JWT_SECRET === undefined) console.warn("   ⚠️  JWT_SECRET not set — using insecure default");
});
