-- ===========================================================================
--  APPLY PACK - migration 0269  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), AFTER APPLY-0268
--  and BEFORE the deploy.yml run that ships builder item 395 (the release refuses to go
--  out until the change ledger has 0269). IDEMPOTENT ("if not exists", "on conflict",
--  "if exists"), safe to re-run.
--
--  Why: builder list item 395 (Nov 22 2026 review, file 07 finding 19). Uploads go from
--  the browser straight to storage, and only the client portal read the stored file back;
--  the buckets' settings were made by hand, so a rebuild wouldn't bring them back.
--
--  What it does, in plain words:
--    1. presence_media.checked_at, for the 15-minute run's upload check (the stored file's
--       real kind and size, read back; the real size replaces the claimed one).
--    2. presence-media: private, 100 MB, the 15 kinds the upload doors take. CHANGES
--       PRODUCTION: it had 10 MB and four kinds (JPEG, PNG, WebP, PDF; read Nov 22), so
--       the client portal's "Send your studio a file" refused Word files, zips, videos,
--       iPhone photos and drawings it offers. The server keeps each door's own limits.
--       client-files: private, 50 MB, its 15 kinds, exactly as production has it.
--    3. Every storage rule naming client-files goes: "Allow all on client-files" (already
--       dropped by hand on Nov 22, on Eric's yes; this keeps it gone) and the three old
--       own-folder rules for signed-in people, which matched a folder by the person's
--       email against the old clients table. No page uses that bucket; the server reads it
--       with its own key, which these rules never limited. Each dropped rule is named in
--       the output ("dropped storage rule: ...").
--
--  Check first that the editor's top bar says davis-digital-studio (production).
--
--  Rollback (only if ever needed): alter table public.presence_media drop column if exists
--  checked_at; to narrow presence-media again, update storage.buckets set file_size_limit =
--  10485760, allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf']
--  where id = 'presence-media' (the portal's wider kinds then fail at upload again).
--
--  Covers: supabase/migrations/0269_upload_checks_buckets.sql
-- ===========================================================================

alter table public.presence_media add column if not exists checked_at timestamptz;
comment on column public.presence_media.checked_at is
  'Builder item 395: when the server read the stored file back and found it was what it said (type from its bytes, size from storage). Null: not checked yet.';
create index if not exists presence_media_unchecked_idx on public.presence_media (created_at) where checked_at is null and deleted_at is null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('presence-media', 'presence-media', false, 104857600, array[
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'text/plain',
    'image/svg+xml', 'application/postscript', 'application/illustrator', 'image/heic', 'image/heif',
    'application/zip', 'video/mp4', 'video/quicktime']),
  ('client-files', 'client-files', false, 52428800, array[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain', 'video/mp4', 'video/quicktime', 'application/zip'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Allow all on client-files" on storage.objects;
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and (coalesce(qual, '') like '%client-files%' or coalesce(with_check, '') like '%client-files%')
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
    raise notice 'dropped storage rule: %', p.policyname;
  end loop;
end $$;

select public.presence_ledger_note(269, 'upload_checks_buckets');

-- Verify right away (expect: the column; presence-media false, 104857600, 15 kinds;
-- client-files false, 52428800, 15 kinds; no storage rule naming client-files):
-- select column_name from information_schema.columns where table_schema = 'public' and table_name = 'presence_media' and column_name = 'checked_at';
-- select id, public, file_size_limit, cardinality(allowed_mime_types) as kinds from storage.buckets where id in ('presence-media', 'client-files') order by id;
-- select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects'
--    and (coalesce(qual, '') like '%client-files%' or coalesce(with_check, '') like '%client-files%');
