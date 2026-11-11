-- ===========================================================================
--  APPLY PACK - migration 0157  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor), BEFORE or WITH the deploy.yml run
--  that ships Site health, and AFTER APPLY-0156. ADDITIVE and IDEMPOTENT ("if
--  not exists", "create or replace"), so it is safe to re-run. Nothing
--  existing changes: one empty column on presence_visits, one new table and the
--  one function that writes it.
--
--  Why: list item 151. The Health check says how fast each site loads for its
--  visitors (from the visit counter) and how much of the last 30 days it was
--  online (from the uptime check that already runs).
--
--  If the deploy goes first, nothing breaks: the Health check simply leaves out
--  speed and the uptime figure until this is applied.
--
--  Rollback (only if ever needed):
--    alter table public.presence_visits drop column if exists lcp_ms;
--    drop function if exists public.presence_uptime_tick(uuid, boolean);
--    drop table if exists public.presence_uptime_days;
--
--  Covers: supabase/migrations/0157_site_health_speed_uptime.sql
-- ===========================================================================

alter table public.presence_visits
  add column if not exists lcp_ms integer;

comment on column public.presence_visits.lcp_ms is
  'List item 151: on a leave row, the page''s largest contentful paint for that visitor, in milliseconds. Null when the browser does not report it.';

create table if not exists public.presence_uptime_days (
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  day date not null,
  checks integer not null default 0,
  ok_checks integer not null default 0,
  primary key (site_id, day)
);

alter table public.presence_uptime_days enable row level security;
revoke all on public.presence_uptime_days from anon, authenticated;

comment on table public.presence_uptime_days is
  'List item 151: per site per day, uptime checks run and checks that found the site answering. Written by presence_uptime_tick only.';

create or replace function public.presence_uptime_tick(p_site uuid, p_ok boolean)
returns void
language sql
security definer
set search_path = public
as $tick$
  insert into public.presence_uptime_days (site_id, day, checks, ok_checks)
  values (p_site, (now() at time zone 'utc')::date, 1, case when p_ok then 1 else 0 end)
  on conflict (site_id, day) do update
    set checks = public.presence_uptime_days.checks + 1,
        ok_checks = public.presence_uptime_days.ok_checks + excluded.ok_checks;
$tick$;

revoke all on function public.presence_uptime_tick(uuid, boolean) from public, anon, authenticated;
grant execute on function public.presence_uptime_tick(uuid, boolean) to service_role;


-- Verify (expect: lcp_ms integer; the table with RLS on; the function runnable by service_role only):
-- select column_name, data_type from information_schema.columns
--   where table_schema = 'public' and table_name = 'presence_visits' and column_name = 'lcp_ms';
-- select relrowsecurity from pg_class where relname = 'presence_uptime_days';
-- select has_function_privilege('service_role', 'public.presence_uptime_tick(uuid, boolean)', 'execute') as service,
--        has_function_privilege('anon', 'public.presence_uptime_tick(uuid, boolean)', 'execute') as anon;
