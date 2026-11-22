-- ===========================================================================
--  APPLY PACK - migration 0246  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships builder item 408. IDEMPOTENT ("create or
--  replace", "drop index if exists"), so it is safe to re-run. It deletes nothing
--  by itself: the retention sweep calls the new function every 15 minutes and
--  works the backlog off in bites of 2,000 rows a table a tick.
--
--  Why: builder list item 408. The database was 225 MB; presence_moments (93 MB,
--  137,090 rows for 9 sites) and audit_log (51 MB, 166,629 rows, written only by
--  the old server) were history nobody reads. Every reader of moments takes a site's
--  newest 300 at most. The function keeps each site's newest 500 moments and every
--  dismissed one (the coach reads dismissals back), and 90 days of audit_log, and
--  drops the audit log's request_id index (12 MB, never used, nothing reads by it).
--
--  If the deploy goes first, nothing breaks: the sweep records skipped_history:true
--  until the function exists.
--
--  Rollback (only if ever needed; deleted rows do not come back):
--    drop function if exists public.presence_prune_history(int, int, int);
--    create index if not exists audit_log_request_id_idx on public.audit_log (request_id);
--
--  Covers: supabase/migrations/0246_history_trim.sql
-- ===========================================================================

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


-- Verify right away (expect: one row naming the function; then the two index names
-- audit_log_created_at_idx and audit_log_tenant_idx, no request_id one; then the
-- counts before the sweep starts):
-- select proname from pg_proc where proname = 'presence_prune_history';
-- select indexname from pg_indexes where tablename = 'audit_log' order by indexname;
-- select (select count(*) from public.presence_moments) as moments,
--        (select count(*) from public.presence_moments where status = 'dismissed') as dismissed,
--        (select count(*) from public.audit_log) as audit_rows,
--        pg_size_pretty(pg_total_relation_size('public.presence_moments')) as moments_size,
--        pg_size_pretty(pg_total_relation_size('public.audit_log')) as audit_size,
--        pg_size_pretty(pg_total_relation_size('public.presence_scheduled_runs')) as runs_size,
--        pg_size_pretty(pg_database_size(current_database())) as whole_database;
--
-- A dry run of one bite, to see the function answer (it deletes 2,000 rows of each):
-- select public.presence_prune_history(500, 90, 2000);
--
-- Then, a day later (the sweep runs it every 15 minutes, about 130,000 moments to
-- clear at 2,000 a tick): the moments count is near 9 x 500 plus the dismissed ones,
-- and the audit log holds 90 days. Row counts fall at once; the space on disk is given
-- back only by a vacuum. Autovacuum marks it reusable (the tables stop growing); to
-- shrink the files themselves, once, in a quiet moment (each takes seconds at this
-- size and locks its table while it runs):
-- vacuum (full, analyze) public.presence_moments;
-- vacuum (full, analyze) public.audit_log;
-- vacuum (full, analyze) public.presence_scheduled_runs;
-- select pg_size_pretty(pg_database_size(current_database())) as whole_database;
