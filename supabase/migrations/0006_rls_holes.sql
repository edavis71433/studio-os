-- 0006_rls_holes.sql
-- rollback: restore the prior policy and drop the added column (see block below).
--
-- WHAT / WHY  (two items surfaced by the step-3 audit)
--
--   (1) email_templates — REAL HOLE.
--       Current policy: `authenticated USING (true) WITH CHECK (true)`. That
--       means ANY authenticated user — including a logged-in portal CLIENT —
--       can read AND write every email template. Templates are a staff-only
--       resource. email_templates has no tenant_id yet, so this migration adds
--       one (default DDS, FK to tenants) and replaces the open policy with the
--       standard tenant-scoped one. current_tenant_ids() is membership-derived,
--       so clients (who have no membership) get nothing — hole closed — and the
--       table now follows the tenant-owned standard.
--
--   (2) admins — NOT a hole, but unused.
--       Its only policy is `service_role USING (true)`; authenticated/anon get
--       nothing by default-deny, so it is not a client-facing exposure. The
--       `admins` concept was deleted from the function (verifyAdminJwt/isAdmin
--       removed). It is a drop candidate. The drop is included below but GATED
--       on row-count and left commented for an explicit decision, since dropping
--       a table is heavier than a policy change.
-- ============================================================================

-- (1) email_templates: add tenant_id + tenant-scope the policy
alter table "public"."email_templates"
  add column if not exists "tenant_id" "uuid" not null
    default '00000000-0000-0000-0000-000000000001'::uuid;

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
     where table_schema='public' and table_name='email_templates'
       and constraint_name='email_templates_tenant_id_fkey'
  ) then
    alter table "public"."email_templates"
      add constraint "email_templates_tenant_id_fkey"
      foreign key ("tenant_id") references "public"."tenants"("id");
  end if;
end
$$;

drop policy if exists "authenticated full access" on "public"."email_templates";

create policy "email_templates_staff"
  on "public"."email_templates"
  using ("tenant_id" in (select "public"."current_tenant_ids"()))
  with check ("tenant_id" in (select "public"."current_tenant_ids"()));

-- (2) admins: OPTIONAL cleanup — uncomment to drop after confirming it is unused.
-- do $$
-- declare n bigint;
-- begin
--   if exists (select 1 from information_schema.tables
--              where table_schema='public' and table_name='admins') then
--     select count(*) into n from "public"."admins";
--     raise notice 'admins has % row(s); drop is manual-opt-in in 0006', n;
--     -- drop table "public"."admins";
--   end if;
-- end $$;

-- ============================================================================
-- ROLLBACK:
--   drop policy if exists "email_templates_staff" on "public"."email_templates";
--   create policy "authenticated full access" on "public"."email_templates"
--     to "authenticated" using (true) with check (true);
--   alter table "public"."email_templates"
--     drop constraint if exists "email_templates_tenant_id_fkey";
--   alter table "public"."email_templates" drop column if exists "tenant_id";
--   -- (admins: nothing to roll back unless its optional drop was uncommented.)
-- ============================================================================
