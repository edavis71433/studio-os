-- ===========================================================================
--  APPLY PACK - migrations 0099, 0100, 0101  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor). ADDITIVE and IDEMPOTENT ("if not
--  exists" tables and indexes), so it is safe to re-run. It adds four empty
--  tables and changes no existing row:
--    presence_appointment_types, presence_booking_settings,
--    presence_appointments, presence_reviews
--
--  Why: the Website > Bookings and Reviews tabs have answered 503 in production
--  because these were never applied (checked 2026-11-05: the tables do not exist).
--
--  NOT a plain copy of the three migrations. Each of them also re-declares the
--  CHECK on presence_plan_notices.kind with the list of kinds as it stood THEN.
--  Replaying that today would drop the kinds added by 0102 through 0135
--  (client_message, invoice_void_paid, ...), so those 10 statements are left
--  out on purpose. The live constraint already carries new_booking,
--  booking_reminder, booking_followup and new_review: the verify query at the
--  bottom proves it. Everything else is the migrations' own DDL, unchanged.
--
--  Wrapped in one transaction: all-or-nothing.
-- ===========================================================================

begin;

-- --- 0099 - native booking ---------------------------------------------------
create table if not exists public.presence_appointment_types (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  name text not null default '',
  duration_min integer not null default 30 check (duration_min between 5 and 480),
  price_cents integer check (price_cents is null or price_cents >= 0),
  description text not null default '',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists presence_appointment_types_site_idx
  on public.presence_appointment_types (site_id, sort_order)
  where deleted_at is null;
alter table public.presence_appointment_types enable row level security;
create table if not exists public.presence_booking_settings (
  site_id uuid primary key references public.presence_sites(id) on delete cascade,
  enabled boolean not null default false,
  weekly jsonb not null default '[[],[],[],[],[],[],[]]'::jsonb,
  closed_dates jsonb not null default '[]'::jsonb,
  slot_interval_min integer not null default 30,
  buffer_min integer not null default 0,
  lead_time_hours integer not null default 2,
  max_days_ahead integer not null default 60,
  timezone text not null default 'America/Los_Angeles',
  auto_confirm boolean not null default false,
  intro text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.presence_booking_settings enable row level security;
create table if not exists public.presence_appointments (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  type_id uuid references public.presence_appointment_types(id) on delete set null,
  type_name text not null default '',
  contact_id uuid references public.presence_contacts(id) on delete set null,
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  slot_start_local text not null default '',
  duration_min integer not null default 30,
  timezone text not null default '',
  price_cents integer check (price_cents is null or price_cents >= 0),
  customer_name text not null default '',
  customer_email text not null default '',
  customer_phone text not null default '',
  note text not null default '',
  status text not null default 'pending'
    check (status in ('pending','confirmed','canceled','completed')),
  source text not null default 'website',
  ip_hash text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  canceled_at timestamptz
);
create unique index if not exists presence_appointments_slot_uq
  on public.presence_appointments (site_id, slot_start_local)
  where status in ('pending','confirmed');
create index if not exists presence_appointments_site_upcoming_idx
  on public.presence_appointments (site_id, slot_start)
  where status in ('pending','confirmed');
create index if not exists presence_appointments_site_local_idx
  on public.presence_appointments (site_id, slot_start_local)
  where status in ('pending','confirmed');
alter table public.presence_appointments enable row level security;
comment on table public.presence_appointment_types is
  'Bookable services for native online booking (name, duration, optional price). Site-scoped, deny-all RLS, function-mediated.';
comment on table public.presence_booking_settings is
  'ONE row per site: weekly availability (jsonb) + booking-window config (slot interval / buffer / lead-time / max-days / timezone / auto-confirm). Validated by lib/booking.ts. Deny-all RLS.';
comment on table public.presence_appointments is
  'Customer bookings (public self-serve submit -> owner-seen). status pending/confirmed/canceled/completed. Atomic no-double-book via presence_appointments_slot_uq. Confirmations reuse the ONE send path;
contact reuses presence_contacts. Deny-all RLS;
function-mediated.';

-- --- 0100 - booking reminders and no-show ---------------------------------------------------
alter table public.presence_appointments
  drop constraint if exists presence_appointments_status_check;
alter table public.presence_appointments
  add constraint presence_appointments_status_check
  check (status in ('pending','confirmed','canceled','completed','no_show'));

-- --- 0101 - native reviews ---------------------------------------------------
create table if not exists public.presence_reviews (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  contact_id uuid references public.presence_contacts(id) on delete set null,
  reviewer_name text not null default '',
  reviewer_email text not null default '',
  rating integer not null default 5 check (rating between 1 and 5),
  body text not null default '',
  status text not null default 'pending'
    check (status in ('pending','approved','hidden')),
  owner_reply text not null default '',
  source text not null default 'website',
  ip_hash text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz
);
create index if not exists presence_reviews_site_status_idx
  on public.presence_reviews (site_id, status, created_at desc);
create index if not exists presence_reviews_site_approved_idx
  on public.presence_reviews (site_id, approved_at desc)
  where status = 'approved';
alter table public.presence_reviews enable row level security;
comment on table public.presence_reviews is
  'Customer reviews (public self-serve submit -> owner-approved -> shown). status pending/approved/hidden. Displayed ONLY after approval;
honest schema.org (AggregateRating + Review) is baked from approved rows at serialize time. Submit safety (honeypot + rate-limit + ip_hash + validation) reuses the form/booking path;
contact reuses presence_contacts. Deny-all RLS;
function-mediated.';

commit;

-- VERIFY: expect 6 rows. Four tables with detail = RLS on: true, then the two
-- constraints with detail = true.
select 'table' as kind, c.relname as name, 'RLS on: ' || c.relrowsecurity::text as detail
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('presence_appointment_types','presence_booking_settings','presence_appointments','presence_reviews')
union all
select 'constraint', conname,
       case conname
         when 'presence_plan_notices_kind_check' then (
           pg_get_constraintdef(oid) like '%new_booking%' and pg_get_constraintdef(oid) like '%booking_reminder%'
           and pg_get_constraintdef(oid) like '%booking_followup%' and pg_get_constraintdef(oid) like '%new_review%'
           and pg_get_constraintdef(oid) like '%client_message%')::text
         else (pg_get_constraintdef(oid) like '%no_show%')::text
       end
  from pg_constraint
 where conname in ('presence_plan_notices_kind_check','presence_appointments_status_check');
