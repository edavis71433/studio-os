-- ── 0111 — G5/G10: take-offline (unpublish) + scheduled offline windows ──────
-- Additive only. Two changes, both on existing tables:
--
-- 1. presence_sites.offline_at — the honest "site is veiled" marker. Taking a
--    site offline deploys a minimal holding page over the live deploy (nothing
--    is deleted; every version is kept); offline_at records when. Any publish
--    that goes live clears it (a live deploy of real content IS being online).
--
-- 2. presence_scheduled_publishes gains kind='offline' — the "unpublish at"
--    leg of a scheduled publish window (G5), fired by the SAME cron through
--    the SAME table as scheduled publishes/reverts. An offline row needs no
--    frozen snapshot (it deploys the holding page), so snapshot_id becomes
--    nullable — mirroring 0016's D1 precedent on presence_publishes.

-- 1. the offline marker (null = online)
alter table public.presence_sites
  add column if not exists offline_at timestamptz;
comment on column public.presence_sites.offline_at is
  'G10: when the owner took the site offline (holding page deployed over live). NULL = online. Cleared by any publish that goes live.';

-- 2a. widen the scheduled-action kinds (constraint name resolved dynamically,
--     as 0018 did — safe whether the inline check kept its generated name)
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

-- 2b. an offline row carries no snapshot
alter table public.presence_scheduled_publishes
  alter column snapshot_id drop not null;
comment on column public.presence_scheduled_publishes.snapshot_id is
  'The frozen snapshot to publish/restore. NULL for kind=offline (the holding page is rendered at fire time, not frozen).';

-- rollback:
--   alter table public.presence_sites drop column if exists offline_at;
--   -- (only valid while no kind='offline' rows exist:)
--   -- alter table public.presence_scheduled_publishes drop constraint if exists presence_scheduled_publishes_kind_check;
--   -- alter table public.presence_scheduled_publishes add constraint presence_scheduled_publishes_kind_check check (kind in ('publish','revert'));
--   -- (only valid while no NULL snapshot_id rows exist:)
--   -- alter table public.presence_scheduled_publishes alter column snapshot_id set not null;
