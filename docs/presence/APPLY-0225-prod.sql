-- ===========================================================================
--  APPLY PACK - migration 0225  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships the Trash for files. ADDITIVE and
--  IDEMPOTENT ("if not exists"), so it is safe to re-run. Nothing existing
--  changes: one new column on presence_media and two small indexes.
--
--  Why: builder list item 218. Delete in Files moves a file to a Trash for 30
--  days, with Put back and Delete for good.
--
--  If the deploy goes first, nothing breaks: Delete says the Trash isn't
--  switched on yet and deletes nothing, and the Trash reads as empty.
--
--  Rollback (only if ever needed):
--    drop index if exists public.presence_media_trash_site_idx;
--    drop index if exists public.presence_media_trash_due_idx;
--    alter table public.presence_media drop column if exists trashed_at;
--
--  Covers: supabase/migrations/0225_files_trash.sql
-- ===========================================================================

alter table public.presence_media add column if not exists trashed_at timestamptz;

create index if not exists presence_media_trash_site_idx
  on public.presence_media (site_id, trashed_at desc) where trashed_at is not null;
create index if not exists presence_media_trash_due_idx
  on public.presence_media (trashed_at) where trashed_at is not null;

comment on column public.presence_media.trashed_at is
  'Item 218: when a person moved this file to the Trash (deleted_at is set too). Put back clears both; after 30 days ops/file_trash.ts deletes it for good unless the live site still shows it.';


-- Verify (expect: one row, trashed_at timestamp with time zone; then 2 index names; then 0):
-- select column_name, data_type from information_schema.columns where table_name = 'presence_media' and column_name = 'trashed_at';
-- select indexname from pg_indexes where tablename = 'presence_media' and indexname like 'presence_media_trash_%';
-- select count(*) from public.presence_media where trashed_at is not null;
