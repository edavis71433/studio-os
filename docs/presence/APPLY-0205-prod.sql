-- ===========================================================================
--  APPLY PACK - migration 0205  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships item 208. ADDITIVE and IDEMPOTENT
--  ("add column if not exists"), so it is safe to re-run. Two new, empty
--  columns on presence_publishes: no row changes, no table is rewritten, and it
--  takes well under a second (17 rows on Nov 12).
--
--  Why: builder list item 208. Every publish made every photo again and asked
--  the host about all of them, and a publish or a restore that changed nothing
--  was still a paid deploy (about 10 cents at Netlify). A publish now records
--  the files it sent, so the next one names the photos the live site already
--  has by their digest and sends nothing at all when every file is the same.
--
--  If the deploy goes first, nothing breaks: publishes work as before (every
--  photo made, every deploy sent) until this lands, and the first publish after
--  it fills the list in.
--
--  Rollback (only if ever needed; publishes go back to making every photo):
--    alter table public.presence_publishes drop column if exists deploy_files, drop column if exists unchanged;
--
--  Covers: supabase/migrations/0205_publish_sends_what_changed.sql
-- ===========================================================================

alter table public.presence_publishes
  add column if not exists deploy_files jsonb,
  add column if not exists unchanged boolean not null default false;

comment on column public.presence_publishes.deploy_files is
  'Item 208: every file this publish sent to the host, path to SHA-1. The next publish reuses a photo''s digest and sends nothing when every file matches.';
comment on column public.presence_publishes.unchanged is
  'Item 208: the live site already had exactly these files, so nothing was sent and no deploy was paid for.';


-- Verify (expect two rows: deploy_files jsonb YES, unchanged boolean NO false):
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'presence_publishes' and column_name in ('deploy_files', 'unchanged')
-- order by column_name;
