-- ── CL-1 · Content Library & Reusable Content ───────────────────────────────
-- Saved, reusable structured content. A library item IS a validated structured
-- BLOCK (the SAME SiteBlock model as the block editor — no duplicate block
-- definitions, no second editor, no second content model). It's stored as block
-- JSON here so it can be re-inserted into the block editor and published through
-- the ONE render/publish pipeline. Site-scoped, so a saved block's media_id
-- references (Files/Stock) stay valid on re-insert. Deny-all RLS: reached only via
-- the function's service role, which scopes by site_id.
create table if not exists public.presence_content_library (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  name text not null,
  kind text not null default 'block',          -- 'block' (a single structured block); extensible later
  payload jsonb not null,                        -- a validated StoredBlock (site_blocks model)
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists presence_content_library_site_idx on public.presence_content_library (site_id, created_at desc);

alter table public.presence_content_library enable row level security;
-- deny-all: no policies → only the service role (which bypasses RLS) can touch it.
-- rollback: drop table public.presence_content_library;
