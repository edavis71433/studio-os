-- ── 0027 — M9.5D: the Brand Guardian's storage ──────────────────────────────
-- Additive only. Two new tables; nothing existing changes.
--
-- 1. presence_brand_profile — the customer's identity, structured. THEIRS:
--    client-editable end to end (manual parity is the point of a brand
--    profile). The single exception is `learned`, which only the function
--    writes: observed preferences are GUIDANCE, and guidance never overwrites
--    what the customer wrote about themselves.
create table if not exists public.presence_brand_profile (
  site_id uuid primary key references public.presence_sites(id) on delete cascade,
  mission text not null default '',
  vision text not null default '',
  core_values jsonb not null default '[]',
  personality text not null default '',
  voice_characteristics text not null default '',
  preferred_vocabulary text not null default '',
  words_prefer jsonb not null default '[]',
  words_avoid jsonb not null default '[]',
  never_claims text not null default '',
  reading_level text not null default 'everyday' check (reading_level in ('everyday','relaxed','professional','technical')),
  industry_terminology jsonb not null default '[]',
  taglines jsonb not null default '[]',
  elevator_pitch text not null default '',
  target_audience text not null default '',
  brand_promise text not null default '',
  selling_points jsonb not null default '[]',
  learned jsonb not null default '{}',          -- function-written guidance ONLY; never merged into the fields above
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.presence_brand_profile is
  'M9.5D. The structured Brand Profile — the customer''s identity in writing, fully client-editable. `learned` carries observed preferences (accepted/rejected proposals, chosen tones) as guidance only; the Guardian never overwrites the customer''s own words.';

create trigger presence_brand_profile_touch before update on public.presence_brand_profile
  for each row execute function public.presence_touch_updated_at();

alter table public.presence_brand_profile enable row level security;
create policy presence_brand_profile_client_all on public.presence_brand_profile
  for all to authenticated
  using (site_id in (select public.my_presence_site_ids()))
  with check (site_id in (select public.my_presence_site_ids()));
grant select, insert, update, delete on public.presence_brand_profile to authenticated;

-- 2. presence_brand_reports — the Guardian's findings. Critique only: no
--    write path to content; "Improve" hands findings to the AI Editor
--    through the customer. Internal consistency measures live in
--    internal_metrics and are never customer language (Law 13).
create table if not exists public.presence_brand_reports (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  scope text not null check (scope in ('site','section')),
  target text not null default '',
  status text not null default 'open' check (status in ('open','superseded')),
  findings jsonb not null default '[]',
  open_count int not null default 0,
  internal_metrics jsonb not null default '{}',   -- numbers for the machine; sentences for the customer
  deterministic_only boolean not null default false,
  model text not null default '',
  created_at timestamptz not null default now()
);
comment on table public.presence_brand_reports is
  'M9.5D. Brand consistency reports: explainable findings over tone, vocabulary, formatting, business consistency, and visual style. No numerical scores reach customers (Law 13); internal metrics stay internal.';

create index if not exists presence_brand_reports_site_idx
  on public.presence_brand_reports (site_id, status, created_at desc);

alter table public.presence_brand_reports enable row level security;
create policy presence_brand_reports_client_read on public.presence_brand_reports
  for select to authenticated
  using (site_id in (select public.my_presence_site_ids()));
grant select on public.presence_brand_reports to authenticated;
