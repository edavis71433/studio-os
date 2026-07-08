-- ── Phase D1: activate the two new editions commercially ─────────────────────
-- The packaging layer (commerce/editions.ts) already supports CMS-Only and
-- Business-OS-Only; this makes them SELLABLE by widening the entitlement `plan`
-- CHECK to accept their rungs. Same table, same licensing architecture — no new
-- commerce system. Additive: existing rows/values unaffected. Idempotent.
alter table public.presence_entitlements
  drop constraint if exists presence_entitlements_plan_check;
alter table public.presence_entitlements
  add constraint presence_entitlements_plan_check
  check (plan in ('presence_monitor','cms_only','business_os_only','presence','presence_managed','agency','enterprise'));
comment on column public.presence_entitlements.plan is
  'Phase D1. The licensed rung: presence_monitor|cms_only|business_os_only|presence|presence_managed|agency|enterprise. Maps to a feature edition via commerce/editions.ts editionFromPlan; drives nav automatically.';

-- rollback (only safe if no cms_only/business_os_only rows exist):
--   alter table public.presence_entitlements drop constraint if exists presence_entitlements_plan_check;
--   alter table public.presence_entitlements add constraint presence_entitlements_plan_check
--     check (plan in ('presence_monitor','presence','presence_managed','agency','enterprise'));
