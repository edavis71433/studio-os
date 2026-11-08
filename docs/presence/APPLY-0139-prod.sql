-- ===========================================================================
--  APPLY PACK - migration 0139  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor), BEFORE or WITH the deploy.yml run
--  that ships the visit counter switch. ADDITIVE and IDEMPOTENT ("add column if
--  not exists"), so it is safe to re-run. Nothing existing changes: one new
--  column on presence_settings, default on, so every site keeps counting visits
--  exactly as today.
--
--  Why: list item 61. Every published site's privacy page now describes the
--  site's own visit counter truthfully, and the owner gets a switch in Business
--  details to turn the counter off. The privacy page follows the switch.
--
--  If the deploy goes first, nothing breaks: the settings read and save step
--  down without this column, the switch reads as on, and turning it off says
--  "That didn't save" until the column exists.
--
--  Rollback (only if ever needed):
--    alter table public.presence_settings drop column if exists visit_counter;
--
--  Covers: supabase/migrations/0139_visit_counter_switch.sql
-- ===========================================================================

alter table public.presence_settings
  add column if not exists visit_counter boolean not null default true;

comment on column public.presence_settings.visit_counter is
  'List item 61: count visits on the published site with the first-party counter (on by default). The privacy page reads the same switch.';

-- Verify (expect 1 row: visit_counter boolean default true):
-- select column_name, data_type, column_default from information_schema.columns
--   where table_schema = 'public' and table_name = 'presence_settings'
--     and column_name = 'visit_counter';
