-- ===========================================================================
--  APPLY PACK - migration 0184  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE
--  the deploy.yml run that ships the site's own icon. ADDITIVE and
--  IDEMPOTENT ("if not exists"), so it is safe to re-run. Nothing existing
--  changes: one new, optional column on presence_settings.
--
--  Why: builder list item 158. The owner can pick a picture as the site's
--  browser-tab icon instead of the letter in a coloured square.
--
--  Run it first: a restore of a version writes this column back (a version
--  without an icon goes back to the letter), so until it exists a restore fails.
--  Settings itself reads and saves everything else either way.
--
--  Rollback (only if ever needed):
--    alter table public.presence_settings drop column if exists icon_media_id;
--
--  Covers: supabase/migrations/0184_site_icon.sql
-- ===========================================================================

alter table public.presence_settings
  add column if not exists icon_media_id uuid;
comment on column public.presence_settings.icon_media_id is
  'List item 158. The site''s own browser-tab icon (a presence_media id); none = the template''s letter in the site''s colour.';

-- Check: one row, icon_media_id (uuid).
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'presence_settings' and column_name = 'icon_media_id';
