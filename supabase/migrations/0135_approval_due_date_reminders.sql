-- rollback: alter table public.presence_approvals drop column if exists due_date;
--   alter table public.presence_approvals drop column if exists last_reminded_at;
--   drop index if exists public.presence_approvals_due_idx;
--   and restore the 0133 notice-kind check after
--   delete from public.presence_plan_notices where kind = 'approval_overdue';
--
-- ── Approval per deliverable, with reminders (studio audit, Oct 2026, change 8) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. The function degrades
-- honestly until it lands: an approval insert that the old table rejects for
-- `due_date` (PGRST204) is retried without it (the request still lands, just
-- undated); every approvals read retries without the column; the reminder
-- sweep's filter 400s on the missing column and the sweep is a clean no-op;
-- the overdue notice is a best-effort raise that stays dormant.
--
-- WHAT CHANGES
--   1. presence_approvals.due_date (date, null): when the studio would like the
--      client's answer. Optional — an undated approval behaves exactly as before
--      (no reminder, ever). Carried in the "Needs your OK — {title}" email and
--      drawn as "due {date}" on both records.
--   2. presence_approvals.last_reminded_at (timestamptz, null): the reminder
--      sweep's once-per-day gate (commerce/lifecycle.runApprovalReminders): the
--      client is emailed the day before due_date and daily once overdue, never
--      twice in one UTC day. Stamped BEFORE the send (the row is the gate — a
--      parallel tick cannot double-send; a failed send costs one day, never a
--      duplicate).
--   3. presence_plan_notices.kind accepts 'approval_overdue': one dismissible
--      row to the STUDIO when a client-visible approval goes past its due date
--      (period 'approval:<project id>:<approval id>', once per approval; the
--      bell deep-links the project).
--
-- Properties:
--   • ADDITIVE — nullable columns, no default, no backfill; every existing row
--     stays valid. The FULL 0133 notice-kind superset is carried forward
--     verbatim. ⚠ If another migration between 0133 and this one also widens
--     the notice CHECK, merge its kinds into the list below before applying —
--     whichever list is applied LAST is the one that holds.
--   • IDEMPOTENT — `add column if not exists`, `create index if not exists`,
--     `drop constraint if exists` + re-add; re-running is a no-op.
--   • RLS UNTOUCHED — no policy, grant, owner, or table-level RLS setting is
--     read or changed here.

alter table public.presence_approvals add column if not exists due_date date;
alter table public.presence_approvals add column if not exists last_reminded_at timestamptz;

comment on column public.presence_approvals.due_date is
  'Studio audit change 8 (0135): when the studio would like the client''s answer. Null = no date, no reminder. Carried in the request email and drawn as "due {date}" on both records.';
comment on column public.presence_approvals.last_reminded_at is
  'Studio audit change 8 (0135): the reminder sweep''s once-per-UTC-day gate (lifecycle.runApprovalReminders) — stamped before the send so a parallel tick can never double-remind.';

-- the sweep's exact read: pending, client-visible, dated, due by tomorrow
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
    'approval_overdue'
  ));

comment on constraint presence_plan_notices_kind_check on public.presence_plan_notices is
  'Notice kinds the code raises. 0135 added approval_overdue (a client-visible approval passed its due date — commerce/lifecycle.runApprovalReminders raises one dismissible row per approval, period approval:<project id>:<approval id>). Full 0133 superset carried forward — no kind dropped.';
