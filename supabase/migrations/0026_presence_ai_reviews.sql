-- ── 0026 — M9.5C: the AI Reviewer's reports ─────────────────────────────────
-- Additive only. One new table; nothing existing changes.
-- A review is a REPORT of findings — it edits nothing, publishes nothing,
-- and has no write path to content. "Fix this" hands a finding to the AI
-- Editor (M9.5B) through the customer; dismissal is per finding, recorded.
create table if not exists public.presence_ai_reviews (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  scope text not null check (scope in ('site','section','entity')),
  target text not null default '',            -- section name or entity id when scoped
  status text not null default 'open' check (status in ('open','superseded')),
  findings jsonb not null default '[]',       -- [{ the 15-field finding contract + status }]
  open_count int not null default 0,
  deterministic_only boolean not null default false,  -- true when no model ran (AI-off still reviews)
  model text not null default '',
  created_at timestamptz not null default now()
);
comment on table public.presence_ai_reviews is
  'M9.5C. Review reports: explainable, evidence-quoted findings over existing content. The Reviewer critiques; the Editor improves; the Writer creates — never overlapping. No write path to content exists here.';

create index if not exists presence_ai_reviews_site_idx
  on public.presence_ai_reviews (site_id, status, created_at desc);

alter table public.presence_ai_reviews enable row level security;
create policy presence_ai_reviews_client_read on public.presence_ai_reviews
  for select to authenticated
  using (site_id in (select public.my_presence_site_ids()));
-- no client write policies: runs and dismissals go through the presence function.

grant select on public.presence_ai_reviews to authenticated;
