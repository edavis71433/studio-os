-- ===========================================================================
--  APPLY-0247  (owner-apply, prod)  ·  backup codes for two-step sign-in
-- ===========================================================================
--  Run ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE OR AFTER
--  the deploy.yml run that ships builder list item 347: either order is safe.
--  ADDITIVE and IDEMPOTENT ("if not exists"; the one constraint is dropped and
--  re-added), so it is safe to re-run. Nothing existing changes shape.
--
--  WHAT IT CREATES
--    1. public.presence_backup_codes: one row per backup code, holding only the
--       code's hash (the page makes the codes and hashes them; no code is ever
--       stored). user_id is the person's sign-in; site_id their site, when known.
--       used_at marks the one use. Row security on, no policies: the server
--       (service role) alone reads and writes it, like every presence_* table.
--    2. two indexes on it: by user, and the unused rows by user.
--    3. presence_fresh_codes.action accepts 'two_step_off' too: the fresh code a
--       studio owner types before turning off a client's two-step sign-in.
--
--  IF THE DEPLOY GOES FIRST (table not there yet): Save backup codes and the
--  lost-phone door answer 503 "needs a one-time database update" and change
--  nothing; the owner's Turn off, for owners confirming by email, can't make its
--  code until the constraint is widened. Nothing else is touched.
--  IF THIS GOES FIRST: an empty table and a wider constraint, used by nothing.
--
--  The same SQL is in docs/presence/APPLY-0247-prod.sql with its check query.
--
--  Rollback (only if ever needed):
--    drop table if exists public.presence_backup_codes;
--    (the widened constraint can stay: it only allows one more action name)
-- ===========================================================================
-- rollback: drop table if exists public.presence_backup_codes;
--   (with the table gone, saving codes and the lost-phone door answer 503 and change nothing)
--
-- ── Backup codes for two-step sign-in (builder list item 347) ──
--
-- WHY
--   Two-step sign-in (item 191) had no backup codes. A lost phone meant emailing
--   support, and clearing a second step was done by hand in Supabase.
--
-- WHAT CHANGES
--   One new table. The page makes ten codes with crypto.getRandomValues, shows them
--   once, and sends only sha256(salt|CODE) for each with the salt; a row is one hash.
--   used_at is set once, with used_at IS NULL in the WHERE, so the same code can't
--   work twice however many requests race. A new set replaces the old (every row of
--   the user's is deleted first). Row security on, no policies: service role only.
--   presence_fresh_codes.action learns 'two_step_off' (lib/fresh_code.ts), the studio
--   owner's confirmation before turning a client's two-step sign-in off for them.

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

alter table public.presence_backup_codes enable row level security;   -- deny-all; function-mediated

comment on table public.presence_backup_codes is
  'Item 347: a backup code for two-step sign-in, kept only as sha256(salt|CODE). Ten per set, made and shown once by the page; used_at marks the one use. Service role only.';

-- the fresh-code table (0197) accepts the owner's "turn off two-step" action
alter table public.presence_fresh_codes drop constraint if exists presence_fresh_codes_action_check;
alter table public.presence_fresh_codes add constraint presence_fresh_codes_action_check
  check (action in ('invite_coowner', 'transfer', 'domain_remove', 'close_account', 'two_step_off'));
