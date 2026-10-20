-- ═══════════════════════════════════════════════════════════════════════════
--  APPLY PACK · migration 0133  (owner-apply, prod)
-- ═══════════════════════════════════════════════════════════════════════════
--  Run this ONCE (Supabase → SQL Editor), BEFORE or WITH the deploy.yml run
--  that ships the presence function. ADDITIVE and IDEMPOTENT (drop constraint
--  "if exists" + re-add), so it is safe to re-run. The function degrades
--  honestly until this runs: an 'operator' write the old CHECK rejects is
--  retried as 'staff' (still the studio's hand), and the client notice stays
--  dormant.
--
--  Why: Studio audit (Oct 2026) change 2 — speak as the studio when acting for
--  a client. An agency operator's publish for a client was recorded as the
--  CLIENT's ('client'), so the client's room said "published by you"; the
--  client was never told. Now: actor_kind 'operator', room says "published by
--  your studio", and a dismissible "Your studio published a change" notice
--  reaches the client.
--
--  Covers: supabase/migrations/0133_actor_kind_operator.sql
-- ═══════════════════════════════════════════════════════════════════════════

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
    'email_auth','apex_drift',
    'client_message','client_upload','client_request','client_approval',
    'invoice_void_paid',
    'retainer_status','deal_task_due',
    'studio_published'
  ));

comment on constraint presence_plan_notices_kind_check on public.presence_plan_notices is
  'Notice kinds the code raises. 0133 added studio_published (the client''s studio published for them — routes/publish.ts raises one dismissible row per operator publish, period pub:<publish id>). Full 0127 superset carried forward — no kind dropped.';

-- Verify (expect three rows, each listing 'operator'):
-- select conrelid::regclass as table_name, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conname in ('presence_snapshots_created_by_kind_check','presence_publishes_actor_kind_check','presence_change_events_actor_kind_check');
-- Verify (expect one row whose definition contains 'studio_published'):
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'presence_plan_notices_kind_check';
