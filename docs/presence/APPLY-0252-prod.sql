-- ===========================================================================
--  APPLY PACK - migration 0252  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships the client reminders. ADDITIVE and
--  IDEMPOTENT ("if not exists"), so it is safe to re-run. Nothing existing
--  changes: one nullable column on two tables, and a partial index on each.
--
--  Why: builder list item 336. A to-do put to a client and an unanswered
--  questionnaire get a gentle email after 3 days and again after 7; the column
--  is the once-per-window gate (the same one approvals have had since 0135).
--
--  If the deploy goes first, nothing breaks: the daily reminder step reads the
--  missing column, gets a refusal, and sends nothing for those two kinds.
--
--  Rollback (only if ever needed):
--    alter table public.presence_tasks drop column if exists last_reminded_at;
--    alter table public.presence_surveys drop column if exists last_reminded_at;
--
--  Covers: supabase/migrations/0252_client_reminders.sql
-- ===========================================================================

alter table public.presence_tasks add column if not exists last_reminded_at timestamptz;
alter table public.presence_surveys add column if not exists last_reminded_at timestamptz;
create index if not exists presence_tasks_client_remind_idx on public.presence_tasks (created_at)
  where client_action_required = true and client_visible = true and deleted_at is null and status in ('todo', 'in_progress', 'blocked');
create index if not exists presence_surveys_client_remind_idx on public.presence_surveys (created_at)
  where status = 'active' and client_visible = true and deleted_at is null;
