-- ── P2-D: Service Delivery foundation (Projects · Milestones · Tasks · Events) ─
-- The multi-tenant post-sale delivery spine, built on the frozen presence pattern
-- (every row site_id-scoped → references presence_sites, deny-all RLS,
-- function-mediated via svc(), exactly like the P2-C sales tables in 0074). No
-- legacy migration; the clever-api projects/tasks/timeline data is disposable.
--
-- The ONE authoritative container (no duplicate truth — each link is an FK):
--   clients / presence_sites  (the customer, from P2-C convert)
--     -> presence_projects            (the authoritative delivery container)
--        -> presence_milestones       (delivery outcomes; group tasks)
--        -> presence_tasks            (work items; client_visible + action-required explicit)
--        -> presence_project_events   (activity history; copy of the deal-events shape)
-- Client-visible vs internal is EXPLICIT (client_visible columns) and enforced in
-- the function by role — never a new visibility system.

-- ── projects: the ONE authoritative service-delivery container ──
create table if not exists public.presence_projects (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,   -- the customer this delivery serves
  deal_id uuid references public.presence_deals(id) on delete set null, -- provenance from P2-C convert (idempotent handoff)
  name text not null default '',
  description text not null default '',
  status text not null default 'active'
    check (status in ('active','on_hold','complete','archived')),
  owner_user_id uuid,                                  -- studio team owner (auth user)
  client_visible boolean not null default true,        -- is the project itself visible to the customer
  start_date date,
  target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists presence_projects_site_status_idx
  on public.presence_projects (site_id, status) where deleted_at is null;
create index if not exists presence_projects_site_recent_idx
  on public.presence_projects (site_id, updated_at desc) where deleted_at is null;
create index if not exists presence_projects_client_idx
  on public.presence_projects (client_id) where deleted_at is null;
create index if not exists presence_projects_deal_idx
  on public.presence_projects (deal_id) where deleted_at is null;
alter table public.presence_projects enable row level security;  -- deny-all; function-mediated

-- ── milestones: delivery outcomes that group tasks ──
create table if not exists public.presence_milestones (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  project_id uuid not null references public.presence_projects(id) on delete cascade,
  title text not null default '',
  status text not null default 'open' check (status in ('open','complete')),
  due_date date,
  sort_order integer not null default 0,
  client_visible boolean not null default true,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists presence_milestones_project_idx
  on public.presence_milestones (project_id, sort_order) where deleted_at is null;
create index if not exists presence_milestones_site_idx
  on public.presence_milestones (site_id) where deleted_at is null;
alter table public.presence_milestones enable row level security;  -- deny-all; function-mediated

-- ── tasks: work items belonging to a project (default INTERNAL — explicit opt-in to client-visible) ──
create table if not exists public.presence_tasks (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  project_id uuid not null references public.presence_projects(id) on delete cascade,
  milestone_id uuid references public.presence_milestones(id) on delete set null,
  title text not null default '',
  detail text not null default '',
  status text not null default 'todo'
    check (status in ('todo','in_progress','blocked','done')),
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  client_visible boolean not null default false,        -- tasks are internal unless explicitly shared
  client_action_required boolean not null default false, -- a client-required action (distinguished from internal work)
  assigned_to uuid,                                     -- studio team member (auth user)
  due_date date,
  sort_order integer not null default 0,
  source text not null default 'manual',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists presence_tasks_project_idx
  on public.presence_tasks (project_id, sort_order) where deleted_at is null;
create index if not exists presence_tasks_project_status_idx
  on public.presence_tasks (project_id, status) where deleted_at is null;
create index if not exists presence_tasks_site_idx
  on public.presence_tasks (site_id, updated_at desc) where deleted_at is null;
alter table public.presence_tasks enable row level security;  -- deny-all; function-mediated

-- ── project events: activity history + audit (the presence_deal_events shape) ──
create table if not exists public.presence_project_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.presence_projects(id) on delete cascade,
  site_id uuid not null references public.presence_sites(id) on delete cascade,  -- denormalized for RLS + scoping
  kind text not null check (kind in (
    'project_created','status_change','task_created','task_status_change',
    'milestone_created','milestone_completed','note','client_action')),
  detail jsonb not null default '{}',
  actor text not null default '',
  actor_kind text not null default '',
  client_visible boolean not null default false,        -- surfaced to the customer's activity view when true
  created_at timestamptz not null default now()
);
create index if not exists presence_project_events_idx
  on public.presence_project_events (project_id, created_at desc);
create index if not exists presence_project_events_site_idx
  on public.presence_project_events (site_id, created_at desc);
alter table public.presence_project_events enable row level security;  -- deny-all; function-mediated

-- ── convert handoff: link a deal to the project spun up for the new customer.
--    UNIQUE = idempotent handoff (a deal maps to at most one project). ──
alter table public.presence_deals
  add column if not exists created_project_id uuid references public.presence_projects(id) on delete set null;
create unique index if not exists presence_deals_created_project_uq
  on public.presence_deals (created_project_id) where created_project_id is not null;

-- touch-updated_at triggers (reuse the existing function)
do $$ begin
  create trigger presence_projects_touch before update on public.presence_projects for each row execute function public.presence_touch_updated_at();
  create trigger presence_milestones_touch before update on public.presence_milestones for each row execute function public.presence_touch_updated_at();
  create trigger presence_tasks_touch before update on public.presence_tasks for each row execute function public.presence_touch_updated_at();
exception when others then null; end $$;

comment on table public.presence_projects is
  'P2-D service delivery. The ONE authoritative post-sale delivery container, site_id-scoped, bounded status ladder. client_visible + deal_id (idempotent convert handoff). Deny-all RLS; function-mediated.';

-- rollback:
--   alter table public.presence_deals drop column if exists created_project_id;
--   drop table if exists public.presence_project_events;
--   drop table if exists public.presence_tasks;
--   drop table if exists public.presence_milestones;
--   drop table if exists public.presence_projects;
