-- rollback: alter table public.presence_visits drop column if exists lcp_ms;
--           drop function if exists public.presence_uptime_tick(uuid, boolean);
--           drop table if exists public.presence_uptime_days;
--
-- ── Site health: speed as visitors feel it, and an uptime figure (list item 151) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION, and after 0156 (item 157's
-- 'leave' rows carry the speed). The function degrades honestly until it lands:
-- a page's time is kept without its speed, the uptime check keeps checking without
-- a tally, and the Health check leaves out what it can't yet say.
--
-- WHAT CHANGES
--   presence_visits.lcp_ms (integer, null): on a 'leave' row, how long the page's
--     main content took to show for that visitor (largest contentful paint, the
--     measure Google uses), 1 ms to 60 s. Browsers that don't report it (Safari)
--     send nothing.
--   presence_uptime_days: one row per site per day, how many uptime checks ran
--     and how many found the site answering. Written only by
--     presence_uptime_tick (the uptime check, service role); RLS on, nothing
--     granted to anon or signed-in users.
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
