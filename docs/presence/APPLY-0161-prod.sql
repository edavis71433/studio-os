-- APPLY 0161 (production) — One calm pop-up per site (builder list item 148).
-- Safe to run more than once. One new column on site settings, empty (off) for every
-- site; nothing existing changes. Paste into Supabase → SQL Editor → Run.
alter table public.presence_settings add column if not exists popup jsonb;

-- Check: one row (popup, jsonb).
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'presence_settings' and column_name = 'popup';
