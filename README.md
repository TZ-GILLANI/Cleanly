# Cleanly 🐙 — Eight arms, zero dust

A four-sided cleaning marketplace for Debrecen, Hungary:

- **Customers** book verified cleaning companies — flat-price, **hourly** (choose 2–8 hours), or **subscription plans** (weekly / bi-weekly / monthly with a recurring schedule). Students get automatic discounts. Saved home address, Wolt-style address bar, EN/HU language toggle.
- **Companies** register with documentation (tax ID / VAT, registration number), upload their own logo, create services with any of the three pricing models, assign cleaners, decline bookings they can't serve, and invite staff with one-time reference codes.
- **Employees (cleaners)** join via invite code and work through per-job task checklists with a live status flow.
- **Admin** oversees the whole platform: KPIs, 30-day revenue chart, company approval/suspension, user activation, all bookings.

Built with **React + Vite** (frontend) and **Express + PostgreSQL** (backend) with **JWT auth** (bcrypt-hashed passwords). Ships as a web app, an installable **Android APK** (Capacitor), and an **iPhone home-screen PWA**.

| Mode | Trigger | What it means |
|---|---|---|
| **Demo mode** | `VITE_USE_API=false` (or building the APK) | Fully self-contained: seeded localStorage data, role-switcher in the top bar, works offline. |
| **API mode** | `VITE_USE_API=true` + Postgres running | Real accounts, real database, JWT sessions, admin panel with live analytics. |

---

## Run it

```bash
npm install
npm run dev        # starts Vite (5173) + Express API (3001) together
```

Open http://localhost:5173.

**First-time database setup** (API mode):
1. Install PostgreSQL 17+, create a database `cleanly`.
2. Copy `.env.example` → `.env`, set `DATABASE_URL` and a `JWT_SECRET`.
3. Apply the schema: `psql -d cleanly -f schema.sql` (idempotent — safe to re-run after updates).
4. Seed test data: `npm run seed`.

### Seeded accounts

| Role | Email | Password |
|---|---|---|
| 🛡️ Admin | `admin@cleanly.hu` | `admin123` |
| 🏢 Company (SparkClean) | `spark@cleanly.hu` | `company123` |
| 🏢 Company (Tiszta Otthon) | `tiszta@cleanly.hu` | `company123` |
| 🏢 Company (pending approval) | `otthon@cleanly.hu` | `company123` |
| 🧽 Cleaners | `eszter/david/anna/peter@cleanly.hu` | `employee123` |
| 🛋️ Customer | `musa@cleanly.hu` | `customer123` |

## Android APK

Prereqs on this machine: Android Studio (SDK + bundled JDK). Then:

```bash
npm run build                 # production bundle (demo mode via .env.production)
npx cap copy android
cd android && .\gradlew.bat assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

The app icon, splash screens, and in-app branding use the Cleanly logo
(`logo.png` dark-on-white, `white logo.png` for dark surfaces); regenerate native
assets with `npx @capacitor/assets generate --android`.

## iPhone

iOS can't sideload APKs — serve the app (locally + `cloudflared tunnel --url http://localhost:5173`, or deploy) and use Safari → Share → **Add to Home Screen**. PWA meta + apple-touch-icon are already wired.

## Languages 🇬🇧🇭🇺

`src/lib/i18n.js` holds the EN/HU dictionary; `t()` comes from the store. The toggle lives on the welcome screen (top-right) and in the profile panel; a customer's choice is saved to their profile.

## Payments (scaffolded, not live)

Customers choose **cash** (default) or **card** in their profile. Real card processing is prepared for Hungarian providers — fill in `.env`:
`PAYMENT_PROVIDER=simplepay|barion` plus `SIMPLEPAY_MERCHANT`/`SIMPLEPAY_SECRET_KEY` or `BARION_POSKEY` (sandbox accounts: sandbox.simplepay.hu / sandbox.barion.com). Until keys exist, card bookings behave like cash.

## Project structure

```
cleanly/
├─ index.html                 PWA meta, favicon, manifest
├─ schema.sql                 full Postgres schema (idempotent migrations at the bottom)
├─ .env.example               DATABASE_URL, JWT_SECRET, payment keys, VITE_USE_API
├─ server/
│  ├─ index.js                Express app (serves dist/ in production)
│  ├─ db.js                   pg pool (DATE columns returned as YYYY-MM-DD strings)
│  ├─ middleware/auth.js      JWT sign/verify, requireAuth, requireRole
│  ├─ seed.js                 accounts, services (all 3 pricing types), bookings, reviews
│  └─ routes/                 auth, companies, services, bookings, employees, notices, reviews, admin
├─ src/
│  ├─ store.jsx               ONE data interface, TWO backends (demo / API) + i18n state
│  ├─ lib/api.js              fetch wrapper with JWT
│  ├─ lib/i18n.js             EN/HU dictionary + t()
│  └─ App.jsx                 all four interfaces + auth + shell
├─ android/                   Capacitor Android project (icons/splash generated)
└─ scripts/                   Playwright verification & screenshot scripts
```

Design system (navy `#1B2A6B`, mint `#5EE6A8`, Quicksand/Inter, the octopus) lives at the top of `App.jsx`.

## Honest gaps before charging real money

> **Update v2.1.0:** Barion payments implemented, deploy configs added (`render.yaml`,
> `codemagic.yaml`), GDPR account deletion + `/privacy` shipped. See **PRODUCTION-LAUNCH.md**
> for the go-live checklist. Original list kept below for history.

1. **Payments** — cash-on-completion works today; card needs your Barion/SimplePay merchant account (see above).
2. **Invoicing / NAV** — when Cleanly charges commission, invoice via szamlazz.hu or Billingo (they handle NAV Online Számla reporting).
3. **GDPR** — privacy policy, EU data region, account-deletion flow before public launch.
4. **Notifications** — currently in-app only; add email (Resend) → push (OneSignal) later.
5. **Deployment** — the local tunnel link is temporary; deploy (Render/Railway + managed Postgres) for a permanent URL.
