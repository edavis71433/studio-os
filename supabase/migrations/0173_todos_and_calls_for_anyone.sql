-- 0173 — To-dos and logged calls for anyone, not only people with a deal
-- (sales items 85 and 106's "tasks with a due date tied to a contact"; item 80 logs its sent
-- emails here too), Nov 2026.
--
-- A to-do and a logged call lived on a deal, so a past customer with no open deal, or someone
-- you met and want to ring next week, could only get a note.
--
-- 1. presence_deal_tasks (the to-dos, 0108) can now be for a person (contact_id), a customer
--    (client_id), a deal (deal_id, as before) or nobody (a to-do of your own): deal_id becomes
--    optional. Nothing existing changes; every current to-do keeps its deal.
-- 2. presence_person_events keeps a call, email, meeting or note logged for a person or a
--    customer who has no deal, and an email sent to them from Studio OS (via = 'app'). A deal's
--    own logs stay on its deal events (presence_deal_events), as before.
--
-- Function-mediated, deny-all row level security like every sales table (0074). The code
-- tolerates this migration not being applied yet: those writes say they need a quick database
-- update, and the reads leave them out.

-- ── 1. to-dos for anyone ──
alter table public.presence_deal_tasks alter column deal_id drop not null;
alter table public.presence_deal_tasks add column if not exists contact_id uuid references public.presence_contacts(id) on delete cascade;
alter table public.presence_deal_tasks add column if not exists client_id uuid references public.clients(id) on delete cascade;
-- an index for each new link, as 0164 gave every link (Supabase's adviser)
create index if not exists presence_deal_tasks_contact_id_idx on public.presence_deal_tasks (contact_id);
create index if not exists presence_deal_tasks_client_id_idx on public.presence_deal_tasks (client_id);
-- the To-dos page reads a studio's open ones, soonest first
create index if not exists presence_deal_tasks_open_idx on public.presence_deal_tasks (site_id, due_date) where deleted_at is null and status = 'open';

-- ── 2. calls, emails, meetings and notes for a person or customer with no deal ──
create table if not exists public.presence_person_events (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  contact_id uuid references public.presence_contacts(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  kind text not null check (kind in ('call', 'email', 'meeting', 'note')),
  body text not null default '',
  subject text not null default '',
  occurred_at timestamptz not null default now(),
  via text not null default '' check (via in ('', 'bcc', 'app')),   -- by hand · the log-this-email address · sent from Studio OS
  message_id text not null default '',
  actor text not null default '',
  actor_kind text not null default '',
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint presence_person_events_for_someone check (contact_id is not null or client_id is not null)
);
create index if not exists presence_person_events_site_id_idx on public.presence_person_events (site_id, created_at desc);
create index if not exists presence_person_events_contact_id_idx on public.presence_person_events (contact_id);
create index if not exists presence_person_events_client_id_idx on public.presence_person_events (client_id);
alter table public.presence_person_events enable row level security;   -- deny-all; function-mediated

comment on table public.presence_person_events is
  'Sales items 85 and 80: a call, email, meeting or note logged for a person or customer with no deal, and an email sent to them from Studio OS (via=app). A deal''s own logs stay in presence_deal_events.';

-- rollback (only once nothing has been written to the new places):
--   drop table if exists public.presence_person_events;
--   drop index if exists public.presence_deal_tasks_open_idx;
--   drop index if exists public.presence_deal_tasks_client_id_idx;
--   drop index if exists public.presence_deal_tasks_contact_id_idx;
--   alter table public.presence_deal_tasks drop column if exists client_id, drop column if exists contact_id;
--   delete from public.presence_deal_tasks where deal_id is null;
--   alter table public.presence_deal_tasks alter column deal_id set not null;
