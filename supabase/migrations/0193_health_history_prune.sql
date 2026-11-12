-- rollback: drop function if exists public.presence_prune_health(int, int);
--
-- ── Health-check history is cleared after 30 days (builder list item 206) ────
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. Until it lands the retention
-- sweep keeps calling the 0091 prune on its old 180 days, exactly as before.
--
-- WHY
--   Every 15-minute tick ran a full health check for every site and appended a new
--   run, its findings, a judgment batch and a recommendation batch. On production
--   (Nov 11 2026): 45,500 runs for 8 sites, 2.3 million findings (1,444 MB),
--   600,000 judgments (556 MB) and 420,000 recommendations (386 MB) that nothing
--   ever cleared. Readers only use a site's latest run and batch. From this
--   release a site is checked once a day and after each publish
--   (functions/presence/lib/check_soon.ts); this function keeps what is left small.
--
-- WHAT CHANGES
--   presence_prune_health(keep_days, max_runs): deletes health-check runs older than
--   keep_days. Their findings (presence_evidence) and judgments (presence_judgments)
--   go with them through the existing cascades. It then deletes recommendation
--   batches older than keep_days. Always kept, however old: each site's newest run,
--   each site's newest run that finished without an error (the one judgments are
--   made from), and each site's newest recommendation batch, so a paused site still
--   shows its last check. At most max_runs runs (and 20 recommendation rows per run)
--   go per call: the retention sweep calls it every tick through the API, where a
--   statement may take 8 seconds, so a backlog is worked off in bites.
--   presence_moments is NOT touched: the timeline reads its history, and
--   dismissed moments are the memory of what an owner waved away.
--   presence_health_days (the trend line, one small row a site a day) is NOT touched.
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
