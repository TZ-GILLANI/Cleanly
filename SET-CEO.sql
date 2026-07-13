-- ═══════════════════════════════════════════════════════════════════
--  Cleanly — PROMOTE musagillani@tzmanufacturing.com TO CEO (super admin)
--
--  Use this if that email currently only has limited "Admin" access and
--  you want it to be the full CEO / super admin.
--
--  HOW TO RUN:
--    1. Supabase → SQL Editor → New query
--    2. Paste this, click Run
--    3. IMPORTANT: log out of the app and log back in — the CEO powers
--       only appear after a fresh login (the access token is refreshed).
--
--  NOTE: the account must already exist (sign up once with this email
--  first if it doesn't). This only upgrades an existing account.
-- ═══════════════════════════════════════════════════════════════════

UPDATE users
SET is_super = true,
    role = 'admin',
    is_active = true,
    approval_status = 'approved'
WHERE email = 'musagillani@tzmanufacturing.com';

-- Confirm it worked (should show is_super = true):
SELECT email, role, is_super, is_active, approval_status
FROM users
WHERE email = 'musagillani@tzmanufacturing.com';
