-- ── Phase F: commercial V1 features (approved trio) ──────────────────────────
-- Two additive tables. Everything reuses existing spines: scheduled publishes
-- fire the ONE publish pipeline; form submissions feed the CRM timeline; one-tap
-- approve is a stateless signed token (no table). Deny-all RLS, function-mediated.

-- FD-1: scheduled publish / revert (content expiry). A row captures a snapshot
-- and a time; the scheduler fires runPipeline when due. kind='publish' pushes a
-- captured draft; kind='revert' restores a prior version (expiry).
create table if not exists public.presence_scheduled_publishes (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  snapshot_id uuid not null,                          -- the frozen snapshot to publish/restore
  kind text not null default 'publish' check (kind in ('publish','revert')),
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending','done','failed','canceled')),
  summary text not null default '',
  created_by text,
  created_at timestamptz not null default now(),
  fired_at timestamptz,
  last_error text not null default ''
);
comment on table public.presence_scheduled_publishes is
  'Phase F FD-1. A scheduled publish/revert: a frozen snapshot + a due time, fired by the scheduler through the ONE publish pipeline. Deny-all RLS.';
create index if not exists presence_scheduled_pub_due_idx on public.presence_scheduled_publishes (scheduled_for) where status = 'pending';
alter table public.presence_scheduled_publishes enable row level security;   -- deny-all

-- FD-2: form / lead capture. Public submissions from the customer's published
-- site land here (an inbox they own); they also feed the CRM timeline.
create table if not exists public.presence_form_submissions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  form_kind text not null default 'contact' check (form_kind in ('contact','quote','booking')),
  name text not null default '',
  email text not null default '',
  phone text not null default '',
  message text not null default '',
  fields jsonb not null default '{}',
  source_page text not null default '',
  status text not null default 'new' check (status in ('new','read','archived')),
  spam boolean not null default false,
  ip_hash text not null default '',                   -- salted hash for rate-limit/abuse only; never the raw IP
  created_at timestamptz not null default now()
);
comment on table public.presence_form_submissions is
  'Phase F FD-2. Lead-capture submissions from the published site (contact/quote/booking). Owner-visible inbox + CRM timeline. No raw IP, no tracking. Deny-all RLS.';
create index if not exists presence_form_sub_idx on public.presence_form_submissions (site_id, created_at desc) where spam = false;
alter table public.presence_form_submissions enable row level security;      -- deny-all

-- rollback:
--   drop table if exists public.presence_scheduled_publishes;
--   drop table if exists public.presence_form_submissions;
