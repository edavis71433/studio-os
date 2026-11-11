-- 0149 — The daily domain watch tells the truth (builder list items 132 and 134, Nov 2026 review)
-- Five columns on presence_sites, written once a day by commerce/lifecycle.ts runDomainWatch:
--   domain_lookup_status  how the registration lookup went: ok · not_found · failed. The
--                         lookup now asks under the REGISTERED name ("www." dropped); the
--                         Domains page says "couldn't read this domain's record" instead
--                         of a quiet "Not known yet" when it fails (item 132).
--   cert_state            Netlify's word for the padlock (issued · renewed · pending · none …)
--   cert_expires_at       when the padlock ends: the Domains page shows it, and Home asks
--                         when it is under 14 days (item 134, review finding 20).
--   cert_pending_since    since when the records have been right with no padlock on; the
--                         watch asks Netlify again each day, and Home asks after a day
--                         (item 134, review finding 4).
--   cert_checked_at       when the padlock was last looked at.
-- Nothing is backfilled: the next daily check fills each site in.
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
-- rollback: alter table public.presence_sites drop constraint if exists presence_sites_domain_lookup_status_check,
--   drop column if exists domain_lookup_status, drop column if exists cert_state, drop column if exists cert_expires_at,
--   drop column if exists cert_pending_since, drop column if exists cert_checked_at;
