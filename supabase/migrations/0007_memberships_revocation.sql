-- 0007_memberships_revocation.sql
-- rollback: see the "-- ROLLBACK" block at the bottom. Reversible: drops only
--           the column/trigger/function this migration adds. No data touched.
--
-- WHAT / WHY
--   Revocation stage of the request pipeline (pipeline-design.md §2, decision
--   locked by Eric 2026-07-05: immediate reject, no grace period).
--
--   The pipeline rejects a request when the caller's membership row was
--   modified AFTER their JWT was issued (updated_at > token iat) — so a role
--   downgrade or removal takes effect within minutes, not at token expiry.
--   memberships has no updated_at today; this adds it plus a touch trigger
--   (same pattern as tenants_touch from 0001).
--
--   Backfill: existing rows get updated_at = created_at (their last known
--   modification), NOT now() — otherwise every currently-issued token would be
--   instantly "stale" the moment revocation ships, logging everyone out.
-- ============================================================================

alter table "public"."memberships"
  add column if not exists "updated_at" timestamp with time zone;

-- backfill BEFORE setting the default, so pre-existing rows carry created_at
update "public"."memberships"
   set "updated_at" = "created_at"
 where "updated_at" is null;

alter table "public"."memberships"
  alter column "updated_at" set default now(),
  alter column "updated_at" set not null;

create or replace function "public"."memberships_touch_updated_at"()
returns trigger language plpgsql as $$
begin
  new."updated_at" = now();
  return new;
end
$$;

drop trigger if exists "memberships_touch" on "public"."memberships";
create trigger "memberships_touch"
  before update on "public"."memberships"
  for each row execute function "public"."memberships_touch_updated_at"();

-- ============================================================================
-- ROLLBACK (run manually if this migration must be reversed):
--   drop trigger if exists "memberships_touch" on "public"."memberships";
--   drop function if exists "public"."memberships_touch_updated_at"();
--   alter table "public"."memberships" drop column if exists "updated_at";
-- No membership data is affected by either apply or rollback (the column is
-- derived bookkeeping; role/tenant/user columns are untouched).
-- ============================================================================
