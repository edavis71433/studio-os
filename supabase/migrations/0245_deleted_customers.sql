-- rollback: drop table if exists public.presence_deleted_customers;
--   (with the table gone, Delete customer says it isn't switched on yet and deletes
--    nothing; Recently deleted shows no customers)
--
-- ── A studio can delete a customer it added by mistake (builder list item 241) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. Until it lands, Delete customer
-- answers that it isn't switched on yet and changes nothing.
--
-- WHY
--   Eric, Nov 15: "i also cant delete whats currently there". Customers had no Delete;
--   only Sites had Move to trash. A customer added by mistake stayed on Customers, with
--   their contact and their project, for good.
--
-- WHAT CHANGES
--   One new table. A row is written when a studio deletes one of its customers and says
--   what went with them, so Recently deleted can list it and Restore can put back exactly
--   that for 30 days:
--     · ended_links: the studio's links to the customer (presence_service_links, now
--       'ended', the bridge's existing state);
--     · deleted_projects / deleted_contacts: their project(s) and the person(s), which
--       carry deleted_at as every soft delete here does;
--     · site_id + site_to_trash: their website, when they had one, and whether the studio
--       sent it to the Sites Trash with them (it keeps its own 90 days there) or kept it.
--   restored_at marks a Restore; closed_at marks the daily sweep letting the row go after
--   30 days (ops/customer_trash.ts), which also removes a bare record: no sign-in, no
--   website and nothing else pointing at it.
--   One open deletion per studio and customer (a unique index), so two presses can't
--   delete the same customer twice. Row security on, no policies: only the server
--   (service role) reads and writes it, like every presence_* table.
create table if not exists public.presence_deleted_customers (
  id uuid primary key default gen_random_uuid(),
  studio_site_id uuid not null references public.presence_sites(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  site_id uuid references public.presence_sites(id) on delete set null,
  site_to_trash boolean not null default false,
  ended_links uuid[] not null default '{}',
  deleted_projects uuid[] not null default '{}',
  deleted_contacts uuid[] not null default '{}',
  deleted_by text not null default '',
  deleted_at timestamptz not null default now(),
  restored_at timestamptz,
  closed_at timestamptz
);

create unique index if not exists presence_deleted_customers_open_uq
  on public.presence_deleted_customers (studio_site_id, client_id) where restored_at is null and closed_at is null;
create index if not exists presence_deleted_customers_recent_idx
  on public.presence_deleted_customers (studio_site_id, deleted_at desc) where restored_at is null and closed_at is null;
create index if not exists presence_deleted_customers_due_idx
  on public.presence_deleted_customers (deleted_at) where restored_at is null and closed_at is null;

alter table public.presence_deleted_customers enable row level security;   -- deny-all; function-mediated

comment on table public.presence_deleted_customers is
  'Item 241: a customer a studio deleted, and what went with them (ended links, deleted projects and contacts, the website sent to the Trash or kept). Restore puts it back for 30 days; then ops/customer_trash.ts closes the row and removes a bare record.';
