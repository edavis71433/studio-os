-- ── P2-C: Sales & Customer Lifecycle ────────────────────────────────────────
-- The smallest COMPLETE commercial workflow, multi-tenant on the frozen presence
-- spine: every row is site_id-scoped (references presence_sites, RLS via
-- my_presence_site_ids()), deny-all + function-mediated exactly like the CRM
-- notes (0048). No legacy migration; the clever-api sales data is disposable.
--
-- Chain (no duplicate truth — each link is an FK column):
--   presence_form_submissions? -> presence_deals(-> presence_contacts)
--     -> presence_proposals -> presence_contracts
--     -> convert -> clients.id (deals.converted_client_id, UNIQUE = idempotent)
--     -> presence_sites.id (deals.converted_site_id)

-- ── contacts: the ONE authoritative person/company record ──
create table if not exists public.presence_contacts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  phone text not null default '',
  company text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
-- one contact per (site, email) when an email is given (duplicate protection)
create unique index if not exists presence_contacts_site_email_uq
  on public.presence_contacts (site_id, lower(email)) where email <> '' and deleted_at is null;
create index if not exists presence_contacts_site_idx
  on public.presence_contacts (site_id, updated_at desc) where deleted_at is null;
alter table public.presence_contacts enable row level security;  -- deny-all; function-mediated

-- ── deals: the ONE authoritative lead+opportunity record (bounded stage ladder) ──
create table if not exists public.presence_deals (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  contact_id uuid references public.presence_contacts(id) on delete set null,
  title text not null default '',
  stage text not null default 'lead'
    check (stage in ('lead','qualified','proposal','contract','won','lost')),
  source text not null default '',                    -- e.g. website_form, referral, manual
  source_submission_id uuid,                          -- optional link to presence_form_submissions
  expected_value_cents integer not null default 0 check (expected_value_cents >= 0),
  expected_close date,
  notes text not null default '',
  assigned_to uuid,                                   -- optional owner (auth user id)
  lost_reason text not null default '',
  converted_client_id uuid references public.clients(id) on delete set null,
  converted_site_id uuid references public.presence_sites(id) on delete set null,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
-- idempotent conversion: a given client can be the target of at most one deal
create unique index if not exists presence_deals_converted_client_uq
  on public.presence_deals (converted_client_id) where converted_client_id is not null;
create index if not exists presence_deals_site_stage_idx
  on public.presence_deals (site_id, stage) where deleted_at is null;
create index if not exists presence_deals_site_recent_idx
  on public.presence_deals (site_id, updated_at desc) where deleted_at is null;
create index if not exists presence_deals_contact_idx
  on public.presence_deals (contact_id) where deleted_at is null;
alter table public.presence_deals enable row level security;  -- deny-all; function-mediated

-- ── deal events: stage history + activity + audit (append-only in spirit) ──
create table if not exists public.presence_deal_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.presence_deals(id) on delete cascade,
  site_id uuid not null references public.presence_sites(id) on delete cascade,  -- denormalized for RLS + scoping
  kind text not null check (kind in ('created','stage_change','note','proposal_sent','proposal_decided','contract_sent','contract_signed','converted')),
  from_stage text not null default '',
  to_stage text not null default '',
  detail jsonb not null default '{}',
  actor text not null default '',
  actor_kind text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists presence_deal_events_idx on public.presence_deal_events (deal_id, created_at desc);
create index if not exists presence_deal_events_site_idx on public.presence_deal_events (site_id, created_at desc);
alter table public.presence_deal_events enable row level security;  -- deny-all; function-mediated

-- ── proposals: the smallest complete quote (line items + status + share token) ──
create table if not exists public.presence_proposals (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  deal_id uuid not null references public.presence_deals(id) on delete cascade,
  title text not null default '',
  line_items jsonb not null default '[]',             -- [{label, qty, unit_cents}]
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  currency text not null default 'usd',
  terms text not null default '',
  status text not null default 'draft'
    check (status in ('draft','sent','accepted','declined')),
  version integer not null default 1,
  share_token text,                                   -- HMAC signed link carries the id; this is a fallback lookup
  sent_at timestamptz,
  decided_at timestamptz,
  decided_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists presence_proposals_deal_idx on public.presence_proposals (deal_id, created_at desc) where deleted_at is null;
create index if not exists presence_proposals_site_idx on public.presence_proposals (site_id, status) where deleted_at is null;
alter table public.presence_proposals enable row level security;  -- deny-all; function-mediated

-- ── contracts: the agreement (body + version-integrity hash + signed evidence) ──
create table if not exists public.presence_contracts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  deal_id uuid not null references public.presence_deals(id) on delete cascade,
  proposal_id uuid references public.presence_proposals(id) on delete set null,
  title text not null default '',
  body text not null default '',
  content_hash text not null default '',              -- version integrity: sign the exact bytes shown
  terms_snapshot jsonb not null default '{}',         -- accepted commercial terms carried forward
  status text not null default 'draft'
    check (status in ('draft','sent','signed','voided')),
  signer_name text not null default '',
  signer_email text not null default '',
  signed_at timestamptz,
  signed_evidence jsonb not null default '{}',        -- {hash, ip_hash, token_exp, at}
  version integer not null default 1,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists presence_contracts_deal_idx on public.presence_contracts (deal_id, created_at desc) where deleted_at is null;
create index if not exists presence_contracts_site_idx on public.presence_contracts (site_id, status) where deleted_at is null;
alter table public.presence_contracts enable row level security;  -- deny-all; function-mediated

-- touch-updated_at triggers (reuse the existing function)
do $$ begin
  create trigger presence_contacts_touch before update on public.presence_contacts for each row execute function public.presence_touch_updated_at();
  create trigger presence_deals_touch before update on public.presence_deals for each row execute function public.presence_touch_updated_at();
  create trigger presence_proposals_touch before update on public.presence_proposals for each row execute function public.presence_touch_updated_at();
  create trigger presence_contracts_touch before update on public.presence_contracts for each row execute function public.presence_touch_updated_at();
exception when others then null; end $$;

comment on table public.presence_deals is
  'P2-C sales lifecycle. The ONE authoritative lead+opportunity record, site_id-scoped, bounded stage ladder. converted_client_id UNIQUE = idempotent convert-to-customer. Deny-all RLS; function-mediated.';

-- rollback:
--   drop table if exists public.presence_contracts;
--   drop table if exists public.presence_proposals;
--   drop table if exists public.presence_deal_events;
--   drop table if exists public.presence_deals;
--   drop table if exists public.presence_contacts;
