-- ===========================================================================
--  APPLY PACK - migration 0155  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor), BEFORE or WITH the deploy.yml run
--  that ships ad tags. ADDITIVE and IDEMPOTENT ("add column if not exists"), so
--  it is safe to re-run. Nothing existing changes: two empty columns on
--  presence_settings, so every site stays exactly as it is today.
--
--  Why: list item 152. An owner who advertises pastes a Google tag ID and a
--  Meta Pixel ID on Connections. The published site then asks visitors about
--  cookies first and loads the tags only for those who say yes; its privacy
--  page says so.
--
--  If the deploy goes first, nothing breaks: the settings read and save step
--  down without these columns, and saving a tag says it didn't save until the
--  columns exist.
--
--  Rollback (only if ever needed):
--    alter table public.presence_settings drop column if exists google_tag_id;
--    alter table public.presence_settings drop column if exists meta_pixel_id;
--
--  Covers: supabase/migrations/0155_ad_tags.sql
-- ===========================================================================

alter table public.presence_settings
  add column if not exists google_tag_id text not null default '';

alter table public.presence_settings
  add column if not exists meta_pixel_id text not null default '';

comment on column public.presence_settings.google_tag_id is
  'List item 152: the Google tag ID (G-, AW-, GT- or DC-) that loads behind the site''s cookie notice. Empty = none.';

comment on column public.presence_settings.meta_pixel_id is
  'List item 152: the Meta Pixel ID that loads behind the site''s cookie notice. Empty = none.';

-- Verify (expect 2 rows, both text with default ''):
-- select column_name, data_type, column_default from information_schema.columns
--   where table_schema = 'public' and table_name = 'presence_settings'
--     and column_name in ('google_tag_id', 'meta_pixel_id');
