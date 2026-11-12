-- ===========================================================================
--  APPLY PACK - migration 0171  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships the new Search tab. ADDITIVE and IDEMPOTENT
--  ("if not exists", the check dropped and added again), so it is safe to re-run.
--  Nothing existing changes: two new settings columns, off and empty.
--
--  Why: builder list item 124. The Search tab's row of tools gets "Hide from
--  search" and an editable llms.txt for AI tools.
--
--  If the deploy goes first, nothing breaks: Settings steps down without the two
--  columns and the two tools say they aren't ready yet.
--
--  Rollback (only if ever needed):
--    alter table public.presence_settings drop constraint if exists presence_settings_llms_txt_len;
--    alter table public.presence_settings drop column if exists llms_txt;
--    alter table public.presence_settings drop column if exists search_hidden;
--
--  Covers: supabase/migrations/0171_search_tools.sql
-- ===========================================================================

alter table public.presence_settings
  add column if not exists search_hidden boolean not null default false;

alter table public.presence_settings
  add column if not exists llms_txt text;

alter table public.presence_settings drop constraint if exists presence_settings_llms_txt_len;
alter table public.presence_settings
  add constraint presence_settings_llms_txt_len check (llms_txt is null or char_length(llms_txt) <= 4000);

comment on column public.presence_settings.search_hidden is
  'List item 124: true when the owner hid the site from search engines; every published page then says noindex.';
comment on column public.presence_settings.llms_txt is
  'List item 124: the owner''s llms.txt for AI tools, published at /llms.txt. Null means none.';


-- Verify (expect two rows: search_hidden boolean default false, llms_txt text):
-- select column_name, data_type, column_default from information_schema.columns
--   where table_schema = 'public' and table_name = 'presence_settings' and column_name in ('search_hidden', 'llms_txt');
