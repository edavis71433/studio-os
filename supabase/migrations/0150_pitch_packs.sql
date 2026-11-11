-- ── Pitch packs (Semrush review, sales item 113, Nov 2026) ───────────────────
-- rollback: drop table if exists public.presence_pitch_packs;
--
-- One pack per prospect: their Site Review score and AI Visibility result
-- beside two nearby rivals, behind an unguessable link (pitch.html?t=<token>).
-- The pack is built one scan per request (routes/pitch_pack.ts); `pieces` keeps
-- the small summaries, never the full reports (those stay in tool_reports).
--
-- Deploy order: either way. Before this runs, the routes answer 503 with a
-- plain "not set up yet" sentence (tableMissing), and the page says so.
--
-- Properties:
--   • ADDITIVE — one new table; nothing existing is read, written or moved.
--   • IDEMPOTENT — create-if-not-exists throughout.
--   • PRIVATE — row level security on with no policies: only the Edge Function
--     (service role) reads or writes it. The public read is by token alone.

create table if not exists public.presence_pitch_packs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  prospect_id uuid not null references public.presence_prospects(id) on delete cascade,
  token text not null unique check (char_length(token) between 24 and 64),
  status text not null default 'building' check (status in ('building','ready')),
  pieces jsonb not null default '{}'::jsonb,
  built_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, prospect_id)
);
alter table public.presence_pitch_packs enable row level security;

comment on table public.presence_pitch_packs is
  'Pitch packs (sales item 113): per prospect, the Site Review + AI Visibility summaries beside two rivals, served publicly by token on pitch.html. Service role only.';
