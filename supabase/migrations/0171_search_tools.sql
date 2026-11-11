-- rollback: alter table public.presence_settings drop constraint if exists presence_settings_llms_txt_len;
--           alter table public.presence_settings drop column if exists llms_txt;
--           alter table public.presence_settings drop column if exists search_hidden;
--
-- ── The Search tab's tools: Hide from search and llms.txt (builder list item 124) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. Until it lands, Settings reads
-- and saves everything else (routes/content.ts steps down one pack at a time) and
-- the two tools say they aren't ready.
--
-- WHAT CHANGES
--   presence_settings.search_hidden (boolean, default false): when true, the next
--     publish has every page ask search engines not to list it (noindex). robots.txt
--     stays open: a search engine has to read a page to see its noindex.
--   presence_settings.llms_txt (text, null, at most 4,000 characters): the owner's
--     llms.txt for AI tools, written at /llms.txt on the next publish. Null means none.
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
