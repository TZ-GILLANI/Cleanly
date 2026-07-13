# 🐙 CLEANLY — Production Launch Guide

Your app is now a full production stack. This is the exact order to go live.
Everything code-side is DONE — these steps are accounts, keys, and uploads.

**What changed in this version (v2.1.0)**
- Mobile apps talk to your real server (`VITE_API_BASE`), shared database for everyone
- 💳 **Barion card payments** fully implemented (sandbox-ready; flip to live with 2 env vars)
- 🔐 Production hardening: server refuses to start without a real `JWT_SECRET`
- 🗑️ **Account deletion** in Profile + 📄 **/privacy** policy page — both are MANDATORY for Play Store & App Store approval; already done
- One-click deploy config (`render.yaml`), cloud iOS/Android builds (`codemagic.yaml`), production admin seeder (`server/seed-prod.js`)

---

## STEP 1 — Code to GitHub (15 min)
1. github.com → New repository → `cleanly`, **Private**.
2. Upload this whole folder (GitHub Desktop app is easiest: Add local repository → Publish).
   `.gitignore` keeps junk out automatically.

## STEP 2 — Database on Supabase (10 min)
1. supabase.com → New project `cleanly`, region **EU (Frankfurt)**, save the DB password.
2. SQL Editor → New query → paste ALL of `schema.sql` → Run. ("Success. No rows returned" = good.)
3. Project Settings → Database → **Connection string → URI** (Session pooler). Copy it, insert your DB password. This is your `DATABASE_URL`.

## STEP 3 — Backend on Render (15 min)
1. render.com → sign in with GitHub → **New → Blueprint** → select the `cleanly` repo.
   `render.yaml` configures everything (Node app, health check, JWT secret auto-generated).
2. When asked, paste `DATABASE_URL` from Step 2.
3. Deploy → you get `https://cleanly-XXXX.onrender.com`. Open it — your app is live on the web (this same URL also powers the mobile apps).
4. Render → Environment → set `PUBLIC_BASE_URL` = that URL → Save (it redeploys).
5. Create your admin login — on your PC, in the project folder (cmd):
   ```
   set DATABASE_URL=postgres-string-from-step-2
   set ADMIN_EMAIL=you@yourdomain.com
   set ADMIN_PASSWORD=a-long-strong-password
   npm run seed:prod
   ```
   Log in with that email/password → you are the platform admin.

## STEP 4 — Card payments (Barion)
**Now (sandbox, free, 10 min):** register at **sandbox.barion.com** → My shops → create shop → copy **POSKey**.
In Render Environment set: `BARION_POSKEY` = that key, `BARION_PAYEE` = your sandbox account email, `BARION_ENV` = `test`.
Test in the app: profile → payment method **Card** → book → pay with Barion's test card. Booking shows **💳 Paid**.

**For launch (live):** register your Kft at **barion.com** (approval usually days; have company docs + bank account ready).
When approved: replace `BARION_POSKEY`/`BARION_PAYEE` with live values, set `BARION_ENV=prod`. That's the whole switch.

## STEP 5 — Android app → Play Store
1. Edit `.env.production`: set `VITE_API_BASE=https://your-render-url.onrender.com` (no trailing /).
2. Play Console ($25 once) — register as **ORGANIZATION** (your Kft) to skip the 12-tester requirement for new personal accounts.
3. Build the store bundle — either:
   - **Codemagic (no local setup):** codemagic.io → sign in with GitHub → add the repo → run workflow `android-playstore` → download the `.aab`, or
   - **Android Studio on your PC:** open the `android` folder → Build → Generate Signed App Bundle (create a keystore when prompted — SAVE THAT FILE + PASSWORD FOREVER).
4. Play Console → Create app (*Cleanly*, House & Home) → upload the `.aab` → fill Data safety
   (collects: name, email, phone, address — app functionality; not shared/sold) →
   **Privacy policy URL: `https://your-render-url.onrender.com/privacy`** → submit for review.

## STEP 6 — iPhone app → App Store (no Mac needed)
1. developer.apple.com → enroll ($99/yr, as your Kft — needs a D-U-N-S number, Apple guides you).
2. codemagic.io → Teams → Integrations → **App Store Connect** (create an API key at appstoreconnect.apple.com → Users and Access → Keys, upload it; name it `codemagic`).
3. Codemagic → your app → code signing: let it create the distribution certificate automatically.
4. Run workflow `ios-appstore` → builds on a cloud Mac, pushes to **TestFlight**.
5. Test on your iPhone via TestFlight, then App Store Connect → submit for review.
   Review notes: *"Marketplace for physical cleaning services in Debrecen, Hungary.
   Payment for physical services via Barion per guideline 3.1.5(a).
   Demo account: [your test customer email/password]."*

## STEP 7 — Before pressing 'publish'
- [ ] Fill the placeholders in `server/privacy.html` (company name, address, tax no., email)
- [ ] Sandbox Barion payment tested end-to-end
- [ ] Company approval flow tested (admin approves companies before they appear)
- [ ] Invoicing ready: szamlazz.hu or Billingo (NAV Online Számla automatic through them)
- [ ] Render free tier sleeps when idle (first request ~40s) — upgrade to Starter ($7/mo) on launch day

## Updating the app later
Push to GitHub → Render redeploys web + backend automatically. Prices/services/companies
live in the database, so they update instantly WITHOUT store releases. For a new store
version: bump `versionCode`/`versionName` in `android/app/build.gradle`, rebuild, upload.

## Costs
| Item | Cost |
|---|---|
| Render + Supabase + Codemagic free tiers | 0 Ft to start |
| Render Starter (recommended at launch) | ~$7/mo |
| Google Play | $25 once |
| Apple Developer | $99/yr |
| Barion | ~1.5% + small fixed fee per transaction, no monthly |
