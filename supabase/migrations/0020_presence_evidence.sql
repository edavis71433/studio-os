-- ── 0020 — M9.0: the Presence Evidence Engine's storage ─────────────────────
-- Additive only. Two new tables; no changes to existing tables or policies.
-- Constitutional home: 05 §2/§10 — the Optimization Engine OBSERVES and keeps
-- dated, sourced evidence. Evidence is operator/internal material: raw engine
-- output is never customer-facing (the concierge speaks; the engine records).
-- Therefore: RLS enabled with NO client policies — service role only.

-- ── 1. presence_evidence_runs — one row per observation run ─────────────────
-- The run record is what makes ABSENCE meaningful: providers/checks executed
-- are recorded, so an item missing from a later run is provable improvement.
create table if not exists public.presence_evidence_runs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null default 'operator' check (trigger in ('operator','schedule','publish')),
  providers jsonb not null default '[]',  -- [{name, category, ok, items, ms, error?}] — execution record
  item_count int not null default 0,
  input jsonb not null default '{}',      -- what was observable: {live_fetched, has_live_snapshot, page_count, media_count}
  error_text text                          -- run-level failure (operator detail; never client-facing)
);
comment on table public.presence_evidence_runs is
  'M9.0 (constitution 05 §10). One observation run of the Evidence Engine. Records which providers/checks executed so absence of an item in a later run is provable improvement. Internal/operator only.';

create index if not exists presence_evidence_runs_site_idx
  on public.presence_evidence_runs (site_id, started_at desc);

alter table public.presence_evidence_runs enable row level security;
-- no policies: service role only (the presence function's admin surface).

-- ── 2. presence_evidence — the evidence items ───────────────────────────────
-- The frozen evidence contract (M9.0): category, type, severity, timestamp,
-- source, confidence, affected resource, human explanation, technical
-- explanation, recommended next action. The next action is CATALOG METADATA —
-- a fixed, deterministic remediation hint keyed by evidence type — never a
-- judgment (judgment belongs to Presence Intelligence, M9.1+, per 05 §2).
-- Additive schema: new evidence TYPES are catalog entries; new FIELDS are new
-- columns; no free-form structures.
create table if not exists public.presence_evidence (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.presence_evidence_runs(id) on delete cascade,
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  category text not null check (category in (
    'website','seo','accessibility','performance','structured_data','metadata',
    'freshness','business_info','media','links','local_presence','reviews',
    'trust','content','conversion')),
  type text not null,                      -- catalog key, e.g. 'seo.title_missing'
  severity text not null check (severity in ('critical','warning','info')),
  confidence numeric not null check (confidence > 0 and confidence <= 1),
  source text not null,                    -- which provider + input surface, e.g. 'seo@render:/menu/'
  resource text not null default '',       -- affected resource: page path, entity id, url, field
  human text not null,                     -- plain-language observation (templated, deterministic)
  tech text not null,                      -- technical observation (templated, deterministic)
  next_action text not null,               -- fixed per-type remediation hint from the catalog
  facts jsonb not null default '{}',       -- the measured values behind the templates (typed per catalog entry)
  observed_at timestamptz not null,        -- the run's clock, passed in (providers are pure)
  fingerprint text not null                -- stable identity: site|type|resource — for latest-state and delta queries
);
comment on table public.presence_evidence is
  'M9.0 evidence contract. Observations only — no interpretation, no prioritization, no AI (those are M9.1+ consumers). Templated explanations from the type catalog; facts carry the measured values. Internal/operator only.';

create index if not exists presence_evidence_site_time_idx
  on public.presence_evidence (site_id, observed_at desc);
create index if not exists presence_evidence_fingerprint_idx
  on public.presence_evidence (site_id, fingerprint, observed_at desc);
create index if not exists presence_evidence_run_idx
  on public.presence_evidence (run_id);

alter table public.presence_evidence enable row level security;
-- no policies: service role only. Clients meet evidence only through the
-- concierge (M9.1+), never raw.
