-- ===========================================================================
--  APPLY PACK - migration 0190  (owner-apply, prod)
-- ===========================================================================
--  Builder list item 206: a site's health is checked once a day and after each
--  publish, and old check results are cleared after 30 days.
--
--  THREE STEPS, IN THIS ORDER
--    Step 1  the clearing function. Additive, safe to re-run. Run it BEFORE or
--            WITH the deploy.yml run that ships item 206. Takes under a second.
--    Step 2  the deploy (not SQL): from then on each site is checked once a day
--            and after a publish, and every tick clears what is past 30 days.
--    Step 3  the one-time clear-out, AFTER the deploy is live. Optional but it is
--            where the space comes back. Run it ONCE. Expect 10 to 60 seconds.
--
--  If the deploy goes first, nothing breaks: the retention sweep keeps using the
--  old 180-day prune until step 1 lands.
--  If step 3 is never run, nothing breaks either: every 15-minute tick clears
--  500 old runs, so the rows past 30 days are gone in about 16 hours and the
--  rest as they age. But deleting rows does not hand disk space back, so the
--  tables would stay near their 2.4 GB on disk. Step 3 hands it back at once.
--
--  THE SCHEDULE
--    No scheduled job is added, changed or removed. production's presence-cycle
--    job keeps running every 15 minutes (publishes, reminders and the uptime
--    check need that). What changed is in the function's code: the tick now
--    checks only the sites that are due (functions/presence/lib/check_soon.ts).
--    To go back to a check on every tick: revert the item 206 pull request and
--    run deploy.yml again. No SQL is needed for that.
--    To stop the clearing only: see Rollback.
--
--  Rollback (only if ever needed):
--    drop function if exists public.presence_prune_health(int, int);
--    The sweep then falls back to the old 180-day prune by itself.
--    Step 3 cannot be undone from here: it removes old check results for good.
--    Nothing a page reads is among them (see step 3), and Supabase's daily
--    backup holds the day before.
--
--  Covers: supabase/migrations/0190_health_history_prune.sql
-- ===========================================================================


-- ── STEP 1: the clearing function ───────────────────────────────────────────

create or replace function public.presence_prune_health(keep_days int default 30, max_runs int default 500)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz := now() - make_interval(days => greatest(keep_days, 1));
  bite int := greatest(least(coalesce(max_runs, 500), 5000), 1);
  n_runs int := 0;
  n_recs int := 0;
begin
  with keep as (
    select id from (select distinct on (site_id) id from public.presence_evidence_runs
                    order by site_id, started_at desc) newest
    union
    select id from (select distinct on (site_id) id from public.presence_evidence_runs
                    where finished_at is not null and error_text is null
                    order by site_id, started_at desc) newest_good
  ),
  doomed as (
    select r.id from public.presence_evidence_runs r
    where r.started_at < cutoff and r.id not in (select id from keep)
    order by r.started_at asc
    limit bite
  ),
  gone as (
    delete from public.presence_evidence_runs r using doomed d where r.id = d.id returning 1
  )
  select count(*)::int into n_runs from gone;

  with keep as (
    select batch_id from (select distinct on (site_id) batch_id from public.presence_recommendations
                          order by site_id, created_at desc) newest
  ),
  doomed as (
    select c.id from public.presence_recommendations c
    where c.created_at < cutoff and c.batch_id not in (select batch_id from keep)
    order by c.created_at asc
    limit bite * 20
  ),
  gone as (
    delete from public.presence_recommendations c using doomed d where c.id = d.id returning 1
  )
  select count(*)::int into n_recs from gone;

  return jsonb_build_object('runs', n_runs, 'recommendations', n_recs);
end;
$$;

comment on function public.presence_prune_health(int, int) is
  'List item 206: clears health-check runs (findings and judgments cascade) and recommendation batches older than keep_days, in bites of max_runs, keeping each site''s newest. Called by the retention sweep (service role) every tick.';

-- 0141's lesson: production's default privileges give new functions to postgres only.
revoke all on function public.presence_prune_health(int, int) from public, anon, authenticated;
grant execute on function public.presence_prune_health(int, int) to service_role;


-- Verify step 1 (expect service = true, anon = false):
-- select has_function_privilege('service_role', 'public.presence_prune_health(int, int)', 'execute') as service,
--        has_function_privilege('anon', 'public.presence_prune_health(int, int)', 'execute') as anon;


-- ── STEP 3: the one-time clear-out (run once, after the deploy is live) ─────
--  Measured on production on Nov 11 2026 (8 sites):
--    presence_evidence          2,285,000 rows   1,444 MB
--    presence_judgments           603,000 rows     556 MB
--    presence_recommendations     422,000 rows     386 MB
--    presence_evidence_runs        45,500 rows      48 MB
--  Expected afterwards: about 170 runs, 9,000 findings, 2,300 judgments and
--  1,600 recommendations, about 15 MB in all.
--
--  WHAT IS KEPT, for every site:
--    * its newest check, and its newest check that finished without an error
--    * the last check of each day in the past 30 days (what a once-a-day check
--      would have left; the 95 other checks of each day said the same thing)
--    * every check a kept health day points to (presence_health_days.run_id),
--      which is what the Health page reads for today's problems
--    * anything started in the last hour, so a check in flight is left alone
--    * the findings and judgments of those checks, and the recommendation
--      batches made from them
--  NOT touched: presence_health_days (the trend line), presence_moments (notes
--  and the timeline), presence_scheduled_runs (what the watchdog email reads).
--
--  HOW: the kept rows are copied aside, the four tables are emptied, and the
--  kept rows are put back, all in ONE transaction. Emptying a table hands its
--  disk space back straight away; deleting 99 rows in 100 would not, and would
--  take minutes. The tables are locked for those seconds, so a tick that
--  arrives meanwhile waits for it. If anything fails, nothing changes.
--  It stops itself, changing nothing, if the kept set looks wrong.
--
--  Run everything from "begin;" to "commit;" as one piece.

begin;

lock table public.presence_evidence_runs, public.presence_evidence,
           public.presence_judgments, public.presence_recommendations
  in access exclusive mode;

create temp table keep_runs on commit drop as
  select id from (select distinct on (site_id) id from public.presence_evidence_runs
                  order by site_id, started_at desc) newest
  union
  select id from (select distinct on (site_id) id from public.presence_evidence_runs
                  where finished_at is not null and error_text is null
                  order by site_id, started_at desc) newest_good
  union
  select id from (select distinct on (site_id, (started_at at time zone 'utc')::date) id
                  from public.presence_evidence_runs
                  where started_at >= now() - interval '30 days'
                  order by site_id, (started_at at time zone 'utc')::date, started_at desc) last_of_day
  union
  select run_id from public.presence_health_days where run_id is not null
  union
  select id from public.presence_evidence_runs where started_at >= now() - interval '1 hour';

create temp table kept_runs on commit drop as
  select r.* from public.presence_evidence_runs r where r.id in (select id from keep_runs);
create temp table kept_evidence on commit drop as
  select e.* from public.presence_evidence e where e.run_id in (select id from keep_runs);
create temp table kept_judgments on commit drop as
  select j.* from public.presence_judgments j where j.evidence_run_id in (select id from keep_runs);
-- recommendations name the judgment batch they were made from, which names its run;
-- each site's newest batch is kept whatever it was made from
create temp table kept_recommendations on commit drop as
  select c.* from public.presence_recommendations c
  where c.judgment_batch_id in (select batch_id from kept_judgments)
     or c.batch_id in (select batch_id from (select distinct on (site_id) batch_id
                                              from public.presence_recommendations
                                              order by site_id, created_at desc) newest);

do $$
declare sites int; kept int; newest_all timestamptz; newest_kept timestamptz;
begin
  select count(distinct site_id), max(started_at) into sites, newest_all from public.presence_evidence_runs;
  select count(distinct site_id), max(started_at) into kept, newest_kept from kept_runs;
  if kept is distinct from sites or newest_kept is distinct from newest_all then
    raise exception 'clear-out stopped, nothing changed: % of % sites kept, newest check % against %', kept, sites, newest_kept, newest_all;
  end if;
end $$;

truncate table public.presence_evidence_runs, public.presence_evidence, public.presence_judgments;
truncate table public.presence_recommendations;

insert into public.presence_evidence_runs  select * from kept_runs;
insert into public.presence_evidence       select * from kept_evidence;
insert into public.presence_judgments      select * from kept_judgments;
insert into public.presence_recommendations select * from kept_recommendations;

commit;

analyze public.presence_evidence_runs;
analyze public.presence_evidence;
analyze public.presence_judgments;
analyze public.presence_recommendations;

-- Verify step 3 (expect about 170 runs and every table under 10 MB; "sites" the same as before):
-- select 'runs' as t, count(*) as n, count(distinct site_id) as sites, pg_size_pretty(pg_total_relation_size('public.presence_evidence_runs')) as size from public.presence_evidence_runs
-- union all select 'findings', count(*), count(distinct site_id), pg_size_pretty(pg_total_relation_size('public.presence_evidence')) from public.presence_evidence
-- union all select 'judgments', count(*), count(distinct site_id), pg_size_pretty(pg_total_relation_size('public.presence_judgments')) from public.presence_judgments
-- union all select 'recommendations', count(*), count(distinct site_id), pg_size_pretty(pg_total_relation_size('public.presence_recommendations')) from public.presence_recommendations;
