-- 0162 — The Domains page does things (builder list item 162, Nov 2026 review, domains finding 6)
-- Four columns on presence_sites, written once a day (and on "Check now") by
-- commerce/lifecycle.ts checkOneDomain, from the same public registration record the
-- expiry already comes from:
--   domain_lock           the transfer lock is on (client/server transfer prohibited)
--   domain_dns_host       the company that runs the domain's DNS, from its nameservers:
--                         where the client must add records, often not where it was bought
--   domain_statuses       the registry's status words (["client transfer prohibited", …]),
--                         which say "redemption period", "pending delete" or "hold"
--   domain_registered_at  when it was first registered
-- The studio's notes per domain (whose account, renews by itself, a note) are a reserved
-- JSON row (__domain_notes__) on the client's site, so they need no column.
-- Nothing is backfilled: the next daily check, or "Check now", fills each site in.
alter table public.presence_sites
  add column if not exists domain_lock boolean,
  add column if not exists domain_dns_host text,
  add column if not exists domain_statuses jsonb,
  add column if not exists domain_registered_at timestamptz;
-- rollback: alter table public.presence_sites drop column if exists domain_lock, drop column if exists domain_dns_host,
--   drop column if exists domain_statuses, drop column if exists domain_registered_at;
