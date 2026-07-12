-- ── 0093 · presence_scheduled_runs (created_at desc) index ───────────────────
-- The health endpoint (watchdog-probed every 5 minutes) reads the latest tick
-- and counts 24h failures ordered/filtered by created_at; the existing indexes
-- cover (status, scheduled_for) and (site_id, created_at) only. At 500 sites
-- the 90-day ledger is ~350k rows — this keeps the liveness read flat.
-- Rollback: drop index presence_scheduled_runs_created_idx;
create index if not exists presence_scheduled_runs_created_idx
  on public.presence_scheduled_runs (created_at desc);
