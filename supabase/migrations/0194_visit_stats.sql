-- rollback: drop function if exists public.presence_visit_stats(uuid, timestamptz, timestamptz, timestamptz, timestamptz, int, text[]);
--           drop function if exists public.presence_sites_visitors(uuid[], timestamptz);
--
-- ── Visits counted in the database (builder list item 207) ───────────────────
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. Until it lands the pages read
-- the rows a page at a time and count them in code (right up to 50,000 rows, slower).
--
-- WHY
--   Analytics, the client portal, the Health page and Business insights asked for
--   up to 5,000 visit rows and counted them in code, but one read hands back 1,000
--   at most. Past about 1,000 rows in the window (twelve weeks on Analytics: a dozen
--   page views a day) visitors were understated, older weeks on the chart fell
--   toward zero, and the "cut short" note waited for 5,000 rows that could never
--   arrive. The Sites page has counted in the database since 0170 and showed a
--   different number for the same month.
--
-- WHAT CHANGES (two read-only functions, nothing existing changes)
--   presence_visit_stats(site, start, now, end, prior start, weeks, paths): one site's
--     numbers for a window, as the pages show them: visitors (the day's visitor marks,
--     page views only, a row with no mark is not a person), page views, visitors in
--     the window before, calls, emails, button and download counts, the ten most
--     viewed pages with their visitors, where visits came from (by referrer host and
--     utm_source; the server words them), devices, countries, and visitors per week
--     for the last `weeks` weeks counted back from `now`. `end` closes the window
--     (null = up to the newest row); `paths` narrows it to some pages.
--   presence_sites_visitors(site ids, since): visitors and page views per site, for
--     the studio's client list.
create or replace function public.presence_visit_stats(
  p_site_id uuid,
  p_start timestamptz,
  p_now timestamptz default now(),
  p_end timestamptz default null,
  p_prior_start timestamptz default null,
  p_weeks int default 0,
  p_paths text[] default null
)
returns jsonb
language sql stable
set search_path = public
as $$
  with v as (
    select v.ts, v.kind, v.path, v.ref_host, v.utm_source, v.device, v.country,
           nullif(v.visitor_hash, '') as vh
    from public.presence_visits v
    where v.site_id = p_site_id
      and v.kind in ('pageview', 'phone', 'email', 'cta', 'download')
      and v.ts >= least(p_start, coalesce(p_prior_start, p_start),
                        case when p_weeks > 0 then p_now - make_interval(days => 7 * p_weeks) else p_start end)
      and (p_end is null or v.ts < p_end)
      and (p_paths is null or v.path = any(p_paths))
  ),
  cur as (select * from v where ts >= p_start),
  pv as (select * from cur where kind = 'pageview')
  select jsonb_build_object(
    'visitors', (select count(distinct vh) from pv),
    'pageviews', (select count(*) from pv),
    'prior_visitors', case when p_prior_start is null then null else
      (select count(distinct vh) from v where kind = 'pageview' and ts >= p_prior_start and ts < p_start) end,
    'events', (select coalesce(jsonb_object_agg(e.kind, e.n), '{}'::jsonb)
               from (select kind, count(*) as n from cur where kind <> 'pageview' group by kind) e),
    'pages', (select coalesce(jsonb_agg(jsonb_build_object('path', p.path, 'views', p.views, 'visitors', p.visitors) order by p.views desc, p.path), '[]'::jsonb)
              from (select path, count(*) as views, count(distinct vh) as visitors from pv where path <> ''
                    group by path order by count(*) desc, path limit 10) p),
    -- a visit with no mark counts as its own visit, as the page-by-page count did
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('ref_host', s.ref_host, 'utm_source', s.utm_source, 'visits', s.visits) order by s.visits desc, s.ref_host, s.utm_source), '[]'::jsonb)
                from (select ref_host, utm_source, count(distinct coalesce(vh, ts::text)) as visits from pv
                      group by ref_host, utm_source order by 3 desc, ref_host, utm_source limit 200) s),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('device', d.device, 'views', d.n) order by d.n desc, d.device), '[]'::jsonb)
                from (select device, count(*) as n from pv where device <> '' group by device) d),
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('country', c.country, 'visits', c.n) order by c.n desc, c.country), '[]'::jsonb)
                  from (select country, count(*) as n from pv where country <> ''
                        group by country order by count(*) desc, country limit 5) c),
    'weekly', case when p_weeks > 0 then
      (select jsonb_agg(coalesce(w.n, 0) order by g.i)
       from generate_series(0, p_weeks - 1) as g(i)
       left join (select (p_weeks - 1 - floor(extract(epoch from (p_now - ts)) / 604800))::int as i, count(distinct vh) as n
                  from v
                  where kind = 'pageview' and vh is not null and ts <= p_now and ts > p_now - make_interval(days => 7 * p_weeks)
                  group by 1) w on w.i = g.i) end
  )
$$;

comment on function public.presence_visit_stats(uuid, timestamptz, timestamptz, timestamptz, timestamptz, int, text[]) is
  'List item 207: one site''s visit numbers for a window, counted here so they stay right past the 1,000 rows one API read returns. Read by Analytics, the client portal, the Health page and Business insights (service role).';

create or replace function public.presence_sites_visitors(p_site_ids uuid[], p_since timestamptz)
returns table (site_id uuid, visitors bigint, pageviews bigint)
language sql stable
set search_path = public
as $$
  select v.site_id,
         count(distinct nullif(v.visitor_hash, ''))::bigint as visitors,
         count(*)::bigint as pageviews
  from public.presence_visits v
  where v.site_id = any(p_site_ids) and v.kind = 'pageview' and v.ts >= p_since
  group by v.site_id
$$;

comment on function public.presence_sites_visitors(uuid[], timestamptz) is
  'List item 207: visitors and page views per site since a moment, counted here, for the studio''s client list (service role).';

-- 0141's lesson: production's default privileges give new functions to postgres only.
revoke all on function public.presence_visit_stats(uuid, timestamptz, timestamptz, timestamptz, timestamptz, int, text[]) from public, anon, authenticated;
grant execute on function public.presence_visit_stats(uuid, timestamptz, timestamptz, timestamptz, timestamptz, int, text[]) to service_role;
revoke all on function public.presence_sites_visitors(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.presence_sites_visitors(uuid[], timestamptz) to service_role;
