-- ── Prospects (Semrush review, sales list item 112, Nov 2026) ────────────────
-- rollback: drop table if exists public.presence_prospects;
--
-- The lead list: businesses a studio found (Google Places text search) and chose
-- to keep. One row per saved business per studio. "→ Deal" stamps deal_id so a
-- prospect becomes at most one deal; nothing here ever emails anyone.
--
-- Deploy order: either way. Before this runs, the routes answer 503 with a plain
-- "not set up yet" sentence (tableMissing), and the page says so.
--
-- Properties:
--   • ADDITIVE — one new table; nothing existing is read, written or moved.
--   • IDEMPOTENT — create-if-not-exists throughout.
--   • PRIVATE — row level security on with no policies: only the Edge Function
--     (service role) reads or writes it.

create table if not exists public.presence_prospects (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  business_name text not null check (char_length(business_name) between 1 and 200),
  phone text check (char_length(phone) <= 40),
  website text check (char_length(website) <= 300),
  address text check (char_length(address) <= 200),
  industry text check (char_length(industry) <= 80),
  -- what a quick look at their website found (no website = the warmest gap)
  site_health text not null default 'unknown'
    check (site_health in ('no_website','unreachable','dated','decent','unknown')),
  score int check (score between 0 and 100),
  status text not null default 'New' check (status in ('New','Contacted','In pipeline','Not a fit')),
  search_query text check (char_length(search_query) <= 160),
  source text not null default 'Google Maps' check (char_length(source) <= 40),
  notes text check (char_length(notes) <= 2000),
  deal_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists presence_prospects_site on public.presence_prospects (site_id, created_at desc);
alter table public.presence_prospects enable row level security;

comment on table public.presence_prospects is
  'The Prospects page''s lead list (sales item 112): businesses found via Places search and saved by a studio. Service role only; deal_id set once by "→ Deal".';
