-- ── L5.6 Enterprise & Multi-Location Foundation ─────────────────────────────
-- One business owns MANY locations. A location IS a presence_site; the
-- organization adds an inheritance layer (Organization → Region → Location) that
-- stores ONLY the differences. Org-wide changes ride the FROZEN Approved-Plan
-- spine. No engine change, no new pipeline, no CRM/commerce/analytics.

create table if not exists public.presence_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tenant_id uuid not null,                       -- the owning tenant (customer ownership preserved)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.presence_organizations is
  'L5.6. An organization that owns many locations (each a presence_site). Config is inherited via presence_org_config; org-wide changes are Approved Plans.';

create table if not exists public.presence_regions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.presence_organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- the inheritable config, stored ONLY where overridden (org / region / location)
create table if not exists public.presence_org_config (
  org_id uuid not null references public.presence_organizations(id) on delete cascade,
  level text not null check (level in ('org','region','location')),
  ref_id uuid not null,                          -- org id / region id / site id, per level
  config jsonb not null default '{}',            -- only the fields this level overrides
  updated_at timestamptz not null default now(),
  primary key (org_id, level, ref_id)
);
comment on table public.presence_org_config is
  'L5.6. Layered config: the org sets defaults; a region and a location override ONLY what they need. Resolution deep-merges org⊕region⊕location. Deny-all RLS.';

-- org-wide operations as Approved Plans (mirrors presence_pack_operations)
create table if not exists public.presence_org_operations (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null,                         -- scope sentinel for the spine's atomic claim (the org's id or the all-zero global)
  org_id uuid not null references public.presence_organizations(id) on delete cascade,
  op text not null check (op in ('brand_update','hours_update','connected_update','industry_update','location_rollout','template_rollout')),
  title text not null,
  summary text not null,
  what_changes jsonb not null default '[]',
  what_stays jsonb not null default '[]',
  risk text not null default '',
  reversible boolean not null default true,
  rollback text not null default '',
  requires_approval boolean not null default true check (requires_approval = true),  -- the constitutional constant
  targets jsonb not null default '[]',           -- affected location site_ids
  patch jsonb not null default '{}',             -- the config change this rollout applies (merged into the org layer)
  status text not null default 'proposed'
    check (status in ('proposed','approved','abandoned','executed','failed')),
  executed_at timestamptz,                        -- the atomic-claim column (lib/approved_plan.ts)
  decided_at timestamptz,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.presence_org_operations is
  'L5.6. Approved-Plan ledger for org-wide changes (brand/hours/connected/industry/rollout). Reuses the frozen spine; requires_approval is a DB CHECK. Deny-all RLS.';
create index if not exists presence_org_operations_idx on public.presence_org_operations (org_id, status, created_at);

-- a location links a site to its organization (+ optional region). Additive + nullable.
alter table public.presence_sites
  add column if not exists org_id uuid references public.presence_organizations(id) on delete set null,
  add column if not exists region_id uuid references public.presence_regions(id) on delete set null;
create index if not exists presence_sites_org_idx on public.presence_sites (org_id);

alter table public.presence_organizations enable row level security;   -- deny-all
alter table public.presence_regions enable row level security;         -- deny-all
alter table public.presence_org_config enable row level security;      -- deny-all
alter table public.presence_org_operations enable row level security;  -- deny-all

do $$ begin
  create trigger presence_organizations_touch before update on public.presence_organizations for each row execute function public.presence_touch_updated_at();
  create trigger presence_regions_touch before update on public.presence_regions for each row execute function public.presence_touch_updated_at();
  create trigger presence_org_config_touch before update on public.presence_org_config for each row execute function public.presence_touch_updated_at();
  create trigger presence_org_operations_touch before update on public.presence_org_operations for each row execute function public.presence_touch_updated_at();
exception when others then null; end $$;

-- rollback:
--   alter table public.presence_sites drop column if exists org_id, drop column if exists region_id;
--   drop table if exists public.presence_org_operations;
--   drop table if exists public.presence_org_config;
--   drop table if exists public.presence_regions;
--   drop table if exists public.presence_organizations;
