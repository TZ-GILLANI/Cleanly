-- ════════════════════════════════════════════════════════════
-- CLEANLY — PostgreSQL schema
-- Run once: psql -d cleanly -f schema.sql
-- Requires PostgreSQL 13+ (gen_random_uuid via pgcrypto)
-- ════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Roles ────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('customer','employee','company','admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE customer_type_enum AS ENUM ('student','resident');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 1. USERS (replaces Supabase auth.users) ─────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          user_role NOT NULL DEFAULT 'customer',
  full_name     TEXT NOT NULL,
  customer_type customer_type_enum,
  company_id    UUID,
  phone         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. COMPANIES ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  emoji            TEXT NOT NULL DEFAULT '🫧',
  tagline          TEXT,
  area             TEXT,
  student_discount INT NOT NULL DEFAULT 10 CHECK (student_discount BETWEEN 0 AND 50),
  rating           NUMERIC(2,1) NOT NULL DEFAULT 5.0,
  review_count     INT NOT NULL DEFAULT 0,
  cover            TEXT,
  is_listed        BOOLEAN NOT NULL DEFAULT true,
  is_approved      BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE users
    ADD CONSTRAINT users_company_fk
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. INVITE CODES ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invite_codes (
  code        TEXT PRIMARY KEY,
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  label       TEXT,
  used_by     UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 4. SERVICES ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS services (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  icon        TEXT NOT NULL DEFAULT '🏠',
  price_huf   INT NOT NULL CHECK (price_huf >= 0),
  minutes     INT NOT NULL DEFAULT 120,
  tasks       JSONB NOT NULL DEFAULT '[]',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 5. BOOKINGS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      UUID NOT NULL REFERENCES users(id),
  company_id       UUID NOT NULL REFERENCES companies(id),
  service_id       UUID REFERENCES services(id),
  service_snapshot JSONB NOT NULL,
  scheduled_date   DATE NOT NULL,
  scheduled_slot   TEXT NOT NULL,
  address          TEXT NOT NULL,
  note             TEXT,
  customer_type    TEXT NOT NULL,
  total_huf        INT NOT NULL,
  status           INT NOT NULL DEFAULT 0,
  assigned_to      UUID REFERENCES users(id),
  tasks_done       JSONB NOT NULL DEFAULT '[]',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 6. NOTICES ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  to_employee UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  is_read     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 7. REVIEWS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id),
  stars       INT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  body        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Trigger: refresh company rating on review ────────────────
CREATE OR REPLACE FUNCTION refresh_company_rating()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE companies SET
    rating       = (SELECT ROUND(AVG(stars)::NUMERIC, 1) FROM reviews WHERE company_id = NEW.company_id),
    review_count = (SELECT COUNT(*) FROM reviews WHERE company_id = NEW.company_id)
  WHERE id = NEW.company_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_review_created ON reviews;
CREATE TRIGGER on_review_created
  AFTER INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION refresh_company_rating();

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bookings_customer  ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_company   ON bookings(company_id);
CREATE INDEX IF NOT EXISTS idx_bookings_employee  ON bookings(assigned_to);
CREATE INDEX IF NOT EXISTS idx_notices_employee   ON notices(to_employee);
CREATE INDEX IF NOT EXISTS idx_services_company   ON services(company_id);
CREATE INDEX IF NOT EXISTS idx_reviews_company    ON reviews(company_id);

-- ════════════════════════════════════════════════════════════
-- v2 — company onboarding docs, flexible pricing, subscriptions
-- (additive: safe to re-run on an existing database)
-- ════════════════════════════════════════════════════════════

-- Company onboarding / documentation + own logo
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tax_id        TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS reg_number    TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url      TEXT;   -- company-uploaded PNG (data URL)

-- Flexible pricing on services:
--   pricing_type: 'flat' (price_huf) | 'hourly' (hourly_rate_huf × hours) | 'subscription' (price_huf per period)
ALTER TABLE services  ADD COLUMN IF NOT EXISTS pricing_type    TEXT NOT NULL DEFAULT 'flat';
ALTER TABLE services  ADD COLUMN IF NOT EXISTS hourly_rate_huf INT;
ALTER TABLE services  ADD COLUMN IF NOT EXISTS min_hours       INT DEFAULT 2;
ALTER TABLE services  ADD COLUMN IF NOT EXISTS max_hours       INT DEFAULT 8;
ALTER TABLE services  ADD COLUMN IF NOT EXISTS period          TEXT;  -- 'weekly' | 'biweekly' | 'monthly' (subscriptions)

-- Pricing context captured on each booking
ALTER TABLE bookings  ADD COLUMN IF NOT EXISTS pricing_type   TEXT NOT NULL DEFAULT 'flat';
ALTER TABLE bookings  ADD COLUMN IF NOT EXISTS hours          NUMERIC;
ALTER TABLE bookings  ADD COLUMN IF NOT EXISTS period         TEXT;
ALTER TABLE bookings  ADD COLUMN IF NOT EXISTS decline_reason TEXT;  -- company "not available" message (status 8)

-- Saved customer details (home address + preferred payment method + language)
ALTER TABLE users ADD COLUMN IF NOT EXISTS address       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash';  -- 'cash' | 'card'
ALTER TABLE users ADD COLUMN IF NOT EXISTS lang          TEXT DEFAULT 'en';     -- 'en' | 'hu'

-- Verification documents (array of {name, type, data} data-URLs):
--   companies: tax certificate, registration extract …
--   users (employees): ID / residence card …
ALTER TABLE users     ADD COLUMN IF NOT EXISTS documents JSONB NOT NULL DEFAULT '[]';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS documents JSONB NOT NULL DEFAULT '[]';

-- Make the rating trigger resilient when a company has zero reviews
CREATE OR REPLACE FUNCTION refresh_company_rating()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE companies SET
    rating       = COALESCE((SELECT ROUND(AVG(stars)::NUMERIC, 1) FROM reviews WHERE company_id = NEW.company_id), 0),
    review_count = (SELECT COUNT(*) FROM reviews WHERE company_id = NEW.company_id)
  WHERE id = NEW.company_id;
  RETURN NEW;
END $$;

-- ── Card payments (Barion) ─────────────────────────────────────────
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status    TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS order_no          INTEGER;  -- 'unpaid' | 'pending' | 'paid'
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS barion_payment_id TEXT;
CREATE INDEX IF NOT EXISTS bookings_barion_idx ON bookings (barion_payment_id);

-- ── Complaints / support reports ───────────────────────────────────
CREATE TABLE IF NOT EXISTS complaints (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id  UUID REFERENCES bookings(id) ON DELETE SET NULL,
  subject     TEXT NOT NULL,
  body        TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
  resolution  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS complaints_status_idx ON complaints (status, created_at DESC);

-- ── Multi-city (Hungary-wide, Europe-ready) ────────────────────────
ALTER TABLE companies ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT 'Debrecen';
CREATE INDEX IF NOT EXISTS companies_city_idx ON companies (city);

-- ── Phone: one number = one active account + verification flag ─────
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique ON users (phone) WHERE phone IS NOT NULL AND is_active = true;

-- ── Student verification workflow ──────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending','approved','rejected'));
CREATE INDEX IF NOT EXISTS users_approval_idx ON users (approval_status) WHERE approval_status = 'pending';

-- ── Google review hand-off (policy-compliant: customer posts it themselves) ──
ALTER TABLE companies ADD COLUMN IF NOT EXISTS google_place_id TEXT;

-- ── Stripe Connect: automatic payout split to companies ────────────
ALTER TABLE companies ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;

-- ── Customer-facing service fee (added on top of company price) ────
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_fee_huf INT NOT NULL DEFAULT 0;

-- ── Admin tiers + email verification ───────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_code_expires TIMESTAMPTZ;

-- ── Notices: read receipts + per-side clearing ─────────────────────
ALTER TABLE notices ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
ALTER TABLE notices ADD COLUMN IF NOT EXISTS deleted_by_company  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE notices ADD COLUMN IF NOT EXISTS deleted_by_employee BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE notices ADD COLUMN IF NOT EXISTS from_employee    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE notices ADD COLUMN IF NOT EXISTS read_by_company BOOLEAN NOT NULL DEFAULT false;

-- ── Invoices on bookings + company-side archiving ──────────────────
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS invoice JSONB;               -- {name,type,data} uploaded by company
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS archived_by_company BOOLEAN NOT NULL DEFAULT false;

-- ── Terms acceptance (click-wrap consent proof) ────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

-- Admin decision log - records which admin made which decision (all admins have full access).
CREATE TABLE IF NOT EXISTS admin_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID,
  admin_email TEXT,
  admin_name  TEXT,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  detail      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_log_created_idx ON admin_log (created_at DESC);

-- User notifications feed (in-app bell). Phone push layer added later.
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  booking_id UUID,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

-- Complaint two-way thread + admin-to-company assignment.
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS assigned_company_id UUID;
CREATE TABLE IF NOT EXISTS complaint_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  sender_id    UUID,
  sender_role  TEXT,
  sender_name  TEXT,
  body         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS complaint_messages_idx ON complaint_messages (complaint_id, created_at);

-- Live location (foreground tracking while a cleaner is on the way) + saved addresses.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS live_lat DOUBLE PRECISION;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS live_lng DOUBLE PRECISION;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS live_at  TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS saved_addresses JSONB NOT NULL DEFAULT '[]';

-- v4.4: company promotional offers ({pct,label,until}), shown to customers and applied at booking
ALTER TABLE companies ADD COLUMN IF NOT EXISTS promo JSONB;

-- v4.6: per-service discounts (percent off that one cleaning)
ALTER TABLE services ADD COLUMN IF NOT EXISTS promo_pct INTEGER;

-- v4.6.1: resident→student switch requires card verification (no self-service discount)
ALTER TABLE users ADD COLUMN IF NOT EXISTS student_upgrade BOOLEAN NOT NULL DEFAULT false;

-- v4.7: FCM device token for real phone push notifications
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT;

-- v4.9: keep a record of who a deleted account was, for the company's and admin's
-- booking history only (accounting). Clearable per booking.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_name  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_email TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS hide_deleted_identity BOOLEAN NOT NULL DEFAULT false;

-- v4.9: day-of reminders (customer ~40min before, company at each booking time)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_customer_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_company_at  TIMESTAMPTZ;

-- v5.0: complaint routing — who is talking to the customer right now, and how
-- the company chose to handle it (solve in chat, or call the customer back).
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS handled_by TEXT NOT NULL DEFAULT 'admin'
  CHECK (handled_by IS NULL OR handled_by IN ('admin','company'));
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS company_action TEXT
  CHECK (company_action IS NULL OR company_action IN ('chat','callback'));
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS callback_note TEXT;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS callback_at TIMESTAMPTZ;

-- v5.0: saved card for recurring plans — the customer approves it once at the
-- first payment, then each renewal is charged automatically (off-session).
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_payment_method TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS card_brand TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS card_last4 TEXT;

-- v5.2: cleaner gets a 40-min heads-up too
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_cleaner_at TIMESTAMPTZ;

-- v5.5: company availability — working hours per weekday, days off, and a
-- "fully booked / paused" switch. Shape:
--   { "paused": false,
--     "days": { "1": {"on":true,"from":"08:00","to":"18:00"}, ... "0": {"on":false} },
--     "closed": ["2026-08-20", "2026-12-24"] }
-- Weekday keys are JS getDay(): 0=Sunday … 6=Saturday.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS availability JSONB;

-- ═══ UPDATE 1 · Part 3: currency + real subscriptions ═══════════════
-- Per-company currency (3.2). Existing *_huf columns stay for old clients;
-- *_minor columns are the forward-looking truth (integer minor units).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'HUF';
ALTER TABLE services  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'HUF';
ALTER TABLE bookings  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'HUF';
ALTER TABLE bookings  ADD COLUMN IF NOT EXISTS total_minor BIGINT;
ALTER TABLE bookings  ADD COLUMN IF NOT EXISTS service_fee_minor BIGINT;
UPDATE bookings SET total_minor = total_huf * 100 WHERE total_minor IS NULL AND total_huf IS NOT NULL;
UPDATE bookings SET service_fee_minor = COALESCE(service_fee_huf,0) * 100 WHERE service_fee_minor IS NULL;

-- Real subscription schedules (3.4) — replaces the old "chain" design.
CREATE TABLE IF NOT EXISTS subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  service_id    UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  frequency     TEXT NOT NULL,                    -- weekly | biweekly | monthly
  slot          TEXT NOT NULL,                    -- "09:00"
  address       TEXT NOT NULL,
  note          TEXT,
  hours         INT,
  currency      TEXT NOT NULL DEFAULT 'HUF',
  amount_minor  BIGINT NOT NULL,                  -- per occurrence, incl. fee
  fee_minor     BIGINT NOT NULL DEFAULT 0,
  stripe_customer_id TEXT,                        -- on the COMPANY's connected account
  payment_method_id  TEXT,                        -- saved card on that account
  stripe_account_id  TEXT,                        -- the connected account
  status        TEXT NOT NULL DEFAULT 'active',   -- active | paused | cancelled
  next_booking_date DATE,                         -- next date to materialise
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at  TIMESTAMPTZ
);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL;
-- 'scheduled' = future occurrence, will be auto-charged 24-48h before
-- (payment_status values in use: unpaid | pending | paid | refunded | scheduled | failed)

-- ═══ UPDATE 1 · Part 4: country + service areas + geocode cache ═════
ALTER TABLE users     ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'HU';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'HU';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS service_lat DOUBLE PRECISION;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS service_lng DOUBLE PRECISION;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS service_radius_km INT NOT NULL DEFAULT 10;
ALTER TABLE users     ADD COLUMN IF NOT EXISTS address_lat DOUBLE PRECISION;
ALTER TABLE users     ADD COLUMN IF NOT EXISTS address_lng DOUBLE PRECISION;

-- 4.6: geocode an address once, never look it up again (respects OSM's policy)
CREATE TABLE IF NOT EXISTS geocache (
  q          TEXT PRIMARY KEY,
  lat        DOUBLE PRECISION,
  lng        DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Collection services (laundry, ironing, anything taken away and brought back) ──
-- The platform only understood one shape of job: someone comes to your address,
-- works there, leaves. A laundry round is two visits with days in between, so it
-- needs its own fulfilment type and its own idea of "finished".
ALTER TABLE services ADD COLUMN IF NOT EXISTS fulfilment TEXT NOT NULL DEFAULT 'onsite';
ALTER TABLE services ADD COLUMN IF NOT EXISTS turnaround_days INT NOT NULL DEFAULT 3;
-- How many jobs of this service one team can take in a single hour. A cleaning
-- slot is exclusive; a collection round can call at several houses. NULL = use
-- the team size, which is the old behaviour.
ALTER TABLE services ADD COLUMN IF NOT EXISTS slot_capacity INT;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS fulfilment  TEXT NOT NULL DEFAULT 'onsite';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS return_date DATE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS return_slot TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS returned_at  TIMESTAMPTZ;

-- Status ladder, by fulfilment type:
--   onsite      0 New  1 Assigned  2 On the way  3 Cleaning        4 Done
--   collection  0 New  1 Assigned  2 On the way  5 Collected
--                                  3 In progress 6 Out for return  4 Returned
-- 8 Declined and 9 Cancelled apply to both. Review and invoicing still key off
-- 4, so nothing downstream had to learn a new "finished" signal.

-- ── Priced by the unit: laundry by the kilo, carpets by the square metre ──
-- Same shape as hourly pricing (customer picks a quantity, price = rate x quantity),
-- but with a label the company chooses, because "3 hours" and "3 kg" are the same
-- arithmetic and should not be two different code paths.
ALTER TABLE services ADD COLUMN IF NOT EXISTS unit_label    TEXT;      -- 'kg', 'm²', 'item'…
ALTER TABLE services ADD COLUMN IF NOT EXISTS unit_price_huf INT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS min_units     NUMERIC(8,2);
ALTER TABLE services ADD COLUMN IF NOT EXISTS max_units     NUMERIC(8,2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS units         NUMERIC(8,2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS unit_label    TEXT;

-- ── When the work actually happened ──────────────────────────────
-- The company and the admin need the real clock times, not just the slot that
-- was booked: a job booked for 10:00 that started at 11:40 is the thing a
-- customer complains about, and without a timestamp it is one person's word
-- against another's.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS started_at  TIMESTAMPTZ;   -- work began
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;   -- work ended
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS enroute_at  TIMESTAMPTZ;   -- set off

-- ── Reporting a customer ─────────────────────────────────────────
-- Reviews run one way: customers rate companies. A company with a customer who
-- was abusive, absent, or whose home was unsafe had nowhere to say so, and no
-- record if it happened again.
CREATE TABLE IF NOT EXISTS customer_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   UUID REFERENCES bookings(id) ON DELETE SET NULL,
  customer_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  reported_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  category     TEXT NOT NULL,          -- 'abusive' | 'absent' | 'unsafe' | 'payment' | 'other'
  detail       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'reviewed' | 'dismissed'
  admin_note   TEXT,
  handled_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  handled_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_reports_customer ON customer_reports (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_reports_open ON customer_reports (status);

-- What Cleano actually keeps after covering Stripe on the partner's behalf.
-- The customer's invoice still shows a 500 Ft platform fee; the partner's cost
-- breaks down as (this) to Cleano plus Stripe's cut, which sums back to 500.
-- Our fee invoice must be for what we really received, or nothing reconciles.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS platform_net_minor INT;

-- ── Invoicing ──────────────────────────────────────────────────────
-- Billing address for the partner company. A Hungarian invoice is not valid
-- without the buyer's postcode, town and street, and we were only storing city.
-- Cities a company serves in full, as a JSON array of names: ["Debrecen","Nyíregyháza"].
-- This is the answer to three separate questions that turned out to be one:
--   "give me a button for the whole city"        -> the list holds their own city
--   "what about smaller cities"                  -> a name is a name, size is irrelevant
--   "and if a company is multi-city?"            -> the list holds as many as they like
-- A radius is a bad proxy for a city: 30 km swallows four towns around a village
-- and still misses the edge of a large one. Empty list = fall back to the radius.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS service_cities JSONB NOT NULL DEFAULT '[]';

-- Service areas, v7.1.
--
-- What came before was two ideas that could not talk to each other: one pin
-- with a radius, floating free of any city, plus a flat list of whole cities.
-- You could say "everywhere within 15 km of this dot" or "all of Debrecen and
-- all of Budapest" -- but not "all of Debrecen, and only the middle of
-- Budapest", which is what a real cleaning company covers. Nothing anchored
-- the pin either, so it could sit in a field 38 km from the city it claimed.
--
-- Each entry is now a place with a name:
--   { "city": "Debrecen", "mode": "all" }
--   { "city": "Budapest", "mode": "radius", "lat": .., "lng": .., "radiusKm": 8, "label": "Belvaros" }
-- An address is covered if ANY entry covers it. The old columns are still
-- written so builds already on people's phones keep working.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS service_areas JSONB NOT NULL DEFAULT '[]';

-- EU VAT number (kozossegi adoszam). Optional: only companies that invoice
-- across an EU border need one. Validated per member state, and for Hungary
-- checked against the adoszam already on file, because HU + the first eight
-- digits of the adoszam IS the VAT number -- a mismatch is a typo.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS eu_vat TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS billing_name    TEXT;   -- legal name, if it differs from the trading name
ALTER TABLE companies ADD COLUMN IF NOT EXISTS billing_zip     TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS billing_city    TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS billing_address TEXT;   -- street and number
ALTER TABLE companies ADD COLUMN IF NOT EXISTS billing_email   TEXT;   -- where invoices are sent

-- Our own invoice to the partner for the platform fee, issued automatically.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS fee_invoice_no   TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS fee_invoice_at   TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS fee_invoice_pdf  TEXT;   -- base64
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS fee_invoice_error TEXT;  -- last failure, so it can be retried and chased

-- The partner's own invoice to the customer, uploaded by the partner.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS partner_invoice_no  TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS partner_invoice_at  TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS partner_invoice_pdf TEXT;   -- base64
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS partner_invoice_nudged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bookings_fee_invoice_missing ON bookings (company_id) WHERE fee_invoice_no IS NULL;

-- Calendar sync. The token is a read-only secret that lives in a subscription
-- URL. It is not the login token, and rotating it kills every old link at once.
ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_calendar_token ON users (calendar_token);

-- Calendars only replace an event when SEQUENCE moves, so a booking needs to
-- remember when it last changed.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION touch_booking_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_bookings_touch ON bookings;
CREATE TRIGGER trg_bookings_touch BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION touch_booking_updated_at();

-- 5.2 live translation of user-entered text. One JSONB map of lang → text next
-- to each source field, filled on write. Legal pages are deliberately excluded.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tagline_i18n      JSONB;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS requirements_i18n JSONB;
ALTER TABLE services  ADD COLUMN IF NOT EXISTS name_i18n         JSONB;
ALTER TABLE services  ADD COLUMN IF NOT EXISTS description_i18n  JSONB;
ALTER TABLE reviews   ADD COLUMN IF NOT EXISTS body_i18n         JSONB;

-- 5.9: a review an admin removed must stay out of the average forever.
-- Without this, the next new review re-runs the trigger and resurrects it.
CREATE OR REPLACE FUNCTION refresh_company_rating()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE companies SET
    rating       = COALESCE((SELECT ROUND(AVG(stars)::NUMERIC, 1) FROM reviews
                              WHERE company_id = NEW.company_id AND removed_at IS NULL), 0),
    review_count = (SELECT COUNT(*) FROM reviews
                     WHERE company_id = NEW.company_id AND removed_at IS NULL)
  WHERE id = NEW.company_id;
  RETURN NEW;
END $$;

-- 5.5 targeted announcements need a city on the person, not just the company.
-- Backfilled from the company for owners/cleaners so targeting works on day one.
ALTER TABLE users ADD COLUMN IF NOT EXISTS city TEXT;
UPDATE users u SET city = c.city
  FROM companies c WHERE u.city IS NULL AND c.id = u.company_id AND c.city IS NOT NULL;
UPDATE users u SET city = c.city
  FROM companies c WHERE u.city IS NULL AND c.owner_id = u.id AND c.city IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_city ON users (city);

-- 5.11 booking-acceptance timeout
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS accept_nudged_at TIMESTAMPTZ;

-- ═══ UPDATE 1 · Part 5: moderation, requirements, admin audit ═══════
-- 5.3 review moderation: companies REPORT, admins remove, every removal logged
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reported_at     TIMESTAMPTZ;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reported_reason TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS removed_at      TIMESTAMPTZ;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS removed_by      UUID;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS removed_reason  TEXT;

-- 5.4 company requirements the customer must acknowledge before paying
ALTER TABLE companies ADD COLUMN IF NOT EXISTS requirements JSONB;   -- ["parking", ...]
ALTER TABLE services  ADD COLUMN IF NOT EXISTS requirements JSONB;   -- extra, per service
ALTER TABLE bookings  ADD COLUMN IF NOT EXISTS requirements_ack_at TIMESTAMPTZ;
