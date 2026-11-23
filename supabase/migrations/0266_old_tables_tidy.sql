-- rollback (puts back the rules and grants exactly as 0164 and the baseline left them):
--   create policy "audit_leads_insert_anyone" on public.audit_leads for insert to public with check (true);
--   create policy "audit_leads_select" on public.audit_leads for select to authenticated using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
--   create policy "audit_leads_update" on public.audit_leads for update to authenticated using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))) with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
--   create policy "audit_leads_delete" on public.audit_leads for delete to authenticated using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
--   create policy "discovery_intake_insert_anyone" on public.discovery_intake for insert to anon with check (true);
--   create policy "discovery_intake_all" on public.discovery_intake for all to authenticated using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))) with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
--   create policy "anon can insert surveys" on public.project_surveys for insert to anon with check (true);
--   grant references, trigger, truncate, maintain on public.audit_leads, public.discovery_intake, public.project_surveys to anon, authenticated;
--
-- ── Three old tables read the way they behave (builder list item 399) ─────────────
-- A TIDY-UP, NOT A SAFETY FIX. Order-free: nothing in either function reads these
-- rules or grants (the server reaches all three tables with its own key).
--
-- WHY (Nov 22 2026 review, file 07 finding 5, settled live in 15-verification-lead)
--   audit_leads, discovery_intake and project_surveys carry row rules that read as
--   "anyone may add a row" (and, for signed-in people, "read your studio's rows"), plus
--   REFERENCES, TRIGGER, TRUNCATE and MAINTAIN grants to the public roles. A read-only check on
--   production showed the public roles hold no INSERT, SELECT, UPDATE or DELETE there,
--   so none of those rules can ever apply: nobody can touch the rows with the public key.
--   The first report took the rules for an open door. They are only misleading.
--
-- WHAT CHANGES
--   Every row rule on the three tables is dropped (whatever its name on production), and
--   every grant the public roles still hold on them is revoked. Row security stays on,
--   so the tables are exactly what they already were in practice: the server's own key
--   only. No row changes.

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
