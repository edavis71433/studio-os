-- ── Deposits & service invoices (multi-tenant) ──────────────────────────────
-- The agency can turn an accepted proposal (or an ad-hoc amount) into a payable
-- invoice/deposit. This is SERVICE billing (project work the agency sells) — kept
-- deliberately separate from the customer's SaaS subscription, on the SAME one
-- Stripe authority (a Stripe Payment Link per invoice; the webhook flips it paid
-- via metadata.presence_invoice_id). Amounts are in CENTS, like every other money
-- value in `presence` (proposals.subtotal_cents, etc.) — the legacy single-tenant
-- `invoices` table (clever-api, dollars) is NOT reused; this is the platform home
-- and retires cleanly with clever-api.
--
-- Deny-all RLS; every read/write is function-mediated by the service role and
-- scoped by site_id (the issuing agency) + customer_client_id (who can see/pay it).

create table if not exists public.presence_invoices (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null,                         -- the agency site that issued it
  deal_id uuid,                                  -- the originating pipeline deal (optional)
  customer_client_id uuid,                       -- who's billed (their clients.id) — how the client portal finds it; null = pay-by-link only
  customer_site_id uuid,                          -- the customer's workspace (optional convenience)
  title text not null default 'Invoice',
  description text not null default '',
  amount_cents integer not null default 0 check (amount_cents >= 0 and amount_cents <= 100000000),
  currency text not null default 'usd',
  purpose text not null default 'service' check (purpose in ('service','deposit')),
  status text not null default 'open' check (status in ('open','paid','void')),
  stripe_url text,                                -- the hosted Stripe payment link
  stripe_payment_link_id text,
  due_date date,
  paid_at timestamptz,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists presence_invoices_customer_idx
  on public.presence_invoices (customer_client_id) where deleted_at is null;
create index if not exists presence_invoices_site_idx
  on public.presence_invoices (site_id, created_at desc) where deleted_at is null;
create index if not exists presence_invoices_deal_idx
  on public.presence_invoices (deal_id) where deleted_at is null;

alter table public.presence_invoices enable row level security;  -- deny-all; function-mediated
