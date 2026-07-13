-- ═══════════════════════════════════════════════════════════════════════════
--  APPLY PACK · migrations 0094–0098  (owner-apply, staging + prod)
-- ═══════════════════════════════════════════════════════════════════════════
--  Run this ONCE on each environment (Supabase → SQL Editor, or psql).
--  Everything is ADDITIVE and IDEMPOTENT (add column / index / constraint
--  "if not exists" or drop-then-recreate), so it is safe to re-run.
--  The presence function already degrades gracefully until this is applied —
--  the new features simply stay dormant, nothing breaks.
--
--  Wrapped in one transaction = all-or-nothing.
--
--  Covers, in order (the notice-kind CHECK is widened cumulatively by 94/95/96):
--    0094  uptime heartbeat        → presence_sites.uptime_* + 'site_down' notice
--    0095  service edges           → presence_settings.saved_replies/customer_faq + 'support_aging'
--    0096  retainers + renewals    → presence_deals.retainer + 'agreement_renewal'
--    0097  contact custom fields   → presence_contacts.custom
--    0098  broadcasts              → presence_broadcasts + presence_broadcast_sends
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 0094 · Uptime heartbeat ─────────────────────────────────────────────────
alter table public.presence_sites
  add column if not exists uptime_ok boolean,
  add column if not exists uptime_fail_streak integer not null default 0,
  add column if not exists uptime_checked_at timestamptz;
create index if not exists presence_sites_uptime_cursor_idx
  on public.presence_sites (uptime_checked_at asc nulls first)
  where status in ('ready','live');

-- ── 0095 · Service edges (settings columns) ─────────────────────────────────
alter table public.presence_settings
  add column if not exists saved_replies jsonb,
  add column if not exists customer_faq jsonb;

-- ── 0096 · Retainers (deal column + index) ──────────────────────────────────
alter table public.presence_deals
  add column if not exists retainer jsonb;
create index if not exists presence_deals_retainer_sub_idx
  on public.presence_deals ((retainer->>'stripe_subscription_id')) where retainer is not null;

-- ── 0094+0095+0096 · Notice-kind whitelist (final cumulative list) ───────────
alter table public.presence_plan_notices
  drop constraint if exists presence_plan_notices_kind_check;
alter table public.presence_plan_notices
  add constraint presence_plan_notices_kind_check
  check (kind in (
    'capacity','trial_ending','trial_ended','payment_trouble','account_lapsed',
    'search_setup','winddown_reminder','win_back','welcome_back',
    'deletion_requested','domain_expiry','lead_followup','renewal_reminder',
    'deal_signed','deal_followup','publish_failed','invoice_paid',
    'connection_expired','website_enquiry','approval_decided',
    'site_down',           -- 0094
    'support_aging',       -- 0095
    'agreement_renewal'    -- 0096
  ));

-- ── 0097 · Contact custom fields ────────────────────────────────────────────
alter table public.presence_contacts
  add column if not exists custom jsonb not null default '{}';

-- ── 0098 · Broadcasts (two tables) ──────────────────────────────────────────
create table if not exists public.presence_broadcasts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  subject text not null default '',
  body text not null default '',
  audience text not null default 'contacts',
  status text not null default 'draft'
    check (status in ('draft','scheduled','sending','sent','canceled')),
  scheduled_at timestamptz,
  sent_at timestamptz,
  recipient_count integer not null default 0,
  sent_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists presence_broadcasts_site_idx
  on public.presence_broadcasts (site_id, created_at desc);
create index if not exists presence_broadcasts_due_idx
  on public.presence_broadcasts (scheduled_at) where status = 'scheduled';
alter table public.presence_broadcasts enable row level security;

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
alter table public.presence_broadcast_sends enable row level security;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  Done. Verify (optional):
--    select count(*) from information_schema.columns
--      where table_name='presence_sites' and column_name='uptime_ok';        -- 1
--    select to_regclass('public.presence_broadcasts');                        -- not null
-- ═══════════════════════════════════════════════════════════════════════════
