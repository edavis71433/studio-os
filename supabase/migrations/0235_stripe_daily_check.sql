-- rollback: drop table if exists public.presence_stripe_checks;
--           alter table public.presence_invoices drop column if exists stripe_checked_at;
--           alter table public.presence_invoices drop column if exists receipt_sent_at;
--   (with them gone, the daily check skips its work and says so in the tick, and a paid
--    invoice's receipt goes out the way it did before: once, with the studio's line)
--
-- ── The daily check against Stripe (sales item 130) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. Until it lands, the check finds
-- nothing to do and the receipt goes out as before.
--
-- WHY
--   Stripe tells Studio OS about each payment, refund and retainer change with a message,
--   and tries for three days when our server doesn't answer. After that the message is
--   gone, and nothing ever asked Stripe again (the Nov 15 2026 Stripe review, finding 4).
--   A paid invoice stayed unpaid and its reminders kept asking a client who had paid; a
--   retainer charge was never recorded; and when the main server was down while the
--   webhook worked, the client's receipt never went out and nothing sent it later.
--
-- WHAT CHANGES
--   presence_invoices.receipt_sent_at: when the client's receipt for an online payment
--   went out. The receipt is sent by whoever claims this first (the paid echo, or the
--   daily check for one the echo missed), so it goes out once. Every invoice already
--   paid is marked handled here, so nothing old is sent again.
--   presence_invoices.stripe_checked_at: when the daily check last asked Stripe whether
--   an open invoice was paid, so each is asked once a day, oldest first, a few a tick.
--   presence_stripe_checks: the same for each retainer (a deal's own row can't carry it:
--   any change to a deal moves its updated_at), and for a receipt being tried again.
--   Only the server reads or writes it.
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
-- deny-all: no policy, so only the server's service role reads or writes it
alter table public.presence_stripe_checks enable row level security;
comment on table public.presence_stripe_checks is
  'Sales item 130: when the daily check last asked Stripe about one retainer (retainer:<deal id>) or last tried a receipt that never went out (receipt:<invoice id>), and what it found: same, fixed (Studio OS was put right), unanswered (Stripe did not answer; asked again next tick).';
