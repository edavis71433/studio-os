-- ═══════════════════════════════════════════════════════════════════════════
--  APPLY PACK · migration 0113  (owner-apply, staging + prod)
-- ═══════════════════════════════════════════════════════════════════════════
--  Run this ONCE on each environment (Supabase → SQL Editor, or psql).
--  Everything is ADDITIVE and IDEMPOTENT (create table "if not exists"), so it
--  is safe to re-run.
--  The presence function already degrades gracefully until this is applied —
--  the Inbox's per-thread unread dots simply fall back to the old needs-reply
--  heuristic, and POST /threads/read quietly no-ops.
--
--  Wrapped in one transaction = all-or-nothing.
--
--  Covers:
--    0113  per-thread read marks → presence_thread_reads table (Inbox slice 2)
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 0113 · Per-thread read marks (Inbox split view, slice 2) ─────────────────
-- Salesforce Split View parity: real per-conversation unread dots. One row per
-- (site, reader, thread) recording when that reader last opened the thread.
-- reader = the same text key presence_activity_reads uses (auth user id or
-- email). thread_key is an allowlisted opaque key ('client:…' | 'support:…' |
-- 'lead:…'), validated in code.
create table if not exists public.presence_thread_reads (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null,
  reader text not null,
  thread_key text not null,
  last_seen_at timestamptz not null default now(),
  unique (site_id, reader, thread_key)
);
-- service-role only (the edge function bypasses RLS); no anon/authenticated policy.
alter table public.presence_thread_reads enable row level security;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  Done. Verify (optional):
--    select to_regclass('public.presence_thread_reads');                       -- not null
--    select relrowsecurity from pg_class
--      where oid = 'public.presence_thread_reads'::regclass;                   -- true
-- ═══════════════════════════════════════════════════════════════════════════
