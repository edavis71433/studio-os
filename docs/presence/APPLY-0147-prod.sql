-- APPLY 0147 (production) — Notifications per site (builder list item 47).
-- Safe to run more than once. Widens one check; no rows change.
-- Paste into Supabase → SQL Editor → Run.
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
    'email_auth','apex_drift',
    'client_message','client_upload','client_request','client_approval',
    'invoice_void_paid',
    'retainer_status','deal_task_due',
    'studio_published',
    'approval_overdue',
    'invoice_upcoming',
    'site_published','traffic_spike'
  ));
comment on constraint presence_plan_notices_kind_check on public.presence_plan_notices is
  'Notice kinds the code raises. 0147 added site_published (a publish finished, period pub:<id>) and traffic_spike (a busy day, period day:<date>), both updates the studio bell lists per site. Full 0145 superset carried forward — no kind dropped.';

-- Check: the constraint names both new kinds.
select position('site_published' in pg_get_constraintdef(oid)) > 0 as site_published_ok,
       position('traffic_spike' in pg_get_constraintdef(oid)) > 0 as traffic_spike_ok
from pg_constraint where conname = 'presence_plan_notices_kind_check';
