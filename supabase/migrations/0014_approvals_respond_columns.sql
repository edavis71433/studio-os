-- rollback: alter table public.approvals drop column if exists responded_at; alter table public.approvals drop column if exists client_feedback;
--
-- 0014: approvals — add the two columns the portal has always written
--
-- WHAT: the portal's approve() and submitRevision() have always sent
--   responded_at (when the client decided) and client_feedback (the client's
--   revision note) — but neither column exists on approvals. Every client
--   approval/revision since launch failed with PGRST204 (400) while the old
--   UI showed success anyway. The RCAT H1/H2 honest-failure fixes surfaced
--   the hidden 400, and the automated live acceptance suite caught it on
--   2026-07-06 ("That didn't go through — nothing was changed").
--
-- WHY additive: matches the code's long-standing intent; no backfill possible
--   (the data was never captured). Nullable, no defaults, zero risk to reads.

alter table public.approvals add column if not exists responded_at timestamptz;
alter table public.approvals add column if not exists client_feedback text;

-- ROLLBACK
-- alter table public.approvals drop column if exists responded_at;
-- alter table public.approvals drop column if exists client_feedback;
