-- rollback: drop function if exists public.presence_month_visitors(uuid[], timestamptz, text);
--           drop table if exists public.presence_health_days;
--
-- ── Numbers on every site: health kept by day, visitors by month (builder list items 129, 180, 183) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. Until it lands the Sites page
-- shows its cards and table without these numbers, the evidence engine keeps checking
-- (it just keeps no daily health), and Website health says its history isn't kept yet.
--
-- WHAT CHANGES
--   presence_health_days: one row per site per day, written after each evidence run
--     (the day's last run wins): the studio's 0 to 100 number, how many problem types
--     are critical or warnings, which ones (issues), and the fingerprint of every
--     failing item, so a later day can say what was fixed and what is new. RLS on,
--     nothing granted to anon or signed-in users; the function's own key writes it.
--   presence_month_visitors(site ids, since, zone): each site's visitors and page views
--     per month, counted in the database, on the zone's clock (UTC unless one is given;
--     the monthly report gives the site's own). The Sites page asks once for every site;
--     reading the rows instead stopped at 1,000 a request. They are visits, as
--     Analytics calls them: the visitor mark changes each day, so a month's
--     count is its daily visitors added up.
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

create or replace function public.presence_month_visitors(p_site_ids uuid[], p_since timestamptz, p_tz text default 'utc')
returns table (site_id uuid, month text, visitors bigint, pageviews bigint)
language sql stable
set search_path = public
as $$
  select v.site_id,
         to_char(date_trunc('month', v.ts at time zone p_tz), 'YYYY-MM') as month,
         count(distinct nullif(v.visitor_hash, ''))::bigint as visitors,
         count(*)::bigint as pageviews
  from public.presence_visits v
  where v.site_id = any(p_site_ids) and v.kind = 'pageview' and v.ts >= p_since
  group by v.site_id, 2
$$;

revoke all on function public.presence_month_visitors(uuid[], timestamptz, text) from public, anon, authenticated;
grant execute on function public.presence_month_visitors(uuid[], timestamptz, text) to service_role;
