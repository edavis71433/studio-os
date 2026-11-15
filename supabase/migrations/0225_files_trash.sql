-- rollback: drop index if exists public.presence_media_trash_site_idx;
--           drop index if exists public.presence_media_trash_due_idx;
--           alter table public.presence_media drop column if exists trashed_at;
--   (with the column gone, Delete says the Trash isn't switched on and deletes nothing;
--    files already in the Trash stay out of Files and are cleared by media_gc after 7 days)
--
-- ── Files keep a Trash for 30 days (builder list item 218) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. Until it lands, Delete in Files and
-- the editor's photo list answer that the Trash isn't switched on yet and delete nothing;
-- the Trash reads as empty. Everything else is unchanged.
--
-- WHY
--   Delete in Files removed the stored file at once ("This cannot be undone"). Squarespace
--   keeps a Trash (Nov 12 review, file 01, finding 8): a client deleting their only logo
--   had no way back.
--
-- WHAT CHANGES
--   presence_media.trashed_at: when a person moved the file to the Trash. Such a row also
--   carries deleted_at, so it leaves every list, the photo picker and the site's space the
--   way a deleted file always has; trashed_at tells it apart from a replaced version or a
--   clean-up, which media_gc clears after 7 days. The stored file stays until Delete for
--   good, or until the hygiene sweep (ops/file_trash.ts) clears what has been in a Trash
--   for 30 days, keeping any the live site still shows.
--   Two small indexes over the Trash only: a site's Trash, newest first, and the sweep's
--   oldest-first read across every site.
alter table public.presence_media add column if not exists trashed_at timestamptz;

create index if not exists presence_media_trash_site_idx
  on public.presence_media (site_id, trashed_at desc) where trashed_at is not null;
create index if not exists presence_media_trash_due_idx
  on public.presence_media (trashed_at) where trashed_at is not null;

comment on column public.presence_media.trashed_at is
  'Item 218: when a person moved this file to the Trash (deleted_at is set too). Put back clears both; after 30 days ops/file_trash.ts deletes it for good unless the live site still shows it.';
