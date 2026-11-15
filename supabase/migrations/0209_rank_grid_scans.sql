-- rollback: drop table if exists public.presence_rank_grid_scans;
--
-- ── The map rank grid (builder list item 185) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. Until it lands the grid can be set
-- up but no scan runs (there is nowhere to keep one), and the Search tab says so.
--
-- WHAT CHANGES
--   presence_rank_grid_scans: one row per scan of one search over a client's grid of
--     spots around the business: when, which search, monthly or "Scan now", the grid's
--     size and spacing, the business's Google place id, its rank at each spot, the
--     first three place ids at each spot, who came up ahead most often, the requests
--     made and what they cost at Google's prices. Google lets place ids be kept; the
--     centre's coordinates are cleared by the monthly job after 30 days (Google's rule),
--     and no name or address from Google is ever stored. RLS on, nothing granted to
--     anon or signed-in users; the function's own key reads and writes it.
create table if not exists public.presence_rank_grid_scans (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  phrase text not null check (char_length(phrase) between 2 and 60),
  kind text not null check (kind in ('monthly', 'now')),
  scanned_at timestamptz not null default now(),
  size smallint not null check (size in (5, 7)),
  spacing_mi numeric(3,1) not null check (spacing_mi in (0.5, 1, 2)),
  place_id text not null check (char_length(place_id) between 10 and 400),
  center_lat double precision,
  center_lng double precision,
  ranks jsonb not null check (jsonb_typeof(ranks) = 'array'),
  tops jsonb not null default '[]'::jsonb check (jsonb_typeof(tops) = 'array'),
  rivals jsonb not null default '[]'::jsonb check (jsonb_typeof(rivals) = 'array'),
  total smallint not null,
  top3 smallint not null,
  top10 smallint not null,
  found smallint not null,
  avg_rank numeric(4,1),
  requests jsonb not null default '{}'::jsonb,
  cost_usd numeric(8,4) not null default 0,
  created_by text
);

create index if not exists presence_rank_grid_scans_site_idx on public.presence_rank_grid_scans (site_id, scanned_at desc);
create index if not exists presence_rank_grid_scans_coords_idx on public.presence_rank_grid_scans (scanned_at) where center_lat is not null;

alter table public.presence_rank_grid_scans enable row level security;
revoke all on public.presence_rank_grid_scans from anon, authenticated;

comment on table public.presence_rank_grid_scans is
  'List item 185: the map rank grid. One row per scan of one search over a client''s grid of spots: rank at each spot (1-20, 0 = not in the top 20, null = no answer), the first three place ids at each spot, rivals by place id, cost at Google''s prices. Coordinates cleared after 30 days; no Google names or addresses. Written by ops/rank_grid_scans.ts (service role) only.';
