-- APPLY 0188 (production) — money can't go wrong quietly (sales items 116 and 118).
-- Safe to run more than once. Adds four columns to presence_invoices (first_sent_at, link_gen, paid_ref,
-- paid_private_note) and fills first_sent_at on the invoices already sent. No other row changes.
-- Run BEFORE the backend deploy that reads them. Until it runs, Record payment answers "needs a quick
-- database update first" and everything else works as it did.
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
-- check: select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'presence_invoices'
--          and column_name in ('first_sent_at','link_gen','paid_ref','paid_private_note')) as invoice_cols,                  -- 4
--        (select count(*) from public.presence_invoices where stripe_url is not null and first_sent_at is null
--          and payment_for is null) as sent_but_unstamped;                                                                   -- 0
