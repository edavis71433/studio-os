-- ===========================================================================
--  APPLY PACK - migration 0233  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships refunds and disputes. ADDITIVE and
--  IDEMPOTENT ("if not exists" / "drop ... if exists"), so it is safe to re-run.
--  Nothing existing changes: two new columns on presence_invoices (every row
--  gets 0 and empty) and one new table.
--
--  Why: sales items 126 and 127. A refund or a dispute made in Stripe now shows
--  on the invoice, comes off revenue, the weekly email and the bookkeeper file,
--  and a dispute raises a Needs you line with Stripe's deadline.
--
--  If the deploy goes first, nothing is lost: Stripe's refund and dispute
--  messages are answered "not ready" and Stripe sends them again (for 3 days).
--
--  Rollback (only if ever needed):
--    drop table if exists public.presence_money_returns;
--    alter table public.presence_invoices drop constraint if exists presence_invoices_refunded_cents_check;
--    alter table public.presence_invoices drop constraint if exists presence_invoices_dispute_status_check;
--    alter table public.presence_invoices drop column if exists refunded_cents;
--    alter table public.presence_invoices drop column if exists dispute_status;
--
--  Covers: supabase/migrations/0233_refunds_disputes.sql
-- ===========================================================================

alter table public.presence_invoices add column if not exists refunded_cents integer not null default 0;
alter table public.presence_invoices add column if not exists dispute_status text;
alter table public.presence_invoices drop constraint if exists presence_invoices_refunded_cents_check;
alter table public.presence_invoices add constraint presence_invoices_refunded_cents_check check (refunded_cents >= 0 and refunded_cents <= 100000000);
alter table public.presence_invoices drop constraint if exists presence_invoices_dispute_status_check;
alter table public.presence_invoices add constraint presence_invoices_dispute_status_check check (dispute_status is null or dispute_status in ('open', 'won', 'lost'));

create table if not exists public.presence_money_returns (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  invoice_id uuid references public.presence_invoices(id) on delete set null,
  deal_id uuid,
  kind text not null check (kind in ('refund', 'dispute')),
  applies_to text not null check (applies_to in ('invoice', 'extra', 'void', 'retainer')),
  stripe_id text not null unique check (char_length(stripe_id) between 3 and 255),
  stripe_charge text not null default '',
  stripe_payment_intent text not null default '',
  stripe_invoice text not null default '',
  amount_cents integer not null default 0 check (amount_cents >= 0 and amount_cents <= 100000000),
  counted_cents integer not null default 0 check (counted_cents >= 0 and counted_cents <= 100000000),
  counted_at timestamptz,
  fee_cents integer not null default 0 check (fee_cents between -1000000 and 1000000),
  status text not null check (status in ('pending', 'succeeded', 'failed', 'canceled', 'open', 'won', 'lost')),
  stripe_status text not null default '',
  reason text not null default '',
  method text not null default '',
  due_by timestamptz,
  happened_at timestamptz not null,
  closed_at timestamptz,
  client_emailed boolean not null default false,
  livemode boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists presence_money_returns_site_idx on public.presence_money_returns (site_id, counted_at);
create index if not exists presence_money_returns_invoice_idx on public.presence_money_returns (invoice_id) where invoice_id is not null;
create index if not exists presence_money_returns_deal_idx on public.presence_money_returns (deal_id) where deal_id is not null;

alter table public.presence_money_returns enable row level security;
revoke all on public.presence_money_returns from anon, authenticated;

comment on column public.presence_invoices.refunded_cents is
  'Sales item 126: how much of this invoice''s own payment came back through Stripe, as Studio OS counts it (an overpayment refunded is not part of it). Equal to amount_cents = refunded in full. Set by commerce/charge_returns.ts from Stripe''s own record.';
comment on column public.presence_invoices.dispute_status is
  'Sales item 127: null, open, won or lost. A paid invoice reads Disputed while open and Dispute lost once lost; won (or an inquiry closed) reads Paid. Set by commerce/charge_returns.ts.';
comment on table public.presence_money_returns is
  'Sales items 126 and 127: one row per Stripe refund (re_) or dispute (du_), keyed by its Stripe id. counted_cents comes off revenue, the weekly email and the bookkeeper file on counted_at (a refund when made, a lost dispute when it closed). fee_cents is Stripe''s dispute fee. Written by commerce/charge_returns.ts (service role) only.';


-- Verify (expect: two rows, refunded_cents integer and dispute_status text; then 1; then 3 index names; then 0 and 0):
-- select column_name, data_type from information_schema.columns where table_name = 'presence_invoices' and column_name in ('refunded_cents', 'dispute_status') order by column_name desc;
-- select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'presence_money_returns';
-- select indexname from pg_indexes where tablename = 'presence_money_returns' and indexname like 'presence_money_returns_%_idx';
-- select count(*) from public.presence_money_returns;
-- select count(*) from public.presence_invoices where refunded_cents <> 0 or dispute_status is not null;
