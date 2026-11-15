-- ===========================================================================
--  APPLY PACK - migration 0209  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships the map rank grid. ADDITIVE and IDEMPOTENT
--  ("if not exists"), so it is safe to re-run. Nothing existing changes: one new
--  table and its two indexes.
--
--  Why: builder list item 185. For clients the studio switches it on for, the
--  Search tab shows where the business comes up on Google Maps from a grid of
--  spots around it, scanned once a month and on "Scan now", with every scan kept.
--
--  If the deploy goes first, nothing breaks: the grid can be set up, but no scan
--  runs until this table exists, and the Search tab says so.
--
--  Rollback (only if ever needed):
--    drop table if exists public.presence_rank_grid_scans;
--
--  Covers: supabase/migrations/0209_rank_grid_scans.sql
-- ===========================================================================

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


-- Verify (expect: true, the table with RLS on, and 0 rows):
-- select relrowsecurity from pg_class where relname = 'presence_rank_grid_scans';
-- select count(*) from public.presence_rank_grid_scans;
