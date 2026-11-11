-- APPLY 0169 (production) — A restore brings back sections, pages and the menu (builder list item 187).
-- Safe to run more than once. One new column on the kept versions; nothing existing changes.
alter table public.presence_snapshots add column if not exists draft_settings jsonb;
comment on column public.presence_snapshots.draft_settings is
  'Builder item 187. The website''s settings (lib/site_roles.ts SETTINGS_CONTENT_FIELDS: blocks, pages, nav, header and footer choices, logo/cover/share media ids, announcement, page search settings) exactly as the draft stored them when this snapshot was taken, for restore-to-draft and checkpoint restores. NULL = taken before 0169; a restore rebuilds them from content.';

-- Check: the column exists, as jsonb.
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'presence_snapshots' and column_name = 'draft_settings';
