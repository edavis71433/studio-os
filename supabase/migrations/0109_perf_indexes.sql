-- ── #169 optimization pass: two missing hot-path indexes ─────────────────────
-- presence_plan_notices is read by (site_id, status='active') on EVERY signed-in
-- page boot (the bell count in /portal/context, workspace.ts:122) and every feed
-- (workspace.ts:245) — but its only index is the unique (client_id, kind, period).
-- presence_service_links is scanned by (agency_site_id, status='active') on every
-- operator feed (workspace.ts:358) and bridge lookup (service_bridge.ts:107) —
-- its 0079 indexes cover only the customer side. Both additive + idempotent.
create index if not exists presence_plan_notices_site_status_idx
  on public.presence_plan_notices (site_id, status);
create index if not exists presence_service_links_agency_idx
  on public.presence_service_links (agency_site_id, status);
