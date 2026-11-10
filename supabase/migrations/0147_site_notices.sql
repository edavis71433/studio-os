-- 0147 — Notifications per site (builder list item 47, Nov 2026)
-- Two new notice kinds on the ONE notice model (presence_plan_notices):
--   site_published  a site's publish finished (any actor, including a scheduled one):
--                   "Published 3 changes", period pub:<publish id>, an update, no push
--   traffic_spike   yesterday had about three times a usual day's visitors:
--                   period day:<YYYY-MM-DD>, an update, no push (ops/traffic_spikes.ts)
-- The studio's bell lists these across every client site, each naming the site.
-- Full 0145 superset carried forward — no kind dropped.
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
    'retainer_status','deal_task_due',
    -- added by 0133 (speak as the studio when acting for a client):
    'studio_published',
    -- added by 0135 (approval per deliverable, with reminders):
    'approval_overdue',
    -- added by 0145 (a recurring invoice goes out in three days):
    'invoice_upcoming',
    -- added by 0147 (notifications per site):
    'site_published','traffic_spike'
  ));

comment on constraint presence_plan_notices_kind_check on public.presence_plan_notices is
  'Notice kinds the code raises. 0147 added site_published (a publish finished, period pub:<id>) and traffic_spike (a busy day, period day:<date>), both updates the studio bell lists per site. Full 0145 superset carried forward — no kind dropped.';

-- rollback (delete the new kinds' rows first):
--   delete from public.presence_plan_notices where kind in ('site_published','traffic_spike');
--   restore the 0145 notice check (copy it from that file).
