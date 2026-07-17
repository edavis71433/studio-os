-- ═══════════════════════════════════════════════════════════════════════════
--  APPLY PACK · migration 0114  (owner-apply, staging + prod)
-- ═══════════════════════════════════════════════════════════════════════════
--  Run this ONCE on each environment (Supabase → SQL Editor, or psql).
--  Everything is ADDITIVE and IDEMPOTENT (add column "if not exists", create
--  index "if not exists"), so it is safe to re-run.
--  The presence function already degrades gracefully until this is applied — the
--  inbound-email route treats a missing external_id column as "not landed" and
--  retries its insert WITHOUT the key on the precise missing-column signal, so
--  email still lands (only the DB-level dedup guard is inactive) pre-apply.
--
--  RUN ORDER (T4 — do NOT collapse back into one transaction):
--    STEP 1 (transactional): ADD the external_id columns. all-or-nothing.
--    STEP 2 (NON-transactional): build the two unique indexes CONCURRENTLY.
--  Why split: `CREATE INDEX CONCURRENTLY` CANNOT run inside a transaction block,
--  and a plain (non-concurrent) index build takes an ACCESS-EXCLUSIVE, write-
--  BLOCKING lock on the live support tables for the whole build — inbound email +
--  the portal would stall meanwhile. CONCURRENTLY builds without blocking writes.
--  (The migration file 0114 itself keeps the repo's non-concurrent convention;
--  THIS owner-run APPLY pack is the one that touches live tables, so it is made
--  concurrent-safe.) Run STEP 1, let it commit, THEN run STEP 2.
--
--  Covers:
--    0114  inbound-email idempotency → external_id + partial unique index on
--          presence_support_messages AND presence_support_requests (CRM slice 6)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── STEP 1 · add the idempotency columns (transactional) ─────────────────────
-- external_id = the RFC Message-Id of the landed email (or the svix id fallback).
-- Resend retries a webhook until 2xx, so the same email can arrive twice; this key
-- + the partial unique indexes in STEP 2 make a re-delivery a no-op.
begin;
alter table public.presence_support_messages add column if not exists external_id text;
alter table public.presence_support_requests add column if not exists external_id text;
commit;

-- ── STEP 2 · build the dedup indexes CONCURRENTLY (NO surrounding transaction) ─
-- Per-table dedup: at most one row per (site, external_id) when external_id is set.
-- HONEST SCOPE: each index guards its OWN table only. A same-table retry is caught
-- atomically; the cross-table race (message vs request) is narrowed by the route's
-- re-check but NOT closed by these indexes. Partial so legacy keyless rows are
-- unaffected. RLS is UNTOUCHED (both tables are RLS-on / policy-less from 0078).
-- CONCURRENTLY: no write-blocking lock on the live tables (cannot run in a txn).
-- IF NOT EXISTS keeps it idempotent/re-runnable. NOTE: if a CONCURRENTLY build is
-- interrupted it can leave an INVALID index — re-running this statement is safe
-- (IF NOT EXISTS skips a valid one); to clear an invalid one, DROP INDEX it first
-- (see rollback below) then re-run.
create unique index concurrently if not exists presence_support_messages_extid_uq
  on public.presence_support_messages (site_id, external_id) where external_id is not null;
create unique index concurrently if not exists presence_support_requests_extid_uq
  on public.presence_support_requests (site_id, external_id) where external_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
--  Done. Verify (optional):
--    select column_name from information_schema.columns
--      where table_name = 'presence_support_messages' and column_name = 'external_id';   -- one row
--    select indexname from pg_indexes
--      where indexname in ('presence_support_messages_extid_uq',
--                          'presence_support_requests_extid_uq');                          -- two rows
--
--  Rollback (manual, if ever needed):
--    drop index if exists public.presence_support_messages_extid_uq;
--    drop index if exists public.presence_support_requests_extid_uq;
--    alter table public.presence_support_messages drop column if exists external_id;
--    alter table public.presence_support_requests drop column if exists external_id;
-- ═══════════════════════════════════════════════════════════════════════════
