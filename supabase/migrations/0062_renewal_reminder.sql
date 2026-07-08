-- ── Phase PP (PP-2 / CP-3.1): the annual renewal heads-up ────────────────────
-- Never surprise a customer with a yearly charge. The lifecycle sweep raises a
-- calm notice + email ~30 days and again ~7 days before an annual renewal, on
-- the existing notices rail (send-once via period = renewal-date:window).
-- One new notice kind; no new table.
alter table public.presence_plan_notices
  drop constraint if exists presence_plan_notices_kind_check;
alter table public.presence_plan_notices
  add constraint presence_plan_notices_kind_check
  check (kind in ('capacity','trial_ending','trial_ended','payment_trouble','account_lapsed','search_setup','winddown_reminder','win_back','welcome_back','deletion_requested','domain_expiry','lead_followup','renewal_reminder'));
-- rollback: delete renewal_reminder rows, then restore the prior kind check.
