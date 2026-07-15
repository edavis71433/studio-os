-- ═══════════════════════════════════════════════════════════════════════════
--  APPLY PACK · migration 0109  (owner-apply, staging + prod)
-- ═══════════════════════════════════════════════════════════════════════════
--  Run this ONCE on each environment (Supabase → SQL Editor, or psql).
--  Two hot-path indexes (#169 optimization pass) — additive + idempotent,
--  zero behavior change, safe to re-run.
--
--    0109  presence_plan_notices (site_id, status)      — the bell count read
--          presence_service_links (agency_site_id, status) — operator feed/bridge
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create index if not exists presence_plan_notices_site_status_idx
  on public.presence_plan_notices (site_id, status);
create index if not exists presence_service_links_agency_idx
  on public.presence_service_links (agency_site_id, status);

commit;

-- Verify (optional):
--   select indexname from pg_indexes where tablename='presence_plan_notices';   -- includes presence_plan_notices_site_status_idx
--   select indexname from pg_indexes where tablename='presence_service_links';  -- includes presence_service_links_agency_idx
