-- rollback: see ROLLBACK block at bottom (drop the two media FKs + their indexes; restore publishes.snapshot_id FK to NOT NULL RESTRICT — only valid while no NULLs exist).
--
-- 0016: Presence FK fixes — the two corrections required by the M2
--   Architecture Review Board (2026-07-06). Nothing else.
--
-- D1: presence_publishes.snapshot_id was NOT NULL with a default-RESTRICT FK,
--   which made the contracted keep-20 snapshot pruning mechanically impossible
--   (every published snapshot is referenced forever). Now nullable with
--   ON DELETE SET NULL: publish history always survives; pruning a snapshot
--   leaves an honest history row whose snapshot_id is NULL ("no longer
--   restorable"); retained snapshots keep restoring.
--
-- D2: presence_offerings.media_id and presence_posts.hero_media_id were bare
--   uuids. Adding FKs -> presence_media(id) ON DELETE SET NULL prevents
--   dangling references on hard delete; the same-site rule remains API-enforced
--   per G1 (FKs cannot express it). Partial indexes support the FK lookups.

-- ── D1 ──────────────────────────────────────────────────────────────────────
alter table public.presence_publishes
  drop constraint if exists presence_publishes_snapshot_id_fkey;
alter table public.presence_publishes
  alter column snapshot_id drop not null;
alter table public.presence_publishes
  add constraint presence_publishes_snapshot_id_fkey
  foreign key (snapshot_id) references public.presence_snapshots(id) on delete set null;

comment on column public.presence_publishes.snapshot_id is
  'NULL means the snapshot was pruned by retention: the history row is permanent and truthful, the restore affordance simply disappears (G1 §12-13; ARB D1).';

-- ── D2 ──────────────────────────────────────────────────────────────────────
alter table public.presence_offerings
  add constraint presence_offerings_media_id_fkey
  foreign key (media_id) references public.presence_media(id) on delete set null;
alter table public.presence_posts
  add constraint presence_posts_hero_media_id_fkey
  foreign key (hero_media_id) references public.presence_media(id) on delete set null;

create index if not exists presence_offerings_media_idx
  on public.presence_offerings (media_id) where media_id is not null;
create index if not exists presence_posts_hero_media_idx
  on public.presence_posts (hero_media_id) where hero_media_id is not null;

-- ROLLBACK
-- drop index if exists public.presence_posts_hero_media_idx;
-- drop index if exists public.presence_offerings_media_idx;
-- alter table public.presence_posts drop constraint if exists presence_posts_hero_media_id_fkey;
-- alter table public.presence_offerings drop constraint if exists presence_offerings_media_id_fkey;
-- alter table public.presence_publishes drop constraint if exists presence_publishes_snapshot_id_fkey;
-- -- (restoring NOT NULL + RESTRICT is only valid while snapshot_id has no NULLs:)
-- -- alter table public.presence_publishes alter column snapshot_id set not null;
-- -- alter table public.presence_publishes add constraint presence_publishes_snapshot_id_fkey foreign key (snapshot_id) references public.presence_snapshots(id);
