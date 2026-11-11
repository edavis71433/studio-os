-- APPLY 0153 (production) — "Connected" means the domain shows our site (builder list item 134).
-- Safe to run more than once. Adds four columns to presence_sites and one check; no rows change.
-- Paste into Supabase → SQL Editor → Run, BEFORE the backend deploy that reads them.
alter table public.presence_sites
  add column if not exists domain_serving text,
  add column if not exists domain_checks jsonb,
  add column if not exists domain_serving_checked_at timestamptz,
  add column if not exists domain_registered_name text;
alter table public.presence_sites drop constraint if exists presence_sites_domain_serving_check;
alter table public.presence_sites
  add constraint presence_sites_domain_serving_check
  check (domain_serving is null or domain_serving in ('latest','old_copy','other','unreachable'));
-- check: select column_name from information_schema.columns where table_schema = 'public' and table_name = 'presence_sites'
--        and column_name in ('domain_serving','domain_checks','domain_serving_checked_at','domain_registered_name');   -- 4 rows
