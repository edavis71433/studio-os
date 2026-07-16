-- ── Wave-2 G11: per-section annotations & review comments ────────────────────
-- The agency↔client collaboration gap (Adobe AC-7/WF-6 parity, SMB-shaped):
-- comment threads on the DRAFT, keyed by page slug + stable section (block) id.
-- block_id null/'' = the whole page. Two author kinds: the operator (signed-in,
-- via /comments) and the client (via the signed, expiring share-link token —
-- the same authorization as the /p/s/:token draft door; no account needed).
-- Additive; the code is deploy-order-tolerant (routes degrade to empty/calm
-- errors until this is applied). body length (≤2000) is enforced in code.
create table if not exists public.presence_section_comments (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null,
  page_slug text not null default '',            -- '' = the home page
  block_id text,                                 -- stable section id; null/'' = whole page
  author_kind text not null check (author_kind in ('operator','client')),
  author_key text,                               -- operator: user id/email; client: not stored (no PII)
  body text not null,                            -- ≤2000 chars, enforced in code
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  deleted_at timestamptz
);
create index if not exists idx_section_comments_site_status
  on public.presence_section_comments (site_id, status) where deleted_at is null;
-- service-role only (the edge function mediates every read/write, like
-- presence_deal_tasks in 0108); no anon/authenticated policy — deny-all.
alter table public.presence_section_comments enable row level security;
