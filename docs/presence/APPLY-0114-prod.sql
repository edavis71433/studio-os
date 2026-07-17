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
--  Wrapped in one transaction = all-or-nothing.
--
--  Covers:
--    0114  inbound-email idempotency → external_id + partial unique index on
--          presence_support_messages AND presence_support_requests (CRM slice 6)
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 0114 · Inbound-email idempotency keys ────────────────────────────────────
-- external_id = the RFC Message-Id of the landed email (or the svix id fallback).
-- Resend retries a webhook until 2xx, so the same email can arrive twice; this key
-- + the partial unique index below make a re-delivery a no-op.
alter table public.presence_support_messages add column if not exists external_id text;
alter table public.presence_support_requests add column if not exists external_id text;

-- Per-table dedup: at most one row per (site, external_id) when external_id is set.
-- HONEST SCOPE: each index guards its OWN table only. A same-table retry is caught
-- atomically; the cross-table race (message vs request) is narrowed by the route's
-- re-check but NOT closed by these indexes. Partial so legacy keyless rows are
-- unaffected. RLS is UNTOUCHED (both tables are RLS-on / policy-less from 0078).
create unique index if not exists presence_support_messages_extid_uq
  on public.presence_support_messages (site_id, external_id) where external_id is not null;
create unique index if not exists presence_support_requests_extid_uq
  on public.presence_support_requests (site_id, external_id) where external_id is not null;

commit;

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
