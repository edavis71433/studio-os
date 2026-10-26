-- 0136_free_tools.sql
-- rollback: see the "-- ROLLBACK" block at the bottom. Reversible: drops only
--           the four tool_* tables and the one function this migration adds.
--
-- WHAT / WHY
--   Free Tools rebuild, Phase 1 (Free Tools Build Spec, Oct 2026). Site Review
--   and AI Visibility Check share one store:
--     tool_reports     one row per scan (teaser + full report data)
--     tool_leads       one row per captured email (the unlock form)
--     tool_scan_cache  avoids re-running the same scan (24h / 7d)
--     tool_usage_log   cost and abuse tracking (daily spend cap)
--
--   Named tool_* because public.leads (the CRM inbox) and public.audit_leads
--   (the old audit pipeline) already exist. unlock-report still mirrors each
--   unlocked lead into audit_leads so it lands in the Studio OS pipeline.
--
--   Service role only: RLS on with NO policies, and anon/authenticated get no
--   table access at all. The browser never reads these tables; the tool-report
--   and unlock-report edge functions do, and decide what a locked report shows.
-- ============================================================================

create table if not exists public.tool_leads (
  id                uuid        primary key default gen_random_uuid(),
  email             text        not null,
  name              text,
  business_name     text,
  business_type     text,
  city              text,
  website_url       text,
  source_tool       text        not null check (source_tool in ('site_review', 'ai_visibility')),
  consent_marketing boolean     not null default false,
  audit_lead_id     uuid,
  created_at        timestamptz not null default now()
);
create index if not exists tool_leads_email_idx on public.tool_leads (lower(email));
create index if not exists tool_leads_created_idx on public.tool_leads (created_at desc);

create table if not exists public.tool_reports (
  id          uuid        primary key default gen_random_uuid(),
  tool        text        not null check (tool in ('site_review', 'ai_visibility')),
  input       jsonb       not null default '{}'::jsonb,
  raw_results jsonb,
  findings    jsonb,
  scores      jsonb,
  unlocked    boolean     not null default false,
  unlocked_at timestamptz,
  lead_id     uuid        references public.tool_leads (id) on delete set null,
  pdf_url     text,
  cached_from uuid,
  created_at  timestamptz not null default now()
);
create index if not exists tool_reports_created_idx on public.tool_reports (created_at desc);

create table if not exists public.tool_scan_cache (
  tool       text        not null check (tool in ('site_review', 'ai_visibility')),
  cache_key  text        not null,
  report_id  uuid        not null references public.tool_reports (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (tool, cache_key)
);

create table if not exists public.tool_usage_log (
  id         uuid          primary key default gen_random_uuid(),
  tool       text          not null,
  kind       text          not null default 'scan' check (kind in ('scan', 'cache_hit', 'unlock', 'blocked')),
  ip_hash    text,
  email      text,
  report_id  uuid,
  cost_usd   numeric(10,4) not null default 0,
  note       text,
  created_at timestamptz   not null default now()
);
create index if not exists tool_usage_log_created_idx on public.tool_usage_log (created_at desc);

alter table public.tool_leads      enable row level security;
alter table public.tool_reports    enable row level security;
alter table public.tool_scan_cache enable row level security;
alter table public.tool_usage_log  enable row level security;

revoke all on public.tool_leads, public.tool_reports, public.tool_scan_cache, public.tool_usage_log from anon, authenticated;
grant all on public.tool_leads, public.tool_reports, public.tool_scan_cache, public.tool_usage_log to service_role;

-- Today's estimated spend across both tools, in dollars, for the daily cap.
-- "Today" is the studio's day (Los Angeles), so the cap resets at local midnight.
create or replace function public.tool_spend_today()
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select coalesce(sum(cost_usd), 0)
    from public.tool_usage_log
   where created_at >= (date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles');
$$;
revoke all on function public.tool_spend_today() from public, anon, authenticated;
grant execute on function public.tool_spend_today() to service_role;

comment on table public.tool_reports is
  'Free Tools (0136): one row per Site Review / AI Visibility scan. findings = {summary, items[], top_three[], tables[]}; scores = {overall, label, pillars[], highlights}. Locked rows are served as a teaser by the tool-report function.';
comment on table public.tool_leads is
  'Free Tools (0136): one row per email captured on a report unlock. Mirrored into audit_leads (audit_lead_id) so it shows in the Studio OS pipeline.';

-- ============================================================================
-- ROLLBACK (run manually if this migration must be reversed):
--   drop function if exists public.tool_spend_today();
--   drop table if exists public.tool_scan_cache;
--   drop table if exists public.tool_usage_log;
--   drop table if exists public.tool_reports;
--   drop table if exists public.tool_leads;
-- Drops captured tool leads and reports; the audit_leads mirrors survive.
-- ============================================================================
