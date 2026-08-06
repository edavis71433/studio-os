-- ── Comms routing fix (F3): write-time client identity + project-message dedup ─
-- Two structural gaps let a known client's messages drift into anonymous support
-- rows: (1) support requests carried NO durable link to the client — read paths
-- re-derived it by string-matching requester keys (auth uuid / stored emails),
-- which silently fails for an alternate address or a GoTrue-resolved uid; and
-- (2) inbound email could not land on presence_project_messages idempotently
-- because that table had no external_id (the 0114 dedup key exists only on the
-- support tables).
--
--   • presence_support_requests.client_id — stamped AT WRITE TIME by every
--     support-request writer when the requester resolves to a client
--     (client_delivery, service_intake, inbound_email). Read paths PREFER it and
--     fall back to the legacy key-matching for old rows. Nullable: anonymous /
--     contact-only requesters stay unstamped. on delete set null (0075's
--     convention for optional client links) — a deleted client must never
--     cascade away its support history.
--   • presence_project_messages.external_id — the inbound Message-Id (or svix id)
--     so a matched client's EMAIL reply can land on the project thread with the
--     same idempotency contract 0114 gave the support tables. Same partial
--     unique index shape: at most one row per (site, external_id) when set;
--     legacy rows (external_id null) are unaffected.
--
-- The functions degrade gracefully until this is applied: inserts retry once
-- without the missing column on the precise missing-column signal (PGRST204 /
-- 42703), and the widened feed select falls back to the old column list.
--
-- Additive + idempotent; RLS UNTOUCHED (both tables are RLS-on/policy-less,
-- function-mediated — 0077/0078).

alter table public.presence_support_requests add column if not exists client_id uuid references public.clients(id) on delete set null;
alter table public.presence_project_messages add column if not exists external_id text;

-- the read paths' preferred lookup: a site's tickets for one client
create index if not exists presence_support_client_idx
  on public.presence_support_requests (site_id, client_id) where client_id is not null and deleted_at is null;

-- per-table dedup, mirroring 0114's shape exactly
create unique index if not exists presence_project_messages_extid_uq
  on public.presence_project_messages (site_id, external_id) where external_id is not null;

-- ── Rollback (manual) ────────────────────────────────────────────────────────
-- drop index if exists public.presence_project_messages_extid_uq;
-- drop index if exists public.presence_support_client_idx;
-- alter table public.presence_project_messages drop column if exists external_id;
-- alter table public.presence_support_requests drop column if exists client_id;
