-- rollback: alter table public.presence_tasks drop column if exists last_reminded_at;
--           alter table public.presence_surveys drop column if exists last_reminded_at;
--   (with the columns gone, the daily client-reminder step reads nothing and sends nothing;
--    the first "needs something from you" email, which needs no column, still goes out)
--
-- ── A client is reminded about a to-do and a questionnaire (builder list item 336) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. Until it lands, the reminder step
-- is a clean no-op for to-dos and questionnaires (approvals already carry the column
-- from 0135).
--
-- WHY
--   Waiting on a client's photos and words is where a web project stalls, and nothing
--   reminded them. A to-do put to the client, and an unanswered questionnaire, now get a
--   gentle email after 3 days and again after 7 (lib/client_reminders.ts), the same
--   once-per-window gate the approval reminders use: the row's own last_reminded_at,
--   claimed before the send.
--
-- WHAT CHANGES
--   One nullable column on two tables, and a partial index each so the daily step reads
--   only what is still open. Nothing existing changes.
alter table public.presence_tasks add column if not exists last_reminded_at timestamptz;
alter table public.presence_surveys add column if not exists last_reminded_at timestamptz;
create index if not exists presence_tasks_client_remind_idx on public.presence_tasks (created_at)
  where client_action_required = true and client_visible = true and deleted_at is null and status in ('todo', 'in_progress', 'blocked');
create index if not exists presence_surveys_client_remind_idx on public.presence_surveys (created_at)
  where status = 'active' and client_visible = true and deleted_at is null;
