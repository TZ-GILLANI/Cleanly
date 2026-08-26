-- ═══════════════════════════════════════════════════════════════════
--  CLEANO — the columns your database is missing (for v7.8.0)
--  NUMBER 4 IS NEW. Run the file again; 1 to 3 will simply do nothing.
--
--  Where: Supabase → your project → SQL Editor → New query
--  Paste this whole file, press RUN. It is safe to run more than once,
--  so re-running it after you already did 1 and 2 costs nothing.
--
--  Do NOT paste the big schema.sql. That file is 585 lines and the
--  Supabase editor has been timing out on it ("Failed to fetch") —
--  which is the error you saw. These statements are the only part of
--  it your live database does not already have.
-- ═══════════════════════════════════════════════════════════════════


-- 1 ── Service areas ────────────────────────────────────────────────
-- The list of places a company works in. Each entry is either a whole
-- town or a circle inside one, which is what lets a company say
-- "all of Debrecen, and only the middle of Budapest".
-- Until this column exists the app falls back to the old single pin.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS service_areas JSONB NOT NULL DEFAULT '[]';


-- 2 ── EU VAT number ────────────────────────────────────────────────
-- Optional közösségi adószám, validated per country. Needed for
-- invoicing a customer or partner in another EU country.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS eu_vat TEXT;


-- 3 ── Why a payment failed ─────────────────────────────────────────
-- ADDED 25 Aug, after the card kept failing on Stripe's own page.
-- Stripe reports a refused card as payment_intent.payment_failed, and
-- nothing was listening for it — so the booking sat as "pending", no
-- reason was kept anywhere, and the only account of what went wrong
-- lived in the Stripe dashboard. This column holds Stripe's own
-- sentence ("Your card was declined", "insufficient funds") and the
-- app shows it to the customer and to you.
-- Needs server v7.1.2 or later.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS payment_error TEXT;


-- 4 ── Moving one visit ─────────────────────────────────────────────
-- NEW in v7.3.0. A customer who can't make Tuesday offers two or three
-- dates they could manage, and you pick whichever one you can actually
-- work. Neither side sets the new date alone, so you are never handed
-- a day you're closed. Holds the whole exchange — the dates offered,
-- which ones are workable, the one you chose, and the original date.
-- Nothing about the money moves: same price, same payment, same place
-- in the plan. Only the day and the hour change.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS reschedule JSONB;


-- ═══════════════════════════════════════════════════════════════════
--  CHECK IT WORKED
--  Run this second query. You want four rows back.
-- ═══════════════════════════════════════════════════════════════════

SELECT table_name, column_name, data_type, column_default
FROM   information_schema.columns
WHERE  (table_name = 'companies' AND column_name IN ('service_areas', 'eu_vat'))
   OR  (table_name = 'bookings'  AND column_name IN ('payment_error', 'reschedule'))
ORDER  BY table_name, column_name;

-- Expected:
--   bookings   | payment_error | text  |
--   bookings   | reschedule    | jsonb |
--   companies  | eu_vat        | text  |
--   companies  | service_areas | jsonb | '[]'::jsonb
--
-- Then open  https://<your-render-url>/api/health  in a browser.
-- You want:  "version":"7.8.0"  and  "schema":"ready"
-- If it says "schema":"MIGRATION_PENDING", the ALTERs did not land.
-- If it says an older version, Render has not deployed the new code yet.


-- ═══════════════════════════════════════════════════════════════════
--  OPTIONAL — two settings on YOUR company, not schema changes.
--  Only run these if you want them. Replace the name if it differs.
-- ═══════════════════════════════════════════════════════════════════

-- (a) Student discount. It is 0% right now, so students pay full price.
--     The App Store text says "up to 20%", which stays true at 0 —
--     but nobody gets anything. 20 makes the promise real.
--     You can also do this in the app: Company → Profile → Student discount.
--
-- UPDATE companies SET student_discount = 20 WHERE name = 'TZ Gillani Kft';


-- (b) Service area. Your pin sits 38.6 km south-west of Debrecen with a
--     39 km radius, so the city centre was inside it and the university
--     was not. The app now reads it as "the whole of Debrecen" anyway,
--     so nothing is broken — but this replaces it with the clean version.
--     You can also do this in the app: Company → Profile → Service areas.
--
-- UPDATE companies
--   SET service_areas = '[{"city":"Debrecen","mode":"all"}]'::jsonb
--   WHERE name = 'TZ Gillani Kft';
