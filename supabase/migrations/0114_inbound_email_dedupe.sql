-- ── Slice 6 (Inbound email capture): idempotency keys for landed email ────────
-- A client's email reply enters via the pre-auth /email/inbound webhook and lands
-- as EITHER a new support request OR a reply on an existing one. Resend retries a
-- webhook until it gets a 2xx, so the SAME email can be delivered more than once —
-- external_id (the RFC Message-Id, or the svix id as a fallback) is the dedup key.
--
-- One partial unique index PER TABLE on (site_id, external_id). HONEST SCOPE: each
-- index guards its OWN table only — a same-table retry is caught atomically, but a
-- cross-table race (the code re-checks BOTH tables right before insert, yet a
-- sub-second window remains) is NOT claimed to be closed by these indexes. The
-- route degrades gracefully until this is applied: alreadyLanded() treats a
-- missing column as "not landed", and insertDeduped() retries once WITHOUT the key
-- on the precise missing-column signal (PGRST204 / 42703).
--
-- Additive + idempotent (add column if not exists, create index if not exists);
-- RLS is UNTOUCHED (both tables were already RLS-on/policy-less from 0078).

alter table public.presence_support_messages add column if not exists external_id text;
alter table public.presence_support_requests add column if not exists external_id text;

-- Per-table dedup: at most one row per (site, external_id) when external_id is set.
-- Partial (where external_id is not null) so the millions of legacy rows without a
-- key are unaffected.
create unique index if not exists presence_support_messages_extid_uq
  on public.presence_support_messages (site_id, external_id) where external_id is not null;
create unique index if not exists presence_support_requests_extid_uq
  on public.presence_support_requests (site_id, external_id) where external_id is not null;

-- ── Rollback (manual) ────────────────────────────────────────────────────────
-- drop index if exists public.presence_support_messages_extid_uq;
-- drop index if exists public.presence_support_requests_extid_uq;
-- alter table public.presence_support_messages drop column if exists external_id;
-- alter table public.presence_support_requests drop column if exists external_id;
