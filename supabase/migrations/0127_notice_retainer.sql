-- ── Notice kinds: retainer dunning + deal to-do/next-step reminders ─────────
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTIONS. Both raises are
-- best-effort and fully swallowed: pre-migration the CHECK rejects the insert,
-- raiseNotice returns false, no email goes out, nothing throws — the features
-- are simply DORMANT until this lands (the 0094–0119 deploy-order posture).
-- Late application loses alerts silently, which is precisely the class of gap
-- these two kinds exist to close — so SQL first.
--
-- WHAT THEY ARE (part of the "the studio must never be silent" pass):
--
--   retainer_status  raised by commerce/retainers.ts applyRetainerSync when a
--                    service retainer's status TRANSITIONS to past_due or
--                    canceled (a care-plan payment failing was previously
--                    invisible outside the deal drawer — no notice, no email).
--                    period = 'retainer:<deal id>:<transition>:w<7-day bucket>'
--                    → send-once within a week even across several Stripe
--                    failed-invoice events; a STILL-past-due retainer may speak
--                    again next week. Recovery (past_due → active) clears every
--                    bucket at once by the 'retainer:<deal id>:' prefix.
--                    The operator email rides the notice's created flag.
--
--   deal_task_due    raised by commerce/lifecycle.ts runDealTaskReminders for
--                    (a) an OPEN presence_deal_tasks row whose due_date is
--                    today or past, and (b) a pipeline deal whose
--                    next_step_at has passed. The dates the owner set finally
--                    remind — nothing ever read either column before.
--                    period = 'dealtask:<task id>:w<n>' / 'nextstep:<deal id>:w<n>'
--                    → weekly re-nudge while overdue; the sweep simply stops
--                    once the to-do is done or the date moves (no teardown
--                    needed — the rows are ordinary dismissible asks).
--
-- Neither joins NOTICE_PROTECTED_KINDS (lib/inbox_feed.ts): retainer_status'
-- resolution happens in Stripe (outside this app) and deal_task_due is the
-- owner's own to-do — an undismissable row with no in-app teardown would be a
-- permanent one (the 0119 rule).
--
-- Properties:
--   • ADDITIVE — the FULL 0119 superset is carried forward verbatim; no kind is
--     ever dropped (an existing row could not satisfy a narrowed constraint).
--     ⚠ If another migration between 0119 and this one also widens this CHECK,
--     merge its kinds into the list below before applying — whichever list is
--     applied LAST is the one that holds.
--   • IDEMPOTENT — `drop constraint if exists` + re-add; re-running is a no-op.
--     No data is written, moved, or deleted.
--   • RLS UNTOUCHED — no policy, grant, owner, or table-level RLS setting is
--     read or changed here.

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
    'invoice_void_paid',
    -- added by 0127 (the never-silent pass):
    'retainer_status','deal_task_due'
  ));

comment on constraint presence_plan_notices_kind_check on public.presence_plan_notices is
  'Notice kinds the code raises. 0127 added retainer_status (a service retainer transitioned to past_due/canceled — applyRetainerSync raises + emails once per transition per week; recovery clears by the retainer:<deal> prefix) and deal_task_due (an open deal to-do past its due_date, or a deal whose next_step_at passed — weekly re-nudge while overdue). Full 0119 superset carried forward — no kind dropped.';

-- rollback: restore the 0119 check (delete any rows with the new kinds first).
--   delete from public.presence_plan_notices where kind in ('retainer_status','deal_task_due');
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
--       'client_message','client_upload','client_request','client_approval',
--       'invoice_void_paid'
--     ));
