-- 0001_tenants_enrich.sql
-- rollback: see the "-- ROLLBACK" block at the bottom of this file. Reversible:
--           drops only the columns/enum this migration adds; touches no other
--           table and no business data.
--
-- WHAT / WHY
--   `tenants` today is minimal (id, name, slug, created_at). The tenancy work
--   (Build Brief section 8) needs a lifecycle state machine on it, and the
--   platform needs the attributes currently stranded on the dead `agencies`
--   table (plan, brand, owner_email) to live on the canonical tenant instead.
--   This migration ADDS those columns and a tenant_state enum. It is additive
--   only: no column is dropped, no row is deleted, no other table is touched.
--
--   Lifecycle states are the exact set from the brief:
--     trialing, active, past_due, suspended, closed, purge_scheduled
--   Existing tenants default to 'active' (production tenant #1 is live).
-- ============================================================================

-- 1) Lifecycle state enum (guarded so re-running is safe).
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tenant_state') then
    create type "public"."tenant_state" as enum (
      'trialing', 'active', 'past_due', 'suspended', 'closed', 'purge_scheduled'
    );
  end if;
end
$$;

-- 2) Additive columns on tenants. IF NOT EXISTS makes each idempotent.
alter table "public"."tenants"
  add column if not exists "state"       "public"."tenant_state" not null default 'active',
  add column if not exists "plan"        "text",
  add column if not exists "brand"       "jsonb" not null default '{}'::jsonb,
  add column if not exists "owner_email" "text",
  add column if not exists "updated_at"  timestamp with time zone not null default now(),
  add column if not exists "deleted_at"  timestamp with time zone;

-- 3) Backfill: every existing tenant is an active, live tenant. The default
--    already sets this for new rows; this is explicit for any pre-existing rows
--    (production tenant #1) so state is never null.
update "public"."tenants" set "state" = 'active' where "state" is null;

-- 4) keep updated_at honest on future edits
create or replace function "public"."tenants_touch_updated_at"()
returns trigger language plpgsql as $$
begin
  new."updated_at" = now();
  return new;
end
$$;

drop trigger if exists "tenants_touch" on "public"."tenants";
create trigger "tenants_touch"
  before update on "public"."tenants"
  for each row execute function "public"."tenants_touch_updated_at"();

-- ============================================================================
-- ROLLBACK (run manually if this migration must be reversed):
--   drop trigger if exists "tenants_touch" on "public"."tenants";
--   drop function if exists "public"."tenants_touch_updated_at"();
--   alter table "public"."tenants"
--     drop column if exists "state",
--     drop column if exists "plan",
--     drop column if exists "brand",
--     drop column if exists "owner_email",
--     drop column if exists "updated_at",
--     drop column if exists "deleted_at";
--   drop type if exists "public"."tenant_state";
-- No business data is affected by either apply or rollback.
-- ============================================================================
