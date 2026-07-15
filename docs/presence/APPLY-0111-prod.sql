-- ═══════════════════════════════════════════════════════════════════════════
--  APPLY PACK · migration 0111  (owner-apply, staging + prod)
-- ═══════════════════════════════════════════════════════════════════════════
--  Run this ONCE on each environment (Supabase → SQL Editor, or psql).
--  G10 take-offline + G5 scheduled offline windows:
--    • presence_sites.offline_at — when the owner took the site offline
--      (holding page deployed over live; NULL = online; any live publish clears it)
--    • presence_scheduled_publishes.kind gains 'offline' (the "unpublish at"
--      leg of a scheduled publish window; same table, same cron)
--    • presence_scheduled_publishes.snapshot_id becomes nullable (an offline
--      row has no frozen snapshot — mirrors 0016 D1 on presence_publishes)
--  Additive, idempotent, safe to re-run. Pair with a presence function deploy
--  (routes: POST /site/offline · POST /site/online · /schedule kind=offline).
--  Until this is applied, those routes return a calm write_failed/constraint
--  error and everything that exists today keeps working unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.presence_sites
  add column if not exists offline_at timestamptz;
comment on column public.presence_sites.offline_at is
  'G10: when the owner took the site offline (holding page deployed over live). NULL = online. Cleared by any publish that goes live.';

do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.presence_scheduled_publishes'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table public.presence_scheduled_publishes drop constraint %I', c);
  end loop;
end $$;
alter table public.presence_scheduled_publishes add constraint presence_scheduled_publishes_kind_check
  check (kind in ('publish','revert','offline'));

alter table public.presence_scheduled_publishes
  alter column snapshot_id drop not null;
comment on column public.presence_scheduled_publishes.snapshot_id is
  'The frozen snapshot to publish/restore. NULL for kind=offline (the holding page is rendered at fire time, not frozen).';

commit;

-- Verify (optional):
--   select column_name, is_nullable from information_schema.columns
--     where table_name='presence_scheduled_publishes' and column_name='snapshot_id';  -- YES
--   select column_name from information_schema.columns
--     where table_name='presence_sites' and column_name='offline_at';                 -- offline_at
--   select pg_get_constraintdef(oid) from pg_constraint
--     where conname='presence_scheduled_publishes_kind_check';                        -- includes 'offline'
