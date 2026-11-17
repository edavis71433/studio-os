-- ===========================================================================
--  APPLY PACK - migration 0245  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships Delete customer. ADDITIVE and IDEMPOTENT
--  ("if not exists"), so it is safe to re-run. Nothing existing changes: one new
--  table with row security on and no policies (only the server reads it), and
--  three small indexes.
--
--  Why: builder list item 241. A studio can delete a customer it added by
--  mistake, choosing whether their website goes to the Trash with them or stays,
--  and Restore puts them back for 30 days.
--
--  If the deploy goes first, nothing breaks: Delete customer says it isn't
--  switched on yet and changes nothing, and Recently deleted lists no customers.
--
--  Rollback (only if ever needed):
--    drop table if exists public.presence_deleted_customers;
--
--  Covers: supabase/migrations/0245_deleted_customers.sql
-- ===========================================================================

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

alter table public.presence_deleted_customers enable row level security;

comment on table public.presence_deleted_customers is
  'Item 241: a customer a studio deleted, and what went with them (ended links, deleted projects and contacts, the website sent to the Trash or kept). Restore puts it back for 30 days; then ops/customer_trash.ts closes the row and removes a bare record.';


-- Verify (expect: 14 columns; then 3 index names plus the primary key; then true; then 0):
-- select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'presence_deleted_customers';
-- select indexname from pg_indexes where tablename = 'presence_deleted_customers' order by indexname;
-- select relrowsecurity from pg_class where relname = 'presence_deleted_customers';
-- select count(*) from public.presence_deleted_customers;
