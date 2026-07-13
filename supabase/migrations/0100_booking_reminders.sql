-- ── 0100 — Booking reminders + no-show handling (task #164) ──────────────────
-- Native booking (0099) made confirmed appointments but nothing reminded the
-- customer or handled a no-show. The behaviour is SWEEP-DRIVEN (no new route):
--   • runBookingReminders  → a calm, transactional reminder to the CUSTOMER before
--        the slot (day-before + same-day bands), send-once via the ONE notice model.
--   • runBookingFollowups  → after a slot passes and it's still 'confirmed', an
--        OWNER nudge ("mark it done or a no-show") on the ONE notice model. Never
--        auto-marks, never re-messages the customer.
--
-- This migration is the ONLY storage change and is purely ADDITIVE — send-once
-- reuses the notice dedupe (no new column, no reminded_at flag). Two tiny widenings:
--   1. the notice-kind whitelist admits 'booking_reminder' + 'booking_followup'
--      (raiseNotice / the ledger insert are best-effort, so WITHOUT this they fail
--      the CHECK silently and the sweeps no-op — exactly the 0094–0099 trap 0088
--      documented). The customer-reminder rows are stored 'dismissed' (a silent
--      send-once ledger, never a bell card); the follow-up rows are active notices.
--   2. the appointment status set admits 'no_show' so the owner can mark a missed
--      appointment distinctly from 'completed' / 'canceled'.
--
-- OWNER-APPLY (deploy-order-tolerant, mirrors 0094–0099): apply on staging + prod.
-- Until applied, both sweeps run but write nothing (the kind CHECK rejects the
-- ledger/notice insert → no email, no card, no throw) and 'no_show' is unavailable.
-- Additive + idempotent; safe to re-run.

-- 1. Widen the ONE notice model's kind whitelist (keep every prior kind incl. 0099's
--    'new_booking'; add the two booking-lifecycle kinds).
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
    -- added by 0100:
    'booking_reminder','booking_followup'
  ));

-- 2. Admit 'no_show' to the appointment status set (keeps pending/confirmed/
--    canceled/completed). Owner-marked; the sweep never sets it.
alter table public.presence_appointments
  drop constraint if exists presence_appointments_status_check;
alter table public.presence_appointments
  add constraint presence_appointments_status_check
  check (status in ('pending','confirmed','canceled','completed','no_show'));

comment on constraint presence_plan_notices_kind_check on public.presence_plan_notices is
  'Notice kinds the code raises. 0100 added booking_reminder (silent send-once ledger for customer reminders) + booking_followup (owner no-show/completion nudge).';

-- rollback:
--   delete from public.presence_plan_notices where kind in ('booking_reminder','booking_followup');
--   update public.presence_appointments set status = 'canceled' where status = 'no_show';
--   -- then restore the 0099 kind check + the 4-value appointment status check.
