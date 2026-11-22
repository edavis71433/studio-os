-- ===========================================================================
--  APPLY PACK - migration 0247  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE OR
--  AFTER the deploy.yml run that ships backup codes for two-step sign-in
--  (builder list item 347): either order is safe. ADDITIVE and IDEMPOTENT
--  ("if not exists"; the one constraint is dropped and re-added), so it is safe
--  to re-run. Nothing existing changes shape: one new table with row security on
--  and no policies (only the server reads it), two small indexes, and one more
--  allowed value in presence_fresh_codes.action.
--
--  Why: builder list item 347. Two-step sign-in had no backup codes; a lost
--  phone meant emailing support, and clearing a second step was done by hand.
--  The page makes ten codes and shows them once; this table keeps only their
--  hashes. One code turns two-step sign-in off once, without a session.
--
--  If the deploy goes first, nothing breaks: Save backup codes and the
--  lost-phone door answer "needs a one-time database update" and change nothing.
--  If this goes first: an empty table and a wider constraint, used by nothing.
--
--  Rollback (only if ever needed):
--    drop table if exists public.presence_backup_codes;
--
--  Covers: supabase/migrations/0247_backup_codes.sql
-- ===========================================================================

create table if not exists public.presence_backup_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  site_id uuid references public.presence_sites(id) on delete set null,
  code_hash text not null check (char_length(code_hash) = 64),
  salt text not null check (char_length(salt) between 32 and 128),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists presence_backup_codes_user_idx
  on public.presence_backup_codes (user_id);
create index if not exists presence_backup_codes_unused_idx
  on public.presence_backup_codes (user_id) where used_at is null;

alter table public.presence_backup_codes enable row level security;

comment on table public.presence_backup_codes is
  'Item 347: a backup code for two-step sign-in, kept only as sha256(salt|CODE). Ten per set, made and shown once by the page; used_at marks the one use. Service role only.';

alter table public.presence_fresh_codes drop constraint if exists presence_fresh_codes_action_check;
alter table public.presence_fresh_codes add constraint presence_fresh_codes_action_check
  check (action in ('invite_coowner', 'transfer', 'domain_remove', 'close_account', 'two_step_off'));


-- Verify (expect: 7 columns; then 2 index names plus the primary key; then true; then 0; then a row whose definition names two_step_off):
-- select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'presence_backup_codes';
-- select indexname from pg_indexes where tablename = 'presence_backup_codes' order by indexname;
-- select relrowsecurity from pg_class where relname = 'presence_backup_codes';
-- select count(*) from public.presence_backup_codes;
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'presence_fresh_codes_action_check';
