-- ============================================================================
--  SCHEDULER TRACKING COLUMNS
--  Run once in Supabase -> SQL Editor. Safe to run more than once.
-- ============================================================================
-- WHY
--   The scheduled job (run_scheduled_jobs in the Edge Function) needs to remember
--   what it has already sent, or it will re-send the same nudge/survey every time
--   it runs. These columns are those memory flags. All nullable, all default null.
--
--   Nothing here is destructive. It only ADDS columns.
-- ============================================================================

-- When the project was marked launched/complete (you may already set this from
-- the admin "Mark as launched" button; the column is added here if missing).
alter table public.clients add column if not exists launched_at timestamptz;

-- When the post-launch satisfaction survey + review request was sent by the
-- scheduler. Null = not sent yet. Set once, never re-sent.
alter table public.clients add column if not exists survey_sent_at timestamptz;

-- Content-collection nudge tracking.
--   content_due_at: the date you told the client their materials are due (set from
--                   the admin hub). The scheduler nudges as this approaches/passes.
--   content_received_at: set when you confirm their content is in. Once set, the
--                   scheduler stops nudging for this client.
--   last_content_nudge_at: the last time a content nudge went out, so we space them.
alter table public.clients add column if not exists content_due_at timestamptz;
alter table public.clients add column if not exists content_received_at timestamptz;
alter table public.clients add column if not exists last_content_nudge_at timestamptz;

-- Optional: a per-client master switch to silence all automated emails to them
-- (useful for a sensitive client or a paused project). Null/false = automation on.
alter table public.clients add column if not exists automation_paused boolean default false;

-- Make sure the service role can read/write these (it already can on clients,
-- but this is harmless and explicit).
grant select, update on public.clients to service_role;
