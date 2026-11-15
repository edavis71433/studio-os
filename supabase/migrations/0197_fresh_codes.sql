-- ── A fresh code before the risky actions (builder list item 191, Nov 2026) ──────
-- rollback: drop table if exists public.presence_fresh_codes;
--
-- Inviting a co-owner (or making someone one), handing a site to someone else, removing a
-- domain and closing the account now ask for a fresh code first, the way Squarespace emails
-- one before an invite. Someone with two-step sign-in on types the code from their
-- authenticator app, which Supabase Auth checks; everyone else gets a 6-digit code by email,
-- kept here only as a hash. A code works once, for 10 minutes, for the one action it was sent
-- for, with 5 tries. lib/fresh_code.ts holds the rules; the retention sweep clears old codes.
--
-- Deploy order: this first. Before it runs, those four actions answer 503 with a plain
-- "needs a one-time database update" sentence for anyone who would need an emailed code.
--
-- Properties:
--   • ADDITIVE — one new table; nothing existing is read, written or moved.
--   • IDEMPOTENT — create-if-not-exists throughout.
--   • PRIVATE — row level security on with no policies: only the Edge Function
--     (service role) reads or writes it.

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
