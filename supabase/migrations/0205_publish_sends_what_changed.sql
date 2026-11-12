-- 0205 — A publish sends only what changed (builder list item 208, Nov 12 2026 review,
-- file 06 findings 81 and 84, file 03 findings 1 and 11).
--
-- presence_publishes
--   deploy_files  every file the publish sent to the host, path to SHA-1, the way the host
--                 was asked for them. The next publish names a photo the live site already
--                 has by its digest instead of making it again, and compares the whole list:
--                 when every file is the same it sends nothing, since each deploy is paid for
--                 (about 10 cents at Netlify). Empty for publishes before this migration; the
--                 first publish after it makes every photo once, as before, and fills it in.
--   unchanged     true when the live site already had exactly these files, so nothing was
--                 sent and no deploy was paid for. The studio's usage numbers (item 210) leave
--                 these out of the publishes they count.
-- Both columns are new and empty, so adding them changes no row and takes no time.
alter table public.presence_publishes
  add column if not exists deploy_files jsonb,
  add column if not exists unchanged boolean not null default false;

comment on column public.presence_publishes.deploy_files is
  'Item 208: every file this publish sent to the host, path to SHA-1. The next publish reuses a photo''s digest and sends nothing when every file matches.';
comment on column public.presence_publishes.unchanged is
  'Item 208: the live site already had exactly these files, so nothing was sent and no deploy was paid for.';
