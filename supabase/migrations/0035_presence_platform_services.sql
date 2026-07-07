-- ── 0035 — M14: Presence Platform Services storage ──────────────────────────
-- Additive only. Two new tables + an extended CHECK; nothing existing changes.
--
-- OWNERSHIP GUARANTEES (M14): customers always own their domain, content,
-- media, and data. They can transfer in, and they can LEAVE — the export
-- route hands over everything portable. Nothing in this migration (or this
-- platform) creates lock-in.

-- 1. The desired-state DNS zone — the manual editor's document. What the
--    customer WANTS true of their DNS, validated record by record. Reality
--    is observed separately (M12 zone snapshots); drift = desired minus
--    observed, and repair is a PLAN (approval law unchanged).
create table if not exists public.presence_dns_zones (
  site_id uuid primary key references public.presence_sites(id) on delete cascade,
  domain text not null,
  records jsonb not null default '[]',     -- validated DnsRecord[]
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
comment on table public.presence_dns_zones is
  'M14. The desired-state DNS zone (the manual editor). Observed reality lives in presence_zone_snapshots; drift between the two generates repair PLANS — the platform never writes DNS without an approved plan and a write-capable adapter.';

-- 2. Zone edit history — every saved desired-state version, for rollback.
create table if not exists public.presence_dns_zone_history (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  records jsonb not null default '[]',
  note text not null default '',
  saved_at timestamptz not null default now()
);
comment on table public.presence_dns_zone_history is
  'M14. Every saved version of the desired-state zone. Rollback restores a version into presence_dns_zones (and, when reality must follow, produces a plan).';

create index if not exists presence_dns_zone_history_site_idx
  on public.presence_dns_zone_history (site_id, saved_at desc);

alter table public.presence_dns_zones enable row level security;
create policy presence_dns_zones_client_read on public.presence_dns_zones
  for select to authenticated using (site_id in (select public.my_presence_site_ids()));
grant select on public.presence_dns_zones to authenticated;

alter table public.presence_dns_zone_history enable row level security;
create policy presence_dns_zone_history_client_read on public.presence_dns_zone_history
  for select to authenticated using (site_id in (select public.my_presence_site_ids()));
grant select on public.presence_dns_zone_history to authenticated;

create trigger presence_dns_zones_touch before update on public.presence_dns_zones
  for each row execute function public.presence_touch_updated_at();

-- 3. New plan kinds (additive CHECK growth, the sanctioned pattern):
--    domain transfers with progress, DNS repair, and provider-preset email setup.
alter table public.presence_infra_plans
  drop constraint if exists presence_infra_plans_kind_check;
alter table public.presence_infra_plans
  add constraint presence_infra_plans_kind_check check (kind in (
    'connect_domain','email_auth','registrar_care','hosting_restore','migration',
    -- M14:
    'domain_transfer_in','domain_transfer_out','dns_repair','email_setup'));
