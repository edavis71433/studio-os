-- ── L4.3 Write-Capable Adapters ─────────────────────────────────────────────
-- The first external writes. EVERY write is a PLAN the customer reviews and
-- approves before anything happens — the same safety core as M12 Infrastructure
-- Change Plans, applied to connected providers. Nothing here writes directly;
-- nothing bypasses approval. A write plan carries plain-language everything
-- (what changes, what does NOT, risk, rollback, how it's verified), executes
-- only after an explicit recorded decision, records the provider's response and
-- a verification result, and — where reversible — can be undone.
--
-- `requires_approval` is a CHECK constant, exactly like the recommendation and
-- infra-plan approval laws before it: not a setting, a law.
create table if not exists public.presence_connection_writes (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  provider_key text not null,
  workflow text not null check (workflow in (
    'gbp_post', 'gbp_hours', 'gsc_verify',        -- real provider writes (approval-gated)
    'calendar_hold', 'email_draft', 'social_draft' -- handoffs — prepared for the customer, NEVER sent
  )),
  kind text not null check (kind in ('write', 'handoff')),
  title text not null,
  summary text not null,
  what_changes jsonb not null default '[]',        -- plain-language bullets
  what_stays jsonb not null default '[]',          -- what will NOT change
  risk text not null default '',                   -- honest, plain words
  reversible boolean not null default false,
  rollback text not null default '',               -- how to undo, or why undo is unneeded/impossible
  verify text not null default '',                 -- how we confirm it worked, plain words
  requires_approval boolean not null default true check (requires_approval = true),
  payload jsonb not null default '{}',             -- the exact data to write (or the handoff content)
  prior_state jsonb,                               -- snapshot for rollback (e.g. previous hours)
  recommendation_hash text,                        -- pipeline traceability: the rec this plan serves
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'abandoned', 'executed', 'failed')),
  provider_response jsonb,                          -- what the provider returned (non-sensitive)
  verification jsonb,                              -- the read-back result: { ok, note }
  decided_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.presence_connection_writes is
  'L4.3. Write plans for connected providers — the approval-gated safety core for external writes. Every write is proposed → approved → executed → verified, with plain-language what-changes/risk/rollback and a captured provider response + verification. Deny-all RLS (function-mediated, service-role only). handoff-kind rows never touch a provider.';
create index if not exists presence_connection_writes_idx
  on public.presence_connection_writes (site_id, provider_key, status, created_at);

alter table public.presence_connection_writes enable row level security;  -- deny-all (no policies)

do $$ begin
  create trigger presence_connection_writes_touch before update on public.presence_connection_writes
    for each row execute function public.presence_touch_updated_at();
exception when others then null; end $$;

-- rollback:
--   drop table if exists public.presence_connection_writes;
