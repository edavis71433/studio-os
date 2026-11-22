-- ===========================================================================
--  APPLY PACK - migration 0251  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), any time
--  after 0188 (paid_ref). A DATA fill only: it writes paid_ref on invoices paid
--  online before Nov 12 2026 that never had one, from the webhook's own record
--  of each payment, and only where the match is certain (the payment names the
--  invoice, or exactly one payment of the same amount landed within two days).
--  Safe to re-run: it only touches rows whose paid_ref is still empty.
--
--  Sales item 177: without paid_ref, a second online payment on one of those six
--  old rows raised no "Paid twice, refund one" line. Rows this can't place are
--  filled by the daily Stripe check from Stripe's own record.
--
--  Before running, this read shows what will be touched:
--    select id, number, amount_cents, paid_at from public.presence_invoices
--     where status = 'paid' and paid_ref = '' and paid_method = '' and payment_for is null and deleted_at is null;
--
--  Covers: supabase/migrations/0251_fill_paid_ref.sql
-- ===========================================================================
update public.presence_invoices i
   set paid_ref = p.stripe_payment_intent
  from public.stripe_payments p
 where i.status = 'paid' and i.paid_ref = '' and i.paid_method = '' and i.payment_for is null and i.deleted_at is null
   and p.invoice_id = i.id and p.stripe_payment_intent is not null and p.stripe_payment_intent <> '';

with one as (
  select i.id as invoice_id, min(p.stripe_payment_intent) as ref, count(*) as n
    from public.presence_invoices i
    join public.stripe_payments p
      on p.invoice_id is null and p.stripe_payment_intent is not null and p.stripe_payment_intent <> ''
     and coalesce(p.kind, 'one_time') in ('one_time', 'service_invoice')   -- the old payments' kind is service_invoice
     and round(p.amount * 100) = i.amount_cents
     and p.created_at between i.paid_at - interval '2 days' and i.paid_at + interval '2 days'
   where i.status = 'paid' and i.paid_ref = '' and i.paid_method = '' and i.payment_for is null and i.deleted_at is null
   group by i.id
)
update public.presence_invoices i
   set paid_ref = one.ref
  from one
 where i.id = one.invoice_id and one.n = 1 and i.paid_ref = '';


-- check: how many paid-online invoices still have no paid_ref (0 is the goal; any left are filled by the daily check)
select count(*) as still_empty from public.presence_invoices
 where status = 'paid' and paid_ref = '' and paid_method = '' and payment_for is null and deleted_at is null;
