-- ── Phase CP-1: agency starter kits ──────────────────────────────────────────
-- A kit is a saved, reusable SETUP — structure and house style, never another
-- business's facts: offering/FAQ suggestions, voice, palette tokens, industry,
-- category order, preferred template. Saved FROM one of the agency's linked
-- sites; applied FILL-ONLY-EMPTY to another (never overwrites, test-locked).
create table if not exists public.presence_starter_kits (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  name text not null,
  industry_key text not null default 'generic',
  payload jsonb not null,
  created_from_site uuid,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_starter_kits_agency on public.presence_starter_kits (agency_id, created_at desc);
alter table public.presence_starter_kits enable row level security;
-- deny-all: service-role only, agency fencing enforced in routes (the platform pattern)
-- rollback: drop table if exists public.presence_starter_kits;
