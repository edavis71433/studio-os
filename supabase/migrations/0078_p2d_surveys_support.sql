-- ── P2-D-4: Surveys & Support ────────────────────────────────────────────────
-- A SMALL, fixed survey (stable questions + one idempotent submission per
-- respondent) and the smallest coherent support workflow (submit → triage →
-- respond → resolve → reopen). Both site_id-scoped, deny-all RLS, function-
-- mediated. Not a form builder, not a helpdesk. No legacy migration.

-- ── surveys ──
create table if not exists public.presence_surveys (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  project_id uuid references public.presence_projects(id) on delete cascade,
  title text not null default '',
  questions jsonb not null default '[]',              -- [{key,label,type,choices?}] — stable schema
  status text not null default 'active' check (status in ('draft','active','closed')),
  client_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists presence_surveys_project_idx on public.presence_surveys (project_id, created_at desc) where deleted_at is null;
create index if not exists presence_surveys_site_idx on public.presence_surveys (site_id, status) where deleted_at is null;
alter table public.presence_surveys enable row level security;  -- deny-all; function-mediated

create table if not exists public.presence_survey_responses (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  survey_id uuid not null references public.presence_surveys(id) on delete cascade,
  project_id uuid references public.presence_projects(id) on delete set null,
  respondent text not null default '',
  answers jsonb not null default '{}',
  status text not null default 'submitted' check (status in ('draft','submitted')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
-- idempotent submission: at most one SUBMITTED response per (survey, respondent)
create unique index if not exists presence_survey_responses_uq
  on public.presence_survey_responses (survey_id, respondent) where status = 'submitted';
create index if not exists presence_survey_responses_survey_idx on public.presence_survey_responses (survey_id, created_at desc) where deleted_at is null;
alter table public.presence_survey_responses enable row level security;  -- deny-all; function-mediated

-- ── support ──
create table if not exists public.presence_support_requests (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  project_id uuid references public.presence_projects(id) on delete set null,
  subject text not null default '',
  body text not null default '',
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  requester text not null default '',
  requester_kind text not null default '',
  assigned_to uuid,
  resolution text not null default '',
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists presence_support_site_status_idx on public.presence_support_requests (site_id, status) where deleted_at is null;
create index if not exists presence_support_requester_idx on public.presence_support_requests (site_id, requester) where deleted_at is null;
create index if not exists presence_support_project_idx on public.presence_support_requests (project_id) where deleted_at is null;
alter table public.presence_support_requests enable row level security;  -- deny-all; function-mediated

create table if not exists public.presence_support_messages (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  request_id uuid not null references public.presence_support_requests(id) on delete cascade,
  body text not null default '',
  author text not null default '',
  author_kind text not null default '',
  attachment_media_id uuid references public.presence_media(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists presence_support_messages_idx on public.presence_support_messages (request_id, created_at asc) where deleted_at is null;
alter table public.presence_support_messages enable row level security;  -- deny-all; function-mediated

-- extend the activity vocabulary so project-linked surveys + support flow into notifications
alter table public.presence_project_events drop constraint if exists presence_project_events_kind_check;
alter table public.presence_project_events add constraint presence_project_events_kind_check
  check (kind in ('project_created','status_change','task_created','task_status_change',
    'milestone_created','milestone_completed','note','client_action',
    'deliverable_added','approval_requested','approval_decided','message',
    'survey_requested','survey_submitted','support_opened','support_message','support_resolved'));

do $$ begin
  create trigger presence_surveys_touch before update on public.presence_surveys for each row execute function public.presence_touch_updated_at();
  create trigger presence_survey_responses_touch before update on public.presence_survey_responses for each row execute function public.presence_touch_updated_at();
  create trigger presence_support_requests_touch before update on public.presence_support_requests for each row execute function public.presence_touch_updated_at();
exception when others then null; end $$;

-- rollback:
--   alter table public.presence_project_events drop constraint if exists presence_project_events_kind_check;
--   drop table if exists public.presence_support_messages;
--   drop table if exists public.presence_support_requests;
--   drop table if exists public.presence_survey_responses;
--   drop table if exists public.presence_surveys;
