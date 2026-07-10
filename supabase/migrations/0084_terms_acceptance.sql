-- ── P2-E W6: durable terms-acceptance evidence (M4) ──────────────────────────
-- Signup shows clickwrap ("by creating your account you agree to the Terms…"),
-- but NOTHING recorded WHICH version was accepted, WHEN, or from where — so there
-- was no evidence to stand on later. This append-only table is that evidence:
-- one row per acceptance (a customer may re-accept a new version over time).
-- Deny-all RLS; written by the service role at signup.

create table if not exists public.presence_terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  email text not null default '',
  terms_version text not null,
  privacy_version text not null default '',
  accepted_at timestamptz not null default now(),
  ip text not null default '',
  user_agent text not null default '',
  method text not null default 'clickwrap_signup',   -- how consent was captured
  context text not null default 'signup',
  created_at timestamptz not null default now()
);
create index if not exists presence_terms_acceptances_client_idx
  on public.presence_terms_acceptances (client_id, accepted_at desc);
alter table public.presence_terms_acceptances enable row level security;  -- deny-all; function-mediated

comment on table public.presence_terms_acceptances is
  'P2-E M4: append-only terms/privacy acceptance evidence (version + when + ip + ua) captured at signup. Deny-all RLS.';

-- rollback:
--   drop table if exists public.presence_terms_acceptances;
