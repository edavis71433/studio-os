-- ===========================================================================
--  APPLY PACK - migration 0170  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships the Sites numbers. ADDITIVE and IDEMPOTENT
--  ("if not exists", "create or replace"), so it is safe to re-run. Nothing
--  existing changes: one new table and one read-only function.
--
--  Why: builder list items 129, 180 and 183. The Sites page shows each site's
--  health, visitors and Google clicks with the change from last month, and
--  Website health draws a line and says what was fixed since last week.
--
--  If the deploy goes first, nothing breaks: the Sites page leaves the numbers
--  out and the evidence engine keeps checking without keeping a daily health.
--
--  Rollback (only if ever needed):
--    drop function if exists public.presence_month_visitors(uuid[], timestamptz);
--    drop table if exists public.presence_health_days;
--
--  Covers: supabase/migrations/0170_site_numbers.sql
-- ===========================================================================

create table if not exists public.presence_health_days (
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  day date not null,
  score smallint not null check (score between 0 and 100),
  critical smallint not null default 0,
  warning smallint not null default 0,
  issues jsonb not null default '[]'::jsonb,
  fingerprints text[] not null default '{}',
  run_id uuid,
  checked_at timestamptz not null default now(),
  primary key (site_id, day)
);

alter table public.presence_health_days enable row level security;
revoke all on public.presence_health_days from anon, authenticated;

comment on table public.presence_health_days is
  'List items 129/180/183: per site per day, the health from that day''s last evidence run: the studio-only 0-100 number, critical and warning problem types, the issues and the failing fingerprints. Written by the evidence engine (service role) only.';

create or replace function public.presence_month_visitors(p_site_ids uuid[], p_since timestamptz)
returns table (site_id uuid, month text, visitors bigint, pageviews bigint)
language sql stable
set search_path = public
as $$
  select v.site_id,
         to_char(date_trunc('month', v.ts at time zone 'utc'), 'YYYY-MM') as month,
         count(distinct nullif(v.visitor_hash, ''))::bigint as visitors,
         count(*)::bigint as pageviews
  from public.presence_visits v
  where v.site_id = any(p_site_ids) and v.kind = 'pageview' and v.ts >= p_since
  group by v.site_id, 2
$$;

revoke all on function public.presence_month_visitors(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.presence_month_visitors(uuid[], timestamptz) to service_role;


-- Verify (expect: the table with RLS on; the function runnable by service_role only):
-- select relrowsecurity from pg_class where relname = 'presence_health_days';
-- select has_function_privilege('service_role', 'public.presence_month_visitors(uuid[], timestamptz)', 'execute') as service,
--        has_function_privilege('anon', 'public.presence_month_visitors(uuid[], timestamptz)', 'execute') as anon;
