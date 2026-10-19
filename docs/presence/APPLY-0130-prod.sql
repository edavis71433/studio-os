-- ═══════════════════════════════════════════════════════════════════════════
--  APPLY PACK · migration 0130  (owner-apply, prod)
-- ═══════════════════════════════════════════════════════════════════════════
--  Run this ONCE (Supabase → SQL Editor). ADDITIVE and IDEMPOTENT (add column
--  "if not exists", create index "if not exists"), so it is safe to re-run.
--  The presence function degrades gracefully until this runs: the contacts
--  read retries without the column, and nothing links contacts to customers.
--
--  Why: Phase 2 one customer model (PR #9). A contact can belong to a customer
--  (presence_contacts.client_id), set on deal convert and on "Add a customer".
--
--  Covers: supabase/migrations/0130_contact_customer_link.sql
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.presence_contacts add column if not exists client_id uuid;
create index if not exists presence_contacts_client_idx
  on public.presence_contacts (site_id, client_id) where client_id is not null;
comment on column public.presence_contacts.client_id is
  'Phase 2: the customer (clients.id) this person belongs to, once converted or added; null = not (yet) a customer.';

-- Verify (expect one row):
-- select column_name from information_schema.columns
--   where table_schema='public' and table_name='presence_contacts' and column_name='client_id';
