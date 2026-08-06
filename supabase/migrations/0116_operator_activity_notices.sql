-- ── Operator activity notices — the portal's four client actions ────────────
-- Eric (the sole studio operator) gets NO email today when a client acts in the
-- portal: a message, a file upload, a support/service request (opened or
-- replied), an approval decision. The relay is being added on the ONE existing
-- notice model (presence_plan_notices, unique on (client_id, kind, period)) —
-- raiseNotice's created-flag is BOTH the dedupe and the send-once throttle, and
-- it already fires the owner's web push.
--
-- That table's `kind` carries a CHECK constraint whose current superset lives in
-- 0102_email_auth_nudge.sql and contains NONE of the new portal kinds. This
-- migration widens it by exactly four:
--
--   client_message   a client wrote (portal composer OR an emailed-in reply)
--   client_upload    a client sent the studio a file
--   client_request   a client opened a support/service request, or replied on one
--   client_approval  a client approved / requested changes on an approval
--
-- Properties:
--   • ADDITIVE — the FULL 0102 superset is carried forward verbatim; no kind is
--     ever dropped (an existing row could not satisfy a narrowed constraint).
--   • IDEMPOTENT — `drop constraint if exists` + re-add; re-running is a no-op.
--     No data is written, moved, or deleted.
--   • RLS UNTOUCHED — no policy, grant, owner, or table-level RLS setting is
--     read or changed here. presence_plan_notices keeps exactly the policies it
--     has today.
--
-- DEPLOY ORDER — apply this migration BEFORE or WITH the function deploy.
--   Pre-migration, the notices INSERT is rejected by the CHECK constraint,
--   raiseNotice returns false, and — because the email is gated on
--   created===true — NO operator email sends. That is the intended degradation:
--   NO EMAIL, NO CRASH. The client's own action (message, upload, request,
--   approval) still succeeds and still returns its normal 200/201; the notify is
--   fire-and-forget and never surfaces an error to the client. The only cost of
--   a late migration is silent operator mail, recoverable by applying it.

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
    'client_message','client_upload','client_request','client_approval'
  ));

comment on constraint presence_plan_notices_kind_check on public.presence_plan_notices is
  'Notice kinds the code raises. 0116 added the four client-portal operator kinds (client_message, client_upload, client_request, client_approval) — each raised by notifyStudioOfClientAction with period = <thread key>:<15-minute bucket>, so the unique (client_id, kind, period) key is the instant-but-throttled send-once gate. Full 0102 superset carried forward — no kind dropped.';

-- rollback:
--   delete from public.presence_plan_notices where kind in ('client_message','client_upload','client_request','client_approval');
--   -- then restore the 0102 kind check (the same superset without the four client_* kinds).
