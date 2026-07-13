-- ── 0098 — Owner broadcasts (composed, approved, per-send email to a list) ────
-- The platform had only transactional + lifecycle ONE-recipient email. This adds
-- the one genuinely-stateful thing a broadcast needs: a saved, owner-approved
-- message + its schedule + status + a per-recipient send log. It does NOT add a
-- second mailer — dispatch reuses commerce/account.ts sendEmail, so the
-- suppression gate (isSuppressed/maySend) and the RFC-8058 one-click
-- List-Unsubscribe header are inherited at the ONE send point. Nothing here
-- auto-sends: a row reaches 'scheduled' or 'sent' only by an explicit owner
-- action; the cron merely DISPATCHES a send the owner already approved, at its
-- due time.
--
-- Additive + deploy-order-tolerant: the routes + sweep degrade gracefully before
-- this is applied (reads return empty, the sweep no-ops, the composer shows the
-- feature as simply unavailable) — mirrors the 0094–0097 posture. Safe to re-run.
-- OWNER-APPLY: apply on staging + prod before the broadcasts surface goes live.

create table if not exists public.presence_broadcasts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  subject text not null default '',
  body text not null default '',                 -- markdown source (rendered safely at send)
  audience text not null default 'contacts',     -- segment key (validated in lib/broadcast.ts)
  status text not null default 'draft'
    check (status in ('draft','scheduled','sending','sent','canceled')),
  scheduled_at timestamptz,                       -- when a scheduled send is due
  sent_at timestamptz,
  recipient_count integer not null default 0,     -- sendable count at dispatch (post-suppression)
  sent_count integer not null default 0,
  skipped_count integer not null default 0,       -- suppressed / opted-out / invalid
  failed_count integer not null default 0,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists presence_broadcasts_site_idx
  on public.presence_broadcasts (site_id, created_at desc);
-- the sweep's claim query: due scheduled sends, oldest first
create index if not exists presence_broadcasts_due_idx
  on public.presence_broadcasts (scheduled_at)
  where status = 'scheduled';
alter table public.presence_broadcasts enable row level security;  -- deny-all; function-mediated

-- Per-recipient send log — the audit trail AND the send-once guard. The unique
-- index on (broadcast_id, lower(email)) means a retried dispatch (a mid-send
-- crash, a re-claimed scheduled row) never double-mails an address.
create table if not exists public.presence_broadcast_sends (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.presence_broadcasts(id) on delete cascade,
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  email text not null,
  status text not null default 'sent'
    check (status in ('sent','skipped_suppressed','failed')),
  reason text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists presence_broadcast_sends_uq
  on public.presence_broadcast_sends (broadcast_id, lower(email));
create index if not exists presence_broadcast_sends_bcast_idx
  on public.presence_broadcast_sends (broadcast_id, created_at);
alter table public.presence_broadcast_sends enable row level security;  -- deny-all

comment on table public.presence_broadcasts is
  'Owner-approved broadcast emails (composed → previewed → EXPLICITLY sent/scheduled per-send). Dispatch reuses the ONE deliverability-grade send path (commerce/account.ts sendEmail: suppression + RFC-8058 one-click unsubscribe). Nothing auto-sends. Deny-all RLS; function-mediated.';
comment on table public.presence_broadcast_sends is
  'Per-recipient broadcast send log: the audit trail + the send-once guard (unique per broadcast+email). Deny-all RLS; function-mediated.';

-- rollback:
--   drop table if exists public.presence_broadcast_sends;
--   drop table if exists public.presence_broadcasts;
