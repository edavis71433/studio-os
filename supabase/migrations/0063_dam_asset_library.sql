-- ── Phase DAM: the Studio Asset Library — EXTENDS presence_media, no new store ─
-- Every asset already lives in presence_media (private bucket, EXIF-stripped,
-- variant pipeline, RLS by site). The DAM adds organization + lifecycle ON that
-- row: tags, a collection, free metadata, a content hash for duplicate detection,
-- a lifecycle status (reusing the approval philosophy), and a brand flag.
alter table public.presence_media
  add column if not exists tags jsonb not null default '[]'::jsonb,
  add column if not exists collection text not null default '',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists content_hash text not null default '',
  add column if not exists brand boolean not null default false,
  add column if not exists asset_status text not null default 'approved'
    check (asset_status in ('draft','pending','approved','published','archived'));

-- fast library reads: by collection, by status, and duplicate lookup by hash
create index if not exists presence_media_collection_idx on public.presence_media (site_id, collection) where deleted_at is null;
create index if not exists presence_media_status_idx on public.presence_media (site_id, asset_status) where deleted_at is null;
create index if not exists presence_media_hash_idx on public.presence_media (site_id, content_hash) where content_hash <> '' and deleted_at is null;
-- rollback: drop the six columns + three indexes. Existing rows default to
-- asset_status='approved' so nothing an owner already uses becomes unavailable.
