-- ── 0034 — M13: Agency Platform storage ─────────────────────────────────────
-- Additive only. Four new tables; nothing existing changes.
--
-- ORCHESTRATION, NOT DUPLICATION: an agency is a lens over existing presence
-- sites. Portfolio, queues, and bulk operations all read/dispatch the frozen
-- per-site architecture. Access is gated inside the presence function by
-- explicit membership + role checks (extending the existing security model);
-- these tables carry NO client-facing policies — RLS is enabled deny-all and
-- every read/write flows through the function's gates.

create table if not exists public.presence_agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  branding jsonb not null default '{}',        -- white label: display_name, logo_url, colors, email_from, portal_note
  seat_limit int not null default 5,
  client_limit int not null default 25,
  plan text not null default 'agency',
  status text not null default 'active' check (status in ('active','paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.presence_agencies is
  'M13. An agency/freelancer/internal team managing many presence sites. Branding white-labels the surfaces; the underlying Studio OS identity (provenance, pipelines) remains intact.';

create table if not exists public.presence_agency_members (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.presence_agencies(id) on delete cascade,
  email text not null,
  user_id uuid,
  role text not null check (role in ('owner','admin','account_manager','content_strategist','designer','developer','support','readonly')),
  status text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, email)
);
comment on table public.presence_agency_members is
  'M13. Agency team members. Roles map to capabilities inside the presence function (pure table) — permissions EXTEND the existing principal model; staff remains the operator superset.';

create table if not exists public.presence_agency_clients (
  site_id uuid primary key references public.presence_sites(id) on delete cascade,
  agency_id uuid not null references public.presence_agencies(id) on delete cascade,
  status text not null default 'active' check (status in ('active','archived')),
  tags jsonb not null default '[]',
  owner_email text not null default '',        -- account ownership (a member email)
  assigned jsonb not null default '[]',        -- team assignment (member emails)
  notes text not null default '',              -- internal notes — never client-visible
  onboarded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.presence_agency_clients is
  'M13. The portfolio link: one presence site managed by one agency. Archive/restore is a status flip; the site and every client-owned row underneath is untouched by portfolio operations.';

create index if not exists presence_agency_clients_agency_idx
  on public.presence_agency_clients (agency_id, status);

create table if not exists public.presence_agency_jobs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.presence_agencies(id) on delete cascade,
  action text not null,
  site_ids jsonb not null default '[]',
  params jsonb not null default '{}',
  run_after timestamptz not null default now(),   -- scheduled bulk work (incl. scheduled publishing)
  status text not null default 'queued' check (status in ('queued','done','failed')),
  results jsonb not null default '[]',            -- per-site outcome — every bulk action stays explainable
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.presence_agency_jobs is
  'M13. Scheduled/deferred bulk operations. Each execution records a per-site result; actions dispatch the EXISTING per-site engines — nothing bulk has powers a single-site action lacks.';

create index if not exists presence_agency_jobs_due_idx
  on public.presence_agency_jobs (status, run_after);

-- deny-all RLS: access flows only through the presence function's gates
alter table public.presence_agencies enable row level security;
alter table public.presence_agency_members enable row level security;
alter table public.presence_agency_clients enable row level security;
alter table public.presence_agency_jobs enable row level security;

do $$ begin
  create trigger presence_agencies_touch before update on public.presence_agencies
    for each row execute function public.presence_touch_updated_at();
  create trigger presence_agency_members_touch before update on public.presence_agency_members
    for each row execute function public.presence_touch_updated_at();
  create trigger presence_agency_clients_touch before update on public.presence_agency_clients
    for each row execute function public.presence_touch_updated_at();
  create trigger presence_agency_jobs_touch before update on public.presence_agency_jobs
    for each row execute function public.presence_touch_updated_at();
exception when duplicate_object then null;
end $$;
