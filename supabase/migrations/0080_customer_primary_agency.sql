-- ── Architecture freeze: one primary agency per customer (launch constraint) ──
-- The Agency–Client Bridge is now the authoritative Studio OS ownership model. For
-- launch we freeze: a customer workspace may be linked to exactly ONE primary
-- agency/studio workspace. This table is that authoritative relationship; the
-- PRIMARY KEY on customer_client_id enforces the one-agency rule at the DB level.
--
-- Future multi-agency collaboration is designed for WITHOUT replacing the core
-- model: to relax, drop this PK and move to a composite (customer_client_id,
-- agency_site_id) key + a "primary" flag. presence_service_links (the per-project
-- bridge) already supports many links; this table is the single-agency gate.

create table if not exists public.presence_customer_agency (
  customer_client_id uuid primary key references public.clients(id) on delete cascade,
  agency_site_id uuid not null references public.presence_sites(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.presence_customer_agency enable row level security;  -- deny-all; function-mediated

comment on table public.presence_customer_agency is
  'Architecture freeze: the ONE primary agency per customer (launch constraint). PK(customer_client_id) enforces one-agency-per-customer; relax to a composite key for future multi-agency. Deny-all RLS; function-mediated.';

-- rollback:
--   drop table if exists public.presence_customer_agency;
