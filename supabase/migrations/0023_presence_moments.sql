-- ── 0023 — M9.3: the Business Moments Engine's storage ──────────────────────
-- Additive only. One new table; nothing existing changes.
-- Constitutional home: 05 §5 — moments are the primary customer experience:
-- at most three, calm, evidenced, dismissable-forever-per-fact. This is the
-- FIRST customer-readable intelligence table: clients may READ their own
-- moments; every write goes through the presence function (dismissal is an
-- outcome, and outcomes are memory).
create table if not exists public.presence_moments (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,                          -- one momentize() pass
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  recommendation_batch_id uuid not null,           -- the M9.2 batch consumed
  moment_key text not null,                        -- stable dedupe key (the frozen contract's deduplication_key)
  moment_hash text not null,                       -- deterministic content id — "new evidence" is a changed hash
  moment_type text not null check (moment_type in (
    'good_news','needs_attention','reminder','opportunity',
    'celebration','seasonal','business_health','learning')),
  headline text not null,                          -- customer language, Direction A voice
  summary text not null,                           -- customer language; one calm paragraph
  tone text not null check (tone in ('reassuring','attentive','encouraging','celebratory','informative')),
  importance int not null check (importance between 1 and 5),  -- INTERNAL ranking; never exposed to customers
  dismissable boolean not null default true,
  supporting_recommendation_ids jsonb not null default '[]',   -- M9.2 recommendation_hash values
  future_follow_up timestamptz,                    -- when a deferred concern may resurface (nullable)
  first_seen_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null check (status in ('active','suppressed','dismissed','superseded','expired')),
  suppression_reason text not null default '',
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.presence_moments is
  'M9.3 (constitution 05 §5). Business Moments: <=3 active per site, deterministic from recommendations, calm customer language. Clients read their own; all writes via the presence function. Dismissal memory: same-fact moments stay gone unless evidence changes, worsens, or the dismissal ages out.';

create index if not exists presence_moments_site_status_idx
  on public.presence_moments (site_id, status, created_at desc);
create index if not exists presence_moments_key_idx
  on public.presence_moments (site_id, moment_key, created_at desc);

alter table public.presence_moments enable row level security;
create policy presence_moments_client_read on public.presence_moments
  for select to authenticated
  using (site_id in (select public.my_presence_site_ids()));
-- no client write policies: generation, supersession, and dismissal all go
-- through the presence function so memory is recorded uniformly.

grant select on public.presence_moments to authenticated;
