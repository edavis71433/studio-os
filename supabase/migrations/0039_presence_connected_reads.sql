-- ── 0039 — L4.1: Read-Only Connected Providers storage ──────────────────────
-- Additive only. Two new tables; nothing existing changes. These give the L4.0
-- connection records their encrypted token store (out-of-row, honoring the L4.0
-- promise that tokens are NEVER in the connection row) and a normalized read
-- cache that the Evidence Engine consumes. Still read-only: nothing here is ever
-- written back to a provider.
--
-- SECURITY: both tables are deny-all RLS (service-role only). Secrets hold ONLY
-- AES-256-GCM ciphertext + iv — never a usable token, never returned to a client.
-- Reads flow through the presence function, which returns normalized, safe data
-- and never a secret.

-- The encrypted delegated-token bundle for one connection (access + refresh +
-- expiry, sealed as one ciphertext). One per (site, provider). The L4.0
-- presence_connections.secret_ref points here.
create table if not exists public.presence_connection_secrets (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  provider_key text not null,
  ciphertext text not null,                 -- AES-256-GCM ciphertext (base64)
  iv text not null,                         -- per-record nonce (base64)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, provider_key)
);
comment on table public.presence_connection_secrets is
  'L4.1. Encrypted delegated provider tokens, out-of-row (L4.0 promise). AES-256-GCM ciphertext+iv only; key is an edge-function env secret. Deny-all RLS; never returned to a client.';

-- The normalized, read-only snapshot of what an adapter last observed at a
-- provider — the Evidence Engine's input. Never written back anywhere.
create table if not exists public.presence_connected_data (
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  provider_key text not null,
  data jsonb not null default '{}',         -- normalized shape (rating, reviews, metrics, …)
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, provider_key)
);
comment on table public.presence_connected_data is
  'L4.1. Normalized read-only snapshot of provider data (the freshest observation). fetched_at is the honest as-of time. Deny-all RLS; feeds the Evidence Engine as just another input.';

alter table public.presence_connection_secrets enable row level security;  -- deny-all
alter table public.presence_connected_data enable row level security;      -- deny-all

do $$ begin
  create trigger presence_connection_secrets_touch before update on public.presence_connection_secrets
    for each row execute function public.presence_touch_updated_at();
  create trigger presence_connected_data_touch before update on public.presence_connected_data
    for each row execute function public.presence_touch_updated_at();
exception when duplicate_object then null;
end $$;

-- ROLLBACK (reference):
--   drop table if exists public.presence_connected_data;
--   drop table if exists public.presence_connection_secrets;
