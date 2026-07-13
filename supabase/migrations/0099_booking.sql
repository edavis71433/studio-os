-- ── 0099 — Native booking / appointments (customer self-serve → owner-seen) ──
-- The #1 table-stakes gap for salons / trades / wellness / clinics / restaurants:
-- let a small business's customers book a real appointment online, native (no
-- external calendar). A booking is a public self-serve submission — SAME safety as
-- a form submit (honeypot + rate-limit + validation + escaping in the route) — that
-- creates a pending/confirmed appointment the owner sees, is emailed about, and gets
-- a bell notice for. Confirmations reuse the ONE send path (commerce/account.ts
-- sendEmail: suppression + one-click unsubscribe); the owner notice reuses the ONE
-- notice model (presence_plan_notices); a booking attaches/creates a CRM contact
-- (presence_contacts). No parallel systems.
--
-- Three additive tables, all site_id-scoped, deny-all RLS + function-mediated,
-- exactly like the CRM/sales spine (0074) and broadcasts (0098):
--   • presence_appointment_types  — the bookable services (name, duration, price…)
--   • presence_booking_settings   — ONE row per site: weekly availability + window
--                                   config (jsonb; slot interval / buffer / lead /
--                                   max-days / timezone / auto-confirm)
--   • presence_appointments       — the bookings themselves + the atomic no-double-
--                                   book guard (unique on site_id + slot_start among
--                                   active statuses)
--
-- Additive + deploy-order-tolerant (mirrors 0094–0098): the routes degrade
-- gracefully before this is applied — public slots/booking + the owner Bookings
-- area return "booking needs a database update" and the site's booking block simply
-- shows as unavailable. OWNER-APPLY: apply on staging + prod before the booking
-- surface goes live. Safe to re-run (create ... if not exists / idempotent).

-- ── bookable appointment types (the services a visitor can pick) ──
create table if not exists public.presence_appointment_types (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  name text not null default '',
  duration_min integer not null default 30 check (duration_min between 5 and 480),
  price_cents integer check (price_cents is null or price_cents >= 0),   -- null = "no set price"
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
alter table public.presence_appointment_types enable row level security;  -- deny-all; function-mediated

-- ── booking settings: ONE row per site (weekly availability + window config) ──
-- Availability lives as jsonb (a 7-element weekly array of {start,end} ranges) so
-- the owner's schedule is one atomic edit — no per-row availability table to keep
-- consistent. All config is validated/clamped by lib/booking.ts normalizeBookingConfig.
create table if not exists public.presence_booking_settings (
  site_id uuid primary key references public.presence_sites(id) on delete cascade,
  enabled boolean not null default false,               -- owner turns bookings on explicitly
  weekly jsonb not null default '[[],[],[],[],[],[],[]]'::jsonb,   -- index 0=Sun … 6=Sat
  closed_dates jsonb not null default '[]'::jsonb,       -- ["YYYY-MM-DD", …] holidays / closures
  slot_interval_min integer not null default 30,
  buffer_min integer not null default 0,
  lead_time_hours integer not null default 2,
  max_days_ahead integer not null default 60,
  timezone text not null default 'America/Los_Angeles',
  auto_confirm boolean not null default false,           -- false → new bookings land 'pending'
  intro text not null default '',                        -- optional calm intro shown on the widget
  updated_at timestamptz not null default now()
);
alter table public.presence_booking_settings enable row level security;  -- deny-all; function-mediated

-- ── the appointments themselves ──
-- slot_start / slot_end are timestamptz (a real instant, computed by the route from
-- the site timezone) so the owner's upcoming list + a future reminder sweep (task
-- #164) sort correctly. slot_start_local keeps the wall-clock the customer picked,
-- for unambiguous display and the double-book comparison, independent of tz drift.
create table if not exists public.presence_appointments (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  type_id uuid references public.presence_appointment_types(id) on delete set null,
  type_name text not null default '',                    -- snapshot of the service name at booking
  contact_id uuid references public.presence_contacts(id) on delete set null,
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  slot_start_local text not null default '',             -- "YYYY-MM-DDTHH:MM" business-local
  duration_min integer not null default 30,
  timezone text not null default '',
  price_cents integer check (price_cents is null or price_cents >= 0),
  customer_name text not null default '',
  customer_email text not null default '',
  customer_phone text not null default '',
  note text not null default '',
  status text not null default 'pending'
    check (status in ('pending','confirmed','canceled','completed')),
  source text not null default 'website',                -- website | manual (owner-added)
  ip_hash text not null default '',                      -- privacy-safe throttling/audit (no raw IP)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  canceled_at timestamptz
);
-- THE atomic no-double-book guard: at most one ACTIVE appointment per (site, slot
-- start local). A concurrent second booking of the same slot hits this unique index
-- and fails cleanly (the route turns the conflict into a calm "just taken" message).
-- Canceled appointments free the slot (they are excluded from the partial index).
create unique index if not exists presence_appointments_slot_uq
  on public.presence_appointments (site_id, slot_start_local)
  where status in ('pending','confirmed');
create index if not exists presence_appointments_site_upcoming_idx
  on public.presence_appointments (site_id, slot_start)
  where status in ('pending','confirmed');
-- the public slots query: existing appointments on a given local day, to subtract
create index if not exists presence_appointments_site_local_idx
  on public.presence_appointments (site_id, slot_start_local)
  where status in ('pending','confirmed');
alter table public.presence_appointments enable row level security;  -- deny-all; function-mediated

-- Widen the notice-kind check to include 'new_booking' (raised by routes/booking.ts
-- → the ONE notice model → bell + push). raiseNotice() is best-effort, so without
-- this the owner's booking alert would fail SILENTLY against the check (same latent
-- trap 0088 fixed for other kinds). Additive; safe to re-run.
alter table public.presence_plan_notices
  drop constraint if exists presence_plan_notices_kind_check;
alter table public.presence_plan_notices
  add constraint presence_plan_notices_kind_check
  check (kind in (
    'capacity','trial_ending','trial_ended','payment_trouble','account_lapsed',
    'search_setup','winddown_reminder','win_back','welcome_back',
    'deletion_requested','domain_expiry','lead_followup','renewal_reminder',
    'deal_signed','deal_followup','publish_failed','invoice_paid',
    'connection_expired','website_enquiry','approval_decided',
    -- added by 0099:
    'new_booking'
  ));

comment on table public.presence_appointment_types is
  'Bookable services for native online booking (name, duration, optional price). Site-scoped, deny-all RLS, function-mediated.';
comment on table public.presence_booking_settings is
  'ONE row per site: weekly availability (jsonb) + booking-window config (slot interval / buffer / lead-time / max-days / timezone / auto-confirm). Validated by lib/booking.ts. Deny-all RLS.';
comment on table public.presence_appointments is
  'Customer bookings (public self-serve submit → owner-seen). status pending/confirmed/canceled/completed. Atomic no-double-book via presence_appointments_slot_uq. Confirmations reuse the ONE send path; owner notice reuses presence_plan_notices; contact reuses presence_contacts. Deny-all RLS; function-mediated.';

-- rollback:
--   drop table if exists public.presence_appointments;
--   drop table if exists public.presence_booking_settings;
--   drop table if exists public.presence_appointment_types;
