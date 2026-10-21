-- ═══════════════════════════════════════════════════════════════════════════
--  APPLY PACK · migration 0134  (owner-apply, prod)
-- ═══════════════════════════════════════════════════════════════════════════
--  Run this ONCE (Supabase → SQL Editor), BEFORE or WITH the deploy.yml run
--  that ships the presence function. ADDITIVE and IDEMPOTENT (add column
--  "if not exists", create index "if not exists", drop constraint "if exists"
--  + re-add), so it is safe to re-run. The function degrades honestly until
--  this runs: an approval request that names a due date is stored without it,
--  every approvals read retries without the column, the reminder sweep is a
--  clean no-op, and the overdue notice stays dormant.
--
--  Why: Studio audit (Oct 2026) change 8 — approval per deliverable, with
--  reminders. The studio can ask the client to approve a specific shared file
--  (and set a date for the answer); the client decides on that file's row;
--  the client is reminded the day before and daily once overdue, at most once a
--  day; the studio gets one dismissible notice when an approval goes overdue.
--
--  Covers: supabase/migrations/0134_approval_due_date_reminders.sql
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.presence_approvals add column if not exists due_date date;
alter table public.presence_approvals add column if not exists last_reminded_at timestamptz;

comment on column public.presence_approvals.due_date is
  'Studio audit change 8 (0134): when the studio would like the client''s answer. Null = no date, no reminder. Carried in the request email and drawn as "due {date}" on both records.';
comment on column public.presence_approvals.last_reminded_at is
  'Studio audit change 8 (0134): the reminder sweep''s once-per-UTC-day gate (lifecycle.runApprovalReminders) — stamped before the send so a parallel tick can never double-remind.';

create index if not exists presence_approvals_due_idx
  on public.presence_approvals (due_date)
  where deleted_at is null and status = 'pending' and client_visible = true and due_date is not null;

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
    'approval_overdue'
  ));

comment on constraint presence_plan_notices_kind_check on public.presence_plan_notices is
  'Notice kinds the code raises. 0134 added approval_overdue (a client-visible approval passed its due date — commerce/lifecycle.runApprovalReminders raises one dismissible row per approval, period approval:<project id>:<approval id>). Full 0133 superset carried forward — no kind dropped.';

-- Verify (expect two rows: due_date date, last_reminded_at timestamp with time zone):
-- select column_name, data_type from information_schema.columns
--   where table_schema = 'public' and table_name = 'presence_approvals'
--     and column_name in ('due_date','last_reminded_at') order by column_name;
-- Verify (expect one row whose definition contains 'approval_overdue'):
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'presence_plan_notices_kind_check';
-- Verify (expect one row):
-- select indexname from pg_indexes where schemaname = 'public' and indexname = 'presence_approvals_due_idx';
