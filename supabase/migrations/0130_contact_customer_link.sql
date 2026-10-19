-- rollback: alter table public.presence_contacts drop column if exists client_id;
-- Phase 2 (overhaul): one customer model. A contact can belong to a customer:
-- presence_contacts.client_id points at the clients row the studio converted or
-- added. Set on deal convert and on "Add a customer"; read by the contacts
-- roster (Customer column → the record), the Customers page's People tab and
-- ⌘K. Nullable — a contact with no customer is just a person you know.
alter table public.presence_contacts add column if not exists client_id uuid;
create index if not exists presence_contacts_client_idx
  on public.presence_contacts (site_id, client_id) where client_id is not null;
comment on column public.presence_contacts.client_id is
  'Phase 2: the customer (clients.id) this person belongs to, once converted or added; null = not (yet) a customer.';
