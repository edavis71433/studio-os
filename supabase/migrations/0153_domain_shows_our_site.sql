-- 0153 — "Connected" means the domain shows our site, and both names are checked
-- (builder list item 134, Nov 2026 review, domains findings 3 and 5).
-- Four columns on presence_sites, written once a day by commerce/lifecycle.ts runDomainWatch:
--   domain_serving             what the home page at the domain is, compared byte for byte
--                              with the home page at the site's own hosting address:
--                              latest · old_copy (Netlify, but not this deploy: another
--                              project or a cache) · other (a parking page, an old host,
--                              a proxy) · unreachable. "Connected" now needs "latest".
--   domain_checks              the checklist the client's sheet and the Domains page show:
--                              [{ key, ok, words }] — each name points here, no old record is
--                              left over, the padlock covers both names, what it shows.
--   domain_serving_checked_at  when that was last looked at.
--   domain_registered_name     the registered name the lookup found, which tells a "www."
--                              twin from a sub-name (shop.example.com has none).
-- Nothing is backfilled: the next daily check fills each site in.
alter table public.presence_sites
  add column if not exists domain_serving text,
  add column if not exists domain_checks jsonb,
  add column if not exists domain_serving_checked_at timestamptz,
  add column if not exists domain_registered_name text;
alter table public.presence_sites drop constraint if exists presence_sites_domain_serving_check;
alter table public.presence_sites
  add constraint presence_sites_domain_serving_check
  check (domain_serving is null or domain_serving in ('latest','old_copy','other','unreachable'));
-- rollback: alter table public.presence_sites drop constraint if exists presence_sites_domain_serving_check,
--   drop column if exists domain_serving, drop column if exists domain_checks,
--   drop column if exists domain_serving_checked_at, drop column if exists domain_registered_name;
