-- ═══════════════════════════════════════════════════════════════════
--  Cleanly — CLEAN SLATE / WIPE ALL TEST DATA
--  ⚠️  IRREVERSIBLE. This deletes EVERYTHING: your CEO admin login,
--      every test company, booking, review, complaint, notice, service.
--      The empty tables (structure) stay — only the ROWS are removed.
--
--  WHEN TO RUN: once, before real launch, to remove all data you
--               created while testing.
--
--  HOW TO RUN:
--    1. Supabase → your project → SQL Editor → New query
--    2. Paste this whole file
--    3. Click "Run"
--    4. Expect: "Success. No rows returned."
--
--  AFTER RUNNING: the database is virgin. You MUST re-create your CEO
--  admin account (it was deleted too) — run seed-admin.bat on your PC.
-- ═══════════════════════════════════════════════════════════════════

TRUNCATE TABLE
  complaints,
  reviews,
  notices,
  bookings,
  services,
  invite_codes,
  companies,
  users
RESTART IDENTITY CASCADE;

-- Verify everything is empty (all counts should be 0):
SELECT 'users'        AS table_name, COUNT(*) AS rows FROM users
UNION ALL SELECT 'companies',    COUNT(*) FROM companies
UNION ALL SELECT 'invite_codes', COUNT(*) FROM invite_codes
UNION ALL SELECT 'services',     COUNT(*) FROM services
UNION ALL SELECT 'bookings',     COUNT(*) FROM bookings
UNION ALL SELECT 'notices',      COUNT(*) FROM notices
UNION ALL SELECT 'reviews',      COUNT(*) FROM reviews
UNION ALL SELECT 'complaints',   COUNT(*) FROM complaints;
