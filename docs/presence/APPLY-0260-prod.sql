-- ===========================================================================
--  APPLY PACK - migration 0260  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), FIRST: before
--  APPLY-0261 and before the deploy.yml run that ships builder items 416, 417 and 420.
--  IDEMPOTENT: safe to re-run (a second run counts the run and changes nothing else).
--
--  Why: builder list item 420. Database changes reach production by hand, and nothing
--  recorded which ones ran: Supabase's own list stops at change 72, one pack once ran in
--  the wrong project, one "success" was an empty tab. From now on every change writes
--  its number into presence_change_ledger when it runs. The health answer and the
--  Health page show the newest number, and the release refuses to go out while the
--  code's newest change isn't written here.
--
--  What it does:
--    1. creates presence_change_ledger and presence_ledger_note() (service role only);
--    2. writes down, as "backfill", the changes production already had before the
--       ledger existed (the list below, read on production on Nov 22; see its note);
--    3. writes down 0260 itself.
--
--  Check first that the editor's top bar says davis-digital-studio (production).
--
--  Rollback (only if ever needed):
--    drop function if exists public.presence_ledger_note(int, text);
--    drop table if exists public.presence_change_ledger;
--
--  Covers: supabase/migrations/0260_change_ledger.sql
-- ===========================================================================

create table if not exists public.presence_change_ledger (
  number int primary key check (number between 0 and 9999),
  name text not null default '',
  how text not null default 'pack' check (how in ('pack', 'backfill')),
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  runs int not null default 1 check (runs >= 1)
);

alter table public.presence_change_ledger enable row level security;   -- deny-all; the service role passes RLS
revoke all on table public.presence_change_ledger from public, anon, authenticated;
grant select, insert, update on table public.presence_change_ledger to service_role;

comment on table public.presence_change_ledger is
  'Builder list item 420: which database changes this database has, by number. Each migration and apply pack from 0260 on writes its own row (presence_ledger_note); older ones were backfilled once.';

create or replace function public.presence_ledger_note(p_number int, p_name text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.presence_change_ledger as l (number, name)
  values (p_number, coalesce(p_name, ''))
  on conflict (number) do update
    set last_at = now(), runs = l.runs + 1, name = coalesce(nullif(excluded.name, ''), l.name);
$$;

revoke all on function public.presence_ledger_note(int, text) from public, anon, authenticated;
grant execute on function public.presence_ledger_note(int, text) to service_role;

-- 2. What production already had before the ledger (backfill; a re-run adds nothing).
-- BACKFILL-LIST-START
-- Read on production by the coordinating session on Nov 22 2026: every numbered migration
-- through 0247 except 0003 to 0005 (fenced: never applied), checked by about 330 objects the
-- migrations create (the only gaps were two indexes later migrations dropped on purpose; 35
-- migrations create nothing checkable and count as applied), plus 0249 to 0255 and 0265 to
-- 0267, run today (0248 was never used). It checks the list again right before running this
-- pack: delete the line of any number that isn't on production, so the ledger never claims a
-- change that isn't there. These numbers predate the ledger, so they don't write themselves.
insert into public.presence_change_ledger (number, name, how) values
  (0, 'baseline', 'backfill'),
  (1, 'tenants_enrich', 'backfill'),
  (2, 'agency_attr_backfill', 'backfill'),
  (6, 'rls_holes', 'backfill'),
  (7, 'memberships_revocation', 'backfill'),
  (8, 'rate_limit_state', 'backfill'),
  (9, 'audit_log', 'backfill'),
  (10, 'lock_definer_rpc_grants', 'backfill'),
  (11, 'messages_index', 'backfill'),
  (12, 'messages_from_who_integrity', 'backfill'),
  (13, 'ai_calls', 'backfill'),
  (14, 'approvals_respond_columns', 'backfill'),
  (15, 'presence_phase1', 'backfill'),
  (16, 'presence_fk_fixes', 'backfill'),
  (17, 'presence_grants', 'backfill'),
  (18, 'presence_lifecycle', 'backfill'),
  (19, 'presence_room', 'backfill'),
  (20, 'presence_evidence', 'backfill'),
  (21, 'presence_judgments', 'backfill'),
  (22, 'presence_recommendations', 'backfill'),
  (23, 'presence_moments', 'backfill'),
  (24, 'presence_ai_drafts', 'backfill'),
  (25, 'presence_ai_drafts_edit_kinds', 'backfill'),
  (26, 'presence_ai_reviews', 'backfill'),
  (27, 'presence_brand', 'backfill'),
  (28, 'presence_growth', 'backfill'),
  (29, 'presence_voice_merge', 'backfill'),
  (30, 'presence_optimization', 'backfill'),
  (31, 'presence_monitor', 'backfill'),
  (32, 'presence_migration_readiness', 'backfill'),
  (33, 'presence_platform', 'backfill'),
  (34, 'presence_agency', 'backfill'),
  (35, 'presence_platform_services', 'backfill'),
  (36, 'presence_commerce', 'backfill'),
  (37, 'presence_operations', 'backfill'),
  (38, 'presence_connected', 'backfill'),
  (39, 'presence_connected_reads', 'backfill'),
  (40, 'presence_connected_intelligence', 'backfill'),
  (41, 'presence_connected_writes', 'backfill'),
  (42, 'presence_pack_marketplace', 'backfill'),
  (43, 'presence_enterprise', 'backfill'),
  (44, 'presence_visual_studio', 'backfill'),
  (45, 'presence_workspace_roles', 'backfill'),
  (46, 'presence_dev_mode', 'backfill'),
  (47, 'snapshot_dev_layer', 'backfill'),
  (48, 'presence_relationship_notes', 'backfill'),
  (49, 'entitlement_plan_editions', 'backfill'),
  (50, 'presence_commercial_v1', 'backfill'),
  (51, 'presence_no_code_essentials', 'backfill'),
  (52, 'business_classic_default', 'backfill'),
  (53, 'named_versions', 'backfill'),
  (54, 'search_verification', 'backfill'),
  (55, 'lifecycle_notices', 'backfill'),
  (56, 'starter_kits', 'backfill'),
  (57, 'design_studio', 'backfill'),
  (58, 'search_visibility', 'backfill'),
  (59, 'trust_automation', 'backfill'),
  (60, 'domain_watch', 'backfill'),
  (61, 'lead_followup', 'backfill'),
  (62, 'renewal_reminder', 'backfill'),
  (63, 'dam_asset_library', 'backfill'),
  (64, 'scoped_access_events', 'backfill'),
  (65, 'files_documents', 'backfill'),
  (66, 'visits', 'backfill'),
  (67, 'search_terms', 'backfill'),
  (68, 'site_blocks', 'backfill'),
  (69, 'brand_kit', 'backfill'),
  (70, 'launches', 'backfill'),
  (71, 'site_preview', 'backfill'),
  (72, 'content_library', 'backfill'),
  (73, 'publish_idempotency', 'backfill'),
  (74, 'p2c_sales_lifecycle', 'backfill'),
  (75, 'p2d_service_delivery', 'backfill'),
  (76, 'p2d_deliverables_approvals', 'backfill'),
  (77, 'p2d_communication', 'backfill'),
  (78, 'p2d_surveys_support', 'backfill'),
  (79, 'p2d_agency_client_bridge', 'backfill'),
  (80, 'customer_primary_agency', 'backfill'),
  (81, 'ai_image_metering', 'backfill'),
  (82, 'account_deletion', 'backfill'),
  (83, 'webhook_idempotency_claim', 'backfill'),
  (84, 'terms_acceptance', 'backfill'),
  (85, 'form_submission_converted', 'backfill'),
  (86, 'presence_invoices', 'backfill'),
  (87, 'sales_templates', 'backfill'),
  (88, 'notice_kinds', 'backfill'),
  (89, 'deal_next_step', 'backfill'),
  (90, 'push_subscriptions', 'backfill'),
  (91, 'sweep_rotation_cursors', 'backfill'),
  (92, 'lead_nurture', 'backfill'),
  (93, 'scheduled_runs_created_idx', 'backfill'),
  (94, 'uptime_heartbeat', 'backfill'),
  (95, 'service_edges', 'backfill'),
  (96, 'retainers_agreement_renewal', 'backfill'),
  (97, 'contact_custom_fields', 'backfill'),
  (98, 'broadcasts', 'backfill'),
  (99, 'booking', 'backfill'),
  (100, 'booking_reminders', 'backfill'),
  (101, 'reviews', 'backfill'),
  (102, 'email_auth_nudge', 'backfill'),
  (103, 'post_tags', 'backfill'),
  (104, 'site_pages', 'backfill'),
  (105, 'site_nav', 'backfill'),
  (106, 'security_rls_hardening', 'backfill'),
  (107, 'proposal_tracking', 'backfill'),
  (108, 'deal_tasks', 'backfill'),
  (109, 'perf_indexes', 'backfill'),
  (110, 'atelier_default', 'backfill'),
  (111, 'offline_unpublish', 'backfill'),
  (112, 'section_comments', 'backfill'),
  (113, 'thread_reads', 'backfill'),
  (114, 'inbound_email_dedupe', 'backfill'),
  (115, 'support_client_link', 'backfill'),
  (116, 'operator_activity_notices', 'backfill'),
  (117, 'deal_event_delete_kinds', 'backfill'),
  (118, 'deal_event_invoice_voided', 'backfill'),
  (119, 'notice_invoice_void_paid', 'backfill'),
  (120, 'project_checklist_backfill', 'backfill'),
  (123, 'project_checklist_uq', 'backfill'),
  (127, 'notice_retainer', 'backfill'),
  (128, 'connection_config', 'backfill'),
  (129, 'enquiry_triage', 'backfill'),
  (130, 'contact_customer_link', 'backfill'),
  (131, 'media_client_private', 'backfill'),
  (132, 'invoice_processing', 'backfill'),
  (133, 'actor_kind_operator', 'backfill'),
  (134, 'automation_switches', 'backfill'),
  (135, 'approval_due_date_reminders', 'backfill'),
  (136, 'free_tools', 'backfill'),
  (137, 'review_request_switch', 'backfill'),
  (138, 'connect_requests_and_one_settings_row', 'backfill'),
  (139, 'visit_counter_switch', 'backfill'),
  (140, 'two_read_indexes', 'backfill'),
  (141, 'prune_evidence_runs_grant', 'backfill'),
  (142, 'next_window_at', 'backfill'),
  (143, 'found_via', 'backfill'),
  (144, 'email_opens', 'backfill'),
  (145, 'estimates_recurring_invoices', 'backfill'),
  (146, 'needs_snoozes', 'backfill'),
  (147, 'site_notices', 'backfill'),
  (148, 'prospects', 'backfill'),
  (149, 'domain_watch', 'backfill'),
  (150, 'pitch_packs', 'backfill'),
  (151, 'tool_lead_deal', 'backfill'),
  (152, 'site_without_owner', 'backfill'),
  (153, 'domain_shows_our_site', 'backfill'),
  (154, 'trash_and_deleted_pages', 'backfill'),
  (155, 'ad_tags', 'backfill'),
  (156, 'button_presses_time_on_page', 'backfill'),
  (157, 'join_our_list', 'backfill'),
  (158, 'page_locks', 'backfill'),
  (159, 'site_availability_ai_crawlers', 'backfill'),
  (160, 'site_health_speed_uptime', 'backfill'),
  (161, 'popup', 'backfill'),
  (162, 'domain_registry_facts', 'backfill'),
  (163, 'google_review_link', 'backfill'),
  (164, 'adviser_housekeeping', 'backfill'),
  (165, 'media_usage', 'backfill'),
  (166, 'contact_fields', 'backfill'),
  (167, 'invoice_payments_numbers', 'backfill'),
  (168, 'contact_imports_merges', 'backfill'),
  (169, 'snapshot_draft_settings', 'backfill'),
  (170, 'site_numbers', 'backfill'),
  (171, 'search_tools', 'backfill'),
  (172, 'ai_checks', 'backfill'),
  (173, 'todos_and_calls_for_anyone', 'backfill'),
  (175, 'follow_ups_recipes', 'backfill'),
  (176, 'proposal_answers_signed_by_both', 'backfill'),
  (177, 'site_transfers', 'backfill'),
  (179, 'website_draft_approvals', 'backfill'),
  (181, 'blog_categories_authors_schedule', 'backfill'),
  (182, 'short_description_second_location', 'backfill'),
  (183, 'comment_name_picture', 'backfill'),
  (184, 'site_icon', 'backfill'),
  (188, 'money_cant_go_wrong_quietly', 'backfill'),
  (193, 'health_history_prune', 'backfill'),
  (194, 'visit_stats', 'backfill'),
  (197, 'fresh_codes', 'backfill'),
  (199, 'todo_owner', 'backfill'),
  (201, 'sales_ai', 'backfill'),
  (205, 'publish_sends_what_changed', 'backfill'),
  (206, 'speed_fixes', 'backfill'),
  (209, 'rank_grid_scans', 'backfill'),
  (213, 'starter_questionnaire', 'backfill'),
  (217, 'saved_pages', 'backfill'),
  (220, 'search_page_pairs', 'backfill'),
  (221, 'update_templates', 'backfill'),
  (223, 'designer_seat', 'backfill'),
  (225, 'files_trash', 'backfill'),
  (229, 'change_log_kinds', 'backfill'),
  (233, 'refunds_disputes', 'backfill'),
  (235, 'stripe_daily_check', 'backfill'),
  (245, 'deleted_customers', 'backfill'),
  (246, 'history_trim', 'backfill'),
  (247, 'health_counts', 'backfill'),
  (249, 'invoice_changes_reminders', 'backfill'),
  (250, 'invoice_settings_costs', 'backfill'),
  (251, 'fill_paid_ref', 'backfill'),
  (252, 'client_reminders', 'backfill'),
  (253, 'backup_codes', 'backfill'),
  (254, 'portal_slug', 'backfill'),
  (255, 'goes_to_customers', 'backfill'),
  (265, 'client_runs_site', 'backfill'),
  (266, 'old_tables_tidy', 'backfill'),
  (267, 'account_checks', 'backfill')
on conflict (number) do nothing;
-- BACKFILL-LIST-END

-- 3. This change itself.
select public.presence_ledger_note(260, 'change_ledger');


-- Verify right away (expect: the table and the function; then 0260 with how = 'pack',
-- and the backfilled numbers with how = 'backfill'):
-- select to_regclass('public.presence_change_ledger'), to_regprocedure('public.presence_ledger_note(int, text)');
-- select how, count(*), min(number), max(number) from public.presence_change_ledger group by how order by how;
-- select number, name, how, runs from public.presence_change_ledger order by number desc limit 5;
