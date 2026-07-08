-- ── Phase RL (FD-R1): lifecycle notices join the plan-notice rail ─────────────
-- The existing presence_plan_notices table (one notice per client/kind/month,
-- calm headline+body, dismissible) gains the subscription-lifecycle kinds. The
-- daily lifecycle sweep raises these + sends the matching emails (send-once via
-- the same unique key). No new tables, no duplicate rails.
alter table public.presence_plan_notices
  drop constraint if exists presence_plan_notices_kind_check;
alter table public.presence_plan_notices
  add constraint presence_plan_notices_kind_check
  check (kind in ('capacity','trial_ending','trial_ended','payment_trouble','account_lapsed'));
-- rollback: restore check (kind in ('capacity')) after deleting non-capacity rows.
