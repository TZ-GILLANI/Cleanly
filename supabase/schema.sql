-- ════════════════════════════════════════════════════════════
-- CLEANLY — Supabase schema
-- Run this once in: Supabase Dashboard → SQL Editor → New query
-- Three roles share one app:
--   customer  → books services, sees only their own bookings
--   employee  → belongs to a company, sees only assigned jobs
--   company   → owns a company, manages services/team/jobs
-- ════════════════════════════════════════════════════════════

-- ── 1. PROFILES (one row per auth user) ─────────────────────
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  role          text not null check (role in ('customer','employee','company')),
  full_name     text not null,
  customer_type text check (customer_type in ('student','resident')),
  company_id    uuid,                       -- set for employees + company owners
  phone         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ── 2. COMPANIES ─────────────────────────────────────────────
create table public.companies (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references public.profiles (id),
  name             text not null,
  emoji            text not null default '🫧',
  tagline          text,
  area             text,
  student_discount int  not null default 10 check (student_discount between 0 and 50),
  rating           numeric(2,1) not null default 5.0,
  review_count     int  not null default 0,
  is_listed        boolean not null default true,
  created_at       timestamptz not null default now()
);

alter table public.profiles
  add constraint profiles_company_fk
  foreign key (company_id) references public.companies (id) on delete set null;

-- ── 3. INVITE CODES (company → employee onboarding) ─────────
create table public.invite_codes (
  code        text primary key,
  company_id  uuid not null references public.companies (id) on delete cascade,
  label       text,                          -- e.g. employee name it was made for
  used_by     uuid references public.profiles (id),
  created_at  timestamptz not null default now()
);

-- ── 4. SERVICES (each company manages its own) ──────────────
create table public.services (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null,
  description text,
  icon        text not null default '🏠',
  price_huf   int  not null check (price_huf >= 0),
  minutes     int  not null default 120,
  tasks       jsonb not null default '[]',   -- checklist the cleaner follows
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ── 5. BOOKINGS ──────────────────────────────────────────────
-- service details are snapshotted so price changes never alter history
create table public.bookings (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references public.profiles (id),
  company_id       uuid not null references public.companies (id),
  service_id       uuid references public.services (id),
  service_snapshot jsonb not null,           -- {name, icon, price_huf, minutes, tasks}
  scheduled_date   date not null,
  scheduled_slot   text not null,            -- '09:30'
  address          text not null,
  note             text,
  customer_type    text not null,            -- student / resident at time of booking
  total_huf        int  not null,
  status           int  not null default 0,  -- 0 new · 1 assigned · 2 on-way · 3 cleaning · 4 done · 9 cancelled
  assigned_to      uuid references public.profiles (id),
  tasks_done       jsonb not null default '[]',
  created_at       timestamptz not null default now()
);

-- ── 6. NOTICES (company → employee messages) ────────────────
create table public.notices (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  to_employee uuid not null references public.profiles (id) on delete cascade,
  body        text not null,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ── 7. REVIEWS ───────────────────────────────────────────────
create table public.reviews (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null unique references public.bookings (id) on delete cascade,
  company_id  uuid not null references public.companies (id) on delete cascade,
  customer_id uuid not null references public.profiles (id),
  stars       int  not null check (stars between 1 and 5),
  body        text,
  created_at  timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════
-- TRIGGERS
-- ════════════════════════════════════════════════════════════

-- Create a profile automatically on sign-up, using the metadata
-- the app passes to supabase.auth.signUp().
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, full_name, customer_type, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'role', 'customer'),
    coalesce(new.raw_user_meta_data ->> 'full_name', 'New user'),
    new.raw_user_meta_data ->> 'customer_type',
    new.raw_user_meta_data ->> 'phone'
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep the company rating snapshot up to date when a review lands.
create or replace function public.refresh_company_rating()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.companies c set
    rating       = (select round(avg(stars)::numeric, 1) from public.reviews where company_id = new.company_id),
    review_count = (select count(*) from public.reviews where company_id = new.company_id)
  where c.id = new.company_id;
  return new;
end $$;

create trigger on_review_created
  after insert on public.reviews
  for each row execute function public.refresh_company_rating();

-- ════════════════════════════════════════════════════════════
-- RPC: claim an invite code (employee onboarding)
-- Called after the employee account is created.
-- ════════════════════════════════════════════════════════════
create or replace function public.claim_invite(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  select company_id into v_company
  from public.invite_codes
  where code = upper(p_code) and used_by is null;

  if v_company is null then
    raise exception 'Invalid or already-used invite code';
  end if;

  update public.invite_codes set used_by = auth.uid() where code = upper(p_code);
  update public.profiles set company_id = v_company, role = 'employee' where id = auth.uid();
  return v_company;
end $$;

-- ════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════
alter table public.profiles     enable row level security;
alter table public.companies    enable row level security;
alter table public.invite_codes enable row level security;
alter table public.services     enable row level security;
alter table public.bookings     enable row level security;
alter table public.notices      enable row level security;
alter table public.reviews      enable row level security;

-- helper: my profile row
create or replace function public.my_company() returns uuid
language sql stable security definer set search_path = public as
$$ select company_id from public.profiles where id = auth.uid() $$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as
$$ select role from public.profiles where id = auth.uid() $$;

-- PROFILES: see yourself; company admins see their employees;
-- customers can see the name of the cleaner assigned to them (via view below).
create policy "profiles_self_read"   on public.profiles for select using (id = auth.uid());
create policy "profiles_self_update" on public.profiles for update using (id = auth.uid());
create policy "profiles_company_reads_staff" on public.profiles for select
  using (company_id is not null and company_id = public.my_company());

-- COMPANIES: anyone signed in can browse listed companies; owner manages their own.
create policy "companies_browse" on public.companies for select using (is_listed = true or owner_id = auth.uid());
create policy "companies_owner_insert" on public.companies for insert with check (owner_id = auth.uid());
create policy "companies_owner_update" on public.companies for update using (owner_id = auth.uid());

-- INVITE CODES: only the owning company can create/see; claiming goes via RPC.
create policy "invites_company" on public.invite_codes for all
  using (company_id = public.my_company() and public.my_role() = 'company')
  with check (company_id = public.my_company());

-- SERVICES: everyone can read active services of listed companies; company manages its own.
create policy "services_browse" on public.services for select
  using (is_active = true or company_id = public.my_company());
create policy "services_company_write" on public.services for insert
  with check (company_id = public.my_company() and public.my_role() = 'company');
create policy "services_company_update" on public.services for update
  using (company_id = public.my_company() and public.my_role() = 'company');
create policy "services_company_delete" on public.services for delete
  using (company_id = public.my_company() and public.my_role() = 'company');

-- BOOKINGS: customer sees own; employee sees assigned; company sees its own.
create policy "bookings_customer_read"  on public.bookings for select using (customer_id = auth.uid());
create policy "bookings_customer_insert" on public.bookings for insert with check (customer_id = auth.uid());
create policy "bookings_customer_cancel" on public.bookings for update
  using (customer_id = auth.uid() and status in (0,1));        -- can only cancel before work starts
create policy "bookings_employee_read"  on public.bookings for select using (assigned_to = auth.uid());
create policy "bookings_employee_update" on public.bookings for update using (assigned_to = auth.uid());
create policy "bookings_company_all"    on public.bookings for select using (company_id = public.my_company());
create policy "bookings_company_update" on public.bookings for update
  using (company_id = public.my_company() and public.my_role() = 'company');

-- NOTICES: company sends; employee reads + marks read.
create policy "notices_company" on public.notices for all
  using (company_id = public.my_company() and public.my_role() = 'company')
  with check (company_id = public.my_company());
create policy "notices_employee_read"   on public.notices for select using (to_employee = auth.uid());
create policy "notices_employee_update" on public.notices for update using (to_employee = auth.uid());

-- REVIEWS: public read; the booking's customer may write once.
create policy "reviews_read" on public.reviews for select using (true);
create policy "reviews_customer_write" on public.reviews for insert
  with check (
    customer_id = auth.uid()
    and exists (select 1 from public.bookings b
                where b.id = booking_id and b.customer_id = auth.uid() and b.status = 4)
  );

-- ════════════════════════════════════════════════════════════
-- OPTIONAL: enable realtime so dashboards update live
-- Dashboard → Database → Replication → add these tables,
-- or run:
-- alter publication supabase_realtime add table public.bookings, public.notices;
-- ════════════════════════════════════════════════════════════
