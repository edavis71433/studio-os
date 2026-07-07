-- ── 0033 — M12: Platform Services storage ───────────────────────────────────
-- Additive only. Two new tables; nothing existing changes.
--
-- PERMANENT PRINCIPLE (M12): infrastructure should be replaceable; customer
-- trust should not. Studio OS is the stable control plane; providers are
-- interchangeable adapters behind capability contracts.
--
-- 1. Infrastructure Change Plans — the safety core. Every infrastructure
--    action is a plan: exact steps, honest risk, rollback note, and a
--    schema-enforced approval requirement. Nothing destructive happens
--    without an explicit customer/operator decision recorded here.
create table if not exists public.presence_infra_plans (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  kind text not null check (kind in ('connect_domain','email_auth','registrar_care','hosting_restore','migration')),
  title text not null,
  summary text not null,
  steps jsonb not null default '[]',
  risk text not null default '',
  reversible boolean not null default true,
  rollback_note text not null default '',
  requires_approval boolean not null default true check (requires_approval = true),
  status text not null default 'proposed' check (status in ('proposed','approved','applied','abandoned')),
  prior_state jsonb not null default '{}',      -- zone/deploy snapshot taken at proposal — the rollback reference
  extra jsonb not null default '{}',            -- migration: content_mapping, redirects, launch checks, QA
  decided_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.presence_infra_plans is
  'M12. Infrastructure Change Plans: every infrastructure action proposed as exact steps with honest risk and a rollback note. requires_approval is a CHECK constant — nothing applies without an explicit recorded decision.';

create index if not exists presence_infra_plans_site_idx
  on public.presence_infra_plans (site_id, status, created_at desc);

create trigger presence_infra_plans_touch before update on public.presence_infra_plans
  for each row execute function public.presence_touch_updated_at();

alter table public.presence_infra_plans enable row level security;
create policy presence_infra_plans_client_read on public.presence_infra_plans
  for select to authenticated
  using (site_id in (select public.my_presence_site_ids()));
grant select on public.presence_infra_plans to authenticated;

-- 2. DNS zone snapshots — read-only history. Taken when plans are proposed
--    and on demand; they are what "rollback" and "what changed?" point at.
create table if not exists public.presence_zone_snapshots (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  domain text not null,
  records jsonb not null default '[]',
  taken_at timestamptz not null default now()
);
comment on table public.presence_zone_snapshots is
  'M12. Read-only DNS zone snapshots (DoH observations). History for the foundations surface and the rollback reference for plans. The platform never writes DNS today; when a write-capable adapter ships, these snapshots are what changes diff against.';

create index if not exists presence_zone_snapshots_site_idx
  on public.presence_zone_snapshots (site_id, taken_at desc);

alter table public.presence_zone_snapshots enable row level security;
create policy presence_zone_snapshots_client_read on public.presence_zone_snapshots
  for select to authenticated
  using (site_id in (select public.my_presence_site_ids()));
grant select on public.presence_zone_snapshots to authenticated;
