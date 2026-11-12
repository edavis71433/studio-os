-- 0188 — Money can't go wrong quietly (sales items 116 and 118, Nov 12 2026 review, file 06
-- findings 2, 3, 4, 9 and 11).
--
-- presence_invoices
--   first_sent_at      when the invoice first went to the client. An invoice made from an
--                      estimate and sent two weeks later used to be reminded as if it had been
--                      sent the day it was made. Existing rows are filled below.
--   link_gen           which pay link the invoice is on. Each link takes one payment and then
--                      switches itself off, and Stripe hands the same link back for the same
--                      request, so a link that is spent (a bank payment that bounced) or was for
--                      another amount (a part payment, an Undo) could never be replaced. Whoever
--                      clears stripe_url adds one, and the next link is made under the new number.
--   paid_ref           the Stripe payment that paid the invoice, so a second, different payment
--                      on a paid invoice can be told from Stripe repeating itself.
--   paid_private_note  the studio's own note on a payment recorded by hand. paid_note is printed
--                      on the client's receipt; this one never is.
-- No notice kind is added: a bounced bank payment and a second payment ride the money kind
-- 'invoice_void_paid' (0119) under their own periods, and a retainer approved twice rides
-- 'retainer_status' (0127). No row is changed except the first_sent_at fill.
alter table public.presence_invoices
  add column if not exists first_sent_at timestamptz,
  add column if not exists link_gen integer not null default 0,
  add column if not exists paid_ref text not null default '',
  add column if not exists paid_private_note text not null default '';
alter table public.presence_invoices drop constraint if exists presence_invoices_paid_private_note_len;
alter table public.presence_invoices
  add constraint presence_invoices_paid_private_note_len check (char_length(paid_private_note) <= 300);
-- the invoices already there: sent the day the deal's history says so, else (it has, or had, a
-- pay link) the day it was made. One never sent stays empty and is stamped when it goes out.
update public.presence_invoices i
   set first_sent_at = coalesce(
         (select min(e.created_at) from public.presence_deal_events e
           where e.deal_id = i.deal_id and e.kind = 'invoice_sent' and e.detail->>'invoice_id' = i.id::text),
         i.created_at)
 where i.first_sent_at is null and i.payment_for is null
   and (i.stripe_url is not null or i.status = 'paid'
        or exists (select 1 from public.presence_deal_events e
                    where e.deal_id = i.deal_id and e.kind = 'invoice_sent' and e.detail->>'invoice_id' = i.id::text));
comment on column public.presence_invoices.first_sent_at is 'Sales item 118: when the invoice first went to the client. Reminders count from this day, not the day the row was made.';
comment on column public.presence_invoices.link_gen is 'Sales item 116: which pay link this invoice is on. Whoever clears stripe_url (a part payment, an Undo, a bank payment that bounced) adds one, so the next link is a new one at Stripe, never the spent one again.';
comment on column public.presence_invoices.paid_ref is 'Sales item 116: the Stripe payment that paid this invoice. A different payment landing on a paid invoice is a second payment, and the studio is told.';
comment on column public.presence_invoices.paid_private_note is 'Sales item 118: the studio''s own note on a payment recorded by hand. Never printed on the receipt (paid_note is).';

-- rollback:
--   alter table public.presence_invoices drop constraint if exists presence_invoices_paid_private_note_len,
--     drop column if exists paid_private_note, drop column if exists paid_ref,
--     drop column if exists link_gen, drop column if exists first_sent_at;
