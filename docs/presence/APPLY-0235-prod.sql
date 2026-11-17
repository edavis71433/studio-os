-- ===========================================================================
--  APPLY PACK - migration 0235  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships the daily check against Stripe. ADDITIVE
--  and IDEMPOTENT ("if not exists", "is null"), so it is safe to re-run.
--
--  Why: sales item 130. Once a day Studio OS asks Stripe about each open invoice
--  and each retainer, so a message from Stripe that never arrived is caught: an
--  invoice paid in Stripe gets marked paid, a retainer's state and charges are
--  put right, and a receipt that never went out is sent.
--
--  What changes: two new columns on presence_invoices (receipt_sent_at, set now on
--  every invoice already paid so no old receipt is sent again; stripe_checked_at,
--  when the check last asked about an open one), and one small new table only the
--  server uses (presence_stripe_checks: when each retainer was last checked).
--  Nothing else changes.
--
--  Run the UPDATE once more right after the deploy finishes: an invoice paid
--  online between this pack and the deploy got its receipt from the old code,
--  which doesn't mark it, and the second run marks it so it isn't sent twice.
--
--  If the deploy goes first, nothing breaks: the check finds nothing to do, and
--  receipts go out as before.
--
--  Rollback (only if ever needed):
--    drop table if exists public.presence_stripe_checks;
--    alter table public.presence_invoices drop column if exists stripe_checked_at;
--    alter table public.presence_invoices drop column if exists receipt_sent_at;
--
--  Covers: supabase/migrations/0235_stripe_daily_check.sql
-- ===========================================================================

alter table public.presence_invoices add column if not exists receipt_sent_at timestamptz;
update public.presence_invoices
   set receipt_sent_at = coalesce(paid_at, updated_at, now())
 where status = 'paid' and receipt_sent_at is null;
comment on column public.presence_invoices.receipt_sent_at is
  'Sales item 130: when the client''s receipt for an online payment went out (claimed before sending, so it goes once). Null on a paid invoice = not sent yet; the daily check (commerce/stripe_check.ts) sends it within three days.';
alter table public.presence_invoices add column if not exists stripe_checked_at timestamptz;
comment on column public.presence_invoices.stripe_checked_at is
  'Sales item 130: when the daily check last asked Stripe whether this open invoice was paid (once a day each, oldest first).';

create table if not exists public.presence_stripe_checks (
  subject text primary key,
  checked_at timestamptz not null default now(),
  outcome text not null default 'same',
  constraint presence_stripe_checks_subject_len check (char_length(subject) between 3 and 120),
  constraint presence_stripe_checks_outcome_check check (outcome in ('same', 'fixed', 'unanswered'))
);
alter table public.presence_stripe_checks enable row level security;
comment on table public.presence_stripe_checks is
  'Sales item 130: when the daily check last asked Stripe about one retainer (retainer:<deal id>) or last tried a receipt that never went out (receipt:<invoice id>), and what it found: same, fixed (Studio OS was put right), unanswered (Stripe did not answer; asked again next tick).';


-- Verify (expect: two rows, both timestamp with time zone; then 0; then one row, true; then 0):
-- select column_name, data_type from information_schema.columns where table_name = 'presence_invoices' and column_name in ('receipt_sent_at', 'stripe_checked_at');
-- select count(*) from public.presence_invoices where status = 'paid' and receipt_sent_at is null;
-- select relrowsecurity from pg_class where relname = 'presence_stripe_checks';
-- select count(*) from public.presence_stripe_checks;
