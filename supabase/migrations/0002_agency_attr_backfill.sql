-- 0002_agency_attr_backfill.sql
-- rollback: none required — this is an idempotent, re-runnable data copy that
--           only writes to the tenants row(s) it can match. To undo, null the
--           three columns on tenants (see block below). No agencies row or
--           business row is modified.
--
-- WHAT / WHY
--   Preserve intent before `agencies` is dropped (0005). `agencies` holds three
--   attributes the platform will need — plan, brand, owner_email — that 0001
--   just added to `tenants`. Copy them from the agency whose id matches the
--   tenant id (both lineages default to the same DDS uuid). Only fills columns
--   that are still empty on the tenant, so re-running never clobbers a value an
--   operator set by hand later.
--
--   Guarded to a no-op if `agencies` is already gone (e.g. migration re-applied
--   after 0005 on another environment).
-- ============================================================================

do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'agencies') then
    update "public"."tenants" t
       set "plan"        = coalesce(t."plan", a."plan"),
           "brand"       = case when t."brand" = '{}'::jsonb then coalesce(a."brand", '{}'::jsonb) else t."brand" end,
           "owner_email" = coalesce(t."owner_email", a."owner_email")
      from "public"."agencies" a
     where a."id" = t."id";
  end if;
end
$$;

-- ============================================================================
-- ROLLBACK (only if you must undo the copy):
--   update "public"."tenants" set "plan" = null, "owner_email" = null,
--          "brand" = '{}'::jsonb
--    where "id" = '00000000-0000-0000-0000-000000000001';
-- (Values are re-derivable from agencies until 0005 drops it.)
-- ============================================================================
