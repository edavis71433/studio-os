-- ── 0021 — M9.1: the Judgment Engine's storage ──────────────────────────────
-- Additive only. One new table; nothing existing changes.
-- Constitutional home: 05 §2 — judgment sits between evidence and
-- recommendation. Judgments are internal: they never reach customers directly
-- (M9.2+ translates the surviving ones). RLS with NO client policies.
--
-- A "batch" is one deterministic judgment pass over one evidence run.
-- Suppressed judgments are STORED with their reason — suppression is a
-- decision, and decisions are auditable.
create table if not exists public.presence_judgments (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,                        -- one judge() pass
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  evidence_run_id uuid not null references public.presence_evidence_runs(id) on delete cascade,
  judgment_key text not null,                    -- stable dedupe key: the rule, per site
  judgment_hash text not null,                   -- deterministic content id: same evidence → same hash
  rule text not null,
  category text not null check (category in (
    'availability','discoverability','accessibility','accuracy','trust',
    'freshness','media','conversion','content','platform','operations')),
  priority text not null check (priority in ('critical','high','medium','low','informational')),
  severity text not null check (severity in ('critical','warning','info')),
  confidence numeric not null check (confidence > 0 and confidence <= 1),
  reasoning text not null,                       -- deterministic template: counts, types, thresholds
  business_impact jsonb not null default '{}',   -- { dimensions: [...], note }
  customer_impact text not null default '',      -- internal explanation (NOT customer copy)
  timing text not null check (timing in ('immediate','soon','seasonal','whenever','none')),
  audience text not null check (audience in ('customer','operator','none')),
  status text not null check (status in ('active','suppressed')),
  suppression_reason text not null default '',
  evidence_ids jsonb not null default '[]',      -- supporting presence_evidence row ids
  evidence_count int not null default 0,
  dedupe_key text not null,                      -- = judgment_key (kept explicit per the frozen contract)
  first_seen_at timestamptz not null,            -- carried across batches for the same key
  expires_at timestamptz not null,               -- staleness bound if no newer batch arrives
  created_at timestamptz not null default now()
);
comment on table public.presence_judgments is
  'M9.1 (constitution 05 §2). Deterministic judgments over evidence: what matters, why, how urgent, whether to interrupt. Internal only — M9.2+ consumes the active ones. Suppressed judgments kept with reasons (auditable).';

create index if not exists presence_judgments_site_batch_idx
  on public.presence_judgments (site_id, created_at desc, batch_id);
create index if not exists presence_judgments_key_idx
  on public.presence_judgments (site_id, judgment_key, created_at desc);

alter table public.presence_judgments enable row level security;
-- no policies: service role only.
