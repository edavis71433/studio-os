-- 0005_drop_agencies_table.sql
-- rollback: recreate the table from the DDL in the block below and re-insert the
--           DDS row (values preserved on tenants by 0002). Reversible.
--
-- WHAT / WHY
--   Retire the dead `agencies` table. By this point its attributes live on
--   `tenants` (0002) and every agency_id column is gone (0003, 0004), so nothing
--   references it. Runtime and RLS never did.
--
--   HARD GATE: refuse to drop unless agencies has <= 1 row. Eric will have run
--   `select id, slug, name, plan from agencies;` on production and confirmed no
--   external script depends on agencies/agency_id BEFORE this migration is
--   applied to production (per the step-3 plan, section 8). The row-count gate
--   is the automated backstop; the human confirmation is the primary control.
--
--   Also drops the now-orphaned emit() dependency ONLY if agencies is a hard
--   dependency — it is not (emit takes a uuid param, not an FK), so emit is
--   left untouched here and renamed later in 0007.
-- ============================================================================

do $$
declare n bigint;
begin
  if exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='agencies') then
    select count(*) into n from "public"."agencies";
    if n > 1 then
      raise exception '0005 aborted: agencies has % rows (expected <= 1). Reconcile/confirm before dropping.', n;
    end if;
    drop table "public"."agencies";
    raise notice '0005: dropped agencies (% row(s) removed)', n;
  end if;
end
$$;

-- ============================================================================
-- ROLLBACK (recreate the table and its single row):
--   create table if not exists "public"."agencies" (
--     "id" uuid default gen_random_uuid() not null,
--     "slug" text not null,
--     "name" text not null,
--     "owner_email" text,
--     "brand" jsonb default '{}'::jsonb,
--     "plan" text default 'founder'::text,
--     "created_at" timestamp with time zone default now(),
--     constraint "agencies_pkey" primary key ("id")
--   );
--   insert into "public"."agencies" (id, slug, name, owner_email, brand, plan)
--   select id, slug, name, owner_email, brand, coalesce(plan,'founder')
--     from "public"."tenants"
--    where id = '00000000-0000-0000-0000-000000000001'
--   on conflict (id) do nothing;
-- ============================================================================
