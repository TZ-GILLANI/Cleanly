-- ═══════════════════════════════════════════════════════════════════
--  Cleano — REVIEWER DEMO ACCOUNTS (Update 1 / v7.0.0)
--
--  WHY THIS EXISTS
--  Apple and Google reviewers log in with the exact credentials you gave
--  them at launch. The pre-launch data wipe deleted those accounts, so a
--  reviewer trying them today would be rejected — and a rejected login is
--  an automatic app rejection. This recreates all four, with a demo
--  company that has services, availability and a requirements list, so
--  the reviewer can walk the whole flow without paying.
--
--  HOW TO RUN
--    1. Supabase → your project → SQL Editor → New query
--    2. Paste this whole file → Run
--    3. Expect "Success" and the summary rows at the bottom
--
--  SAFE TO RE-RUN. It updates the accounts rather than duplicating them.
--
--  ⚠️  DELETE THESE ACCOUNTS ONCE THE UPDATE IS APPROVED.
--      The last statement in this file (commented out) does that.
--
--  The password for all four is:  CleanoDemo2026!
--  (bcrypt hash below — the plain password is never stored)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- bcrypt hash of 'CleanoDemo2026!' (cost 10)
-- Generated locally; the plain text appears nowhere in the database.
DO $$
DECLARE
  pw          TEXT := '$2a$10$izkEODSwrnsco8GevzOmy.MKIrfbLKuNCRd6ciMpyuhYayMP9QKQu';
  co_owner_id UUID;
  co_id       UUID;
  cust_id     UUID;
  clean_id    UUID;
  svc_flat    UUID;
BEGIN
  -- ── 1. COMPANY OWNER ──────────────────────────────────────────────
  INSERT INTO users (email, password_hash, role, full_name, phone, city, country,
                     approval_status, is_active, terms_accepted_at, phone_verified, email_verified)
  VALUES ('demo.company@cleano.hu', pw, 'company', 'Demo Company Owner', '+36301234501',
          'Debrecen', 'HU', 'approved', true, NOW(), true, true)
  ON CONFLICT (email) DO UPDATE SET
    password_hash = EXCLUDED.password_hash, is_active = true,
    approval_status = 'approved', deleted_name = NULL, deleted_email = NULL
  RETURNING id INTO co_owner_id;

  IF co_owner_id IS NULL THEN
    SELECT id INTO co_owner_id FROM users WHERE email = 'demo.company@cleano.hu';
  END IF;

  -- ── 2. THE COMPANY ITSELF ─────────────────────────────────────────
  SELECT id INTO co_id FROM companies WHERE owner_id = co_owner_id;
  IF co_id IS NULL THEN
    INSERT INTO companies (owner_id, name, emoji, tagline, area, city, country,
                           tax_id, reg_number, contact_phone, student_discount,
                           service_lat, service_lng, service_radius_km, currency,
                           is_approved, is_listed)
    VALUES (co_owner_id, 'Sparkle Demo Kft.', '🫧',
            'Spotless homes, on your schedule.', 'Belváros · Nagyerdő', 'Debrecen', 'HU',
            '12345676-1-02', '09-09-123456', '+36301234501', 10,
            47.5316, 21.6273, 25, 'HUF', true, true)
    RETURNING id INTO co_id;
  ELSE
    UPDATE companies SET is_approved = true, is_listed = true,
      service_lat = 47.5316, service_lng = 21.6273, service_radius_km = 25
    WHERE id = co_id;
  END IF;

  UPDATE users SET company_id = co_id WHERE id = co_owner_id;

  -- Open every hour, every day, so a reviewer in any timezone finds a slot
  UPDATE companies SET availability = jsonb_build_object(
    'paused', false, 'closed', '[]'::jsonb, 'busy', '{}'::jsonb,
    'days', jsonb_build_object(
      '0', jsonb_build_object('on', true, 'slots', '["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00"]'::jsonb),
      '1', jsonb_build_object('on', true, 'slots', '["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00"]'::jsonb),
      '2', jsonb_build_object('on', true, 'slots', '["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00"]'::jsonb),
      '3', jsonb_build_object('on', true, 'slots', '["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00"]'::jsonb),
      '4', jsonb_build_object('on', true, 'slots', '["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00"]'::jsonb),
      '5', jsonb_build_object('on', true, 'slots', '["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00"]'::jsonb),
      '6', jsonb_build_object('on', true, 'slots', '["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00"]'::jsonb)
    ))
  WHERE id = co_id;

  -- 5.4 requirements, so the reviewer sees the "I understand" step
  UPDATE companies SET requirements = '["Somewhere to park our van","Hot running water","Someone at home to let us in"]'::jsonb
  WHERE id = co_id;

  -- ── 3. SERVICES ───────────────────────────────────────────────────
  DELETE FROM services WHERE company_id = co_id;
  INSERT INTO services (company_id, name, description, icon, price_huf, minutes, tasks, is_active, pricing_type)
  VALUES (co_id, 'Standard home clean', 'Kitchen, bathroom, floors and dusting throughout.', '🧹',
          12900, 120, '["Kitchen surfaces & sink","Bathroom full clean","Vacuum & mop all floors","Dust all surfaces"]'::jsonb,
          true, 'flat')
  RETURNING id INTO svc_flat;

  INSERT INTO services (company_id, name, description, icon, price_huf, minutes, tasks, is_active,
                        pricing_type, hourly_rate_huf, min_hours, max_hours)
  VALUES (co_id, 'Cleaning by the hour', 'Tell us how long you need — we do as much as we can.', '⏱',
          0, 60, '["Whatever you ask for first"]'::jsonb, true, 'hourly', 4500, 2, 8);

  INSERT INTO services (company_id, name, description, icon, price_huf, minutes, tasks, is_active,
                        pricing_type, period)
  VALUES (co_id, 'Weekly clean plan', 'The same clean, every week, charged automatically.', '🔁',
          10900, 120, '["Kitchen surfaces & sink","Bathroom full clean","Vacuum & mop all floors"]'::jsonb,
          true, 'subscription', 'weekly');

  -- ── 4. CLEANER (employee of the demo company) ─────────────────────
  INSERT INTO users (email, password_hash, role, full_name, phone, address, city, country,
                     company_id, approval_status, is_active, terms_accepted_at, phone_verified, email_verified)
  VALUES ('demo.cleaner@cleano.hu', pw, 'employee', 'Demo Cleaner', '+36301234502',
          'Debrecen, Piac utca 20.', 'Debrecen', 'HU', co_id, 'approved', true, NOW(), true, true)
  ON CONFLICT (email) DO UPDATE SET
    password_hash = EXCLUDED.password_hash, is_active = true, approval_status = 'approved',
    company_id = EXCLUDED.company_id, deleted_name = NULL, deleted_email = NULL
  RETURNING id INTO clean_id;

  -- ── 5. CUSTOMER ───────────────────────────────────────────────────
  INSERT INTO users (email, password_hash, role, full_name, customer_type, phone, address,
                     city, country, approval_status, is_active, terms_accepted_at, phone_verified, email_verified)
  VALUES ('demo.customer@cleano.hu', pw, 'customer', 'Demo Customer', 'resident', '+36301234503',
          'Debrecen, Kossuth utca 1.', 'Debrecen', 'HU', 'approved', true, NOW(), true, true)
  ON CONFLICT (email) DO UPDATE SET
    password_hash = EXCLUDED.password_hash, is_active = true, approval_status = 'approved',
    deleted_name = NULL, deleted_email = NULL
  RETURNING id INTO cust_id;

  -- ── 6. ADMIN (read-only demo, NOT the CEO) ────────────────────────
  --  is_super stays FALSE: the reviewer can see the admin area but cannot
  --  broadcast to every user or grant admin rights.
  INSERT INTO users (email, password_hash, role, full_name, phone, city, country,
                     is_super, approval_status, is_active, terms_accepted_at, phone_verified, email_verified)
  VALUES ('demo.admin@cleano.hu', pw, 'admin', 'Demo Admin', '+36301234504',
          'Debrecen', 'HU', false, 'approved', true, NOW(), true, true)
  ON CONFLICT (email) DO UPDATE SET
    password_hash = EXCLUDED.password_hash, is_active = true, role = 'admin',
    is_super = false, approval_status = 'approved', deleted_name = NULL, deleted_email = NULL;

  -- ── 7. ONE COMPLETED BOOKING, so every screen has something in it ──
  IF NOT EXISTS (SELECT 1 FROM bookings WHERE customer_id = cust_id) THEN
    INSERT INTO bookings (customer_id, company_id, service_id, service_snapshot,
                          scheduled_date, scheduled_slot, address, customer_type,
                          total_huf, service_fee_huf, pricing_type, status, payment_status,
                          assigned_to, order_no, currency, total_minor, service_fee_minor)
    SELECT cust_id, co_id, svc_flat,
           to_jsonb(s) - 'company_id',
           CURRENT_DATE - 7, '10:00', 'Debrecen, Kossuth utca 1.', 'resident',
           12900, 1290, 'flat', 4, 'paid', clean_id,
           COALESCE((SELECT MAX(order_no) FROM bookings), 0) + 1,
           'HUF', 1290000, 129000
    FROM services s WHERE s.id = svc_flat;
  END IF;
END $$;

COMMIT;

-- ── Check it worked ────────────────────────────────────────────────
SELECT email, role, is_active, approval_status, is_super
  FROM users
 WHERE email LIKE 'demo.%@cleano.hu'
 ORDER BY role;

SELECT c.name, c.is_approved, c.is_listed, c.service_radius_km,
       (SELECT COUNT(*) FROM services s WHERE s.company_id = c.id) AS services
  FROM companies c WHERE c.name = 'Sparkle Demo Kft.';


-- ═══════════════════════════════════════════════════════════════════
--  AFTER APPROVAL — remove the demo accounts.
--  Uncomment these four lines and run them once the update is live.
-- ═══════════════════════════════════════════════════════════════════
-- DELETE FROM bookings WHERE customer_id IN (SELECT id FROM users WHERE email LIKE 'demo.%@cleano.hu');
-- DELETE FROM services WHERE company_id IN (SELECT id FROM companies WHERE name = 'Sparkle Demo Kft.');
-- DELETE FROM companies WHERE name = 'Sparkle Demo Kft.';
-- DELETE FROM users WHERE email LIKE 'demo.%@cleano.hu';
