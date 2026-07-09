-- ── Phase SC-2: Scoped-Access Audit Ledger ──────────────────────────────────
-- Accountability for SC-1's Studio→Client drill-in: every SCOPED access (an
-- agency operator reaching a client's tenant) is recorded — allowed and denied.
-- Dedicated table (NOT presence_change_events): this is operator/security
-- forensics, staff-only, deny-all RLS — it must never touch a customer's activity
-- timeline. Never stores tokens, secrets, or request bodies.
create table if not exists public.presence_scoped_access_events (
  id uuid primary key default gen_random_uuid(),
  operator_user_id uuid,                    -- the agency operator's auth user id
  operator_email text not null default '',
  agency_id uuid,
  client_site_id uuid,                      -- the tenant that was accessed/attempted
  client_name text not null default '',
  route text not null default '',           -- path only (no query, no body)
  method text not null default '',
  outcome text not null check (outcome in ('allowed','denied')),
  reason text not null default ''           -- '' when allowed; else the denial reason
    check (reason in ('','unauthorized','forbidden','missing_membership','removed_client','malformed_scope','archived_client','read_only_role')),
  request_id text not null default '',
  ip text not null default '',              -- first forwarded hop (operator's), capped; forensic source
  user_agent text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists psae_client_idx on public.presence_scoped_access_events (client_site_id, created_at desc);
create index if not exists psae_operator_idx on public.presence_scoped_access_events (operator_user_id, created_at desc);
create index if not exists psae_time_idx on public.presence_scoped_access_events (created_at desc);

-- Deny-all: RLS on with NO policy → no authenticated role can read/write it.
-- Service role (the admin audit endpoint, staff-gated) bypasses RLS to read.
alter table public.presence_scoped_access_events enable row level security;
comment on table public.presence_scoped_access_events is
  'SC-2. Operator scoped-access audit ledger. Service-role write (best-effort, never gates the access decision); staff-only read via /admin/scoped-access. No tokens/secrets/bodies. Rollback: drop table.';
