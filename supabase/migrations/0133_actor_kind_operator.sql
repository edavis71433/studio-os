-- rollback: restore the 0015 actor_kind / created_by_kind checks (client,staff,system)
--   after rewriting rows: update … set actor_kind='staff' where actor_kind='operator';
--   and restore the 0127 notice-kind check after
--   delete from public.presence_plan_notices where kind = 'studio_published';
--
-- ── Speak as the studio when acting for a client (studio audit, Oct 2026, change 2) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTIONS. The function degrades
-- honestly until it lands: an 'operator' write that the old CHECK rejects
-- (23514) is retried as 'staff' — still the studio's hand — and the client
-- notice is a best-effort raise that simply stays dormant (the 0094–0131
-- deploy-order posture). Nothing throws, no publish fails on attribution.
--
-- WHAT CHANGES
--   1. presence_snapshots.created_by_kind, presence_publishes.actor_kind and
--      presence_change_events.actor_kind accept 'operator': an AGENCY MEMBER
--      acting inside a client's scope (?client= → x-dds-scope-site, authorised
--      by lib/scope.ts). Before this every non-staff caller was written as
--      'client', so the client's room read "published by you" for a publish
--      their studio made. 'staff' stays the platform's own hand; 'client' the
--      owner's; 'system' the scheduler's. (presence_connection_events already
--      speaks customer|operator|system — migration 0038 — and needs no change.)
--   2. presence_plan_notices.kind accepts 'studio_published': raised by
--      routes/publish.ts after an OPERATOR publish for the client's site —
--      headline "Your studio published a change", one dismissible row per
--      publish (period 'pub:<publish id>', no teardown). Not raised for the
--      owner's own publishes.
--
-- Properties:
--   • ADDITIVE — every existing value stays valid; the FULL 0127 notice-kind
--     superset is carried forward verbatim. ⚠ If another migration between 0127
--     and this one also widens the notice CHECK, merge its kinds into the list
--     below before applying — whichever list is applied LAST is the one that holds.
--   • IDEMPOTENT — `drop constraint if exists` + re-add; re-running is a no-op.
--     No data is written, moved, or deleted.
--   • RLS UNTOUCHED — no policy, grant, owner, or table-level RLS setting is
--     read or changed here.

alter table public.presence_snapshots
  drop constraint if exists presence_snapshots_created_by_kind_check;
alter table public.presence_snapshots
  add constraint presence_snapshots_created_by_kind_check
  check (created_by_kind in ('client','staff','operator','system'));

alter table public.presence_publishes
  drop constraint if exists presence_publishes_actor_kind_check;
alter table public.presence_publishes
  add constraint presence_publishes_actor_kind_check
  check (actor_kind in ('client','staff','operator','system'));

alter table public.presence_change_events
  drop constraint if exists presence_change_events_actor_kind_check;
alter table public.presence_change_events
  add constraint presence_change_events_actor_kind_check
  check (actor_kind in ('client','staff','operator','system'));

comment on column public.presence_publishes.actor_kind is
  'Who published: client (the owner), staff (the platform), operator (the client''s studio — an agency member scoped into the client, 0133), system (the scheduler). The client''s room reads staff/operator as "published by your studio".';

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
    'studio_published'
  ));

comment on constraint presence_plan_notices_kind_check on public.presence_plan_notices is
  'Notice kinds the code raises. 0133 added studio_published (the client''s studio published for them — routes/publish.ts raises one dismissible row per operator publish, period pub:<publish id>). Full 0127 superset carried forward — no kind dropped.';
