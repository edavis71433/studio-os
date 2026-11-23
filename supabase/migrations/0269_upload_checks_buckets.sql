-- rollback: alter table public.presence_media drop column if exists checked_at; the bucket settings and the dropped storage rules are not put back (re-create a rule by hand only if a page ever needs one)
--
-- ── Every upload checked after it arrives, and the storage buckets written down (builder list item 395) ──
-- APPLY BEFORE THE RELEASE THAT SHIPS ITEM 395 (the release refuses to go out until
-- production's change ledger has this number). Order: after 0268.
--
-- WHY (Nov 22 2026 review, file 07 finding 19)
--   An upload goes from the browser straight to storage on a signed link. The server checked
--   only the type and size the page claimed, except in the client portal, so a file could
--   be larger than it said, or another kind of file, and the site's storage total trusted
--   the claim. The two buckets' own settings were made by hand in the dashboard; no
--   migration made them, so a rebuild wouldn't bring them back.
--
-- WHAT CHANGES
--   1. presence_media.checked_at: when the server read the stored file back and found it
--      to be what it said (the 15-minute run's upload check, lib/upload_check.ts). The size
--      it found replaces the claimed one, so the storage total counts what is really kept.
--   2. The buckets, as the code needs them (insert, or set if there):
--        presence-media  private. 100 MB, the largest the upload doors take (videos and zips
--                        at the client portal's "Send your studio a file", builder item 337).
--                        Production had 10 MB and four kinds (JPEG, PNG, WebP, PDF; read Nov
--                        22), which refused the Word files, zips, videos, iPhone photos and
--                        drawings the portal's door offers. Each door's own limits are kept
--                        by the server, before the upload and after it.
--        client-files    private, 50 MB, its 15 kinds: exactly as production has it. Nothing
--                        in the code uses it any more; it is written down so a rebuild matches.
--   3. No rule on storage.objects lets a browser at client-files:
--        "Allow all on client-files" (every action, anyone): already dropped on production
--        by hand on Nov 22 (Eric's yes); dropped here too so a rebuild can't bring it back;
--        the three old own-folder rules for signed-in people (look, add, delete), which
--        matched a person to a folder by their email against the old clients table: no
--        page uses this bucket (the server reads it with its own key), and matching by
--        email is what item 389 stopped. Every rule naming client-files goes, by what it
--        says rather than by name, so whatever their names are on production they all go.

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
