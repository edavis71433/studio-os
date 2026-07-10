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
