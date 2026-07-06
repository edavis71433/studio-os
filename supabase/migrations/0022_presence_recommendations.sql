-- ── 0022 — M9.2: the Recommendation Engine's storage ────────────────────────
-- Additive only. One new table; nothing existing changes.
-- Constitutional home: 05 §2/§6 — recommendation sits between judgment and
-- human decision. Internal only: M9.3+ translates surviving recommendations
-- into the concierge's grammar; nothing here is customer copy.
--
-- Two laws are enforced by the SCHEMA itself, not just by code:
--   • approval_required is always true  (nothing auto-completes, ever)
--   • manual_available is always true   (Law 25: every AI action has a
--     manual equivalent — a row violating it cannot exist)
create table if not exists public.presence_recommendations (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,                          -- one recommend() pass
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  judgment_batch_id uuid not null,                 -- the M9.1 batch consumed
  recommendation_key text not null,                -- stable dedupe key per (site, rule)
  recommendation_hash text not null,               -- deterministic content id
  rule text not null,
  category text not null check (category in (
    'availability','discoverability','accessibility','accuracy','trust',
    'freshness','media','conversion','content','platform','operations')),
  priority text not null check (priority in ('critical','high','medium','low','informational')),
  action text not null check (action in (
    'create','update','remove','review','verify','monitor','connect',
    'complete','refresh','replace','enable','disable')),
  title text not null,                             -- internal structured title (NOT customer copy)
  description text not null,                       -- internal: what should be done
  reason text not null,                            -- internal: why (from the judgment's reasoning)
  expected_benefit text not null,                  -- honest, hedged; never invented numbers
  value_dimensions jsonb not null default '[]',    -- trust | search_visibility | accessibility | customer_experience | performance | business_accuracy | reputation | conversion | freshness
  estimated_effort text not null check (estimated_effort in ('minutes','hour','hours','project')),
  estimated_risk text not null check (estimated_risk in ('none','low','medium')),
  undoability text not null check (undoability in ('not_applicable','fully_undoable','versioned')),
  timing text not null check (timing in ('immediate','soon','seasonal','whenever','none')),
  audience text not null check (audience in ('customer','operator')),
  affected_resources jsonb not null default '[]',
  requires_ai boolean not null default false,      -- the proposed workflow uses AI drafting (M9.3+)
  manual_available boolean not null default true check (manual_available = true),
  approval_required boolean not null default true check (approval_required = true),
  status text not null check (status in ('active','suppressed')),
  suppression_reason text not null default '',
  supporting_judgment_ids jsonb not null default '[]',  -- M9.1 judgment_hash values
  first_seen_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
comment on table public.presence_recommendations is
  'M9.2 (constitution 05 §2/§6). Deterministic recommendations from judgments: what should be proposed, why, benefit, effort, risk, undoability. Internal only; approval_required and manual_available are schema-enforced true. M9.3+ consumes the active ones.';

create index if not exists presence_recommendations_site_batch_idx
  on public.presence_recommendations (site_id, created_at desc, batch_id);
create index if not exists presence_recommendations_key_idx
  on public.presence_recommendations (site_id, recommendation_key, created_at desc);

alter table public.presence_recommendations enable row level security;
-- no policies: service role only.
