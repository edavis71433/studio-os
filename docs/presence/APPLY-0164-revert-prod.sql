-- APPLY 0164 revert (production) — puts back exactly what 0164 changed, if it is ever needed.
-- Production's 89 row rules on these 30 tables as they were on Nov 11 2026, the three duplicate
-- indexes, and the 55 link indexes dropped. All or nothing. Paste into Supabase → SQL Editor → Run.
begin;
drop policy if exists "activity_log_select" on public.activity_log;
drop policy if exists "activity_log_insert" on public.activity_log;
drop policy if exists "activity_log_update" on public.activity_log;
drop policy if exists "activity_log_delete" on public.activity_log;
drop policy if exists "approvals_select" on public.approvals;
drop policy if exists "approvals_update" on public.approvals;
drop policy if exists "audit_leads_insert_anyone" on public.audit_leads;
drop policy if exists "audit_leads_select" on public.audit_leads;
drop policy if exists "audit_leads_update" on public.audit_leads;
drop policy if exists "audit_leads_delete" on public.audit_leads;
drop policy if exists "client_onboarding_select" on public.client_onboarding;
drop policy if exists "client_onboarding_insert" on public.client_onboarding;
drop policy if exists "client_onboarding_update" on public.client_onboarding;
drop policy if exists "client_onboarding_delete" on public.client_onboarding;
drop policy if exists "client_requests_select" on public.client_requests;
drop policy if exists "client_requests_insert" on public.client_requests;
drop policy if exists "client_requests_update" on public.client_requests;
drop policy if exists "client_requests_delete" on public.client_requests;
drop policy if exists "clients_select" on public.clients;
drop policy if exists "clients_insert" on public.clients;
drop policy if exists "clients_update" on public.clients;
drop policy if exists "clients_delete" on public.clients;
drop policy if exists "contacts_select" on public.contacts;
drop policy if exists "contacts_insert" on public.contacts;
drop policy if exists "contacts_update" on public.contacts;
drop policy if exists "contacts_delete" on public.contacts;
drop policy if exists "content_calendar_select" on public.content_calendar;
drop policy if exists "content_calendar_insert" on public.content_calendar;
drop policy if exists "content_calendar_update" on public.content_calendar;
drop policy if exists "content_calendar_delete" on public.content_calendar;
drop policy if exists "discovery_intake_insert_anyone" on public.discovery_intake;
drop policy if exists "discovery_intake_all" on public.discovery_intake;
drop policy if exists "events_select" on public.events;
drop policy if exists "events_insert" on public.events;
drop policy if exists "events_update" on public.events;
drop policy if exists "events_delete" on public.events;
drop policy if exists "file_comments_select" on public.file_comments;
drop policy if exists "file_comments_insert" on public.file_comments;
drop policy if exists "files_select" on public.files;
drop policy if exists "files_insert" on public.files;
drop policy if exists "files_update" on public.files;
drop policy if exists "files_delete" on public.files;
drop policy if exists "growth_tasks_all" on public.growth_tasks;
drop policy if exists "health_metrics_select" on public.health_metrics;
drop policy if exists "health_metrics_insert" on public.health_metrics;
drop policy if exists "health_metrics_update" on public.health_metrics;
drop policy if exists "health_metrics_delete" on public.health_metrics;
drop policy if exists "intake_forms_select" on public.intake_forms;
drop policy if exists "intake_forms_insert" on public.intake_forms;
drop policy if exists "intake_forms_update" on public.intake_forms;
drop policy if exists "intake_forms_delete" on public.intake_forms;
drop policy if exists "invoices_select" on public.invoices;
drop policy if exists "messages_select" on public.messages;
drop policy if exists "messages_insert" on public.messages;
drop policy if exists "monthly_reviews_select" on public.monthly_reviews;
drop policy if exists "monthly_reviews_insert" on public.monthly_reviews;
drop policy if exists "monthly_reviews_update" on public.monthly_reviews;
drop policy if exists "monthly_reviews_delete" on public.monthly_reviews;
drop policy if exists "notifications_select" on public.notifications;
drop policy if exists "notifications_insert" on public.notifications;
drop policy if exists "notifications_update" on public.notifications;
drop policy if exists "notifications_delete" on public.notifications;
drop policy if exists "partnership_goals_select" on public.partnership_goals;
drop policy if exists "partnership_goals_insert" on public.partnership_goals;
drop policy if exists "partnership_goals_update" on public.partnership_goals;
drop policy if exists "partnership_goals_delete" on public.partnership_goals;
drop policy if exists "partnerships_select" on public.partnerships;
drop policy if exists "partnerships_insert" on public.partnerships;
drop policy if exists "partnerships_update" on public.partnerships;
drop policy if exists "partnerships_delete" on public.partnerships;
drop policy if exists "projects_select" on public.projects;
drop policy if exists "projects_insert" on public.projects;
drop policy if exists "projects_update" on public.projects;
drop policy if exists "projects_delete" on public.projects;
drop policy if exists "recommendations_select" on public.recommendations;
drop policy if exists "recommendations_insert" on public.recommendations;
drop policy if exists "recommendations_update" on public.recommendations;
drop policy if exists "recommendations_delete" on public.recommendations;
drop policy if exists "work_log_select" on public.work_log;
drop policy if exists "work_log_insert" on public.work_log;
drop policy if exists "work_log_update" on public.work_log;
drop policy if exists "work_log_delete" on public.work_log;
drop policy if exists "activity_log_client_all" on public.activity_log;
create policy "activity_log_client_all" on public.activity_log as permissive for all to authenticated
  using ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower((auth.jwt() ->> 'email'::text))))))
  with check ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower((auth.jwt() ->> 'email'::text))))));
drop policy if exists "activity_log_staff" on public.activity_log;
create policy "activity_log_staff" on public.activity_log as permissive for all to public
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
drop policy if exists "client inserts own activity" on public.activity_log;
create policy "client inserts own activity" on public.activity_log as permissive for insert to authenticated
  with check ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));
drop policy if exists "client_reads_own_activity" on public.activity_log;
create policy "client_reads_own_activity" on public.activity_log as permissive for select to public
  using ((client_id IN ( SELECT clients.id FROM clients WHERE (clients.email = auth.email()))));
drop policy if exists "approvals_client_read" on public.approvals;
create policy "approvals_client_read" on public.approvals as permissive for select to public
  using ((client_id IN ( SELECT my_client_ids() AS my_client_ids)));
drop policy if exists "client reads own approvals" on public.approvals;
create policy "client reads own approvals" on public.approvals as permissive for select to authenticated
  using ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));
drop policy if exists "client updates own approvals" on public.approvals;
create policy "client updates own approvals" on public.approvals as permissive for update to authenticated
  using ((client_id IN ( SELECT current_client_ids() AS current_client_ids)))
  with check ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));
drop policy if exists "audit_leads_staff" on public.audit_leads;
create policy "audit_leads_staff" on public.audit_leads as permissive for all to public
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
drop policy if exists "Allow anon insert" on public.audit_leads;
create policy "Allow anon insert" on public.audit_leads as permissive for insert to public
  with check (true);
drop policy if exists "anyone can submit a lead" on public.audit_leads;
create policy "anyone can submit a lead" on public.audit_leads as permissive for insert to anon,authenticated
  with check (true);
drop policy if exists "client_growth_tasks_client_rw" on public.client_growth_tasks;
create policy "client_growth_tasks_client_rw" on public.client_growth_tasks as permissive for all to authenticated
  using ((partnership_id IN ( SELECT p.id FROM (partnerships p JOIN contacts ct ON ((ct.id = p.contact_id))) WHERE (lower(ct.email) = lower((auth.jwt() ->> 'email'::text))))))
  with check ((partnership_id IN ( SELECT p.id FROM (partnerships p JOIN contacts ct ON ((ct.id = p.contact_id))) WHERE (lower(ct.email) = lower((auth.jwt() ->> 'email'::text))))));
drop policy if exists "client_onboarding_client_all" on public.client_onboarding;
create policy "client_onboarding_client_all" on public.client_onboarding as permissive for all to authenticated
  using ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower((auth.jwt() ->> 'email'::text))))))
  with check ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower((auth.jwt() ->> 'email'::text))))));
drop policy if exists "client inserts own onboarding" on public.client_onboarding;
create policy "client inserts own onboarding" on public.client_onboarding as permissive for insert to authenticated
  with check ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));
drop policy if exists "client reads own onboarding" on public.client_onboarding;
create policy "client reads own onboarding" on public.client_onboarding as permissive for select to authenticated
  using ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));
drop policy if exists "client_reads_own_onboarding" on public.client_onboarding;
create policy "client_reads_own_onboarding" on public.client_onboarding as permissive for select to public
  using ((client_id IN ( SELECT clients.id FROM clients WHERE (clients.email = auth.email()))));
drop policy if exists "client updates own onboarding" on public.client_onboarding;
create policy "client updates own onboarding" on public.client_onboarding as permissive for update to authenticated
  using ((client_id IN ( SELECT current_client_ids() AS current_client_ids)))
  with check ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));
drop policy if exists "client_updates_own_onboarding" on public.client_onboarding;
create policy "client_updates_own_onboarding" on public.client_onboarding as permissive for update to public
  using ((client_id IN ( SELECT clients.id FROM clients WHERE (clients.email = auth.email()))));
drop policy if exists "client_requests_staff" on public.client_requests;
create policy "client_requests_staff" on public.client_requests as permissive for all to public
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
drop policy if exists "client inserts own requests" on public.client_requests;
create policy "client inserts own requests" on public.client_requests as permissive for insert to authenticated
  with check ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));
drop policy if exists "client_writes_own_client_requests" on public.client_requests;
create policy "client_writes_own_client_requests" on public.client_requests as permissive for insert to public
  with check ((client_id IN ( SELECT clients.id FROM clients WHERE (clients.email = auth.email()))));
drop policy if exists "client reads own requests" on public.client_requests;
create policy "client reads own requests" on public.client_requests as permissive for select to authenticated
  using ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));
drop policy if exists "client_reads_own_client_requests" on public.client_requests;
create policy "client_reads_own_client_requests" on public.client_requests as permissive for select to public
  using ((client_id IN ( SELECT clients.id FROM clients WHERE (clients.email = auth.email()))));
drop policy if exists "clients_staff" on public.clients;
create policy "clients_staff" on public.clients as permissive for all to public
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
drop policy if exists "client reads own row" on public.clients;
create policy "client reads own row" on public.clients as permissive for select to authenticated
  using ((lower(email) = lower((auth.jwt() ->> 'email'::text))));
drop policy if exists "client_reads_own" on public.clients;
create policy "client_reads_own" on public.clients as permissive for select to authenticated
  using ((email = auth.email()));
drop policy if exists "clients_read_own" on public.clients;
create policy "clients_read_own" on public.clients as permissive for select to authenticated
  using ((email = (auth.jwt() ->> 'email'::text)));
drop policy if exists "clients_self_read" on public.clients;
create policy "clients_self_read" on public.clients as permissive for select to authenticated
  using ((lower(email) = lower((auth.jwt() ->> 'email'::text))));
drop policy if exists "client updates own row" on public.clients;
create policy "client updates own row" on public.clients as permissive for update to authenticated
  using ((lower(email) = lower((auth.jwt() ->> 'email'::text))))
  with check ((lower(email) = lower((auth.jwt() ->> 'email'::text))));
drop policy if exists "client_updates_own" on public.clients;
create policy "client_updates_own" on public.clients as permissive for update to authenticated
  using ((email = auth.email()))
  with check ((email = auth.email()));
drop policy if exists "clients_self_update" on public.clients;
create policy "clients_self_update" on public.clients as permissive for update to authenticated
  using ((lower(email) = lower((auth.jwt() ->> 'email'::text))))
  with check ((lower(email) = lower((auth.jwt() ->> 'email'::text))));
drop policy if exists "contacts_staff" on public.contacts;
create policy "contacts_staff" on public.contacts as permissive for all to public
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
drop policy if exists "contacts_self" on public.contacts;
create policy "contacts_self" on public.contacts as permissive for select to authenticated
  using ((auth_user_id = auth.uid()));
drop policy if exists "contacts_self_read" on public.contacts;
create policy "contacts_self_read" on public.contacts as permissive for select to public
  using ((auth_user_id = auth.uid()));
drop policy if exists "content_calendar_staff_all" on public.content_calendar;
create policy "content_calendar_staff_all" on public.content_calendar as permissive for all to public
  using (dds_is_staff(tenant_id))
  with check (dds_is_staff(tenant_id));
drop policy if exists "content_client_read" on public.content_calendar;
create policy "content_client_read" on public.content_calendar as permissive for select to public
  using ((client_visible AND (partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships.contact_id = dds_my_contact_id())))));
drop policy if exists "discovery_intake_staff" on public.discovery_intake;
create policy "discovery_intake_staff" on public.discovery_intake as permissive for all to public
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
drop policy if exists "anon can insert intake" on public.discovery_intake;
create policy "anon can insert intake" on public.discovery_intake as permissive for insert to anon
  with check (true);
drop policy if exists "dp_events_insert" on public.dp_events;
create policy "dp_events_insert" on public.dp_events as permissive for insert to authenticated
  with check ((auth.uid() = user_id));
drop policy if exists "dp_feedback_insert" on public.dp_feedback;
create policy "dp_feedback_insert" on public.dp_feedback as permissive for insert to authenticated
  with check ((auth.uid() = user_id));
drop policy if exists "events_staff" on public.events;
create policy "events_staff" on public.events as permissive for all to public
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
drop policy if exists "events_client_read" on public.events;
create policy "events_client_read" on public.events as permissive for select to public
  using (((client_visible = true) AND (contact_id IN ( SELECT contacts.id FROM contacts WHERE (contacts.auth_user_id = auth.uid())))));
drop policy if exists "events_self" on public.events;
create policy "events_self" on public.events as permissive for select to authenticated
  using (((client_visible = true) AND (contact_id IN ( SELECT contacts.id FROM contacts WHERE (contacts.auth_user_id = auth.uid())))));
drop policy if exists "client inserts own file_comments" on public.file_comments;
create policy "client inserts own file_comments" on public.file_comments as permissive for insert to authenticated
  with check ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));
drop policy if exists "client_inserts_own_file_comments" on public.file_comments;
create policy "client_inserts_own_file_comments" on public.file_comments as permissive for insert to public
  with check ((client_id IN ( SELECT clients.id FROM clients WHERE (clients.email = auth.email()))));
drop policy if exists "client reads own file_comments" on public.file_comments;
create policy "client reads own file_comments" on public.file_comments as permissive for select to authenticated
  using ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));
drop policy if exists "client_reads_own_file_comments" on public.file_comments;
create policy "client_reads_own_file_comments" on public.file_comments as permissive for select to public
  using ((client_id IN ( SELECT clients.id FROM clients WHERE (clients.email = auth.email()))));
drop policy if exists "client deletes own files" on public.files;
create policy "client deletes own files" on public.files as permissive for delete to authenticated
  using ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));
drop policy if exists "client inserts own files" on public.files;
create policy "client inserts own files" on public.files as permissive for insert to authenticated
  with check ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));
drop policy if exists "client reads own files" on public.files;
create policy "client reads own files" on public.files as permissive for select to authenticated
  using ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));
drop policy if exists "files_client_read" on public.files;
create policy "files_client_read" on public.files as permissive for select to public
  using ((client_id IN ( SELECT my_client_ids() AS my_client_ids)));
drop policy if exists "client updates own files" on public.files;
create policy "client updates own files" on public.files as permissive for update to authenticated
  using ((client_id IN ( SELECT current_client_ids() AS current_client_ids)))
  with check ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));
drop policy if exists "growth_messages_client_rw" on public.growth_messages;
create policy "growth_messages_client_rw" on public.growth_messages as permissive for all to authenticated
  using ((partnership_id IN ( SELECT p.id FROM (partnerships p JOIN contacts ct ON ((ct.id = p.contact_id))) WHERE (lower(ct.email) = lower((auth.jwt() ->> 'email'::text))))))
  with check ((partnership_id IN ( SELECT p.id FROM (partnerships p JOIN contacts ct ON ((ct.id = p.contact_id))) WHERE (lower(ct.email) = lower((auth.jwt() ->> 'email'::text))))));
drop policy if exists "growth_quotes_client_rw" on public.growth_quotes;
create policy "growth_quotes_client_rw" on public.growth_quotes as permissive for all to authenticated
  using ((partnership_id IN ( SELECT p.id FROM (partnerships p JOIN contacts ct ON ((ct.id = p.contact_id))) WHERE (lower(ct.email) = lower((auth.jwt() ->> 'email'::text))))))
  with check ((partnership_id IN ( SELECT p.id FROM (partnerships p JOIN contacts ct ON ((ct.id = p.contact_id))) WHERE (lower(ct.email) = lower((auth.jwt() ->> 'email'::text))))));
drop policy if exists "growth_tasks_client_rw" on public.growth_tasks;
create policy "growth_tasks_client_rw" on public.growth_tasks as permissive for all to authenticated
  using ((partnership_id IN ( SELECT p.id FROM (partnerships p JOIN contacts ct ON ((ct.id = p.contact_id))) WHERE (lower(ct.email) = lower((auth.jwt() ->> 'email'::text))))))
  with check ((partnership_id IN ( SELECT p.id FROM (partnerships p JOIN contacts ct ON ((ct.id = p.contact_id))) WHERE (lower(ct.email) = lower((auth.jwt() ->> 'email'::text))))));
drop policy if exists "growth_tasks_staff_all" on public.growth_tasks;
create policy "growth_tasks_staff_all" on public.growth_tasks as permissive for all to public
  using (dds_is_staff(tenant_id))
  with check (dds_is_staff(tenant_id));
drop policy if exists "health_metrics_staff_all" on public.health_metrics;
create policy "health_metrics_staff_all" on public.health_metrics as permissive for all to public
  using (dds_is_staff(tenant_id))
  with check (dds_is_staff(tenant_id));
drop policy if exists "health_client_read" on public.health_metrics;
create policy "health_client_read" on public.health_metrics as permissive for select to public
  using ((partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships.contact_id = dds_my_contact_id()))));
drop policy if exists "intake_forms_client_all" on public.intake_forms;
create policy "intake_forms_client_all" on public.intake_forms as permissive for all to authenticated
  using ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower((auth.jwt() ->> 'email'::text))))))
  with check ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower((auth.jwt() ->> 'email'::text))))));
drop policy if exists "intake_forms_staff" on public.intake_forms;
create policy "intake_forms_staff" on public.intake_forms as permissive for all to public
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
drop policy if exists "client inserts own intake" on public.intake_forms;
create policy "client inserts own intake" on public.intake_forms as permissive for insert to authenticated
  with check ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));
drop policy if exists "client_writes_own_intake_forms" on public.intake_forms;
create policy "client_writes_own_intake_forms" on public.intake_forms as permissive for insert to public
  with check ((client_id IN ( SELECT clients.id FROM clients WHERE (clients.email = auth.email()))));
drop policy if exists "client reads own intake" on public.intake_forms;
create policy "client reads own intake" on public.intake_forms as permissive for select to authenticated
  using ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));
drop policy if exists "client_reads_own_intake_forms" on public.intake_forms;
create policy "client_reads_own_intake_forms" on public.intake_forms as permissive for select to public
  using ((client_id IN ( SELECT clients.id FROM clients WHERE (clients.email = auth.email()))));
drop policy if exists "client updates own intake" on public.intake_forms;
create policy "client updates own intake" on public.intake_forms as permissive for update to authenticated
  using ((client_id IN ( SELECT current_client_ids() AS current_client_ids)))
  with check ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));
drop policy if exists "client_updates_own_intake_forms" on public.intake_forms;
create policy "client_updates_own_intake_forms" on public.intake_forms as permissive for update to public
  using ((client_id IN ( SELECT clients.id FROM clients WHERE (clients.email = auth.email()))));
drop policy if exists "client reads own invoices" on public.invoices;
create policy "client reads own invoices" on public.invoices as permissive for select to authenticated
  using ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));
drop policy if exists "invoices_client_read" on public.invoices;
create policy "invoices_client_read" on public.invoices as permissive for select to public
  using ((client_id IN ( SELECT my_client_ids() AS my_client_ids)));
drop policy if exists "memberships_self_read" on public.memberships;
create policy "memberships_self_read" on public.memberships as permissive for select to public
  using ((user_id = auth.uid()));
drop policy if exists "client inserts own messages" on public.messages;
create policy "client inserts own messages" on public.messages as permissive for insert to authenticated
  with check (((client_id IN ( SELECT current_client_ids() AS current_client_ids)) AND (from_who = 'client'::text)));
drop policy if exists "client reads own messages" on public.messages;
create policy "client reads own messages" on public.messages as permissive for select to authenticated
  using ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));
drop policy if exists "messages_client_read" on public.messages;
create policy "messages_client_read" on public.messages as permissive for select to public
  using ((client_id IN ( SELECT my_client_ids() AS my_client_ids)));
drop policy if exists "monthly_reviews_staff_all" on public.monthly_reviews;
create policy "monthly_reviews_staff_all" on public.monthly_reviews as permissive for all to public
  using (dds_is_staff(tenant_id))
  with check (dds_is_staff(tenant_id));
drop policy if exists "reviews_client_read" on public.monthly_reviews;
create policy "reviews_client_read" on public.monthly_reviews as permissive for select to public
  using (((status = 'published'::text) AND (partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships.contact_id = dds_my_contact_id())))));
drop policy if exists "notifications_client_all" on public.notifications;
create policy "notifications_client_all" on public.notifications as permissive for all to authenticated
  using ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower((auth.jwt() ->> 'email'::text))))))
  with check ((client_id IN ( SELECT clients.id FROM clients WHERE (lower(clients.email) = lower((auth.jwt() ->> 'email'::text))))));
drop policy if exists "notifications_staff" on public.notifications;
create policy "notifications_staff" on public.notifications as permissive for all to public
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
drop policy if exists "client reads own notifications" on public.notifications;
create policy "client reads own notifications" on public.notifications as permissive for select to authenticated
  using ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));
drop policy if exists "client_reads_own_notifications" on public.notifications;
create policy "client_reads_own_notifications" on public.notifications as permissive for select to public
  using ((client_id IN ( SELECT clients.id FROM clients WHERE (clients.email = auth.email()))));
drop policy if exists "client updates own notifications" on public.notifications;
create policy "client updates own notifications" on public.notifications as permissive for update to authenticated
  using ((client_id IN ( SELECT current_client_ids() AS current_client_ids)))
  with check ((client_id IN ( SELECT current_client_ids() AS current_client_ids)));
drop policy if exists "partnership_goals_staff_all" on public.partnership_goals;
create policy "partnership_goals_staff_all" on public.partnership_goals as permissive for all to public
  using (dds_is_staff(tenant_id))
  with check (dds_is_staff(tenant_id));
drop policy if exists "goals_client_read" on public.partnership_goals;
create policy "goals_client_read" on public.partnership_goals as permissive for select to public
  using ((client_visible AND (partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships.contact_id = dds_my_contact_id())))));
drop policy if exists "partnerships_staff_all" on public.partnerships;
create policy "partnerships_staff_all" on public.partnerships as permissive for all to public
  using (dds_is_staff(tenant_id))
  with check (dds_is_staff(tenant_id));
drop policy if exists "partnerships_client_read" on public.partnerships;
create policy "partnerships_client_read" on public.partnerships as permissive for select to public
  using ((contact_id = dds_my_contact_id()));
drop policy if exists "projects_staff" on public.projects;
create policy "projects_staff" on public.projects as permissive for all to public
  using ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)))
  with check ((tenant_id IN ( SELECT current_tenant_ids() AS current_tenant_ids)));
drop policy if exists "projects_client_read" on public.projects;
create policy "projects_client_read" on public.projects as permissive for select to public
  using ((contact_id IN ( SELECT contacts.id FROM contacts WHERE (contacts.auth_user_id = auth.uid()))));
drop policy if exists "projects_self" on public.projects;
create policy "projects_self" on public.projects as permissive for select to authenticated
  using ((contact_id IN ( SELECT contacts.id FROM contacts WHERE (contacts.auth_user_id = auth.uid()))));
drop policy if exists "recommendations_staff_all" on public.recommendations;
create policy "recommendations_staff_all" on public.recommendations as permissive for all to public
  using (dds_is_staff(tenant_id))
  with check (dds_is_staff(tenant_id));
drop policy if exists "recs_client_read" on public.recommendations;
create policy "recs_client_read" on public.recommendations as permissive for select to public
  using ((client_visible AND (partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships.contact_id = dds_my_contact_id())))));
drop policy if exists "work_log_staff_all" on public.work_log;
create policy "work_log_staff_all" on public.work_log as permissive for all to public
  using (dds_is_staff(tenant_id))
  with check (dds_is_staff(tenant_id));
drop policy if exists "worklog_client_read" on public.work_log;
create policy "worklog_client_read" on public.work_log as permissive for select to public
  using ((client_visible AND (partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships.contact_id = dds_my_contact_id())))));
create index if not exists audit_leads_created_idx on public.audit_leads using btree (created_at desc);
create index if not exists idx_tasks_partnership on public.growth_tasks using btree (partnership_id);
create index if not exists idx_memberships_user on public.memberships using btree (user_id);
drop index if exists public.activity_log_client_id_idx;
drop index if exists public.approvals_client_id_idx;
drop index if exists public.audit_leads_contact_id_idx;
drop index if exists public.client_growth_tasks_recommendation_id_idx;
drop index if exists public.client_requests_client_id_idx;
drop index if exists public.clients_contact_id_idx;
drop index if exists public.contacts_auth_user_id_idx;
drop index if exists public.contacts_org_id_idx;
drop index if exists public.contacts_referred_by_idx;
drop index if exists public.email_templates_tenant_id_idx;
drop index if exists public.file_comments_client_id_idx;
drop index if exists public.files_client_id_idx;
drop index if exists public.growth_messages_partnership_id_idx;
drop index if exists public.growth_quotes_recommendation_id_idx;
drop index if exists public.growth_tasks_recommendation_id_idx;
drop index if exists public.intake_forms_client_id_idx;
drop index if exists public.invoices_client_id_idx;
drop index if exists public.notifications_client_id_idx;
drop index if exists public.organizations_agency_id_idx;
drop index if exists public.partnerships_contact_id_idx;
drop index if exists public.presence_agency_jobs_agency_id_idx;
drop index if exists public.presence_appointments_contact_id_idx;
drop index if exists public.presence_appointments_type_id_idx;
drop index if exists public.presence_broadcast_sends_site_id_idx;
drop index if exists public.presence_connect_requests_agency_id_idx;
drop index if exists public.presence_contracts_proposal_id_idx;
drop index if exists public.presence_customer_agency_agency_site_id_idx;
drop index if exists public.presence_deals_converted_site_id_idx;
drop index if exists public.presence_estimates_site_id_idx;
drop index if exists public.presence_judgments_evidence_run_id_idx;
drop index if exists public.presence_launches_prev_snapshot_id_idx;
drop index if exists public.presence_launches_published_publish_id_idx;
drop index if exists public.presence_launches_scheduled_publish_id_idx;
drop index if exists public.presence_launches_snapshot_id_idx;
drop index if exists public.presence_pitch_packs_prospect_id_idx;
drop index if exists public.presence_project_messages_attachment_media_id_idx;
drop index if exists public.presence_publishes_snapshot_id_idx;
drop index if exists public.presence_recurring_invoices_site_id_idx;
drop index if exists public.presence_regions_org_id_idx;
drop index if exists public.presence_reviews_contact_id_idx;
drop index if exists public.presence_scheduled_publishes_site_id_idx;
drop index if exists public.presence_service_links_deal_id_idx;
drop index if exists public.presence_site_preview_snapshot_id_idx;
drop index if exists public.presence_sites_region_id_idx;
drop index if exists public.presence_support_messages_attachment_media_id_idx;
drop index if exists public.presence_support_requests_client_id_idx;
drop index if exists public.presence_survey_responses_project_id_idx;
drop index if exists public.presence_survey_responses_site_id_idx;
drop index if exists public.presence_tasks_milestone_id_idx;
drop index if exists public.presence_visual_plans_media_id_idx;
drop index if exists public.prospects_contact_id_idx;
drop index if exists public.timeline_client_id_idx;
drop index if exists public.tool_reports_lead_id_idx;
drop index if exists public.tool_scan_cache_report_id_idx;
drop index if exists public.work_log_task_id_idx;
commit;
-- check: the 89 rules are back: the fingerprint query in reports/ notes gives 8f02cf6218db85c3a1816ea6fdf21b1d
