-- rollback: alter table public.presence_media drop column if exists client_private;
-- Oct 2026 UX review (gap 4): a file a client sent the studio can be PRIVATE to
-- that client. Private files stay out of the shared library views (All files,
-- Photos, Documents…) and out of the website's image picker; they show only
-- under that client's filter in Files, in the "Client-private" collection, and
-- on the client's record. Additive, default false. The presence function
-- degrades gracefully until this runs: the assets read retries without the
-- column, and the toggle reports that the database update is still pending.
alter table public.presence_media add column if not exists client_private boolean not null default false;
create index if not exists presence_media_client_private_idx
  on public.presence_media (site_id) where client_private;
comment on column public.presence_media.client_private is
  'Oct 2026 review: true = this file is private to the client it was delivered for — hidden from the shared library views and the site picker; visible only under that client''s filter and on their record.';
