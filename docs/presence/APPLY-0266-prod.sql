-- ===========================================================================
--  APPLY PACK - migration 0266  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector). ORDER-FREE:
--  no code reads these rules or grants (both functions reach the three tables with
--  their own key), so it can run before or after any deploy. IDEMPOTENT: it drops
--  whatever rules are there and revokes whatever the public roles still hold, so a
--  second run finds nothing to do. Safe to re-run. No row changes.
--
--  Why: builder list item 399, a TIDY-UP, not a safety fix. audit_leads,
--  discovery_intake and project_surveys carry row rules that read as "anyone may add
--  a row", and the public roles hold REFERENCES, TRIGGER and TRUNCATE there. A
--  read-only check on production (Nov 22) showed those roles hold no INSERT, SELECT,
--  UPDATE or DELETE on the three tables, so none of the rules can ever apply. This
--  makes the rules read the way the tables already behave: the server's key only.
--
--  What production had on Nov 22 (read-only, from the parent session):
--    audit_leads:      audit_leads_insert_anyone (INSERT, public), audit_leads_select,
--                      audit_leads_update, audit_leads_delete (authenticated)
--    discovery_intake: discovery_intake_insert_anyone (INSERT, anon),
--                      discovery_intake_all (ALL, authenticated)
--    project_surveys:  "anon can insert surveys" (INSERT, anon)
--
--  Rollback (puts back the rules and grants as they were):
--    create policy "audit_leads_insert_anyone" on public.audit_leads for insert to public with check (true);
--    create policy "audit_leads_select" on public.audit_leads for select to authenticated using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
--    create policy "audit_leads_update" on public.audit_leads for update to authenticated using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))) with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
--    create policy "audit_leads_delete" on public.audit_leads for delete to authenticated using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
--    create policy "discovery_intake_insert_anyone" on public.discovery_intake for insert to anon with check (true);
--    create policy "discovery_intake_all" on public.discovery_intake for all to authenticated using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))) with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
--    create policy "anon can insert surveys" on public.project_surveys for insert to anon with check (true);
--    grant references, trigger, truncate on public.audit_leads, public.discovery_intake, public.project_surveys to anon, authenticated;
--
--  Covers: supabase/migrations/0266_old_tables_tidy.sql
-- ===========================================================================

do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname from pg_policies
     where schemaname = 'public' and tablename in ('audit_leads', 'discovery_intake', 'project_surveys')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

revoke all on table public.audit_leads, public.discovery_intake, public.project_surveys from anon, authenticated, public;

alter table public.audit_leads enable row level security;
alter table public.discovery_intake enable row level security;
alter table public.project_surveys enable row level security;

comment on table public.audit_leads is
  'Builder item 399: the server''s own key only. No row rules and no grants to the public roles, as the table already behaved.';

-- ── check (read-only): expect no rows from the first two, and three rows "true" from the last ──
select tablename, policyname from pg_policies
 where schemaname = 'public' and tablename in ('audit_leads', 'discovery_intake', 'project_surveys');
select table_name, grantee, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and table_name in ('audit_leads', 'discovery_intake', 'project_surveys')
   and grantee in ('anon', 'authenticated', 'PUBLIC');
select relname, relrowsecurity from pg_class
 where relnamespace = 'public'::regnamespace and relname in ('audit_leads', 'discovery_intake', 'project_surveys');
