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

## v4.2–4.3 additions (July 2026)
- **Logos**: official Cleano lockup integrated. `public/logo.png` (navy mark, favicon), `white-logo.png` (white mark), `white-logo-full.png` (splash lockup), `logo-full.png`. All Android mipmaps + splash drawables regenerated from these. Source masters came from user files with baked checkerboard — alpha was reconstructed; regenerate from `public/` PNGs, never from the originals.
- **Glass bottom nav** + custom minimalist line-icon system: `ICON_PATHS`/`Ic` in App.jsx. Nav, role cards and admin tabs use icon keys, not emoji.
- **Notifications**: bell removed → top banner (auto-dismiss 6s) + history in Profile with Clear all (`DELETE /api/notifications`).
- **Admin announcements**: `POST /api/notifications/broadcast` (requireRole admin; title ≤120, body ≤500, audience all|customer|company|employee) + AnnouncementComposer on the admin dashboard. Marketing use. PUSH HOOK: fan out to FCM/OneSignal inside this route when keys arrive.
- **Multi-language (10)**: en/hu native in code; de,ro,sk,pl,uk,fr,es,it resolve via `src/lib/translations.js` (`EXTRA`, keyed by the exact English source string; `xl()` falls back to English). `L(en,hu)` and `translate()` both pivot through English. Date locales in `LOCALES`. IMPORTANT: if you edit any L("…","…") English string, update the same key in all 8 EXTRA dictionaries or that string silently reverts to English. Translations are machine-drafted — native review recommended before marketing in a new country.
- e2e now 83 tests (broadcast auth/validation/delivery + clearing). versionCode 9 / 4.3.0.
- **v4.4.0 — Company offers**: `companies.promo JSONB` ({pct 1-90, label ≤60, until|null}); editor toggle in Company Settings; `promoOf()` helper client+server checks expiry; booking applies MAX(promo, student_discount) — never stacked; fee-on-top computed on the discounted share; mint pill on customer cards; admin Companies tab shows "Active offers" summary + per-row badge. Public companies SELECT now includes promo. Run schema.sql for the new column. Notifications auto-purge >48h on read (v4.3.1). e2e: 90 tests.
- **v4.4.1 — security hardening** (post-audit): rate limits on /api/verify/start (3/10min + 8/day per user — SMS pumping protection), verify/check, email/start+check (10/10min), registration (6/hour/IP); baseline security headers middleware in index.js (nosniff, DENY framing, referrer policy, permissions policy, HSTS in prod); rateLimit() exported from auth.js, ×50 multiplier when PGMEM=1 so the e2e suite doesn't trip prod limits. Audit found NO SQL injection (all parameterized), IDOR checks intact, webhook signatures verified. e2e: 92 tests.
- **v4.5.0 — admin governance**: grant/revoke admin, deactivating admins, deleting admin accounts, and sending announcements are all CEO-only (isSuper in JWT, enforced server-side; UI hides the controls from limited admins). The CEO account itself can never be modified/deleted via API. New: GET /api/admin/companies/:id/services + "Listings" button in Admin→Companies showing every service (hidden ones flagged); DocViewer gives all admins view+download. e2e: 98 tests.
- **v4.6.0 — per-service discounts + team removal**: services.promo_pct (1-90, NULL=none; UPDATE uses -1 sentinel=keep / 0=clear); booking discount = MAX(service promo, company promo, student) — one discount, never stacked; "Discount %" field in service editor + mint pill on service cards; DELETE /api/employees/:id (company owner) deactivates cleaner, detaches from company, returns their status-1/2/3 jobs to the unassigned pool (status 0); Remove button + ConfirmDialog in Team tab; Android system bars painted brand navy (styles.xml + new colors.xml); legal links use absolute API_BASE URLs (Capacitor webview fix). e2e: 103 tests. Run schema.sql for services.promo_pct.
- **v4.6.1 — student-switch fraud fix**: PUT /auth/profile no longer lets residents self-assign customer_type='student'. Switch requires a card document → stays resident + users.student_upgrade=true; admin Users tab shows "🎓 Upgrade requested" + Approve card/Decline (upgradeDecision in PUT /admin/users/:id) → approve flips to student + notify/email. Downgrade to resident stays instant. Profile UI: card uploader appears when picking Student; save blocked without it. Schema: users.student_upgrade BOOLEAN. e2e: 109 tests.
- **v4.6.2 — booking alerts**: new booking → company owner gets in-app notification (type 'booking') + Resend email with service/date/payout + CTA (fire-and-forget async, never blocks the booking response); assigning a job → notify() to that employee. huf() formatter in bookings.js. e2e: 110 tests.
- **v4.7.0 — real push notifications (FCM), dormant**: client @capacitor/push-notifications@6 (dep added; needs `npx cap sync android` — build-apk bat does it) + src/lib/push.js (native-only, registers token → POST /api/notifications/push-token); users.push_token column; server/lib/notify.js now also fires FCM HTTP v1 (OAuth via RS256 JWT from FIREBASE_SERVICE_ACCOUNT_B64 = base64 service-account JSON; dead tokens auto-cleared on 404/410). ACTIVATION: Firebase console → create project → add Android app com.cleano.app → download google-services.json → put in android/app/ (gradle hookup already conditional) → Project settings → Service accounts → generate private key → base64 it → Render env FIREBASE_SERVICE_ACCOUNT_B64. iOS later needs APNs key uploaded to Firebase. Company decline of paid booking already auto-refunds in full (refund_application_fee + reverse_transfer) — verified. e2e: 113 tests.
- **v4.7.1 — iOS release prep**: codemagic.yaml bundle_identifier corrected com.cleanly.app→com.cleano.app (was a signing-fail bug); added "Enable push notifications capability" step writing App.entitlements aps-environment=production; brand strings Cleanly→Cleano. iOS push still needs (owner): Firebase console → add iOS app com.cleano.app → download GoogleService-Info.plist (Codemagic step should place it in ios/App/App/) + APNs .p8 key uploaded to Firebase Cloud Messaging. build-apk-live/seed bats now always run npm install (push dep was missing → build failed).
- **v4.8.0 — real iOS push (Firebase Messaging)**: swapped @capacitor/push-notifications → @capacitor-firebase/messaging + @capacitor-firebase/app + firebase (unified FCM tokens iOS+Android). src/lib/push.js uses FirebaseMessaging.getToken(). codemagic.yaml "Wire Firebase + push" step: perl-injects FirebaseApp.configure() into AppDelegate, plutil adds UIBackgroundModes remote-notification, ruby+xcodeproj sets CODE_SIGN_ENTITLEMENTS=App/App.entitlements (App.entitlements has aps-environment=production). App icon (octopus navy) via ios-config/AppIcon.appiconset cp'd in build. index.html viewport maximum-scale=1 (iOS input-zoom fix). Server notify.js already sends FCM v1 — no change. Needs: push google-services.json committed (done) + Firebase APNs key (done). e2e still 113.
- **v4.9.0 — final pre-launch batch**: (1) duplicate messages fixed — toast de-dup (same text within 4s ignored) + global error banner removed, store errors routed through the single toast channel. (2) LIVE REFRESH — Shell polls refreshData() every 20s + on focus/visibilitychange (store exposes refreshData via loadAllDataRef). (3) Cleaner approval: employees register approval_status='pending', company approves in Team tab (GET /employees/pending, PUT /employees/:id/approval); owner notified; team list shows approved only. (4) Company can track cleaner (TrackSheet on job cards when status 2/3). (5) Map redesigned: CartoDB dark tiles, Cleano octopus divIcon for cleaner, mint destination pin, real OSRM driving route polyline, geocodeAddress() cache; TrackSheet shows customer/address/note + Open-in-Maps + Call for cleaners. (6) Address: GPS now opens the editor prefilled + new bell/entrance/extra details field. (7) CompanyReviews screen + nav item (GET /reviews/company returns reviews + per-cleaner averages). (8) Admin user rows show phone/address/verified/customer_type/joined + deleted identity. (9) Deleted users retained as deleted_name/deleted_email; company bookings show "Deleted user (name · email)" with ✕ to clear per booking (PUT /bookings/:id/hide-identity, bookings.hide_deleted_identity). (10) Documents open via blob URL (openDoc) — fixes PDF download inside the app. (11) Day-of reminders: server/lib/reminders.js every 5min — customer ~40min before, company at each booking's start; stamped on bookings.reminder_customer_at / reminder_company_at. Schema adds those + deleted_name/deleted_email/hide_deleted_identity. e2e 113 green.
- **v5.0.0 — the four remaining items**: (1) PUSH: server FCM payload now includes a full `apns` block (priority 10, alert push-type, sound/badge/content-available) + `android` high priority — iOS stayed silent without it; failures now logged to Render instead of swallowed. Client push.js rewritten: caches last token (no re-post spam), `tokenReceived` listener re-registers rotated tokens, `notificationReceived` dispatches a `cleano-push` window event which NotificationBanner renders (iOS hides system banners in foreground), forgetPushToken() for logout. ⚠️ OWNER ACTION: the APNs .p8 is only in Firebase's **Development** slot — TestFlight/App Store builds use the **Production** APNs environment, so it must also be uploaded to the *production* slot (same key file, Key ID DQ6KC86439, Team DAS6RZC3A8). This is the most likely reason no notification arrived. (2) COMPLAINT ROUTING: complaints.handled_by ('admin'|'company'), company_action ('chat'|'callback'), callback_note/at. PUT /complaints/:id/handling (admin only; refuses handover before a company is assigned; notifies both sides) + PUT /complaints/:id/company-action (company only; auto-posts a message to the customer). UI: admin toggle "Cleano handles it / Hand to the company"; company sees a panel with "Solve in chat" / "Call back" + optional note. (3) SAVED CARDS: users.stripe_customer_id/default_payment_method/card_brand/card_last4. Subscription checkouts create/reuse a Stripe Customer and set setup_future_usage='off_session'; the webhook stores the payment method; new chargeSavedCard(booking) in payments.js charges renewals off-session (keeping the Connect split) and bookings.js calls it when a subscription renewal is created, notifying the customer either way. (4) LIVE REFRESH: store exposes `dataVersion`, incremented on every refreshData(); CompanyReviews, ComplaintThread and PayoutSetup now re-fetch on it. NOTE: pg-mem needs NULL-safe CHECKs — write `CHECK (col IS NULL OR col IN (...))`. e2e 120 green.
