-- APPLY 0150 (production) — Pitch packs (sales review item 113).
-- Safe to run more than once. One new table; nothing existing changes.
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

-- Check: the table exists with row security on.
select relrowsecurity as rls_on from pg_class where oid = 'public.presence_pitch_packs'::regclass;
