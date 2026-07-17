-- ═══════════════════════════════════════════════════════════════════════════
--  APPLY PACK · migration 0114  (owner-apply, staging + prod)
-- ═══════════════════════════════════════════════════════════════════════════
--  Run this ONCE on each environment (Supabase → SQL Editor).
--  Everything is ADDITIVE and IDEMPOTENT (add column "if not exists", create
--  index "if not exists"), so it is safe to re-run.
--  The presence function already degrades gracefully until this is applied — the
--  inbound-email route treats a missing external_id column as "not landed" and
--  retries its insert WITHOUT the key on the precise missing-column signal, so
--  email still lands (only the DB-level dedup guard is inactive) pre-apply.
--
--  NOTE (why NOT `concurrently`): the Supabase SQL Editor wraps every run in a
--  transaction, and CREATE INDEX CONCURRENTLY refuses to run inside one
--  (ERROR 25001). A plain build takes a brief write-blocking lock, which is
--  fine here: both support tables are small and the inbound-email door is
--  dormant until the Resend dashboard setup is done. If these tables are ever
--  large AND hot, run the CONCURRENTLY variant via psql instead (one statement
--  at a time, no transaction).
--
--  Covers:
--    0114  inbound-email idempotency → external_id + partial unique index on
--          presence_support_messages AND presence_support_requests (CRM slice 6)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Idempotency columns ──────────────────────────────────────────────────────
-- external_id = the RFC Message-Id of the landed email (or the svix id fallback).
-- Resend retries a webhook until 2xx, so the same email can arrive twice; this key
-- + the partial unique indexes below make a re-delivery a no-op.
alter table public.presence_support_messages add column if not exists external_id text;
alter table public.presence_support_requests add column if not exists external_id text;

-- ── Dedup indexes ────────────────────────────────────────────────────────────
-- Per-table dedup: at most one row per (site, external_id) when external_id is set.
-- HONEST SCOPE: each index guards its OWN table only. A same-table retry is caught
-- atomically; the cross-table race (message vs request) is narrowed by the route's
-- re-check but NOT closed by these indexes. Partial so legacy keyless rows are
-- unaffected. RLS is UNTOUCHED (both tables are RLS-on / policy-less from 0078).
create unique index if not exists presence_support_messages_extid_uq
  on public.presence_support_messages (site_id, external_id) where external_id is not null;
create unique index if not exists presence_support_requests_extid_uq
  on public.presence_support_requests (site_id, external_id) where external_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
--  Done. Verify (optional):
--    select indexname from pg_indexes
--      where indexname in ('presence_support_messages_extid_uq',
--                          'presence_support_requests_extid_uq');               -- two rows
--    select i.indexrelid::regclass as idx, i.indisvalid from pg_index i
--      where i.indexrelid::regclass::text like 'presence_support_%extid_uq';    -- both true
--
--  Rollback (manual, if ever needed):
--    drop index if exists public.presence_support_messages_extid_uq;
--    drop index if exists public.presence_support_requests_extid_uq;
--    alter table public.presence_support_messages drop column if exists external_id;
--    alter table public.presence_support_requests drop column if exists external_id;
-- ═══════════════════════════════════════════════════════════════════════════
