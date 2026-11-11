-- 0164 — Database housekeeping from Supabase's adviser (builder list item 170, Nov 2026)
-- Production's performance adviser (Nov 11 2026) listed 55 links between tables with no
-- index, 35 row rules that work out who is asking once per row, 131 places where two or
-- more row rules cover the same table and action, and 3 indexes that duplicate another.
-- This migration fixes all four. It changes no rows and no one's access.
--
-- 1. An index for each of the 55 links (foreign keys). The one that matters most today is
--    presence_judgments.evidence_run_id: 600,000 rows, and its link deletes in a cascade,
--    so each evidence run the 15-minute job prunes (from January 2027) would read the whole
--    545 MB table to find its judgments. Finding one run's judgments took 2.1 seconds.
-- 2. The three duplicate indexes go (the copy each list keeps is named beside it).
-- 3. The row rules of 30 tables, rewritten from production's own (pg_policies, Nov 11):
--    • auth.uid(), auth.jwt(), auth.email() and dds_my_contact_id() are asked once per
--      query: (select auth.uid()) runs once, a bare auth.uid() once for every row.
--    • dds_is_staff(tenant_id) becomes tenant_id in (select current_tenant_ids()): the same
--      set (both read memberships for auth.uid()), worked out once instead of per row.
--    • the rules for one table and one action become one rule, their conditions joined by
--      OR, as Postgres joins them anyway; a condition written twice appears once.
--    • a rule aimed at everyone (to public) whose condition needs a signed-in user is aimed
--      at signed-in users (to authenticated): for anyone else it was always false.
--    • the two "anyone may add" rules (audit_leads, discovery_intake) keep their audience.
--    A table with a single rule keeps it and its name; only its calls change (alter policy).
--    Checked in PGlite against production's 89 rules: 14 kinds of caller (visitors, staff of
--    each studio, clients matched by contact, by email in either case, by contact email,
--    an empty email, a token with no email or no user id) each read, added, changed, moved
--    and removed every row of the 30 tables: 55,286 answers, the same before and after.
--
-- rollback: docs/presence/APPLY-0164-revert-prod.sql (production's 89 rules as they were,
--   the three duplicate indexes back, the 55 new ones dropped).

-- ── 1. indexes for the links ──
create index if not exists activity_log_client_id_idx on public.activity_log (client_id);
create index if not exists approvals_client_id_idx on public.approvals (client_id);
create index if not exists audit_leads_contact_id_idx on public.audit_leads (contact_id);
create index if not exists client_growth_tasks_recommendation_id_idx on public.client_growth_tasks (recommendation_id);
create index if not exists client_requests_client_id_idx on public.client_requests (client_id);
create index if not exists clients_contact_id_idx on public.clients (contact_id);
create index if not exists contacts_auth_user_id_idx on public.contacts (auth_user_id);
create index if not exists contacts_org_id_idx on public.contacts (org_id);
create index if not exists contacts_referred_by_idx on public.contacts (referred_by);
create index if not exists email_templates_tenant_id_idx on public.email_templates (tenant_id);
create index if not exists file_comments_client_id_idx on public.file_comments (client_id);
create index if not exists files_client_id_idx on public.files (client_id);
create index if not exists growth_messages_partnership_id_idx on public.growth_messages (partnership_id);
create index if not exists growth_quotes_recommendation_id_idx on public.growth_quotes (recommendation_id);
create index if not exists growth_tasks_recommendation_id_idx on public.growth_tasks (recommendation_id);
create index if not exists intake_forms_client_id_idx on public.intake_forms (client_id);
create index if not exists invoices_client_id_idx on public.invoices (client_id);
create index if not exists notifications_client_id_idx on public.notifications (client_id);
create index if not exists organizations_agency_id_idx on public.organizations (agency_id);
create index if not exists partnerships_contact_id_idx on public.partnerships (contact_id);
create index if not exists presence_agency_jobs_agency_id_idx on public.presence_agency_jobs (agency_id);
create index if not exists presence_appointments_contact_id_idx on public.presence_appointments (contact_id);
create index if not exists presence_appointments_type_id_idx on public.presence_appointments (type_id);
create index if not exists presence_broadcast_sends_site_id_idx on public.presence_broadcast_sends (site_id);
create index if not exists presence_connect_requests_agency_id_idx on public.presence_connect_requests (agency_id);
create index if not exists presence_contracts_proposal_id_idx on public.presence_contracts (proposal_id);
create index if not exists presence_customer_agency_agency_site_id_idx on public.presence_customer_agency (agency_site_id);
create index if not exists presence_deals_converted_site_id_idx on public.presence_deals (converted_site_id);
create index if not exists presence_estimates_site_id_idx on public.presence_estimates (site_id);
create index if not exists presence_judgments_evidence_run_id_idx on public.presence_judgments (evidence_run_id);
create index if not exists presence_launches_prev_snapshot_id_idx on public.presence_launches (prev_snapshot_id);
create index if not exists presence_launches_published_publish_id_idx on public.presence_launches (published_publish_id);
create index if not exists presence_launches_scheduled_publish_id_idx on public.presence_launches (scheduled_publish_id);
create index if not exists presence_launches_snapshot_id_idx on public.presence_launches (snapshot_id);
create index if not exists presence_pitch_packs_prospect_id_idx on public.presence_pitch_packs (prospect_id);
create index if not exists presence_project_messages_attachment_media_id_idx on public.presence_project_messages (attachment_media_id);
create index if not exists presence_publishes_snapshot_id_idx on public.presence_publishes (snapshot_id);
create index if not exists presence_recurring_invoices_site_id_idx on public.presence_recurring_invoices (site_id);
create index if not exists presence_regions_org_id_idx on public.presence_regions (org_id);
create index if not exists presence_reviews_contact_id_idx on public.presence_reviews (contact_id);
create index if not exists presence_scheduled_publishes_site_id_idx on public.presence_scheduled_publishes (site_id);
create index if not exists presence_service_links_deal_id_idx on public.presence_service_links (deal_id);
create index if not exists presence_site_preview_snapshot_id_idx on public.presence_site_preview (snapshot_id);
create index if not exists presence_sites_region_id_idx on public.presence_sites (region_id);
create index if not exists presence_support_messages_attachment_media_id_idx on public.presence_support_messages (attachment_media_id);
create index if not exists presence_support_requests_client_id_idx on public.presence_support_requests (client_id);
create index if not exists presence_survey_responses_project_id_idx on public.presence_survey_responses (project_id);
create index if not exists presence_survey_responses_site_id_idx on public.presence_survey_responses (site_id);
create index if not exists presence_tasks_milestone_id_idx on public.presence_tasks (milestone_id);
create index if not exists presence_visual_plans_media_id_idx on public.presence_visual_plans (media_id);
create index if not exists prospects_contact_id_idx on public.prospects (contact_id);
create index if not exists timeline_client_id_idx on public.timeline (client_id);
create index if not exists tool_reports_lead_id_idx on public.tool_reports (lead_id);
create index if not exists tool_scan_cache_report_id_idx on public.tool_scan_cache (report_id);
create index if not exists work_log_task_id_idx on public.work_log (task_id);

-- ── 2. duplicate indexes ──
-- 0151 added this one again: the baseline's audit_leads_created_at_idx is the same index
drop index if exists public.audit_leads_created_idx;
-- the same as idx_growth_tasks_partnership
drop index if exists public.idx_tasks_partnership;
-- the same as memberships_user_id_idx
drop index if exists public.idx_memberships_user;

-- ── 3. row rules ──
-- activity_log
drop policy if exists "activity_log_client_all" on public.activity_log;
drop policy if exists "activity_log_staff" on public.activity_log;
drop policy if exists "client inserts own activity" on public.activity_log;
drop policy if exists "client_reads_own_activity" on public.activity_log;
drop policy if exists "activity_log_select" on public.activity_log;
drop policy if exists "activity_log_insert" on public.activity_log;
drop policy if exists "activity_log_update" on public.activity_log;
drop policy if exists "activity_log_delete" on public.activity_log;
create policy "activity_log_select" on public.activity_log for select to authenticated
  using ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower(((select auth.jwt()) ->> 'email'::text)))))
    or (tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))
    or (client_id IN ( SELECT clients.id FROM clients WHERE (clients.email = (select auth.email())))));
create policy "activity_log_insert" on public.activity_log for insert to authenticated
  with check ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower(((select auth.jwt()) ->> 'email'::text)))))
    or (tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))
    or (client_id IN ( SELECT current_client_ids() AS current_client_ids)));
create policy "activity_log_update" on public.activity_log for update to authenticated
  using ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower(((select auth.jwt()) ->> 'email'::text)))))
    or (tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower(((select auth.jwt()) ->> 'email'::text)))))
    or (tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "activity_log_delete" on public.activity_log for delete to authenticated
  using ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower(((select auth.jwt()) ->> 'email'::text)))))
    or (tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));

-- approvals
drop policy if exists "approvals_client_read" on public.approvals;
drop policy if exists "client reads own approvals" on public.approvals;
drop policy if exists "client updates own approvals" on public.approvals;
drop policy if exists "approvals_select" on public.approvals;
drop policy if exists "approvals_update" on public.approvals;
create policy "approvals_select" on public.approvals for select to authenticated
  using ((client_id IN ( SELECT my_client_ids() AS my_client_ids))
    or (client_id IN ( SELECT current_client_ids() AS current_client_ids)));
create policy "approvals_update" on public.approvals for update to authenticated
  using ((client_id IN ( SELECT current_client_ids() AS current_client_ids)))
  with check ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));

-- audit_leads
drop policy if exists "audit_leads_staff" on public.audit_leads;
drop policy if exists "Allow anon insert" on public.audit_leads;
drop policy if exists "anyone can submit a lead" on public.audit_leads;
drop policy if exists "audit_leads_insert_anyone" on public.audit_leads;
drop policy if exists "audit_leads_select" on public.audit_leads;
drop policy if exists "audit_leads_update" on public.audit_leads;
drop policy if exists "audit_leads_delete" on public.audit_leads;
create policy "audit_leads_insert_anyone" on public.audit_leads for insert to public
  with check (true);
create policy "audit_leads_select" on public.audit_leads for select to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "audit_leads_update" on public.audit_leads for update to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "audit_leads_delete" on public.audit_leads for delete to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));

-- client_growth_tasks
alter policy "client_growth_tasks_client_rw" on public.client_growth_tasks
  using ((partnership_id IN ( SELECT p.id FROM (partnerships p JOIN contacts ct ON ((ct.id = p.contact_id))) WHERE (lower(ct.email) = lower(((select auth.jwt()) ->> 'email'::text))))))
  with check ((partnership_id IN ( SELECT p.id FROM (partnerships p JOIN contacts ct ON ((ct.id = p.contact_id))) WHERE (lower(ct.email) = lower(((select auth.jwt()) ->> 'email'::text))))));

-- client_onboarding
drop policy if exists "client_onboarding_client_all" on public.client_onboarding;
drop policy if exists "client inserts own onboarding" on public.client_onboarding;
drop policy if exists "client reads own onboarding" on public.client_onboarding;
drop policy if exists "client_reads_own_onboarding" on public.client_onboarding;
drop policy if exists "client updates own onboarding" on public.client_onboarding;
drop policy if exists "client_updates_own_onboarding" on public.client_onboarding;
drop policy if exists "client_onboarding_select" on public.client_onboarding;
drop policy if exists "client_onboarding_insert" on public.client_onboarding;
drop policy if exists "client_onboarding_update" on public.client_onboarding;
drop policy if exists "client_onboarding_delete" on public.client_onboarding;
create policy "client_onboarding_select" on public.client_onboarding for select to authenticated
  using ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower(((select auth.jwt()) ->> 'email'::text)))))
    or (client_id IN ( SELECT current_client_ids() AS current_client_ids))
    or (client_id IN ( SELECT clients.id FROM clients WHERE (clients.email = (select auth.email())))));
create policy "client_onboarding_insert" on public.client_onboarding for insert to authenticated
  with check ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower(((select auth.jwt()) ->> 'email'::text)))))
    or (client_id IN ( SELECT current_client_ids() AS current_client_ids)));
create policy "client_onboarding_update" on public.client_onboarding for update to authenticated
  using ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower(((select auth.jwt()) ->> 'email'::text)))))
    or (client_id IN ( SELECT current_client_ids() AS current_client_ids))
    or (client_id IN ( SELECT clients.id FROM clients WHERE (clients.email = (select auth.email())))))
  with check ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower(((select auth.jwt()) ->> 'email'::text)))))
    or (client_id IN ( SELECT current_client_ids() AS current_client_ids))
    or (client_id IN ( SELECT clients.id FROM clients WHERE (clients.email = (select auth.email())))));
create policy "client_onboarding_delete" on public.client_onboarding for delete to authenticated
  using ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower(((select auth.jwt()) ->> 'email'::text))))));

-- client_requests
drop policy if exists "client_requests_staff" on public.client_requests;
drop policy if exists "client inserts own requests" on public.client_requests;
drop policy if exists "client_writes_own_client_requests" on public.client_requests;
drop policy if exists "client reads own requests" on public.client_requests;
drop policy if exists "client_reads_own_client_requests" on public.client_requests;
drop policy if exists "client_requests_select" on public.client_requests;
drop policy if exists "client_requests_insert" on public.client_requests;
drop policy if exists "client_requests_update" on public.client_requests;
drop policy if exists "client_requests_delete" on public.client_requests;
create policy "client_requests_select" on public.client_requests for select to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))
    or (client_id IN ( SELECT current_client_ids() AS current_client_ids))
    or (client_id IN ( SELECT clients.id FROM clients WHERE (clients.email = (select auth.email())))));
create policy "client_requests_insert" on public.client_requests for insert to authenticated
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))
    or (client_id IN ( SELECT current_client_ids() AS current_client_ids))
    or (client_id IN ( SELECT clients.id FROM clients WHERE (clients.email = (select auth.email())))));
create policy "client_requests_update" on public.client_requests for update to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "client_requests_delete" on public.client_requests for delete to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));

-- clients
drop policy if exists "clients_staff" on public.clients;
drop policy if exists "client reads own row" on public.clients;
drop policy if exists "client_reads_own" on public.clients;
drop policy if exists "clients_read_own" on public.clients;
drop policy if exists "clients_self_read" on public.clients;
drop policy if exists "client updates own row" on public.clients;
drop policy if exists "client_updates_own" on public.clients;
drop policy if exists "clients_self_update" on public.clients;
drop policy if exists "clients_select" on public.clients;
drop policy if exists "clients_insert" on public.clients;
drop policy if exists "clients_update" on public.clients;
drop policy if exists "clients_delete" on public.clients;
create policy "clients_select" on public.clients for select to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))
    or (lower(email) = lower(((select auth.jwt()) ->> 'email'::text)))
    or (email = (select auth.email()))
    or (email = ((select auth.jwt()) ->> 'email'::text)));
create policy "clients_insert" on public.clients for insert to authenticated
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "clients_update" on public.clients for update to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))
    or (lower(email) = lower(((select auth.jwt()) ->> 'email'::text)))
    or (email = (select auth.email())))
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))
    or (lower(email) = lower(((select auth.jwt()) ->> 'email'::text)))
    or (email = (select auth.email())));
create policy "clients_delete" on public.clients for delete to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));

-- contacts
drop policy if exists "contacts_staff" on public.contacts;
drop policy if exists "contacts_self" on public.contacts;
drop policy if exists "contacts_self_read" on public.contacts;
drop policy if exists "contacts_select" on public.contacts;
drop policy if exists "contacts_insert" on public.contacts;
drop policy if exists "contacts_update" on public.contacts;
drop policy if exists "contacts_delete" on public.contacts;
create policy "contacts_select" on public.contacts for select to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))
    or (auth_user_id = (select auth.uid())));
create policy "contacts_insert" on public.contacts for insert to authenticated
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "contacts_update" on public.contacts for update to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "contacts_delete" on public.contacts for delete to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));

-- content_calendar
drop policy if exists "content_calendar_staff_all" on public.content_calendar;
drop policy if exists "content_client_read" on public.content_calendar;
drop policy if exists "content_calendar_select" on public.content_calendar;
drop policy if exists "content_calendar_insert" on public.content_calendar;
drop policy if exists "content_calendar_update" on public.content_calendar;
drop policy if exists "content_calendar_delete" on public.content_calendar;
create policy "content_calendar_select" on public.content_calendar for select to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))
    or (client_visible AND (partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships.contact_id = (select dds_my_contact_id()))))));
create policy "content_calendar_insert" on public.content_calendar for insert to authenticated
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "content_calendar_update" on public.content_calendar for update to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "content_calendar_delete" on public.content_calendar for delete to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));

-- discovery_intake
drop policy if exists "discovery_intake_staff" on public.discovery_intake;
drop policy if exists "anon can insert intake" on public.discovery_intake;
drop policy if exists "discovery_intake_insert_anyone" on public.discovery_intake;
drop policy if exists "discovery_intake_all" on public.discovery_intake;
create policy "discovery_intake_insert_anyone" on public.discovery_intake for insert to anon
  with check (true);
create policy "discovery_intake_all" on public.discovery_intake for all to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));

-- dp_events
alter policy "dp_events_insert" on public.dp_events
  with check (((select auth.uid()) = user_id));

-- dp_feedback
alter policy "dp_feedback_insert" on public.dp_feedback
  with check (((select auth.uid()) = user_id));

-- events
drop policy if exists "events_staff" on public.events;
drop policy if exists "events_client_read" on public.events;
drop policy if exists "events_self" on public.events;
drop policy if exists "events_select" on public.events;
drop policy if exists "events_insert" on public.events;
drop policy if exists "events_update" on public.events;
drop policy if exists "events_delete" on public.events;
create policy "events_select" on public.events for select to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))
    or ((client_visible = true) AND (contact_id IN ( SELECT contacts.id FROM contacts WHERE (contacts.auth_user_id = (select auth.uid()))))));
create policy "events_insert" on public.events for insert to authenticated
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "events_update" on public.events for update to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "events_delete" on public.events for delete to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));

-- file_comments
drop policy if exists "client inserts own file_comments" on public.file_comments;
drop policy if exists "client_inserts_own_file_comments" on public.file_comments;
drop policy if exists "client reads own file_comments" on public.file_comments;
drop policy if exists "client_reads_own_file_comments" on public.file_comments;
drop policy if exists "file_comments_select" on public.file_comments;
drop policy if exists "file_comments_insert" on public.file_comments;
create policy "file_comments_select" on public.file_comments for select to authenticated
  using ((client_id IN ( SELECT current_client_ids() AS current_client_ids))
    or (client_id IN ( SELECT clients.id FROM clients WHERE (clients.email = (select auth.email())))));
create policy "file_comments_insert" on public.file_comments for insert to authenticated
  with check ((client_id IN ( SELECT current_client_ids() AS current_client_ids))
    or (client_id IN ( SELECT clients.id FROM clients WHERE (clients.email = (select auth.email())))));

-- files
drop policy if exists "client deletes own files" on public.files;
drop policy if exists "client inserts own files" on public.files;
drop policy if exists "client reads own files" on public.files;
drop policy if exists "files_client_read" on public.files;
drop policy if exists "client updates own files" on public.files;
drop policy if exists "files_select" on public.files;
drop policy if exists "files_insert" on public.files;
drop policy if exists "files_update" on public.files;
drop policy if exists "files_delete" on public.files;
create policy "files_select" on public.files for select to authenticated
  using ((client_id IN ( SELECT current_client_ids() AS current_client_ids))
    or (client_id IN ( SELECT my_client_ids() AS my_client_ids)));
create policy "files_insert" on public.files for insert to authenticated
  with check ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));
create policy "files_update" on public.files for update to authenticated
  using ((client_id IN ( SELECT current_client_ids() AS current_client_ids)))
  with check ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));
create policy "files_delete" on public.files for delete to authenticated
  using ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));

-- growth_messages
alter policy "growth_messages_client_rw" on public.growth_messages
  using ((partnership_id IN ( SELECT p.id FROM (partnerships p JOIN contacts ct ON ((ct.id = p.contact_id))) WHERE (lower(ct.email) = lower(((select auth.jwt()) ->> 'email'::text))))))
  with check ((partnership_id IN ( SELECT p.id FROM (partnerships p JOIN contacts ct ON ((ct.id = p.contact_id))) WHERE (lower(ct.email) = lower(((select auth.jwt()) ->> 'email'::text))))));

-- growth_quotes
alter policy "growth_quotes_client_rw" on public.growth_quotes
  using ((partnership_id IN ( SELECT p.id FROM (partnerships p JOIN contacts ct ON ((ct.id = p.contact_id))) WHERE (lower(ct.email) = lower(((select auth.jwt()) ->> 'email'::text))))))
  with check ((partnership_id IN ( SELECT p.id FROM (partnerships p JOIN contacts ct ON ((ct.id = p.contact_id))) WHERE (lower(ct.email) = lower(((select auth.jwt()) ->> 'email'::text))))));

-- growth_tasks
drop policy if exists "growth_tasks_client_rw" on public.growth_tasks;
drop policy if exists "growth_tasks_staff_all" on public.growth_tasks;
drop policy if exists "growth_tasks_all" on public.growth_tasks;
create policy "growth_tasks_all" on public.growth_tasks for all to authenticated
  using ((partnership_id IN ( SELECT p.id FROM (partnerships p JOIN contacts ct ON ((ct.id = p.contact_id))) WHERE (lower(ct.email) = lower(((select auth.jwt()) ->> 'email'::text)))))
    or (tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((partnership_id IN ( SELECT p.id FROM (partnerships p JOIN contacts ct ON ((ct.id = p.contact_id))) WHERE (lower(ct.email) = lower(((select auth.jwt()) ->> 'email'::text)))))
    or (tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));

-- health_metrics
drop policy if exists "health_metrics_staff_all" on public.health_metrics;
drop policy if exists "health_client_read" on public.health_metrics;
drop policy if exists "health_metrics_select" on public.health_metrics;
drop policy if exists "health_metrics_insert" on public.health_metrics;
drop policy if exists "health_metrics_update" on public.health_metrics;
drop policy if exists "health_metrics_delete" on public.health_metrics;
create policy "health_metrics_select" on public.health_metrics for select to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))
    or (partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships.contact_id = (select dds_my_contact_id())))));
create policy "health_metrics_insert" on public.health_metrics for insert to authenticated
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "health_metrics_update" on public.health_metrics for update to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "health_metrics_delete" on public.health_metrics for delete to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));

-- intake_forms
drop policy if exists "intake_forms_client_all" on public.intake_forms;
drop policy if exists "intake_forms_staff" on public.intake_forms;
drop policy if exists "client inserts own intake" on public.intake_forms;
drop policy if exists "client_writes_own_intake_forms" on public.intake_forms;
drop policy if exists "client reads own intake" on public.intake_forms;
drop policy if exists "client_reads_own_intake_forms" on public.intake_forms;
drop policy if exists "client updates own intake" on public.intake_forms;
drop policy if exists "client_updates_own_intake_forms" on public.intake_forms;
drop policy if exists "intake_forms_select" on public.intake_forms;
drop policy if exists "intake_forms_insert" on public.intake_forms;
drop policy if exists "intake_forms_update" on public.intake_forms;
drop policy if exists "intake_forms_delete" on public.intake_forms;
create policy "intake_forms_select" on public.intake_forms for select to authenticated
  using ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower(((select auth.jwt()) ->> 'email'::text)))))
    or (tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))
    or (client_id IN ( SELECT current_client_ids() AS current_client_ids))
    or (client_id IN ( SELECT clients.id FROM clients WHERE (clients.email = (select auth.email())))));
create policy "intake_forms_insert" on public.intake_forms for insert to authenticated
  with check ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower(((select auth.jwt()) ->> 'email'::text)))))
    or (tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))
    or (client_id IN ( SELECT current_client_ids() AS current_client_ids))
    or (client_id IN ( SELECT clients.id FROM clients WHERE (clients.email = (select auth.email())))));
create policy "intake_forms_update" on public.intake_forms for update to authenticated
  using ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower(((select auth.jwt()) ->> 'email'::text)))))
    or (tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))
    or (client_id IN ( SELECT current_client_ids() AS current_client_ids))
    or (client_id IN ( SELECT clients.id FROM clients WHERE (clients.email = (select auth.email())))))
  with check ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower(((select auth.jwt()) ->> 'email'::text)))))
    or (tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))
    or (client_id IN ( SELECT current_client_ids() AS current_client_ids))
    or (client_id IN ( SELECT clients.id FROM clients WHERE (clients.email = (select auth.email())))));
create policy "intake_forms_delete" on public.intake_forms for delete to authenticated
  using ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower(((select auth.jwt()) ->> 'email'::text)))))
    or (tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));

-- invoices
drop policy if exists "client reads own invoices" on public.invoices;
drop policy if exists "invoices_client_read" on public.invoices;
drop policy if exists "invoices_select" on public.invoices;
create policy "invoices_select" on public.invoices for select to authenticated
  using ((client_id IN ( SELECT current_client_ids() AS current_client_ids))
    or (client_id IN ( SELECT my_client_ids() AS my_client_ids)));

-- memberships
alter policy "memberships_self_read" on public.memberships
  using ((user_id = (select auth.uid())));

-- messages
drop policy if exists "client inserts own messages" on public.messages;
drop policy if exists "client reads own messages" on public.messages;
drop policy if exists "messages_client_read" on public.messages;
drop policy if exists "messages_select" on public.messages;
drop policy if exists "messages_insert" on public.messages;
create policy "messages_select" on public.messages for select to authenticated
  using ((client_id IN ( SELECT current_client_ids() AS current_client_ids))
    or (client_id IN ( SELECT my_client_ids() AS my_client_ids)));
create policy "messages_insert" on public.messages for insert to authenticated
  with check (((client_id IN ( SELECT current_client_ids() AS current_client_ids)) AND (from_who = 'client'::text)));

-- monthly_reviews
drop policy if exists "monthly_reviews_staff_all" on public.monthly_reviews;
drop policy if exists "reviews_client_read" on public.monthly_reviews;
drop policy if exists "monthly_reviews_select" on public.monthly_reviews;
drop policy if exists "monthly_reviews_insert" on public.monthly_reviews;
drop policy if exists "monthly_reviews_update" on public.monthly_reviews;
drop policy if exists "monthly_reviews_delete" on public.monthly_reviews;
create policy "monthly_reviews_select" on public.monthly_reviews for select to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))
    or ((status = 'published'::text) AND (partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships.contact_id = (select dds_my_contact_id()))))));
create policy "monthly_reviews_insert" on public.monthly_reviews for insert to authenticated
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "monthly_reviews_update" on public.monthly_reviews for update to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "monthly_reviews_delete" on public.monthly_reviews for delete to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));

-- notifications
drop policy if exists "notifications_client_all" on public.notifications;
drop policy if exists "notifications_staff" on public.notifications;
drop policy if exists "client reads own notifications" on public.notifications;
drop policy if exists "client_reads_own_notifications" on public.notifications;
drop policy if exists "client updates own notifications" on public.notifications;
drop policy if exists "notifications_select" on public.notifications;
drop policy if exists "notifications_insert" on public.notifications;
drop policy if exists "notifications_update" on public.notifications;
drop policy if exists "notifications_delete" on public.notifications;
create policy "notifications_select" on public.notifications for select to authenticated
  using ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower(((select auth.jwt()) ->> 'email'::text)))))
    or (tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))
    or (client_id IN ( SELECT current_client_ids() AS current_client_ids))
    or (client_id IN ( SELECT clients.id FROM clients WHERE (clients.email = (select auth.email())))));
create policy "notifications_insert" on public.notifications for insert to authenticated
  with check ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower(((select auth.jwt()) ->> 'email'::text)))))
    or (tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "notifications_update" on public.notifications for update to authenticated
  using ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower(((select auth.jwt()) ->> 'email'::text)))))
    or (tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))
    or (client_id IN ( SELECT current_client_ids() AS current_client_ids)))
  with check ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower(((select auth.jwt()) ->> 'email'::text)))))
    or (tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))
    or (client_id IN ( SELECT current_client_ids() AS current_client_ids)));
create policy "notifications_delete" on public.notifications for delete to authenticated
  using ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower(((select auth.jwt()) ->> 'email'::text)))))
    or (tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));

-- partnership_goals
drop policy if exists "partnership_goals_staff_all" on public.partnership_goals;
drop policy if exists "goals_client_read" on public.partnership_goals;
drop policy if exists "partnership_goals_select" on public.partnership_goals;
drop policy if exists "partnership_goals_insert" on public.partnership_goals;
drop policy if exists "partnership_goals_update" on public.partnership_goals;
drop policy if exists "partnership_goals_delete" on public.partnership_goals;
create policy "partnership_goals_select" on public.partnership_goals for select to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))
    or (client_visible AND (partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships.contact_id = (select dds_my_contact_id()))))));
create policy "partnership_goals_insert" on public.partnership_goals for insert to authenticated
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "partnership_goals_update" on public.partnership_goals for update to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "partnership_goals_delete" on public.partnership_goals for delete to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));

-- partnerships
drop policy if exists "partnerships_staff_all" on public.partnerships;
drop policy if exists "partnerships_client_read" on public.partnerships;
drop policy if exists "partnerships_select" on public.partnerships;
drop policy if exists "partnerships_insert" on public.partnerships;
drop policy if exists "partnerships_update" on public.partnerships;
drop policy if exists "partnerships_delete" on public.partnerships;
create policy "partnerships_select" on public.partnerships for select to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))
    or (contact_id = (select dds_my_contact_id())));
create policy "partnerships_insert" on public.partnerships for insert to authenticated
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "partnerships_update" on public.partnerships for update to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "partnerships_delete" on public.partnerships for delete to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));

-- projects
drop policy if exists "projects_staff" on public.projects;
drop policy if exists "projects_client_read" on public.projects;
drop policy if exists "projects_self" on public.projects;
drop policy if exists "projects_select" on public.projects;
drop policy if exists "projects_insert" on public.projects;
drop policy if exists "projects_update" on public.projects;
drop policy if exists "projects_delete" on public.projects;
create policy "projects_select" on public.projects for select to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))
    or (contact_id IN ( SELECT contacts.id FROM contacts WHERE (contacts.auth_user_id = (select auth.uid())))));
create policy "projects_insert" on public.projects for insert to authenticated
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "projects_update" on public.projects for update to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "projects_delete" on public.projects for delete to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));

-- recommendations
drop policy if exists "recommendations_staff_all" on public.recommendations;
drop policy if exists "recs_client_read" on public.recommendations;
drop policy if exists "recommendations_select" on public.recommendations;
drop policy if exists "recommendations_insert" on public.recommendations;
drop policy if exists "recommendations_update" on public.recommendations;
drop policy if exists "recommendations_delete" on public.recommendations;
create policy "recommendations_select" on public.recommendations for select to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))
    or (client_visible AND (partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships.contact_id = (select dds_my_contact_id()))))));
create policy "recommendations_insert" on public.recommendations for insert to authenticated
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "recommendations_update" on public.recommendations for update to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "recommendations_delete" on public.recommendations for delete to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));

-- work_log
drop policy if exists "work_log_staff_all" on public.work_log;
drop policy if exists "worklog_client_read" on public.work_log;
drop policy if exists "work_log_select" on public.work_log;
drop policy if exists "work_log_insert" on public.work_log;
drop policy if exists "work_log_update" on public.work_log;
drop policy if exists "work_log_delete" on public.work_log;
create policy "work_log_select" on public.work_log for select to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids))
    or (client_visible AND (partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships.contact_id = (select dds_my_contact_id()))))));
create policy "work_log_insert" on public.work_log for insert to authenticated
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "work_log_update" on public.work_log for update to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
create policy "work_log_delete" on public.work_log for delete to authenticated
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
