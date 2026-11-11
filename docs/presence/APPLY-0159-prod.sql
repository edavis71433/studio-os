-- ===========================================================================
--  APPLY PACK - migration 0159  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor), BEFORE or WITH the deploy.yml run
--  that ships the site controls. ADDITIVE and IDEMPOTENT ("add column if not
--  exists"), so it is safe to re-run. Nothing existing changes: one empty column
--  on presence_sites, and one column on presence_settings that is on by default,
--  so every site stays public and open to AI assistants exactly as today.
--
--  Why: list item 175. An owner can put a visitor password on the live site
--  (the column records when; the password itself stays with Netlify), and can
--  ask AI assistants not to read the site with one switch in Search.
--
--  If the deploy goes first, nothing breaks: the settings read and save step
--  down without the new column, the switch reads as on, and setting a password
--  says it isn't available yet until the column exists.
--
--  Rollback (only if ever needed):
--    alter table public.presence_sites drop column if exists visitor_password_at;
--    alter table public.presence_settings drop column if exists ai_crawlers;
--
--  Covers: supabase/migrations/0159_site_availability_ai_crawlers.sql
-- ===========================================================================

alter table public.presence_sites
  add column if not exists visitor_password_at timestamptz;

comment on column public.presence_sites.visitor_password_at is
  'List item 175: when a visitor password was put on the live site (Netlify site-wide password). Null = public. The password is never stored here.';

alter table public.presence_settings
  add column if not exists ai_crawlers boolean not null default true;

comment on column public.presence_settings.ai_crawlers is
  'List item 175: let AI assistants read the published site (on by default). Off adds a Disallow group per known AI crawler to robots.txt at the next publish.';

-- Verify (expect 2 rows: visitor_password_at timestamp with time zone, no default;
-- ai_crawlers boolean default true):
-- select table_name, column_name, data_type, column_default from information_schema.columns
--   where table_schema = 'public'
--     and ((table_name = 'presence_sites' and column_name = 'visitor_password_at')
--       or (table_name = 'presence_settings' and column_name = 'ai_crawlers'));
