-- ===========================================================================
--  APPLY PACK - migration 0137  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor), BEFORE or WITH the deploy.yml run
--  that ships the review-request switch (PR 140). ADDITIVE and IDEMPOTENT
--  ("add column if not exists"), so it is safe to re-run. Nothing existing
--  changes: two new columns on presence_settings, both with defaults, so every
--  site starts with the switch off.
--
--  Why: list item 29. Settings gets a fourth switch that emails a finished
--  project's client one review request a few days after the project is marked
--  complete (3 by default), once per project.
--
--  If the deploy goes first, nothing breaks: the settings read and save retry
--  without these columns, the new switch reads as off, and the daily job does
--  nothing until they exist.
--
--  Rollback (only if ever needed):
--    alter table public.presence_settings
--      drop column if exists review_requests,
--      drop column if exists review_request_after_days;
--
--  Covers: supabase/migrations/0137_review_request_switch.sql
-- ===========================================================================

alter table public.presence_settings
  add column if not exists review_requests boolean not null default false,
  add column if not exists review_request_after_days integer not null default 3;

comment on column public.presence_settings.review_requests is
  'List item 29: email a project''s client one review request review_request_after_days after the project is marked complete (off by default). Sentence: routes/reviews.ts sendReviewAsk.';
comment on column public.presence_settings.review_request_after_days is
  'Days after a project is marked complete before its review request. 1 to 90, default 3.';

-- Verify (expect 2 rows: review_request_after_days integer default 3,
-- review_requests boolean default false):
-- select column_name, data_type, column_default from information_schema.columns
--   where table_schema = 'public' and table_name = 'presence_settings'
--     and column_name in ('review_requests', 'review_request_after_days')
--   order by column_name;
