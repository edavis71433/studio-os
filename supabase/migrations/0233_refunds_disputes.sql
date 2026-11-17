-- rollback: drop table if exists public.presence_money_returns; alter table public.presence_invoices drop constraint if exists presence_invoices_refunded_cents_check, drop constraint if exists presence_invoices_dispute_status_check, drop column if exists refunded_cents, drop column if exists dispute_status;
--
-- ── Refunds and disputes made in Stripe reach Studio OS (sales items 126, 127) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTIONS. Until it lands, a refund or a
-- dispute Stripe reports is answered "not ready" and Stripe sends it again later (it
-- retries for three days), so nothing is lost; every page reads as before.
--
-- WHAT CHANGES
--   presence_invoices.refunded_cents: how much of this invoice's own payment came
--     back, as Studio OS counts it (an overpayment going back is not part of it).
--     0 = nothing refunded. Equal to amount_cents = refunded in full.
--   presence_invoices.dispute_status: null (never disputed), 'open' (the client's
--     card company or bank is asking for the money back), 'won' (it stays with the
--     studio, or the question closed without a dispute) or 'lost' (it went back).
--   presence_money_returns: one row per Stripe refund (re_…) or dispute (du_…), keyed
--     by its Stripe id: what it was for (an invoice; an extra payment on one, paid
--     twice; a payment on a withdrawn invoice; a retainer charge), its amount, what
--     comes off the money Studio OS counted and when, Stripe's dispute fee, its
--     status, the deadline to answer a dispute, and whether the client was emailed.
--     Revenue, the weekly email and the bookkeeper file read it. RLS on, nothing
--     granted to anon or signed-in users; the function's own key reads and writes it.
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
