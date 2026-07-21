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
