-- ── 0094 · Uptime heartbeat — real "always up", per-site probe state ─────────
-- The DNS/hosting study's #1 business-continuity gap: nothing ever FETCHED a
-- hosted site's live URL — health was only inferred from publish state, so an
-- outage (DNS lapse, hosting incident, cert expiry) was invisible until a
-- customer complained. monitor/heartbeat.ts now probes each live hosted site
-- every tick; this migration is its two dependencies.
--
-- ROUTES ARE DORMANT UNTIL THIS IS APPLIED (owner-apply, like 0075-0079):
-- runUptimeHeartbeat selects these columns; pre-apply the select 400s and the
-- sweep no-ops cleanly (skipped_unmigrated). Additive only; safe to re-run.
--
-- 1. Per-site probe memory. The confirmed-down guard needs to remember the prior
--    probe to require TWO consecutive failures before alerting (no false alarms
--    on a single blip). No suitable existing per-site store held arbitrary probe
--    state — presence_scheduled_runs is a sweep-execution ledger (a down site is
--    NOT a scheduler failure, and writing it there would trip the failure
--    watchdog), and presence_plan_notices is customer-visible. Three columns on
--    the site row, mirroring the domain-watch precedent (0060), is the clean fit.
alter table public.presence_sites
  add column if not exists uptime_ok boolean,                              -- last probe: reachable 2xx/3xx? (null = never probed)
  add column if not exists uptime_fail_streak integer not null default 0,  -- consecutive failed probes (>=2 = confirmed down)
  add column if not exists uptime_checked_at timestamptz;                  -- also the rotation cursor for the heartbeat sweep
comment on column public.presence_sites.uptime_fail_streak is
  'Consecutive failed uptime probes. Alert fires at 2 (DOWN_THRESHOLD) so a single blip never pages the owner; reset to 0 on any reachable probe.';
create index if not exists presence_sites_uptime_cursor_idx
  on public.presence_sites (uptime_checked_at asc nulls first)
  where status in ('ready','live');

-- 2. Widen the ONE notice model's kind whitelist to admit 'site_down'. Every new
--    notice kind requires this (see 0060/0061/0062/0088) — the check is enforced
--    and raiseNotice is best-effort, so an un-whitelisted kind fails SILENTLY.
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
    -- added by 0094:
    'site_down'
  ));

-- rollback: delete site_down notices; restore the 0088 kind check; drop the
-- three uptime_* columns and the cursor index.
