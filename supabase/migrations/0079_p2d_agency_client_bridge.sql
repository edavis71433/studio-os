-- ── P2-D Final Hardening: Agency–Client Bridge ──────────────────────────────
-- The post-sale relationship between an agency/studio workspace and a customer's
-- own workspace, made EXPLICIT and tenant-safe. ONE authoritative project lives
-- on the agency site; the customer (on their OWN site) reaches only their linked,
-- client-visible delivery through this bridge — never as a member of the agency's
-- internal workspace, never able to see another customer's records.
--
--   presence_deals (agency site) --convert--> clients.id (customer) + presence_sites (customer workspace)
--        └─ presence_projects (agency site, client_id = customer)
--             └─ presence_service_links  [THE BRIDGE]  customer_client_id ⇄ project_id (agency site)

create table if not exists public.presence_service_links (
  id uuid primary key default gen_random_uuid(),
  agency_site_id uuid not null references public.presence_sites(id) on delete cascade,   -- where the project + delivery live
  project_id uuid not null references public.presence_projects(id) on delete cascade,
  customer_client_id uuid not null references public.clients(id) on delete cascade,       -- the customer this delivery is for
  customer_site_id uuid references public.presence_sites(id) on delete set null,          -- the customer's OWN workspace (P2-E billing hook)
  deal_id uuid references public.presence_deals(id) on delete set null,                   -- provenance
  status text not null default 'active' check (status in ('active','ended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- ONE bridge per project (idempotent handoff); fast lookup by customer.
create unique index if not exists presence_service_links_project_uq
  on public.presence_service_links (project_id);
create index if not exists presence_service_links_customer_idx
  on public.presence_service_links (customer_client_id, status);
create index if not exists presence_service_links_customer_site_idx
  on public.presence_service_links (customer_site_id, status);
alter table public.presence_service_links enable row level security;  -- deny-all; function-mediated

do $$ begin
  create trigger presence_service_links_touch before update on public.presence_service_links for each row execute function public.presence_touch_updated_at();
exception when others then null; end $$;

-- D3 (perf, from the deep audit): the support list orders by updated_at but had no
-- matching index (sibling tables all have (site_id, updated_at desc)).
create index if not exists presence_support_site_recent_idx
  on public.presence_support_requests (site_id, updated_at desc) where deleted_at is null;

comment on table public.presence_service_links is
  'P2-D Agency–Client Bridge. Links an agency-site delivery project to the customer''s own workspace/client, tenant-safe. The customer reaches only their linked client-visible delivery — never a member of the agency workspace. UNIQUE(project_id) = idempotent handoff.';

-- rollback:
--   drop index if exists public.presence_support_site_recent_idx;
--   drop table if exists public.presence_service_links;
