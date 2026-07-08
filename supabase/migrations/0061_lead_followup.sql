-- ── Phase CRM (FD-CRM1): the un-replied lead follow-up nudge ─────────────────
-- A lead emails the owner once on arrival; if it then sits 'new' for a day,
-- nothing tapped them until the weekly digest. The lifecycle sweep now raises a
-- one-time notice + email per lead on the existing notices rail (period = the
-- lead id → exactly once, ever). No new table — just a new notice kind.
alter table public.presence_plan_notices
  drop constraint if exists presence_plan_notices_kind_check;
alter table public.presence_plan_notices
  add constraint presence_plan_notices_kind_check
  check (kind in ('capacity','trial_ending','trial_ended','payment_trouble','account_lapsed','search_setup','winddown_reminder','win_back','welcome_back','deletion_requested','domain_expiry','lead_followup'));
-- rollback: delete lead_followup rows, then restore the prior kind check.
