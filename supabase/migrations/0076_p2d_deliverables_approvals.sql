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
