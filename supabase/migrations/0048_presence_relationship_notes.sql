-- ── CRM (Phase C) — relationship notes ──────────────────────────────────────
-- The ONE new capability the Client Relationship Center needed. Everything else
-- in the CRM AGGREGATES existing data (publishes, change events, connected
-- events, moments, approvals) — no duplication. A relationship note is a plain
-- note about the studio↔client relationship, either internal (studio-only) or
-- shared (the client may see it). Audience is enforced in the function using the
-- existing principal/agency signals — the permission & visibility models are NOT
-- modified. Deny-all RLS, function-mediated. Soft-delete; append-only in spirit.
create table if not exists public.presence_relationship_notes (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  audience text not null default 'internal' check (audience in ('internal','shared')),
  body text not null,
  pinned boolean not null default false,
  author text,
  author_kind text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
comment on table public.presence_relationship_notes is
  'Phase C CRM. Relationship notes (internal studio-only or shared with the client). Audience enforced in the function via principal/agency signals; permission/visibility models unchanged. Deny-all RLS; function-mediated.';
create index if not exists presence_relationship_notes_idx on public.presence_relationship_notes (site_id, created_at desc) where deleted_at is null;

alter table public.presence_relationship_notes enable row level security;  -- deny-all

do $$ begin
  create trigger presence_relationship_notes_touch before update on public.presence_relationship_notes
    for each row execute function public.presence_touch_updated_at();
exception when others then null; end $$;

-- rollback:
--   drop table if exists public.presence_relationship_notes;
