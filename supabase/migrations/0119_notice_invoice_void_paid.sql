-- ── Notice kind for money that landed on a WITHDRAWN invoice ────────────────
-- APPLY THIS BEFORE DEPLOYING THE FUNCTIONS. The stripe-webhook insert that
-- raises this notice is best-effort and fully swallowed (a payment must never
-- fail because its echo did), so an un-widened CHECK does not error — it drops
-- the notice SILENTLY. That is precisely the gap this kind exists to close, so a
-- late migration reproduces the bug it fixes. Same ordering rule as 0116 (the
-- portal's operator notices) and 0118 (the deal-event kind for the void itself).
--
-- WHAT IT IS. POST /sales/invoices/:id/void withdraws an invoice raised in error
-- and deactivates its Stripe Payment Link. A client can still pay it two ways:
--
--   · the deactivation silently failed (Stripe said no, or was unreachable —
--     commerce/stripe.ts now reports that, and the deal page says so); or
--   · they already had a Checkout Session open. Deactivating a Payment Link does
--     NOT kill sessions already minted from it, so a client who had the payment
--     page loaded can complete it afterwards.
--
-- When that payment lands, markPresenceInvoicePaid correctly REFUSES to
-- resurrect the row — a void invoice stays void. But until now the only record
-- of that refusal was a console.log and a stripe_payments row, neither of which
-- is in the product: money was taken against an invoice the studio had withdrawn
-- and nothing in the app said so. This migration widens the notice kind CHECK by
-- exactly one so that refusal can raise an operator row on the ONE notice model
-- everything else already uses (bell · Today · Inbox, unique on
-- (client_id, kind, period), period = 'voidpaid:<invoice id>' so a Stripe retry
-- of the same event re-raises nothing):
--
--   invoice_void_paid  a payment arrived on an invoice that was VOIDED. The
--                      invoice is not marked paid; the operator has to decide
--                      whether to refund it in Stripe or re-raise the work.
--
-- No existing kind is honest for this. 'invoice_paid' asserts the opposite —
-- it is rendered as good news that needs nothing (today.html NOTICE_FYI_KINDS,
-- "the payment landed — nothing else to do") — and reusing it would tell the
-- operator a withdrawn invoice had been settled. 'payment_trouble' is the SaaS
-- billing rail and means the STUDIO's own card failed. So the constraint moves
-- rather than the meaning.
--
-- It is deliberately NOT added to NOTICE_PROTECTED_KINDS (lib/inbox_feed.ts):
-- the resolution — refunding in Stripe, or deciding to keep the money and
-- re-raise the invoice — happens outside this application, so nothing here can
-- ever tear the row down. An undismissable row with no automatic teardown is a
-- permanent one, which is the trap `deal_followup`/`invremind:` needed a whole
-- second route to escape. The operator dismisses it when they have handled it.
--
-- Properties:
--   • ADDITIVE — the FULL 0116 superset (which itself carries 0102's forward
--     verbatim) is carried forward unchanged; no kind is ever dropped (an
--     existing row could not satisfy a narrowed constraint).
--   • IDEMPOTENT — `drop constraint if exists` + re-add; re-running is a no-op.
--     No data is written, moved, or deleted.
--   • RLS UNTOUCHED — no policy, grant, owner, or table-level RLS setting is
--     read or changed here. presence_plan_notices keeps exactly the policies it
--     has today.
--
-- DEGRADATION IF APPLIED LATE: the notices INSERT is rejected by the CHECK, the
-- helper swallows it and logs, and the webhook still returns 200 — the payment
-- is processed and recorded in stripe_payments exactly as before, and the
-- invoice still stays void. NO CRASH, NO LOST PAYMENT, just the silent operator
-- gap this closes. Recoverable by applying the migration.

alter table public.presence_plan_notices
  drop constraint if exists presence_plan_notices_kind_check;
alter table public.presence_plan_notices
  add constraint presence_plan_notices_kind_check
  check (kind in (
    'capacity','trial_ending','trial_ended','payment_trouble','account_lapsed',
    'search_setup','winddown_reminder','win_back','welcome_back',
    'deletion_requested','domain_expiry','lead_followup','renewal_reminder',
    'deal_signed','deal_followup','publish_failed','invoice_paid',
    'connection_expired','website_enquiry','approval_decided','new_booking',
    'site_down','support_aging','agreement_renewal',
    'booking_reminder','booking_followup',
    'new_review',
    -- added by 0102:
    'email_auth','apex_drift',
    -- added by 0116 (the client portal's four operator-notifying actions):
    'client_message','client_upload','client_request','client_approval',
    -- added by 0119:
    'invoice_void_paid'
  ));

comment on constraint presence_plan_notices_kind_check on public.presence_plan_notices is
  'Notice kinds the code raises. 0119 added invoice_void_paid — raised by stripe-webhook when a payment lands on an invoice that was VOIDED (the invoice is not flipped to paid; the operator decides whether to refund). period = voidpaid:<invoice id>, so the unique (client_id, kind, period) key makes a Stripe retry a no-op. Full 0116 superset carried forward — no kind dropped.';

-- rollback: restore the 0116 check (delete any rows with the new kind first).
--   delete from public.presence_plan_notices where kind = 'invoice_void_paid';
--   alter table public.presence_plan_notices
--     drop constraint if exists presence_plan_notices_kind_check;
--   alter table public.presence_plan_notices
--     add constraint presence_plan_notices_kind_check
--     check (kind in (
--       'capacity','trial_ending','trial_ended','payment_trouble','account_lapsed',
--       'search_setup','winddown_reminder','win_back','welcome_back',
--       'deletion_requested','domain_expiry','lead_followup','renewal_reminder',
--       'deal_signed','deal_followup','publish_failed','invoice_paid',
--       'connection_expired','website_enquiry','approval_decided','new_booking',
--       'site_down','support_aging','agreement_renewal',
--       'booking_reminder','booking_followup',
--       'new_review',
--       'email_auth','apex_drift',
--       'client_message','client_upload','client_request','client_approval'
--     ));
