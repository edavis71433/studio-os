-- rollback: re-run the presence_plan_notices_kind_check block of supabase/migrations/0250_invoice_settings_costs.sql (the list without the three kinds below); delete any notices of those kinds first
--
-- ── Three new kinds of notice (builder list items 391, 393 and 395) ──
-- APPLY BEFORE THE RELEASE THAT SHIPS THEM (the release refuses to go out until production's
-- change ledger has this number). Until it lands the notices below aren't written (the
-- check refuses them); nothing else breaks.
--
-- WHAT CHANGES
--   The notice kinds' check carries 0250's whole list forward, plus:
--     auto_reply_ceiling  a site sent its 200 automatic replies for the day (item 391)
--     email_not_sent      a money, sign-in or agreement email couldn't be sent after a day of
--                         tries, or its address is on the do-not-email list now (item 393)
--     upload_refused      a file that wasn't what it said it was, taken out of Files (item 395)
--   Nothing is removed from the list.

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
