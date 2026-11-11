-- APPLY 0149 (production) — The daily domain watch tells the truth (builder list items 132 and 134).
-- Safe to run more than once. Adds five columns to presence_sites and one check; no rows change.
-- Paste into Supabase → SQL Editor → Run, BEFORE the backend deploy that reads them.
alter table public.presence_sites
  add column if not exists domain_lookup_status text,
  add column if not exists cert_state text,
  add column if not exists cert_expires_at timestamptz,
  add column if not exists cert_pending_since timestamptz,
  add column if not exists cert_checked_at timestamptz;
alter table public.presence_sites drop constraint if exists presence_sites_domain_lookup_status_check;
alter table public.presence_sites
  add constraint presence_sites_domain_lookup_status_check
  check (domain_lookup_status is null or domain_lookup_status in ('ok','not_found','failed'));
-- check: select column_name from information_schema.columns where table_schema = 'public' and table_name = 'presence_sites'
--        and column_name in ('domain_lookup_status','cert_state','cert_expires_at','cert_pending_since','cert_checked_at');   -- 5 rows
