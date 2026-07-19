# CLAUDE.md — Cleano project handover brief
> ⚠️ REBRAND (v3.8.0): the app is now **Cleano** (was Cleanly). User-visible strings, legal
> pages, manifest, appName and Android applicationId (com.cleano.app) are renamed. INTERNAL
> identifiers intentionally KEPT for stability: localStorage keys (cleanly_*), css classes
> (cl-), Render URL (cleanly-2x9z.onrender.com), GitHub repo, java namespace com.cleanly.app,
> demo seed emails (…@cleanly.hu). Also v3.8.0: street AUTOCOMPLETE (Photon/OSM — street
> cannot be typed wrong, city auto-locks from the chosen street), labeled saved addresses UI
> (Home/Office, was missing from the v3.7 sync), city TOGGLE REMOVED (city now derived from
> profile/saved addresses). User must still update the Stripe statement descriptor to CLEANO.
*(Read this fully before making any change. You are inheriting a live production system with a paying-customer-ready pipeline. The founder, Musa Gilani, is non-technical — you are his CTO.)*

## 1. What this is
**Cleanly** (🐙 navy #1B2A6B / mint #5EE6A8, octopus brand) — a four-sided cleaning-services
marketplace for Hungary (Europe-ready): customers book vetted cleaning companies; companies
manage services/team/jobs (built-in mini-CRM); cleaners work task checklists; platform admin
(CEO) oversees everything. React+Vite SPA · Express API · PostgreSQL · Capacitor (one codebase
→ Android + iOS). Bilingual HU/EN, automatic dark mode.

**LIVE:** https://cleanly-2x9z.onrender.com  (Render web service `cleanly`, auto-deploys from GitHub `TZ-GILLANI/Cleanly`, branch main)
**DB:** Supabase project `bkapfsxqkpgamgonuumd` (EU Ireland).  **Payments:** Stripe LIVE (TZ GILLANI KFT), Connect enabled (Marketplace model, Express accounts).
Current code: **v3.7.1**, 71/71 e2e tests green.
Since v3.2 (added in a parallel session "File project review"): order numbers on bookings,
deleted users filtered from admin, in-app **notifications** (server/routes/notifications.js +
notifications table), **complaint threads** (two-way messages + admin-to-company assignment,
complaint_messages table), **live GPS tracking** (cleaner shares via watchPosition; customer
AND company watch via TrackSheet; bookings.live_lat/lng/at; OSM-based, no paid keys),
**labeled saved addresses** (Home/Office etc., users.saved_addresses JSONB, switch/delete in
picker), emoji-reduction pass.
⚠️ DEPLOY GAP at handover time: the live server runs an older build (no watchPosition in
bundle) — user must run full schema.sql in Supabase, then push-to-github.bat.

## 2. Architecture map
```
cleanly-original/            ← the user's working copy lives on his Desktop
├─ src/App.jsx               ~2600 lines, ALL screens (4 roles) + design system consts at top
├─ src/store.jsx             one data layer, TWO backends: demo (localStorage seed) / API (JWT)
├─ src/lib/api.js            fetch wrapper; VITE_API_BASE for mobile builds
├─ src/lib/i18n.js           t() dictionary; App.jsx also uses L(en,hu) helper for literals
├─ server/index.js           Express; static dist/ in prod; raw-body webhooks BEFORE json parser
├─ server/routes/            auth, bookings, companies, services, employees, notices, reviews,
│                            admin, complaints, payments (Stripe+SimplePay+Barion), verify
├─ server/lib/mailer.js      Resend (dormant until RESEND_API_KEY+EMAIL_FROM)
├─ server/lib/validate.js    Hungarian adószám checksum + cégjegyzékszám validation
├─ server/{privacy,terms,partner-terms}.html   legal drafts — placeholders [CÉGNÉV] etc!
├─ schema.sql                CUMULATIVE + IDEMPOTENT — always run the WHOLE file in Supabase
├─ test/e2e.mjs              45 tests, real HTTP against in-memory Postgres (pg-mem, PGMEM=1)
├─ scripts/smoke-render.mjs  jsdom render test (catches white-screen crashes)
├─ render.yaml               Render blueprint (buildCommand needs --include=dev!)
├─ codemagic.yaml            iOS (cloud Mac→TestFlight) + Android (.aab) workflows
└─ android/                  Capacitor project (versionCode/versionName in app/build.gradle)
```

## 3. Key design decisions AND WHY (do not silently reverse these)
- **Fee-on-top money model**: company lists 5000 → customer pays 5000+10% (shown as
  "Cleanly service fee") → company receives FULL 5000. `COMMISSION_PCT` env (Render) drives
  both display and Stripe split. `bookings.service_fee_huf` stores the exact fee.
- **Stripe Connect (Marketplace/Express, destination charges)**: checkout on platform account
  with `transfer_data.destination` + `application_fee_amount = service_fee_huf*100`.
  Platform (TZ GILLANI KFT) carries refund/chargeback liability — formally acknowledged.
  Companies onboard via "⚡ Set up automatic payouts" card in Company Settings.
- **Provider-agnostic payments**: env keys decide — Stripe > SimplePay > Barion
  (`PAYMENT_PROVIDER` env can force). SimplePay/Barion are dormant standby, code complete.
- **HUF on Stripe**: whole forints × 100 (Stripe requires divisible-by-100 for HUF).
- **No cash in live mode** (founder can't collect commission on cash): card only; unpaid
  bookings get a "Pay now" button; demo mode still shows cash for exploration.
- **Approval gates**: students (card photo → admin review) AND companies (docs + adószám
  checksum) start `users.approval_status='pending'` — login blocked until approved; approval
  emails fire when mailer configured.
- **Admin tiers**: seeded admin = CEO (`users.is_super`, in JWT as `isSuper`). "Make admin"
  creates LIMITED admins: only company approvals + view-only documents (no download).
  Enforced server-side (`requireSuper`), not just in UI.
- **One phone = one active account**: partial unique index; freed on account deletion
  (deletion = GDPR anonymisation, keeps booking history).
- **Subscriptions**: completing a visit auto-creates the next (weekly+7/biweekly+14/monthly
  clamped to 28); duplicate-spawn and duplicate-chain guards exist — don't remove them.
- **Theming**: `C` is a mutable palette object swapped by `applyTheme(dark)` (follows OS).
  NEVER hardcode colors in JSX — use C.* slots. (A regex once rewrote the palette into
  self-reference → white-screen. That's why scripts/smoke-render.mjs exists.)
- **Verification engines (dormant by design)**: WhatsApp/SMS codes = Twilio Verify
  (TWILIO_ACCOUNT_SID/AUTH_TOKEN/VERIFY_SID); email codes + all transactional email = Resend
  (RESEND_API_KEY, EMAIL_FROM). UI gates appear automatically when keys exist.
- **Legal**: /terms, /partner-terms (= the commission contract, click-wrap with
  `users.terms_accepted_at` timestamp proof), /privacy (cookies section: only essential
  storage → NO cookie banner needed). All drafts pending lawyer review + placeholder data.

## 4. The sacred workflows (how changes ship)
1. Edit code (see §6 for method) → `npx vite build` must pass
2. `node test/e2e.mjs` → must stay green (add tests for new endpoints)
3. `npm run test:render` → RENDERED OK
4. Bump `package.json` version (+ android versionCode for store-visible releases)
5. Copy changed files to the user's Desktop working copy
6. USER deploys: (a) if schema.sql changed → paste WHOLE file in Supabase SQL Editor → Run;
   (b) double-click `push-to-github.bat` → Render auto-deploys (~5 min)
7. Verify LIVE from outside: GET /api/health, /api/payments/config (add ?cachebust=X —
   fetches get cached!). `/api/payments/config` returns feePct+provider = good version probe.

**Desktop .bat toolbox** (user is on Windows, non-coder — these are his interface):
`run-demo.bat` (offline demo) · `test-fullstack.bat` (local Postgres full stack) ·
`push-to-github.bat` (deploy trigger; handles first-push force) · `seed-admin.bat` (create/
upgrade CEO admin) · `build-apk.bat` (demo APK) · `build-apk-live.bat` (production APK;
requires .env.production VITE_API_BASE=render URL) · `reset-postgres-password.bat`.

## 5. Environment variables (Render → Environment; NAMES only, never ask for values in chat)
NODE_ENV, DATABASE_URL (Supabase session pooler), JWT_SECRET, PUBLIC_BASE_URL,
VITE_USE_API=true, VITE_API_BASE="" (empty on Render = same origin), COMMISSION_PCT=10,
STRIPE_SECRET_KEY ✅, STRIPE_WEBHOOK_SECRET ✅ (endpoint: /api/payments/stripe-webhook,
event checkout.session.completed), BARION_* (unused), and dormant: RESEND_API_KEY,
EMAIL_FROM, TWILIO_*, SIMPLEPAY_*, PAYMENT_PROVIDER.

## 6. How to edit safely (learned the hard way)
- App.jsx/store.jsx are large single files. Edit via EXACT-anchor string replacement with
  assertions; if an anchor misses, READ the real code first — never guess.
- Regex bulk edits: scope tightly (a color regex once ate the palette; a JSX attr got
  `color=C.green` without braces). Build+render-test after EVERY edit round.
- Batch files need CRLF and %% escaping; `set /p` inside parenthesised blocks doesn't work
  (use goto labels). The user's Desktop mount is delete-protected: overwrite works, unlink
  doesn't (rm needs `mcp__cowork__allow_cowork_file_delete`).
- pg-mem (tests): no plpgsql/DO blocks/triggers (loader strips them), enum types extracted
  separately, correlated aggregate subqueries fail (that's why one e2e assertion compares
  parity with CEO instead of status 200).
- Stripe webhooks need the raw body — their routes are mounted BEFORE express.json in
  server/index.js. Keep that ordering.

## 7. Working with Musa (important)
- Non-technical founder, fast tester, gives feedback in batches — turn each item into a fix
  and verify with the test suite before claiming done.
- Click-by-click instructions with exact button names; he sends screenshots — read them.
- **Secrets discipline**: he once pasted a live Stripe key into chat → key was rolled.
  NEVER let credentials touch the chat; guide him to paste only into Render. If a secret
  leaks, insist on rotation — that's the hill to die on.
- He asks "isn't this just X?" questions — answer with structure (tables/mental models),
  not jargon. Hungarian market context matters (ÁFA, NAV, Billingo, adószám, Barion/SimplePay).
- Version everything; he trusts "45/45 tests green" style proof.

## 8. Immediate backlog (in priority order)
1. **APK on his phone**: `build-apk-live.bat` (never yet run!) — .env.production needs the
   Render URL first. Then a photo of Cleanly on his Android = the milestone.
2. Fill legal placeholders: needs his Kft name/address/adószám/cégjegyzékszám/support email
   → patch privacy.html, terms.html, partner-terms.html + Stripe public details.
3. RESEND_API_KEY + EMAIL_FROM → activates approval emails, notices, email verification.
4. Verify Connect end-to-end: approved company → Settings → Connect → Stripe onboarding →
   live card booking shows application fee split in Stripe dashboard.
5. Play Console ($25, ORGANIZATION account to skip 12-tester rule) → codemagic
   `android-playstore` workflow → .aab → listing (privacy URL = live /privacy) → review.
6. Apple Developer ($99, needs D-U-N-S) + Codemagic `ios-appstore` → TestFlight → review
   (review notes: physical services, guideline 3.1.5(a), demo account).
7. Render Starter upgrade ($7/mo) BEFORE public marketing (free tier cold-starts ~50s).
8. Hungarian lawyer review of the three legal drafts.
9. Later roadmap: Billingo API invoice automation, Twilio WhatsApp, SimplePay live,
   favorites, cleaner performance stats, CSV exports, push notifications (OneSignal),
   second-country config in MARKETS (App.jsx).

## 9. History snapshot
v2.x original app (previous dev) → hardened, translated, dark mode, city system, complaints,
CEO tiers, approvals, fee-on-top, 3 payment providers, Connect, legal layer = v3.2.0.
Archives: cleanly-production-vX.zip series in the session outputs. Test admin creds live
only in Musa's head + seed-admin.bat runs.

*Signed over by the previous CTO-Claude. Keep the octopus shipping. 🐙*
