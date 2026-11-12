-- APPLY 0173 (production) — To-dos and logged calls for anyone, not only people with a deal.
-- Safe to run more than once. A to-do's deal becomes optional and it gains two links (empty);
-- one new table (empty). Nothing existing changes. Paste into Supabase → SQL Editor → Run,
-- before the functions deploy that carries sales items 85 and 80.
begin;

alter table public.presence_deal_tasks alter column deal_id drop not null;
alter table public.presence_deal_tasks add column if not exists contact_id uuid references public.presence_contacts(id) on delete cascade;
alter table public.presence_deal_tasks add column if not exists client_id uuid references public.clients(id) on delete cascade;
create index if not exists presence_deal_tasks_contact_id_idx on public.presence_deal_tasks (contact_id);
create index if not exists presence_deal_tasks_client_id_idx on public.presence_deal_tasks (client_id);
create index if not exists presence_deal_tasks_open_idx on public.presence_deal_tasks (site_id, due_date) where deleted_at is null and status = 'open';

create table if not exists public.presence_person_events (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  contact_id uuid references public.presence_contacts(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  kind text not null check (kind in ('call', 'email', 'meeting', 'note')),
  body text not null default '',
  subject text not null default '',
  occurred_at timestamptz not null default now(),
  via text not null default '' check (via in ('', 'bcc', 'app')),
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
alter table public.presence_person_events enable row level security;

comment on table public.presence_person_events is
  'Sales items 85 and 80: a call, email, meeting or note logged for a person or customer with no deal, and an email sent to them from Studio OS (via=app). A deal''s own logs stay in presence_deal_events.';

commit;

-- Check: deal_id is optional and the two links are there; the new table has row level security
-- on and no rules (deny-all); its three indexes and the to-dos' three new ones.
select column_name, is_nullable from information_schema.columns
where table_schema = 'public' and table_name = 'presence_deal_tasks' and column_name in ('deal_id', 'contact_id', 'client_id')
order by column_name;
select relname, relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname) as rules
from pg_class c where relname = 'presence_person_events';
select indexname from pg_indexes where schemaname = 'public' and indexname in (
  'presence_deal_tasks_contact_id_idx', 'presence_deal_tasks_client_id_idx', 'presence_deal_tasks_open_idx',
  'presence_person_events_site_id_idx', 'presence_person_events_contact_id_idx', 'presence_person_events_client_id_idx')
order by indexname;
