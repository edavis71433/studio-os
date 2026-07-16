-- ── Slice 2 (Inbox split view): per-thread read marks ─────────────────────────
-- Real per-conversation unread dots (Salesforce Split View parity): one row per
-- (site, reader, thread) recording when that reader last opened the thread.
-- reader = the same text key presence_activity_reads uses (auth user id or
-- email; customer side would be 'client:<id>'). thread_key is an allowlisted
-- opaque key ('client:…' | 'support:…' | 'lead:…'), validated in code.
-- Additive; the code is deploy-order-tolerant (unread falls back to the old
-- needs-reply heuristic and POST /threads/read no-ops until this is applied).
create table if not exists public.presence_thread_reads (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null,
  reader text not null,
  thread_key text not null,
  last_seen_at timestamptz not null default now(),
  unique (site_id, reader, thread_key)
);
-- service-role only (the edge function mediates every read/write, like
-- presence_section_comments in 0112); no anon/authenticated policy — deny-all.
alter table public.presence_thread_reads enable row level security;
