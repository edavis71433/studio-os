-- 0251 — Fill in which payment paid the invoices paid online before Nov 12 2026 (sales item 177).
--
-- presence_invoices.paid_ref (0188) remembers the Stripe payment that paid an invoice, so a
-- second, different payment landing on a paid invoice raises "Paid twice, refund one". The
-- rows paid before 0188 never had it filled, so a second online payment on one of them raises
-- nothing. This fills them once, from the webhook's own record of each payment
-- (stripe_payments), and never touches a row that already has one or was paid by hand.
--
-- Two passes, each only where the match is certain:
--   1. the payment row names the invoice (stripe_payments.invoice_id, written since item 147)
--   2. exactly one one-off payment (kind one_time or service_invoice) of the same amount within
--      two days of the day the invoice was marked paid, and that payment names no invoice
-- A row neither pass can place stays empty; the daily Stripe check (commerce/stripe_check.ts
-- fillPaidRefs) asks Stripe for it by the invoice's own id and fills it from Stripe's record.
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

-- rollback: not needed in place; paid_ref was empty on these rows (update ... set paid_ref = '' where paid_at < '2026-11-12' would undo it).
