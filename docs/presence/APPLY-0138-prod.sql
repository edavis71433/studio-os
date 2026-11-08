-- ===========================================================================
--  APPLY PACK - migration 0138  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor), BEFORE or WITH the deploy.yml run
--  that ships the security fixes from the sales final pass (PR "batch A").
--  ADDITIVE and IDEMPOTENT ("if not exists"), safe to re-run.
--
--  What it does:
--   1. A new table, presence_connect_requests: when a studio wants to connect a
--      Studio OS account that already exists, the request waits there until the
--      account's owner presses Accept in their own workspace. (Before, the
--      studio got control of that website the moment it typed the email.)
--   2. Studio OS's own settings rows in presence_sales_templates (saved views,
--      picked lists, stage names, the calendar link, the services catalog,
--      contact fields) become ONE row per site and name. Any duplicate that
--      already exists is retired first (kept: the most recently saved).
--
--  If the deploy goes first: asking to connect an existing account says
--  "couldn't send your request just now" until this runs. Nothing else breaks.
--
--  Rollback (only if ever needed):
--    drop index if exists public.presence_sales_templates_reserved_uq;
--    drop table if exists public.presence_connect_requests;
--
--  Covers: supabase/migrations/0138_connect_requests_and_one_settings_row.sql
-- ===========================================================================

create table if not exists public.presence_connect_requests (
  id uuid primary key default gen_random_uuid(),
  studio_site_id uuid not null references public.presence_sites(id) on delete cascade,
  agency_id uuid references public.presence_agencies(id) on delete set null,
  email text not null,
  name text not null default '',
  requested_by text not null default '',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_site_id, email)
);
alter table public.presence_connect_requests enable row level security;
create index if not exists presence_connect_requests_pending_email_idx
  on public.presence_connect_requests (email) where status = 'pending';
comment on table public.presence_connect_requests is
  'Final pass S1 (Nov 2026): a studio''s request to connect the Studio OS account at this email. Linked only when the account owner accepts (routes/connect_requests.ts).';

with ranked as (
  select id, row_number() over (partition by site_id, kind, name order by updated_at desc nulls last, created_at desc, id) as rn
  from public.presence_sales_templates
  where deleted_at is null and name like '\_\_%\_\_'
)
update public.presence_sales_templates t
   set deleted_at = now()
  from ranked r
 where t.id = r.id and r.rn > 1;

create unique index if not exists presence_sales_templates_reserved_uq
  on public.presence_sales_templates (site_id, kind, name)
  where deleted_at is null and name like '\_\_%\_\_';

-- Verify (expect 2 rows: presence_connect_requests_pending_email_idx and
-- presence_sales_templates_reserved_uq):
-- select indexname from pg_indexes
--   where schemaname = 'public'
--     and indexname in ('presence_connect_requests_pending_email_idx', 'presence_sales_templates_reserved_uq')
--   order by indexname;
