-- ═══════════════════════════════════════════════════════════════════════════
--  APPLY PACK · migration 0131  (owner-apply, prod)
-- ═══════════════════════════════════════════════════════════════════════════
--  Run this ONCE (Supabase → SQL Editor). ADDITIVE and IDEMPOTENT (add column
--  "if not exists", create index "if not exists"), so it is safe to re-run.
--  The presence function degrades gracefully until this runs: the assets read
--  retries without the column, the website picker retries without the filter,
--  and the "Private to this client" switch answers "needs the database update".
--
--  Why: Oct 2026 UX review, gap 4 — client-private files. A file a client sent
--  the studio (login screenshots, credentials, drafts) can be marked private to
--  that client: out of the shared library views and the site's image picker,
--  shown only under that client's filter and on their record.
--
--  Covers: supabase/migrations/0131_media_client_private.sql
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.presence_media add column if not exists client_private boolean not null default false;
create index if not exists presence_media_client_private_idx
  on public.presence_media (site_id) where client_private;
comment on column public.presence_media.client_private is
  'Oct 2026 review: true = this file is private to the client it was delivered for — hidden from the shared library views and the site picker; visible only under that client''s filter and on their record.';

-- Verify (expect one row):
-- select column_name, column_default from information_schema.columns
--   where table_schema='public' and table_name='presence_media' and column_name='client_private';
