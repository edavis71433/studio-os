-- 0003_org_scope_converge.sql
-- rollback: re-add the dropped column (see block below). organizations.agency_id
--           carried the same value as organizations.tenant_id (both default to
--           the DDS uuid), so no information is lost.
--
-- WHAT / WHY
--   `organizations` is a CRM grouping of client companies, not a tenant
--   boundary, yet it carries BOTH agency_id and tenant_id. Converge it onto the
--   canonical tenant axis: ensure tenant_id is populated, then drop the
--   redundant agency_id (and its FK to the soon-to-be-dropped agencies).
--
--   PRE-FLIGHT GATE: refuse to run if any organizations row has an agency_id
--   that differs from its tenant_id — that would mean the two axes diverged and
--   this convergence is unsafe. On the DDS data they are identical.
-- ============================================================================

do $$
declare mismatched int;
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='organizations' and column_name='agency_id') then

    select count(*) into mismatched
      from "public"."organizations"
     where "agency_id" is distinct from "tenant_id";

    if mismatched > 0 then
      raise exception '0003 aborted: % organizations rows have agency_id <> tenant_id; reconcile before converging', mismatched;
    end if;

    -- belt-and-suspenders: make sure tenant_id is never null before we lean on it
    update "public"."organizations" set "tenant_id" = "agency_id" where "tenant_id" is null;

    alter table "public"."organizations" drop constraint if exists "organizations_agency_id_fkey";
    alter table "public"."organizations" drop column if exists "agency_id";
  end if;
end
$$;

-- ============================================================================
-- ROLLBACK:
--   alter table "public"."organizations"
--     add column if not exists "agency_id" "uuid"
--       default '00000000-0000-0000-0000-000000000001'::uuid not null;
--   update "public"."organizations" set "agency_id" = "tenant_id";
--   -- (FK to agencies is intentionally NOT restored; agencies is being retired.)
-- ============================================================================
