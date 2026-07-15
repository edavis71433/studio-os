-- ═══════════════════════════════════════════════════════════════════════════
--  APPLY PACK · migrations 0107–0108  (owner-apply, staging + prod)
-- ═══════════════════════════════════════════════════════════════════════════
--  Run this ONCE on each environment (Supabase → SQL Editor, or psql).
--  Everything is ADDITIVE and IDEMPOTENT (add column / create table / index
--  "if not exists"), so it is safe to re-run.
--  The presence function already degrades gracefully until this is applied —
--  proposal viewed/expiry tracking and deal to-dos simply stay dormant.
--
--  Wrapped in one transaction = all-or-nothing.
--
--  Covers, in order:
--    0107  proposal tracking  → presence_proposals.first_viewed_at / expires_at (#205)
--    0108  deal to-dos        → presence_deal_tasks table (#203)
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 0107 · Proposal viewed-tracking + expiry (#205) ─────────────────────────
-- first_viewed_at: stamped the first time a prospect opens the proposal's public
--   link, so the operator knows it landed (a Salesforce open-tracking parity).
-- expires_at: an optional expiry; acceptance is blocked once past (default 30 days
--   set on send). Both are nullable + additive.
alter table public.presence_proposals add column if not exists first_viewed_at timestamptz;
alter table public.presence_proposals add column if not exists expires_at timestamptz;

-- ── 0108 · First-class deal tasks (#203) ─────────────────────────────────────
-- Salesforce Activities parity: real to-dos per deal — multiple, each with a due
-- date and a done-state — kept separate from PROJECT delivery tasks
-- (presence_tasks, which are post-sale).
create table if not exists public.presence_deal_tasks (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null,
  deal_id uuid not null,
  title text not null,
  due_date date,
  status text not null default 'open',           -- open | done
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  deleted_at timestamptz
);
create index if not exists idx_deal_tasks_deal on public.presence_deal_tasks (site_id, deal_id) where deleted_at is null;
-- service-role only (the edge function bypasses RLS); no anon/authenticated policy.
alter table public.presence_deal_tasks enable row level security;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  Done. Verify (optional):
--    select count(*) from information_schema.columns
--      where table_name='presence_proposals'
--        and column_name in ('first_viewed_at','expires_at');                 -- 2
--    select to_regclass('public.presence_deal_tasks');                        -- not null
--    select relrowsecurity from pg_class
--      where oid = 'public.presence_deal_tasks'::regclass;                    -- true
-- ═══════════════════════════════════════════════════════════════════════════
