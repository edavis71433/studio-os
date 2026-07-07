-- ── 0031 — M11: Presence Monitor Edition storage ────────────────────────────
-- Additive only. One new column, one new table; nothing existing changes.
--
-- PRODUCT LAW (M11): Studio OS meets customers where they are before asking
-- them to migrate. Existing websites are welcome; migration is optional;
-- value is proven first.
--
-- 1. The edition lives ON the site row. A Monitor site IS a presence site —
--    same id keys the evidence history, judgments, recommendations, moments,
--    brand profile, growth opportunities, knowledge imports, and concierge
--    threads. Upgrading is flipping one column; NOTHING is copied, so
--    nothing can be lost.
alter table public.presence_sites
  add column if not exists edition text not null default 'presence'
  check (edition in ('monitor', 'presence'));
comment on column public.presence_sites.edition is
  'M11. monitor = entry edition observing the customer''s EXISTING external website (no hosting, no publishing); presence = full hosted edition. Additive ladder; upgrade preserves every site_id-keyed row.';

-- 2. The external website connection. Observation only: the platform reads
--    the customer's site, never writes to it. Verification is read-only
--    proof of ownership (DNS TXT / meta tag / file) — no provider-specific
--    assumptions, no credentials stored, no write access requested.
create table if not exists public.presence_monitor_connections (
  site_id uuid primary key references public.presence_sites(id) on delete cascade,
  url text not null,                 -- the customer's website, as given (https enforced at the route)
  domain text not null,              -- derived host — DNS/RDAP/email-auth probes target this
  platform text not null default 'custom',   -- detected via the read-only adapter registry
  method text not null default 'meta' check (method in ('dns', 'meta', 'file')),
  token text not null,               -- the ownership proof the customer places
  status text not null default 'pending' check (status in ('pending', 'verified')),
  verified_at timestamptz,
  last_checked_at timestamptz,
  last_check_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.presence_monitor_connections is
  'M11. A Monitor site''s link to the customer''s existing website. Read-only forever: observation begins only after ownership verification; nothing on the customer''s website or infrastructure is ever modified.';

create trigger presence_monitor_conn_touch before update on public.presence_monitor_connections
  for each row execute function public.presence_touch_updated_at();

alter table public.presence_monitor_connections enable row level security;
create policy presence_monitor_conn_client_read on public.presence_monitor_connections
  for select to authenticated
  using (site_id in (select public.my_presence_site_ids()));
grant select on public.presence_monitor_connections to authenticated;
