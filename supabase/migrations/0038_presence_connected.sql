-- ── 0038 — L4.0: Connected Platform Foundation storage ──────────────────────
-- Additive only. Two new tables; nothing existing changes. These are the record
-- side of the unified connected-provider contract (connected/contract.ts): the
-- provider DECLARATION is code; a customer's live LINK to a provider is a row
-- here. L4.0 is foundation only — no adapter writes a token, syncs data, or
-- authenticates against a live service; these tables stand ready for L4.1.
--
-- SECURITY (declared now, honored forever):
--   • Tokens are NEVER stored in the row. `secret_ref` points at an encrypted
--     secret held out-of-row (a vault/KMS handle, added with the first live
--     adapter). The row carries only status, granted scopes, and health.
--   • Deny-all RLS: connections and their audit are service-role only. The
--     customer sees their connection state through the presence function, which
--     returns safe fields (status/health/last_sync) and NEVER a secret_ref —
--     exactly the entitlements pattern (system table, function-mediated).
--   • Least privilege: `scopes_granted` records only what the customer approved.
--   • Revocation: disconnect deletes the row (and, with a live adapter, revokes
--     at the provider). Ownership never leaves the customer.

create table if not exists public.presence_connections (
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  provider_key text not null,                 -- matches connected/providers.ts
  status text not null default 'disconnected'
    check (status in ('disconnected','pending','connected','expired','error','revoked')),
  health text not null default 'unknown'
    check (health in ('ok','attention','down','unknown')),
  scopes_granted jsonb not null default '[]', -- only what the customer approved (least privilege)
  secret_ref text,                            -- handle to an ENCRYPTED, out-of-row secret; NEVER a raw token
  last_sync_at timestamptz,                   -- how fresh the observed data is (honesty, not a promise)
  last_error text not null default '',        -- internal; never surfaced raw to a customer
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, provider_key)
);
comment on table public.presence_connections is
  'L4.0. A customer''s live link to one external provider. One row per (site, provider). Tokens live encrypted out-of-row (secret_ref); this row is status/health/scopes only. Deny-all RLS: read through the presence function, which never returns secret_ref.';

create index if not exists presence_connections_provider_idx on public.presence_connections (provider_key, status);

-- Append-only audit: every connect / reconnect / disconnect / error, for
-- provenance and revocation history. Service-role only.
create table if not exists public.presence_connection_events (
  id bigint generated always as identity primary key,
  site_id uuid not null,
  provider_key text not null,
  action text not null,                       -- 'connect' | 'disconnect' | 'reconnect' | 'error' | 'revoke'
  detail text not null default '',            -- plain, non-sensitive
  actor_kind text not null default 'customer',-- customer | operator | system
  created_at timestamptz not null default now()
);
comment on table public.presence_connection_events is
  'L4.0. Append-only audit of connection lifecycle events (provenance + revocation history). Non-sensitive detail only; never tokens.';
create index if not exists presence_connection_events_idx on public.presence_connection_events (site_id, provider_key, created_at);

alter table public.presence_connections enable row level security;         -- deny-all (no policies)
alter table public.presence_connection_events enable row level security;   -- deny-all (no policies)

do $$ begin
  create trigger presence_connections_touch before update on public.presence_connections
    for each row execute function public.presence_touch_updated_at();
exception when duplicate_object then null;
end $$;

-- ROLLBACK (reference):
--   drop table if exists public.presence_connection_events;
--   drop table if exists public.presence_connections;
