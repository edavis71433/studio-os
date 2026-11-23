-- ===========================================================================
--  APPLY PACK - migration 0270  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE the
--  deploy.yml run that ships builder items 391, 393 and 395 (the release refuses to go
--  out until the change ledger has 0270). IDEMPOTENT (the check is dropped and re-added),
--  safe to re-run. Order with its siblings: 0268, then 0269, then 0270.
--
--  Why: three new kinds of notice need room in presence_plan_notices' kind check:
--    auto_reply_ceiling  a site sent its 200 automatic replies for the day (item 391)
--    email_not_sent      an important email couldn't be sent after a day of tries (item 393)
--    upload_refused      a file that wasn't what it said it was, taken out of Files (item 395)
--  0250's whole list is carried forward; nothing is removed.
--
--  Check first that the editor's top bar says davis-digital-studio (production).
--
--  Rollback (only if ever needed): delete notices of the three kinds, then re-run the
--  presence_plan_notices_kind_check block of docs/presence/APPLY-0250-prod.sql.
--
--  Covers: supabase/migrations/0270_notice_kinds_safety.sql
-- ===========================================================================

alter table public.presence_plan_notices drop constraint if exists presence_plan_notices_kind_check;
alter table public.presence_plan_notices add constraint presence_plan_notices_kind_check
  check (kind in (
    'capacity','trial_ending','trial_ended','payment_trouble','account_lapsed',
    'search_setup','winddown_reminder','win_back','welcome_back',
    'deletion_requested','domain_expiry','lead_followup','renewal_reminder',
    'deal_signed','deal_followup','publish_failed','invoice_paid',
    'connection_expired','website_enquiry','approval_decided','new_booking',
    'site_down','support_aging','agreement_renewal',
    'booking_reminder','booking_followup',
    'new_review',
    'email_auth','apex_drift',
    'client_message','client_upload','client_request','client_approval',
    'invoice_void_paid',
    'retainer_status','deal_task_due',
    'studio_published',
    'approval_overdue',
    'invoice_upcoming',
    -- added by builder item 47 (the studio bell's site notices):
    'site_published','traffic_spike',
    -- added by 0250:
    'client_said_paid',
    -- added by 0270 (builder items 391, 393, 395):
    'auto_reply_ceiling','email_not_sent','upload_refused'
  ));

select public.presence_ledger_note(270, 'notice_kinds_safety');

-- Verify right away (expect: true):
-- select pg_get_constraintdef(oid) like '%upload_refused%' from pg_constraint where conname = 'presence_plan_notices_kind_check';
