-- rollback: drop function if exists public.presence_prune_history(int, int, int);
--           create index if not exists audit_log_request_id_idx on public.audit_log (request_id);
--
-- ── Four fifths of the database was history nobody reads (builder list item 408) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. Until it lands the retention
-- sweep records skipped_history:true and clears nothing new.
--
-- WHY (Nov 22 2026 review, file 14, finding 10; statistics views only)
--   The database was 225 MB, and three tables held 177 MB of it:
--     presence_moments          93 MB, 137,090 rows for 9 sites (about 15,000 a site).
--       Nothing ever deleted from it (0 deletes on record; 0193 left it out on purpose).
--       Every reader takes a site's newest few hundred at most: the moments engine
--       the newest 300, the timeline 60, the coach 100, the record 15, the portal 10.
--     audit_log                 51 MB, 166,629 rows. Written only by the old server
--       (clever-api, through audit_write). Read by index once since May. Its
--       request_id index (12 MB) has never been used: nothing looks an audit row up by
--       request id, and the created_at and tenant indexes stay.
--     presence_scheduled_runs   33 MB. Trimmed at 90 days already (ops/retention.ts);
--       its size came from the 15-minute job rewriting its progress note after every
--       chore (41 updates a run, 413,000 in all). Builder item 402 cut that to a few
--       writes a run, so the table stops growing the way it did; the space it holds is
--       given back by a one-time vacuum (see the apply pack), not by this migration.
--
-- WHAT CHANGES
--   presence_prune_history(keep_moments, keep_audit_days, max_rows): deletes, in bites,
--     · a site's moments beyond its newest keep_moments, never a dismissed one (a
--       dismissed moment is the memory of what an owner waved away: coach/engine.ts
--       reads dismissals back, however old);
--     · audit_log rows older than keep_audit_days.
--   At most max_rows of each go per call: the retention sweep calls it every tick
--   through the API, where a statement may take 8 seconds, so the backlog is worked
--   off over the next ticks (about 130,000 moments at 2,000 a tick is 65 ticks, 16
--   hours) and never as one long statement.
--   Drops audit_log_request_id_idx (12 MB, never used).
--   Nothing else is touched: presence_health_days, presence_plan_notices (the send-once
--   ledger) and every business table stay as they are.

create or replace function public.presence_prune_history(keep_moments int default 500, keep_audit_days int default 90, max_rows int default 2000)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  keep int := greatest(coalesce(keep_moments, 500), 50);
  cutoff timestamptz := now() - make_interval(days => greatest(coalesce(keep_audit_days, 90), 7));
  bite int := greatest(least(coalesce(max_rows, 2000), 20000), 1);
  n_moments int := 0;
  n_audit int := 0;
begin
  -- a site's moments past its newest `keep`, oldest first, never a dismissed one
  with ranked as (
    select id, status, row_number() over (partition by site_id order by created_at desc, id desc) as n
      from public.presence_moments
  ),
  doomed as (
    select id from ranked where n > keep and status <> 'dismissed'
     order by n desc
     limit bite
  ),
  gone as (
    delete from public.presence_moments m using doomed d where m.id = d.id returning 1
  )
  select count(*)::int into n_moments from gone;

  with doomed as (
    select id from public.audit_log where created_at < cutoff order by created_at asc limit bite
  ),
  gone as (
    delete from public.audit_log a using doomed d where a.id = d.id returning 1
  )
  select count(*)::int into n_audit from gone;

  return jsonb_build_object('moments', n_moments, 'audit', n_audit);
end;
$$;

revoke all on function public.presence_prune_history(int, int, int) from public, anon, authenticated;
grant execute on function public.presence_prune_history(int, int, int) to service_role;

comment on function public.presence_prune_history(int, int, int) is
  'Builder list item 408: keeps each site''s newest keep_moments moments (dismissed ones always) and keep_audit_days of audit_log, deleting the rest in bites of max_rows. Called by the retention sweep (service role) every tick.';

drop index if exists public.audit_log_request_id_idx;
