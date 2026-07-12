-- ── 0090 — Web Push subscriptions ────────────────────────────────────────────
-- Stores the browser push endpoints an owner opted into, so the platform can
-- notify them (a lead waiting, an approval, a payment) even when the app isn't
-- open — the #1 gap vs native-app competitors. One row per (user, endpoint);
-- re-subscribing upserts. Deny-all RLS: only the edge functions (service role)
-- read/write these; a subscription is never client-readable.
create table if not exists public.presence_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,                      -- auth user id (owner/team)
  email text not null default '',    -- fallback identity
  site_id uuid references public.presence_sites(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,              -- subscription public key (base64url)
  auth text not null,                -- subscription auth secret (base64url)
  user_agent text not null default '',
  failures int not null default 0,   -- consecutive send failures → prune at 5
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  unique (endpoint)
);
create index if not exists presence_push_by_user on public.presence_push_subscriptions (user_id);
create index if not exists presence_push_by_site on public.presence_push_subscriptions (site_id);

alter table public.presence_push_subscriptions enable row level security;
-- no policies = deny all to anon/authenticated; edge functions use the service role.

comment on table public.presence_push_subscriptions is
  'Web Push endpoints for signed-in owners/team. Written by the presence function on opt-in; read by the push sender. Deny-all RLS — never client-readable.';

-- rollback: drop table public.presence_push_subscriptions;
