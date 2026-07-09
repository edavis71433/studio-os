-- ── Phase T · Dedicated Preview Environment (FD-T20) ─────────────────────────
-- Draft → Preview → Live. Preview is a standing, shareable slot per site: a pinned
-- staged snapshot (in presence_snapshots — the SAME store), a stable share token,
-- and an optional password hash. Preview is SERVED THROUGH THE RENDER PIPELINE at
-- /p/:token (no second deploy); Promote to Live reuses the one publish pipeline.
-- One row per site. Deny-all RLS: reached only via the function's service role,
-- which scopes by site_id (public /p/:token resolves the site by the token).
create table if not exists public.presence_site_preview (
  site_id uuid primary key references public.presence_sites(id) on delete cascade,
  snapshot_id uuid references public.presence_snapshots(id),
  token text unique,
  password_hash text,                 -- sha-256 hex of an optional preview password; null = open link
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists presence_site_preview_token_idx on public.presence_site_preview (token);

alter table public.presence_site_preview enable row level security;
-- deny-all: no policies → only the service role (which bypasses RLS) can touch it.
-- rollback: drop table public.presence_site_preview;
