-- rollback: drop table if exists public.platform_account_checks;
--
-- ── The outside accounts Studio OS depends on, checked each quarter (builder list item 398) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. Until the table exists the Health
-- page's new card lists the accounts as never checked, and its "I checked these" button
-- says it couldn't save.
--
-- WHY (Nov 22 2026 review, file 07 finding 6, file 10)
--   The settings that matter in outside accounts (new sign-ups off, confirm email on, the
--   leaked-password check, two-step sign-in at Supabase, GitHub, Netlify, Stripe and
--   Resend) are written down nowhere and nothing checks them. A rebuild wouldn't bring
--   them back, and a switch flipped by mistake would go unnoticed.
--
-- WHAT CHANGES
--   One small table: for each account on the Health page's list, when the platform's
--   owner last ticked it as checked, and who. The list itself (what to check, where) is in
--   the server's code, so it can't drift from the card. Only the server's own key reads or
--   writes it; row security on, no rules, no grants to the public roles.

create table if not exists public.platform_account_checks (
  account text primary key check (account ~ '^[a-z][a-z0-9_]{1,30}$'),
  checked_at timestamptz not null default now(),
  checked_by text not null default ''
);

alter table public.platform_account_checks enable row level security;
revoke all on table public.platform_account_checks from anon, authenticated, public;

comment on table public.platform_account_checks is
  'Builder item 398: the last time the platform owner checked each outside account Studio OS depends on (the list lives in presence/lib/outside_accounts.ts). Server key only.';
