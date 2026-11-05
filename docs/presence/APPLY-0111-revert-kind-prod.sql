-- =================================================================
--  APPLY PACK - repair of migration 0111's kind list  (owner-apply, prod)
-- =================================================================
--  Run this ONCE (Supabase -> SQL Editor). IDEMPOTENT (drop constraint "if exists"
--  and re-add the same list), so it is safe to re-run. No deploy is needed: the
--  code already sends these kinds.
--
--  Why: on production, presence_scheduled_publishes_kind_check allows
--  ('publish','launch','offline'). Migration 0111 and APPLY-0111-prod.sql both say
--  ('publish','revert','offline'), and nothing in git history has ever said 'launch'
--  here, so it was most likely edited by hand when 0111 ran. POST /schedule with kind
--  'revert' (restore a chosen earlier version at a set time) therefore fails the check
--  and answers 502 write_failed. No page sends that kind today, so only direct API
--  calls hit this. Found 2026-11-05 by comparing production's table definitions with
--  a replay of every migration.
--
--  Safe for live rows: production has no row with kind 'launch' (checked
--  2026-11-05) and no code writes that kind; launches schedule as 'publish'. If such
--  a row has appeared since, the add fails, the transaction rolls back, and the
--  constraint stays exactly as it was.
--
--  Covers: the kind list in supabase/migrations/0111_offline_unpublish.sql. The rest
--  of 0111 (presence_sites.offline_at, optional snapshot_id) is already on production.
-- =================================================================

begin;

alter table public.presence_scheduled_publishes
  drop constraint if exists presence_scheduled_publishes_kind_check;

alter table public.presence_scheduled_publishes
  add constraint presence_scheduled_publishes_kind_check
  check (kind in ('publish','revert','offline'));

commit;

-- Verify. Every row must say true.
with c as (
  select pg_get_constraintdef(oid) as def from pg_constraint
  where conname = 'presence_scheduled_publishes_kind_check'
    and conrelid = 'public.presence_scheduled_publishes'::regclass
)
select * from (values
  ('publish is allowed', coalesce((select def like '%''publish''%' from c), false)),
  ('revert is allowed', coalesce((select def like '%''revert''%' from c), false)),
  ('offline is allowed', coalesce((select def like '%''offline''%' from c), false)),
  ('launch is gone', coalesce((select def not like '%''launch''%' from c), false))
) as report(what, on_production)
order by what;
