-- 0004_drop_agency_columns.sql
-- rollback: re-add nullable agency_id columns backfilled from tenant_id (see
--           block below). Data is not lost because every agency_id equalled its
--           tenant_id (this migration refuses to run otherwise).
--
-- WHAT / WHY
--   Remove the dead `agency_id` scaffolding from every business table. It is
--   unused by runtime (0 references) and by RLS (0 policies), and its FKs to
--   agencies were NOT VALID. Redundant with tenant_id, which carries the same
--   value everywhere.
--
--   PER-TABLE PRE-FLIGHT GATE: for each table that has BOTH agency_id and
--   tenant_id, refuse to drop if any row has agency_id <> tenant_id. This proves
--   the column is redundant before removal. Dynamic loop => automatically covers
--   every such table and skips ones already handled (e.g. organizations in 0003).
--
--   Tables affected (18, organizations handled in 0003):
--     activity_log, approvals, audit_leads, client_requests, clients, contacts,
--     discovery_intake, events, files, intake_forms, invoices, message_templates,
--     messages, notifications, projects, prospects, timeline, work_log
-- ============================================================================

do $$
declare
  r record;
  mismatched bigint;
begin
  for r in
    select c.table_name
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.column_name = 'agency_id'
       and exists (
         select 1 from information_schema.columns c2
          where c2.table_schema = 'public'
            and c2.table_name = c.table_name
            and c2.column_name = 'tenant_id'
       )
  loop
    -- gate: agency_id must equal tenant_id on every row (nulls treated equal)
    execute format(
      'select count(*) from public.%I where agency_id is distinct from tenant_id',
      r.table_name
    ) into mismatched;

    if mismatched > 0 then
      raise exception '0004 aborted on table %: % rows have agency_id <> tenant_id', r.table_name, mismatched;
    end if;

    -- drop any agency FK (names vary: *_agency_fk and *_agency_id_fkey), then the column
    execute format('alter table public.%I drop constraint if exists %I', r.table_name, r.table_name || '_agency_fk');
    execute format('alter table public.%I drop constraint if exists %I', r.table_name, r.table_name || '_agency_id_fkey');
    execute format('alter table public.%I drop column if exists agency_id', r.table_name);

    raise notice '0004: dropped agency_id from %', r.table_name;
  end loop;
end
$$;

-- ============================================================================
-- ROLLBACK (re-add the columns; values re-derived from tenant_id):
--   do $$
--   declare r record;
--   begin
--     for r in select unnest(array[
--       'activity_log','approvals','audit_leads','client_requests','clients',
--       'contacts','discovery_intake','events','files','intake_forms','invoices',
--       'message_templates','messages','notifications','projects','prospects',
--       'timeline','work_log']) as t
--     loop
--       execute format('alter table public.%I add column if not exists agency_id uuid', r.t);
--       execute format('update public.%I set agency_id = tenant_id', r.t);
--     end loop;
--   end $$;
--   -- FKs to agencies intentionally NOT restored (agencies is being retired).
-- ============================================================================
