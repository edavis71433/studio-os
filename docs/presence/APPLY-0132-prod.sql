-- ═══════════════════════════════════════════════════════════════════════════
--  APPLY PACK · migration 0132  (owner-apply, prod)
-- ═══════════════════════════════════════════════════════════════════════════
--  Run this ONCE (Supabase → SQL Editor). ADDITIVE and IDEMPOTENT (add column
--  "if not exists"), so it is safe to re-run. The presence function and the
--  Stripe webhook degrade gracefully until this runs: every read retries
--  without the column, and the webhook never 500-loops on it.
--
--  Why: Oct 2026 benchmark, item 2 — money in four states (Paid · Processing ·
--  Upcoming · Overdue). "Processing" is a payment Stripe has accepted but not
--  settled yet (ACH and other delayed methods). The webhook used to flip such an
--  invoice to paid on checkout.session.completed even when payment_status was
--  unpaid; now it stamps this column, and only payment_intent.succeeded /
--  checkout.session.async_payment_succeeded flip it paid. A processing invoice
--  shows "Processing", offers no Pay button, and the reminder skips it.
--
--  After this: Stripe Dashboard → Developers → Webhooks → the existing endpoint →
--  add events payment_intent.processing, checkout.session.async_payment_succeeded,
--  checkout.session.async_payment_failed. Then run deploy.yml (presence AND
--  stripe-webhook changed).
--
--  Covers: supabase/migrations/0132_invoice_processing.sql
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.presence_invoices add column if not exists processing_since timestamptz;
comment on column public.presence_invoices.processing_since is
  'Oct 2026 benchmark: set when Stripe has accepted a payment that has not settled yet (ACH etc.) — the invoice shows as Processing, not Upcoming/Overdue, and offers no Pay button. Cleared when it settles (status→paid) or fails.';

-- Verify (expect one row):
-- select column_name, data_type from information_schema.columns
--   where table_schema='public' and table_name='presence_invoices' and column_name='processing_since';
