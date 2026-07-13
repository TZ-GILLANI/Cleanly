# 🐙 Cleanly — Deep Audit & Best-Version Report (v2.2.0)

## How the app measures against your concept

Your concept: a four-sided cleaning marketplace for Debrecen — customers book verified
companies (flat / hourly / subscription, student discounts), companies manage services
and staff, cleaners work checklists, admin oversees the platform. **Verdict: the concept
is fully built and it's good.** The audit found the product surface complete:

| Concept element | Status |
|---|---|
| 3 pricing models + student discounts | ✅ built, server-side price authority |
| Company verification (docs → admin approval) | ✅ built, ✓-badge shows on approved companies |
| Cleaner task checklists + live status | ✅ built (5-stage flow with progress dots) |
| Reviews → company rating | ✅ built, DB trigger keeps ratings consistent |
| Rebook, cancel, decline-with-reason | ✅ built |
| EN/HU bilingual | ⚠️ **was ~60%** — heavy mixed-language UI (fixed, see below) |
| Payments | ✅ Barion implemented (v2.1), sandbox-ready |
| Store compliance (deletion, privacy) | ✅ added in v2.1 |

## What the audit found and fixed in v2.2.0

1. **The #1 quality gap was language.** The entire booking flow, bookings list, statuses,
   dialogs, payment overlay and success screens were English-only — a Hungarian customer
   in Debrecen saw half-translated screens. Now **every customer-facing string is bilingual**,
   including dates ("Ma / Holnap"), booking stages ("Új → Kiosztva → Úton → Takarítás → Kész ✨"),
   periods ("hetente / kéthetente / havonta") and prices ("15 900 Ft-tól").
2. **Dates now format by language** (hu-HU vs en-GB) everywhere, including the subscription
   calendar and admin header.
3. **Duplicate profile header removed** (customer top bar), hero panel opens profile,
   logout moved into the profile sheet — from your earlier feedback.
4. Small correctness items from earlier passes: local-timezone dates kept, JWT hardening,
   payment status badge, account deletion.

## Design decisions (your design language, kept)

Navy `#1B2A6B` + mint `#5EE6A8`, Quicksand/Inter, the octopus, wave dividers, bubbles —
all untouched. "Best version" here meant *finishing* the experience, not repainting it.

## Recommended roadmap (not blocking launch)

1. **Notifications** — email on booking events (Resend, ~30 min of wiring) → later push (OneSignal).
2. **Company photos** — real cover photos instead of gradient covers; big trust win.
3. **Favorites** ♥ for repeat customers (needs 1 table + 1 endpoint).
4. **Tip the cleaner** after a 5★ review (Barion supports it; adds cleaner retention).
5. **ASO**: Hungarian store listing first ("takarítás Debrecen" keywords), screenshots in HU.
6. Translate company/cleaner/admin dashboards (internal users; customers were the priority).

## Verification
- Production build: ✅ (281 kB bundle, gzip 82 kB)
- API-mode server boot + all endpoints: ✅ (v2.1 checks still pass)

---

## CTO review addendum (v2.3.0) — subscription workflow

Traced the full lifecycle: book → assign → visit → complete → auto-renew → cancel. The
renewal engine existed in all three layers (server, API client, demo). Four real holes
were found and fixed:

1. **Duplicate renewals** — a company bouncing a job's status through "Done" twice spawned
   two next visits. Now guarded server-side (and in demo mode): the same future visit can
   never be created twice.
2. **Parallel subscription chains** — a customer could subscribe twice to the same plan and
   end up with two recurring chains. Now blocked with a clear message ("cancel it first").
3. **Dishonest payment label** — subscriptions promised "💳 Card each visit" but v1 never
   charges cards online for recurring visits. Copy now says "Card per visit (on site)".
   Online recurring card charges (Barion token payments) stay on the roadmap.
4. **Untranslated subscription step** — calendar picker strings were English-only; fixed.

Verified: recurrence math unit-tested across month/year boundaries (Jul 31 → Aug 28,
Dec 28 → Jan 4, Jan 31 → Feb 28 ✓), production build ✓, server boot ✓.

**Release marks:** app version 2.3.0, Android versionCode 2 — ready for store upload.

---

## Full-surveillance addendum (v2.4.0)

**Backend sweep (every route audited):** authorization is consistently enforced —
ownership checks on companies/services/invites, review rules (completed bookings only,
no duplicates, server-derived company), scoped notices, admin guard. Two real defects
found and fixed:
1. 🔴 **Privacy leak** — public company endpoints returned `SELECT *`, exposing uploaded
   verification documents and tax IDs to anyone. Now returns an explicit safe column list.
2. 🟠 **Upload cap** — registration documents/logos travel as data-URLs but the JSON body
   limit was the 100 kB default, so real uploads would fail in API mode. Raised to 8 MB.

**Product upgrades:**
- 🌗 **Automatic dark mode** — the whole app (110+ surfaces re-themed) follows the phone's
  day/night setting live, with a brand-consistent dark palette; status-bar color adapts.
- 📱 **Modern floating dock nav** — translucent rounded dock with an animated active pill,
  replacing the old full-width tab bar.
- 📍 **Structured address picker** — no more freeform address typing: GPS current location
  (OpenStreetMap reverse geocoding), saved home address, recent addresses, or a structured
  street/number/floor form. Android location permissions + iOS permission text wired.

**Release marks:** v2.4.0, Android versionCode 3. Production build ✓.
