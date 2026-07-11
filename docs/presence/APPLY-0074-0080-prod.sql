-- Combined P2-C/P2-D migrations 0074-0080 for PROD (paste into Supabase SQL Editor, Run once).
-- All statements are idempotent (create ... if not exists). Safe to re-run.

-- ═══════════════ 0074_p2c_sales_lifecycle.sql ═══════════════
-- ── P2-C: Sales & Customer Lifecycle ────────────────────────────────────────
-- The smallest COMPLETE commercial workflow, multi-tenant on the frozen presence
-- spine: every row is site_id-scoped (references presence_sites, RLS via
-- my_presence_site_ids()), deny-all + function-mediated exactly like the CRM
-- notes (0048). No legacy migration; the clever-api sales data is disposable.
--
-- Chain (no duplicate truth — each link is an FK column):
--   presence_form_submissions? -> presence_deals(-> presence_contacts)
--     -> presence_proposals -> presence_contracts
--     -> convert -> clients.id (deals.converted_client_id, UNIQUE = idempotent)
--     -> presence_sites.id (deals.converted_site_id)

-- ── contacts: the ONE authoritative person/company record ──
create table if not exists public.presence_contacts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  phone text not null default '',
  company text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
-- one contact per (site, email) when an email is given (duplicate protection)
create unique index if not exists presence_contacts_site_email_uq
  on public.presence_contacts (site_id, lower(email)) where email <> '' and deleted_at is null;
create index if not exists presence_contacts_site_idx
  on public.presence_contacts (site_id, updated_at desc) where deleted_at is null;
alter table public.presence_contacts enable row level security;  -- deny-all; function-mediated

-- ── deals: the ONE authoritative lead+opportunity record (bounded stage ladder) ──
create table if not exists public.presence_deals (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  contact_id uuid references public.presence_contacts(id) on delete set null,
  title text not null default '',
  stage text not null default 'lead'
    check (stage in ('lead','qualified','proposal','contract','won','lost')),
  source text not null default '',                    -- e.g. website_form, referral, manual
  source_submission_id uuid,                          -- optional link to presence_form_submissions
  expected_value_cents integer not null default 0 check (expected_value_cents >= 0),
  expected_close date,
  notes text not null default '',
  assigned_to uuid,                                   -- optional owner (auth user id)
  lost_reason text not null default '',
  converted_client_id uuid references public.clients(id) on delete set null,
  converted_site_id uuid references public.presence_sites(id) on delete set null,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
-- idempotent conversion: a given client can be the target of at most one deal
create unique index if not exists presence_deals_converted_client_uq
  on public.presence_deals (converted_client_id) where converted_client_id is not null;
create index if not exists presence_deals_site_stage_idx
  on public.presence_deals (site_id, stage) where deleted_at is null;
create index if not exists presence_deals_site_recent_idx
  on public.presence_deals (site_id, updated_at desc) where deleted_at is null;
create index if not exists presence_deals_contact_idx
  on public.presence_deals (contact_id) where deleted_at is null;
alter table public.presence_deals enable row level security;  -- deny-all; function-mediated

-- ── deal events: stage history + activity + audit (append-only in spirit) ──
create table if not exists public.presence_deal_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.presence_deals(id) on delete cascade,
  site_id uuid not null references public.presence_sites(id) on delete cascade,  -- denormalized for RLS + scoping
  kind text not null check (kind in ('created','stage_change','note','proposal_sent','proposal_decided','contract_sent','contract_signed','converted')),
  from_stage text not null default '',
  to_stage text not null default '',
  detail jsonb not null default '{}',
  actor text not null default '',
  actor_kind text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists presence_deal_events_idx on public.presence_deal_events (deal_id, created_at desc);
create index if not exists presence_deal_events_site_idx on public.presence_deal_events (site_id, created_at desc);
alter table public.presence_deal_events enable row level security;  -- deny-all; function-mediated

-- ── proposals: the smallest complete quote (line items + status + share token) ──
create table if not exists public.presence_proposals (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  deal_id uuid not null references public.presence_deals(id) on delete cascade,
  title text not null default '',
  line_items jsonb not null default '[]',             -- [{label, qty, unit_cents}]
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  currency text not null default 'usd',
  terms text not null default '',
  status text not null default 'draft'
    check (status in ('draft','sent','accepted','declined')),
  version integer not null default 1,
  share_token text,                                   -- HMAC signed link carries the id; this is a fallback lookup
  sent_at timestamptz,
  decided_at timestamptz,
  decided_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists presence_proposals_deal_idx on public.presence_proposals (deal_id, created_at desc) where deleted_at is null;
create index if not exists presence_proposals_site_idx on public.presence_proposals (site_id, status) where deleted_at is null;
alter table public.presence_proposals enable row level security;  -- deny-all; function-mediated

-- ── contracts: the agreement (body + version-integrity hash + signed evidence) ──
create table if not exists public.presence_contracts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  deal_id uuid not null references public.presence_deals(id) on delete cascade,
  proposal_id uuid references public.presence_proposals(id) on delete set null,
  title text not null default '',
  body text not null default '',
  content_hash text not null default '',              -- version integrity: sign the exact bytes shown
  terms_snapshot jsonb not null default '{}',         -- accepted commercial terms carried forward
  status text not null default 'draft'
    check (status in ('draft','sent','signed','voided')),
  signer_name text not null default '',
  signer_email text not null default '',
  signed_at timestamptz,
  signed_evidence jsonb not null default '{}',        -- {hash, ip_hash, token_exp, at}
  version integer not null default 1,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists presence_contracts_deal_idx on public.presence_contracts (deal_id, created_at desc) where deleted_at is null;
create index if not exists presence_contracts_site_idx on public.presence_contracts (site_id, status) where deleted_at is null;
alter table public.presence_contracts enable row level security;  -- deny-all; function-mediated

-- touch-updated_at triggers (reuse the existing function)
do $$ begin
  create trigger presence_contacts_touch before update on public.presence_contacts for each row execute function public.presence_touch_updated_at();
  create trigger presence_deals_touch before update on public.presence_deals for each row execute function public.presence_touch_updated_at();
  create trigger presence_proposals_touch before update on public.presence_proposals for each row execute function public.presence_touch_updated_at();
  create trigger presence_contracts_touch before update on public.presence_contracts for each row execute function public.presence_touch_updated_at();
exception when others then null; end $$;

comment on table public.presence_deals is
  'P2-C sales lifecycle. The ONE authoritative lead+opportunity record, site_id-scoped, bounded stage ladder. converted_client_id UNIQUE = idempotent convert-to-customer. Deny-all RLS; function-mediated.';

-- rollback:
--   drop table if exists public.presence_contracts;
--   drop table if exists public.presence_proposals;
--   drop table if exists public.presence_deal_events;
--   drop table if exists public.presence_deals;
--   drop table if exists public.presence_contacts;


-- ═══════════════ 0075_p2d_service_delivery.sql ═══════════════
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


-- ═══════════════ 0076_p2d_deliverables_approvals.sql ═══════════════
-- ── P2-D-2: Deliverables & Approvals ────────────────────────────────────────
-- Deliverables are a thin CLIENT-FACING overlay on the ONE authoritative media
-- store (presence_media) — no second bucket, no duplicate file model. Approvals
-- are ONE generic decision record that references the exact item + version
-- (content_hash), reusing the contract version-integrity idiom (0074). Both are
-- site_id-scoped, deny-all RLS, function-mediated. No legacy migration.

-- ── deliverables: a project file shared with the client (overlay on presence_media) ──
create table if not exists public.presence_deliverables (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  project_id uuid not null references public.presence_projects(id) on delete cascade,
  media_id uuid not null references public.presence_media(id) on delete restrict,  -- belt: DB blocks dropping a referenced file (app-level guard in lib/media.ts deleteMedia is the real gate for soft-delete)
  title text not null default '',
  note text not null default '',
  status text not null default 'shared' check (status in ('draft','shared')),
  client_visible boolean not null default true,       -- a deliverable is FOR the client by default
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists presence_deliverables_project_idx
  on public.presence_deliverables (project_id, created_at desc) where deleted_at is null;
create index if not exists presence_deliverables_site_idx
  on public.presence_deliverables (site_id) where deleted_at is null;
create index if not exists presence_deliverables_media_idx
  on public.presence_deliverables (media_id) where deleted_at is null;
alter table public.presence_deliverables enable row level security;  -- deny-all; function-mediated

-- ── approvals: ONE generic decision record bound to the exact item + version ──
create table if not exists public.presence_approvals (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  project_id uuid references public.presence_projects(id) on delete cascade,
  subject_type text not null check (subject_type in ('deliverable','task','project','custom')),
  subject_id uuid,                                     -- the exact item under review
  title text not null default '',
  summary text not null default '',
  content_hash text not null default '',              -- version integrity: the exact version approved (cannot decide a superseded one)
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','changes_requested','superseded')),
  requested_by text not null default '',
  requested_by_kind text not null default '',
  requested_at timestamptz not null default now(),
  decided_by text not null default '',
  decided_by_kind text not null default '',
  decided_at timestamptz,
  decision_note text not null default '',
  client_visible boolean not null default true,        -- approvals are put TO the client
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists presence_approvals_project_idx
  on public.presence_approvals (project_id, created_at desc) where deleted_at is null;
create index if not exists presence_approvals_site_status_idx
  on public.presence_approvals (site_id, status) where deleted_at is null;
create index if not exists presence_approvals_subject_idx
  on public.presence_approvals (subject_type, subject_id) where deleted_at is null;
alter table public.presence_approvals enable row level security;  -- deny-all; function-mediated

-- Fix (genuine defect): the media bucket's allowed_mime_types never included
-- application/pdf, so document support added in 0065 (and P2-D deliverable PDFs)
-- failed at the STORAGE layer (415 invalid_mime_type) despite the DB CHECK + app
-- allow-list permitting it. Widen the bucket idempotently.
update storage.buckets
  set allowed_mime_types = array_append(allowed_mime_types, 'application/pdf')
  where id = 'presence-media'
    and not ('application/pdf' = any(coalesce(allowed_mime_types, array[]::text[])));

-- extend the project-events kind vocabulary for delivery + approvals
alter table public.presence_project_events drop constraint if exists presence_project_events_kind_check;
alter table public.presence_project_events add constraint presence_project_events_kind_check
  check (kind in ('project_created','status_change','task_created','task_status_change',
    'milestone_created','milestone_completed','note','client_action',
    'deliverable_added','approval_requested','approval_decided'));

do $$ begin
  create trigger presence_deliverables_touch before update on public.presence_deliverables for each row execute function public.presence_touch_updated_at();
  create trigger presence_approvals_touch before update on public.presence_approvals for each row execute function public.presence_touch_updated_at();
exception when others then null; end $$;

comment on table public.presence_approvals is
  'P2-D generic approval — references the exact item + version via content_hash; a decision is guarded by status=pending AND content_hash match (reuses the contract version-integrity idiom). Deny-all RLS; function-mediated.';

-- rollback:
--   alter table public.presence_project_events drop constraint if exists presence_project_events_kind_check;
--   drop table if exists public.presence_approvals;
--   drop table if exists public.presence_deliverables;


-- ═══════════════ 0077_p2d_communication.sql ═══════════════
-- ── P2-D-3: Communication (project messages + notification read-state) ───────
-- ONE coherent communication model: a project-scoped thread with an audience
-- discriminator (internal = studio-only note; client = the shared studio↔client
-- conversation). Notifications are DERIVED from the project event log (never a
-- second activity log) + a thin per-reader last-seen marker for read/unread.
-- Site_id-scoped, deny-all RLS, function-mediated. No legacy migration.

-- ── project messages: the conversation (internal notes vs client-visible messages) ──
create table if not exists public.presence_project_messages (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  project_id uuid not null references public.presence_projects(id) on delete cascade,
  audience text not null default 'client' check (audience in ('internal','client')),
  body text not null default '',
  author text not null default '',
  author_kind text not null default '',
  attachment_media_id uuid references public.presence_media(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists presence_project_messages_idx
  on public.presence_project_messages (project_id, created_at desc) where deleted_at is null;
create index if not exists presence_project_messages_site_idx
  on public.presence_project_messages (site_id, created_at desc) where deleted_at is null;
alter table public.presence_project_messages enable row level security;  -- deny-all; function-mediated

-- ── activity read-marker: thin per-reader last-seen for notification read/unread ──
create table if not exists public.presence_activity_reads (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  reader text not null,                               -- principal userId (or a stable side key)
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists presence_activity_reads_uq
  on public.presence_activity_reads (site_id, reader);
alter table public.presence_activity_reads enable row level security;  -- deny-all; function-mediated

-- messages participate in the ONE activity log (so notifications derive uniformly)
alter table public.presence_project_events drop constraint if exists presence_project_events_kind_check;
alter table public.presence_project_events add constraint presence_project_events_kind_check
  check (kind in ('project_created','status_change','task_created','task_status_change',
    'milestone_created','milestone_completed','note','client_action',
    'deliverable_added','approval_requested','approval_decided','message'));

do $$ begin
  create trigger presence_activity_reads_touch before update on public.presence_activity_reads for each row execute function public.presence_touch_updated_at();
exception when others then null; end $$;

comment on table public.presence_project_messages is
  'P2-D communication. ONE project thread; audience internal (studio-only) or client (shared). Internal is never shown to the client side. Deny-all RLS; function-mediated.';

-- rollback:
--   alter table public.presence_project_events drop constraint if exists presence_project_events_kind_check;
--   drop table if exists public.presence_activity_reads;
--   drop table if exists public.presence_project_messages;


-- ═══════════════ 0078_p2d_surveys_support.sql ═══════════════
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


-- ═══════════════ 0079_p2d_agency_client_bridge.sql ═══════════════
-- ── P2-D Final Hardening: Agency–Client Bridge ──────────────────────────────
-- The post-sale relationship between an agency/studio workspace and a customer's
-- own workspace, made EXPLICIT and tenant-safe. ONE authoritative project lives
-- on the agency site; the customer (on their OWN site) reaches only their linked,
-- client-visible delivery through this bridge — never as a member of the agency's
-- internal workspace, never able to see another customer's records.
--
--   presence_deals (agency site) --convert--> clients.id (customer) + presence_sites (customer workspace)
--        └─ presence_projects (agency site, client_id = customer)
--             └─ presence_service_links  [THE BRIDGE]  customer_client_id ⇄ project_id (agency site)

create table if not exists public.presence_service_links (
  id uuid primary key default gen_random_uuid(),
  agency_site_id uuid not null references public.presence_sites(id) on delete cascade,   -- where the project + delivery live
  project_id uuid not null references public.presence_projects(id) on delete cascade,
  customer_client_id uuid not null references public.clients(id) on delete cascade,       -- the customer this delivery is for
  customer_site_id uuid references public.presence_sites(id) on delete set null,          -- the customer's OWN workspace (P2-E billing hook)
  deal_id uuid references public.presence_deals(id) on delete set null,                   -- provenance
  status text not null default 'active' check (status in ('active','ended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- ONE bridge per project (idempotent handoff); fast lookup by customer.
create unique index if not exists presence_service_links_project_uq
  on public.presence_service_links (project_id);
create index if not exists presence_service_links_customer_idx
  on public.presence_service_links (customer_client_id, status);
create index if not exists presence_service_links_customer_site_idx
  on public.presence_service_links (customer_site_id, status);
alter table public.presence_service_links enable row level security;  -- deny-all; function-mediated

do $$ begin
  create trigger presence_service_links_touch before update on public.presence_service_links for each row execute function public.presence_touch_updated_at();
exception when others then null; end $$;

-- D3 (perf, from the deep audit): the support list orders by updated_at but had no
-- matching index (sibling tables all have (site_id, updated_at desc)).
create index if not exists presence_support_site_recent_idx
  on public.presence_support_requests (site_id, updated_at desc) where deleted_at is null;

comment on table public.presence_service_links is
  'P2-D Agency–Client Bridge. Links an agency-site delivery project to the customer''s own workspace/client, tenant-safe. The customer reaches only their linked client-visible delivery — never a member of the agency workspace. UNIQUE(project_id) = idempotent handoff.';

-- rollback:
--   drop index if exists public.presence_support_site_recent_idx;
--   drop table if exists public.presence_service_links;


-- ═══════════════ 0080_customer_primary_agency.sql ═══════════════
-- ── Architecture freeze: one primary agency per customer (launch constraint) ──
-- The Agency–Client Bridge is now the authoritative Studio OS ownership model. For
-- launch we freeze: a customer workspace may be linked to exactly ONE primary
-- agency/studio workspace. This table is that authoritative relationship; the
-- PRIMARY KEY on customer_client_id enforces the one-agency rule at the DB level.
--
-- Future multi-agency collaboration is designed for WITHOUT replacing the core
-- model: to relax, drop this PK and move to a composite (customer_client_id,
-- agency_site_id) key + a "primary" flag. presence_service_links (the per-project
-- bridge) already supports many links; this table is the single-agency gate.

create table if not exists public.presence_customer_agency (
  customer_client_id uuid primary key references public.clients(id) on delete cascade,
  agency_site_id uuid not null references public.presence_sites(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.presence_customer_agency enable row level security;  -- deny-all; function-mediated

comment on table public.presence_customer_agency is
  'Architecture freeze: the ONE primary agency per customer (launch constraint). PK(customer_client_id) enforces one-agency-per-customer; relax to a composite key for future multi-agency. Deny-all RLS; function-mediated.';

-- rollback:
--   drop table if exists public.presence_customer_agency;


