-- ═══════════════════════════════════════════════════════════════════
--  CLEANO — the only two columns your database is missing (v7.1.1)
--
--  Where: Supabase → your project → SQL Editor → New query
--  Paste this whole file, press RUN. It is safe to run more than once.
--
--  Do NOT paste the big schema.sql. That file is 585 lines and the
--  Supabase editor has been timing out on it ("Failed to fetch") —
--  which is the error you saw. These four statements are the only
--  part of it your live database does not already have.
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


-- ═══════════════════════════════════════════════════════════════════
--  CHECK IT WORKED
--  Run this second query. You want two rows back.
-- ═══════════════════════════════════════════════════════════════════

SELECT column_name, data_type, column_default
FROM   information_schema.columns
WHERE  table_name = 'companies'
  AND  column_name IN ('service_areas', 'eu_vat')
ORDER  BY column_name;

-- Expected:
--   eu_vat         | text  |
--   service_areas  | jsonb | '[]'::jsonb
--
-- Then open  https://<your-render-url>/api/health  in a browser.
-- You want:  "version":"7.1.1"  and  "schema":"ready"
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
