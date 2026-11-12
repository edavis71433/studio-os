-- APPLY 0177 (production) — Handing a site to a new owner (builder list item 53).
-- Safe to run more than once. One new table; nothing existing changes.
-- Paste into Supabase -> SQL Editor -> Run.
create table if not exists public.presence_site_transfers (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  client_id uuid not null,
  from_email text not null check (char_length(from_email) between 3 and 254),
  to_email text not null check (char_length(to_email) between 3 and 254),
  keep_old boolean not null default true,
  started_by text not null default '',
  started_side text not null check (started_side in ('owner', 'studio')),
  status text not null default 'asked_owner'
    check (status in ('asked_owner', 'asked_new', 'done', 'cancelled', 'declined', 'expired')),
  decided_by text,
  decided_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists presence_site_transfers_one_open
  on public.presence_site_transfers (site_id) where status in ('asked_owner', 'asked_new');
create index if not exists presence_site_transfers_to on public.presence_site_transfers (to_email, status);
alter table public.presence_site_transfers enable row level security;
do $$ begin
  create trigger presence_site_transfers_touch before update on public.presence_site_transfers
    for each row execute function public.presence_touch_updated_at();
exception when others then null; end $$;
comment on table public.presence_site_transfers is
  'Builder item 53: a request to hand a site to a new owner. Nothing changes until the new owner accepts (and, when the studio started it, the owner agreed first). One open request per site; lapses after 14 days. Service role only.';

-- Check: the table exists with row security on, no policies (service role only), and the one-open index.
select c.relrowsecurity as rls_on,
  (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'presence_site_transfers') as policies,
  (select count(*) from pg_indexes i where i.schemaname = 'public' and i.indexname = 'presence_site_transfers_one_open') as one_open_index
from pg_class c where c.oid = 'public.presence_site_transfers'::regclass;
