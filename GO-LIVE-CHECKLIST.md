# Cleanly — Go-Live Checklist 🐙

Do these in order. Each is a "you" task — the app code is already finished (v3.6.1).
Paste secrets ONLY into Render/Supabase/Stripe — never into a chat.

---

## STEP 1 — Deploy the final version

1. Open **Supabase** → your project → **SQL Editor** → **New query**.
2. Open `schema.sql` (in this folder), copy the whole file, paste it, click **Run**.
   - Expect: "Success." It only *adds* the new `admin_log` and `notifications` tables.
3. Back in this folder, double-click **`push-to-github.bat`**.
4. Open your **Render dashboard** → the `cleanly` service → wait until the latest deploy says **Live** (~5 min).

✅ Done when: Render shows "Live" with your newest push.

---

## STEP 2 — Get the new version on your iPhone

1. On your iPhone, **delete** the current Cleanly icon from the home screen.
2. Open **Safari** → go to **cleanly-2x9z.onrender.com**.
3. Check: the 🔔 bell shows bottom-right, and the app looks right.
4. Tap **Share → Add to Home Screen**.

✅ Done when: the bell appears and the Decision log opens without a blank screen.

---

## STEP 3 — Turn on email (Resend)

1. Go to **resend.com** → sign up (free tier is fine to start).
2. Add & verify a sending domain (or use Resend's test sender to start).
3. Create an **API key** → copy it.
4. In **Render** → `cleanly` service → **Environment** → add two variables:
   - `RESEND_API_KEY` = (the key you copied)
   - `EMAIL_FROM` = e.g. `Cleanly <no-reply@yourdomain>`  (or the Resend test sender)
5. Save → Render redeploys automatically.

✅ Done when: approving a company/student sends them an email.

---

## STEP 4 — Create your CEO admin (if not already)

1. Double-click **`seed-ceo.bat`** in this folder.
2. Paste your Supabase connection string, then choose a password (10+ chars).
   - Email is fixed to **musagillani@tzmanufacturing.com**.
3. Log in at cleanly-2x9z.onrender.com with that email → you should have full CEO access.

✅ Done when: you can log in and see the Admin panel with all tabs.

---

## STEP 5 — The real-payment test (the big one) 💳

Do this with a real card and a small amount. It proves the whole money flow + webhook.

1. **As a company:** sign up a test cleaning company in the app (business details + adószám).
2. **As CEO:** approve that company in Admin → Companies.
3. **As the company:** go to **Settings → "⚡ Set up automatic payouts"** → complete Stripe's
   onboarding (bank account). Wait until it shows **payouts active**.
4. **As a customer:** book that company's service and **pay with a real card**.
5. **Check all four:**
   - Booking flips to **paid**.
   - The **company now sees the order** (it was hidden before payment).
   - A **🔔 notification** appears for both sides.
   - Your **Stripe dashboard** shows the payment with your **10% fee split out**.
6. **Test the refund:** as the company, **decline** that paid booking →
   confirm the customer is **refunded in full** in Stripe.

✅ Done when: money splits correctly AND the refund works. This is launch-ready.

---

## STEP 6 — Before you market it

- **Render → upgrade to Starter ($7/mo)** so the app doesn't "sleep" (~50s cold start).

---

## LATER — App Store + phone push (separate phase)

- Apple Developer account ($99, needs D-U-N-S number).
- OneSignal account (for lock-screen push notifications).
- A Hungarian lawyer glance over privacy/terms/partner-terms → then I remove the
  "draft — pending legal review" line.
- Tell me when you have the Apple + OneSignal accounts and I'll wire up the store build.

---

*If any step errors, copy the message and send it to me — I'll fix it.*
