-- APPLY 0197 (production) — A fresh code before the risky actions (builder list item 191).
-- Safe to run more than once. One new table; nothing existing changes.
-- Paste into Supabase -> SQL Editor -> Run.
create table if not exists public.presence_fresh_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  action text not null check (action in ('invite_coowner', 'transfer', 'domain_remove', 'close_account')),
  code_hash text not null check (char_length(code_hash) = 64),
  tries integer not null default 0 check (tries >= 0),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists presence_fresh_codes_user on public.presence_fresh_codes (user_id, action, created_at desc);
alter table public.presence_fresh_codes enable row level security;
comment on table public.presence_fresh_codes is
  'Builder item 191: a 6-digit code emailed before a risky action (inviting a co-owner, handing a site over, removing a domain, closing the account), kept as a hash. Works once, for 10 minutes, for that action, with 5 tries. People with two-step sign-in use their app instead. Service role only.';

-- Check: the table exists with row security on, no policies (service role only), and its index.
select c.relrowsecurity as rls_on,
  (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'presence_fresh_codes') as policies,
  (select count(*) from pg_indexes i where i.schemaname = 'public' and i.indexname = 'presence_fresh_codes_user') as user_index
from pg_class c where c.oid = 'public.presence_fresh_codes'::regclass;
