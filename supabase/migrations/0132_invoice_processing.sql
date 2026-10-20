-- rollback: alter table public.presence_invoices drop column if exists processing_since;
-- Oct 2026 benchmark (item 2): money in four states — Paid · Processing ·
-- Upcoming · Overdue. "Processing" is a payment Stripe has accepted but not
-- settled (ACH and other delayed methods: checkout.session.completed with
-- payment_status 'unpaid', or payment_intent.processing). The webhook stamps
-- this column instead of flipping the row to paid; payment_intent.succeeded /
-- checkout.session.async_payment_succeeded flip it paid and clear it;
-- async_payment_failed clears it (the invoice is simply open again).
-- status stays open|paid|void (0086) — a processing invoice is still an OPEN
-- invoice in every existing query; only the surfaces read this column, and the
-- presence function degrades gracefully until this runs (every read retries
-- without the column).
alter table public.presence_invoices add column if not exists processing_since timestamptz;
comment on column public.presence_invoices.processing_since is
  'Oct 2026 benchmark: set when Stripe has accepted a payment that has not settled yet (ACH etc.) — the invoice shows as Processing, not Upcoming/Overdue, and offers no Pay button. Cleared when it settles (status→paid) or fails.';
