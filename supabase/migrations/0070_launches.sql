-- ── Phase T · Launches (FD-T7) — named staged releases ───────────────────────
-- A Launch is a named staged SNAPSHOT that flows through the EXISTING publishing
-- pipeline (runPipeline) and the EXISTING scheduler (presence_scheduled_publishes).
-- This table only tracks the release's identity + state + the snapshot pointers;
-- it introduces no new render/publish/schedule engine. Deny-all RLS: reached only
-- via the function's service role, which scopes every query by site_id (the
-- caller-site is resolved + entitlement-gated at the boundary, like every route).
create table if not exists public.presence_launches (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  name text not null,
  status text not null default 'draft',           -- draft|approved|scheduled|published|rolled_back|canceled
  snapshot_id uuid references public.presence_snapshots(id),          -- the staged version
  prev_snapshot_id uuid references public.presence_snapshots(id),     -- the live version at promote (for rollback)
  scheduled_publish_id uuid references public.presence_scheduled_publishes(id),
  published_publish_id uuid references public.presence_publishes(id),
  approved_by text,
  approved_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists presence_launches_site_idx on public.presence_launches (site_id, created_at desc);

alter table public.presence_launches enable row level security;
-- deny-all: no policies → only the service role (which bypasses RLS) can touch it.
-- rollback: drop table public.presence_launches;
