-- APPLY 0162 (production) — The Domains page does things (builder list item 162).
-- Safe to run more than once. Adds four columns to presence_sites; no rows change.
-- Paste into Supabase → SQL Editor → Run, BEFORE the backend deploy that reads them.
alter table public.presence_sites
  add column if not exists domain_lock boolean,
  add column if not exists domain_dns_host text,
  add column if not exists domain_statuses jsonb,
  add column if not exists domain_registered_at timestamptz;
-- check: select column_name from information_schema.columns where table_schema = 'public' and table_name = 'presence_sites'
--        and column_name in ('domain_lock','domain_dns_host','domain_statuses','domain_registered_at');   -- 4 rows
