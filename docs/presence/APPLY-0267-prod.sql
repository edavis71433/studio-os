-- ===========================================================================
--  APPLY PACK - migration 0267  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships builder item 398. IDEMPOTENT ("if not
--  exists"), creates one empty table, safe to re-run.
--
--  Why: builder list item 398. The settings that keep Studio OS safe live in other
--  companies' dashboards (new sign-ups off and confirm email on at Supabase, the
--  leaked-password check, two-step sign-in at Supabase, GitHub, Netlify, Stripe and
--  Resend), written down nowhere, checked by nothing. The Health page gets an
--  "Accounts Studio OS depends on" card: what to check at each, where, and a tick the
--  platform owner sets after looking, due again each quarter. This table keeps the
--  ticks; the list itself is in the server's code (presence/lib/outside_accounts.ts).
--
--  If the deploy goes first, nothing breaks: the card lists every account as never
--  checked, and the tick says it couldn't save until this has run.
--
--  Rollback (only if ever needed):
--    drop table if exists public.platform_account_checks;
--
--  Covers: supabase/migrations/0267_account_checks.sql
-- ===========================================================================

create table if not exists public.platform_account_checks (
  account text primary key check (account ~ '^[a-z][a-z0-9_]{1,30}$'),
  checked_at timestamptz not null default now(),
  checked_by text not null default ''
);

alter table public.platform_account_checks enable row level security;
revoke all on table public.platform_account_checks from anon, authenticated, public;

comment on table public.platform_account_checks is
  'Builder item 398: the last time the platform owner checked each outside account Studio OS depends on (the list lives in presence/lib/outside_accounts.ts). Server key only.';

-- ── check (read-only): expect the table, row security on, no grants to the public roles ──
select relname, relrowsecurity from pg_class
 where relnamespace = 'public'::regnamespace and relname = 'platform_account_checks';
select grantee, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'platform_account_checks' and grantee in ('anon', 'authenticated', 'PUBLIC');
