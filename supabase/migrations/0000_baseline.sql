-- 0000_baseline.sql — frozen production schema, captured 2026-07-05
-- rollback: none — this is the baseline; there is nothing earlier to roll
--           back to. Recovery from a bad state at this level is restore
--           from backup (see DR runbook when written).
-- provenance: GitHub Actions "Schema dump" workflow run of 2026-07-05
--             (artifact schema-foundation, 150,884 bytes), schema-only
--             pg_dump of production project qksstlqzbhesadrrofgn via the
--             transaction-pooler connection string. Verified: 78/78 live
--             relations present, zero data statements, data-leak grep clean,
--             65 RLS enables + 106 policies included.



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."member_role" AS ENUM (
    'owner',
    'admin',
    'staff',
    'readonly'
);


ALTER TYPE "public"."member_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_agency_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select agency_id from public.memberships where user_id = auth.uid()
$$;


ALTER FUNCTION "public"."current_agency_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_client_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select id from public.clients
  where lower(email) = lower(auth.jwt() ->> 'email')
$$;


ALTER FUNCTION "public"."current_client_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_tenant_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  select tenant_id from memberships where user_id = auth.uid()
$$;


ALTER FUNCTION "public"."current_tenant_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dds_client_read_policy"("p_table" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  if not exists (select 1 from information_schema.tables
                 where table_schema='public' and table_name=p_table) then
    raise notice 'skip %, table not found', p_table;
    return;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name=p_table
                   and column_name='client_id') then
    raise notice 'skip %, no client_id column', p_table;
    return;
  end if;

  execute format('drop policy if exists %I on public.%I', p_table || '_client_read', p_table);
  execute format(
    'create policy %I on public.%I for select '
    || 'using (client_id in (select my_client_ids()))',
    p_table || '_client_read', p_table);

  -- The portal reads these as the caller (anon key + JWT), so the authenticated
  -- role needs base SELECT privilege; RLS then narrows it to their own rows.
  execute format('grant select on public.%I to anon, authenticated', p_table);

  raise notice 'client-read policy applied to %', p_table;
end$$;


ALTER FUNCTION "public"."dds_client_read_policy"("p_table" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dds_is_staff"("p_tenant" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = p_tenant
  );
$$;


ALTER FUNCTION "public"."dds_is_staff"("p_tenant" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dds_my_contact_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select c.id from contacts c
  where c.auth_user_id = auth.uid()
  limit 1;
$$;


ALTER FUNCTION "public"."dds_my_contact_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dds_tenant"() RETURNS "uuid"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select '00000000-0000-0000-0000-000000000001'::uuid;
$$;


ALTER FUNCTION "public"."dds_tenant"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dds_tenantize"("p_table" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare
  tnt constant text := '00000000-0000-0000-0000-000000000001';
  has_col boolean;
begin
  -- Skip silently if the table doesn't exist in this database.
  if not exists (select 1 from information_schema.tables
                 where table_schema='public' and table_name=p_table) then
    raise notice 'skip %, table not found', p_table;
    return;
  end if;

  -- 1) add tenant_id (nullable, default DDS) if missing
  select exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name=p_table
                   and column_name='tenant_id') into has_col;
  if not has_col then
    execute format(
      'alter table public.%I add column tenant_id uuid references public.tenants(id) default %L',
      p_table, tnt);
  end if;

  -- 2) backfill any null tenant_id (covers rows created before the default)
  execute format('update public.%I set tenant_id = %L where tenant_id is null', p_table, tnt);

  -- 3) enforce NOT NULL
  execute format('alter table public.%I alter column tenant_id set not null', p_table);

  -- 4) index it (tenant filters hit this on every query)
  execute format('create index if not exists %I on public.%I (tenant_id)',
                 'idx_' || p_table || '_tenant', p_table);

  -- 5) enable RLS
  execute format('alter table public.%I enable row level security', p_table);

  -- 6) staff policy: a member of the row''s tenant can do anything to it.
  --    Drop-then-create so re-runs don't error on "policy already exists".
  execute format('drop policy if exists %I on public.%I', p_table || '_staff', p_table);
  execute format(
    'create policy %I on public.%I for all '
    || 'using (tenant_id in (select current_tenant_ids())) '
    || 'with check (tenant_id in (select current_tenant_ids()))',
    p_table || '_staff', p_table);

  -- 7) GRANT to service_role (the edge function reads/writes as this role).
  --    Without this you get "permission denied for table" -> 401 -> logout.
  execute format('grant select, insert, update, delete on public.%I to service_role', p_table);

  raise notice 'tenantized %', p_table;
end$$;


ALTER FUNCTION "public"."dds_tenantize"("p_table" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dds_touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin new.updated_at = now(); return new; end $$;


ALTER FUNCTION "public"."dds_touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."emit"("p_agency" "uuid", "p_type" "text", "p_actor" "text" DEFAULT 'system'::"text", "p_contact" "uuid" DEFAULT NULL::"uuid", "p_project" "uuid" DEFAULT NULL::"uuid", "p_payload" "jsonb" DEFAULT '{}'::"jsonb", "p_client_visible" boolean DEFAULT false) RETURNS bigint
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  insert into public.events
    (agency_id, contact_id, project_id, actor, type, payload, client_visible)
  values
    (p_agency, p_contact, p_project, p_actor, p_type, coalesce(p_payload,'{}'::jsonb), p_client_visible)
  returning id
$$;


ALTER FUNCTION "public"."emit"("p_agency" "uuid", "p_type" "text", "p_actor" "text", "p_contact" "uuid", "p_project" "uuid", "p_payload" "jsonb", "p_client_visible" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_role"("p_tenant" "uuid", "p_min" "public"."member_role") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = p_tenant
      and (case m.role
             when 'owner'    then 4
             when 'admin'    then 3
             when 'staff'    then 2
             when 'readonly' then 1
           end) >=
          (case p_min
             when 'owner'    then 4
             when 'admin'    then 3
             when 'staff'    then 2
             when 'readonly' then 1
           end)
  )
$$;


ALTER FUNCTION "public"."has_role"("p_tenant" "uuid", "p_min" "public"."member_role") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_agency_admin"("a" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.memberships
    where user_id = auth.uid() and agency_id = a and role = 'admin'
  )
$$;


ALTER FUNCTION "public"."is_agency_admin"("a" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_client_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  select cl.id
  from public.clients cl
  where
    -- linked via contact -> auth_user_id
    cl.contact_id in (
      select co.id from public.contacts co where co.auth_user_id = auth.uid()
    )
    -- OR linked by email on the client row itself
    or lower(coalesce(cl.email, '')) = lower(coalesce((auth.jwt() ->> 'email'), '___none___'))
    or lower(coalesce(cl.contact_email, '')) = lower(coalesce((auth.jwt() ->> 'email'), '___none___'))
$$;


ALTER FUNCTION "public"."my_client_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_apply_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.type = 'project.stage_advanced' and new.project_id is not null then
    update public.projects
       set stage = coalesce(new.payload->>'to_stage', stage),
           ball_in_court = coalesce(new.payload->>'ball_in_court', ball_in_court),
           progress = coalesce((new.payload->>'progress')::int, progress),
           updated_at = now()
     where id = new.project_id;
  elsif new.type = 'project.launched' and new.project_id is not null then
    update public.projects
       set stage = 'launch', launched_at = coalesce((new.payload->>'at')::timestamptz, now()),
           updated_at = now()
     where id = new.project_id;
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."project_apply_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end $$;


ALTER FUNCTION "public"."touch_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."activity_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "detail" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "agency_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "tenant_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "deleted_at" timestamp with time zone,
    "actor_email" "text"
);


ALTER TABLE "public"."activity_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admins" (
    "email" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."admins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agencies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "owner_email" "text",
    "brand" "jsonb" DEFAULT '{}'::"jsonb",
    "plan" "text" DEFAULT 'founder'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."agencies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."approvals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "agency_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "tenant_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "deleted_at" timestamp with time zone,
    "impact" "text" DEFAULT 'none'::"text",
    "last_reminder_at" timestamp with time zone,
    "reminder_count" integer DEFAULT 0
);


ALTER TABLE "public"."approvals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tool" "text" NOT NULL,
    "business_name" "text",
    "client_email" "text",
    "url" "text",
    "city" "text",
    "business_type" "text",
    "score" integer,
    "pillars" "jsonb",
    "core_web_vitals" "jsonb",
    "deep_audit" "jsonb",
    "findings" "jsonb",
    "psi_skipped" boolean DEFAULT false,
    "notes" "text",
    "status" "text" DEFAULT 'new'::"text",
    "agency_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "contact_id" "uuid",
    "pipeline_stage" "text" DEFAULT 'new'::"text" NOT NULL,
    "pipeline_pos" double precision,
    "tenant_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "source" "text" DEFAULT 'website_audit'::"text"
);


ALTER TABLE "public"."audit_leads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "website" "text",
    "notes" "text",
    "tier" "text",
    "amount" numeric,
    "status" "text" DEFAULT 'pending'::"text",
    "stripe_session_id" "text",
    "stripe_payment_intent" "text",
    "stripe_customer_id" "text",
    "paid_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."audit_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "client_name" "text",
    "action" "text" NOT NULL,
    "actor_email" "text",
    "actor_role" "text",
    "reason" "text",
    "affected" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."client_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_growth_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "partnership_id" "uuid",
    "recommendation_id" "uuid",
    "title" "text" NOT NULL,
    "detail" "text",
    "status" "text" DEFAULT 'todo'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."client_growth_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_integrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "status" "text" DEFAULT 'disconnected'::"text" NOT NULL,
    "access_token" "text",
    "refresh_token" "text",
    "property_id" "text",
    "scopes" "text",
    "connected_at" timestamp with time zone,
    "last_sync_at" timestamp with time zone,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "account_label" "text"
);


ALTER TABLE "public"."client_integrations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" DEFAULT "public"."dds_tenant"() NOT NULL,
    "partnership_id" "uuid" NOT NULL,
    "kind" "text" DEFAULT 'note'::"text",
    "body" "text" NOT NULL,
    "pinned" boolean DEFAULT false NOT NULL,
    "remind_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."client_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_onboarding" (
    "client_id" "uuid" NOT NULL,
    "has_seen_welcome" boolean DEFAULT false,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."client_onboarding" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_renewals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "renewed_on" "date" DEFAULT CURRENT_DATE NOT NULL,
    "next_renews_at" "date",
    "interval_days" integer,
    "monthly_amount" "text",
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."client_renewals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "title" "text" NOT NULL,
    "kind" "text" DEFAULT 'monthly'::"text",
    "status" "text" DEFAULT 'draft'::"text",
    "body" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "delivered_at" timestamp with time zone
);


ALTER TABLE "public"."client_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "request_type" "text",
    "subject" "text" NOT NULL,
    "details" "text",
    "status" "text" DEFAULT 'open'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "agency_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "tenant_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."client_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "project_name" "text",
    "project_status" "text" DEFAULT 'In Progress'::"text",
    "progress" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "contact_email" "text",
    "contract_acked_at" timestamp with time zone,
    "last_seen_at" timestamp with time zone,
    "launched_at" timestamp with time zone,
    "maintenance_plan" "text",
    "survey_sent_at" timestamp with time zone,
    "content_due_at" timestamp with time zone,
    "content_received_at" timestamp with time zone,
    "last_content_nudge_at" timestamp with time zone,
    "automation_paused" boolean DEFAULT false,
    "agency_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "contact_id" "uuid",
    "tenant_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "deleted_at" timestamp with time zone,
    "archived_at" timestamp with time zone,
    "archived_by" "text",
    "archive_reason" "text",
    "contract_package" "text",
    "contract_fee" numeric,
    "contract_timeline" "text",
    "contract_effective_date" "date",
    "contract_version" integer,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "subscription_status" "text",
    "next_billing_at" timestamp with time zone,
    "last_anniversary_note_at" timestamp with time zone,
    "renews_at" "date",
    "last_renewal_interval_days" integer,
    "portal_seen_at" timestamp with time zone,
    "website" "text",
    "status" "text" DEFAULT 'active'::"text",
    "monthly_amount" numeric,
    "business_type" "text",
    "industry" "text",
    "city" "text"
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


COMMENT ON COLUMN "public"."clients"."contract_package" IS 'e.g. "Custom + Photography" — the package name shown on the Project Summary in the client''s Agreement tab';



COMMENT ON COLUMN "public"."clients"."contract_fee" IS 'Total project fee. Deposit/balance (50/50 split) is derived from this at display time, not stored separately.';



COMMENT ON COLUMN "public"."clients"."contract_timeline" IS 'Free-text timeline note, e.g. "Estimate confirmed at discovery."';



COMMENT ON COLUMN "public"."clients"."contract_effective_date" IS 'Effective date of the signed agreement.';



COMMENT ON COLUMN "public"."clients"."website" IS 'Client site URL. The one canonical column; url/site_url/domain variants in code are bugs to fix code-side.';



COMMENT ON COLUMN "public"."clients"."status" IS 'Client lifecycle status (active, paused, ...). Distinct from project_status.';



COMMENT ON COLUMN "public"."clients"."monthly_amount" IS 'Monthly recurring amount in dollars. Null = not set (never fake data).';



CREATE TABLE IF NOT EXISTS "public"."contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agency_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "org_id" "uuid",
    "stage" "text" DEFAULT 'lead'::"text" NOT NULL,
    "name" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "source" "text",
    "referred_by" "uuid",
    "owner_notes" "text",
    "auth_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "contacts_stage_check" CHECK (("stage" = ANY (ARRAY['lead'::"text", 'qualified'::"text", 'proposal'::"text", 'active'::"text", 'past'::"text", 'lost'::"text"])))
);


ALTER TABLE "public"."contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_calendar" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" DEFAULT "public"."dds_tenant"() NOT NULL,
    "partnership_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "kind" "text" DEFAULT 'post'::"text",
    "status" "text" DEFAULT 'planned'::"text" NOT NULL,
    "scheduled_for" "date",
    "published_at" timestamp with time zone,
    "notes" "text",
    "client_visible" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    CONSTRAINT "content_calendar_status_check" CHECK (("status" = ANY (ARRAY['idea'::"text", 'planned'::"text", 'in_progress'::"text", 'scheduled'::"text", 'published'::"text"])))
);


ALTER TABLE "public"."content_calendar" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."discovery_intake" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text",
    "email" "text",
    "business" "text",
    "website" "text",
    "goal" "text",
    "ideal_customer" "text",
    "timeline" "text",
    "budget" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "agency_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "tenant_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL
);


ALTER TABLE "public"."discovery_intake" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dp_events" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "email" "text",
    "app" "text" NOT NULL,
    "page" "text",
    "type" "text" NOT NULL,
    "detail" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."dp_events" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."dp_abandoned_flows" WITH ("security_invoker"='true') AS
 SELECT "page",
    ("detail" ->> 'flow'::"text") AS "flow",
    "count"(*) AS "abandons",
    "round"(("avg"((("detail" ->> 'ms'::"text"))::numeric) / (1000)::numeric)) AS "avg_seconds_before_abandon",
    "max"("created_at") AS "last_seen"
   FROM "public"."dp_events"
  WHERE ("type" = 'flow_abandon'::"text")
  GROUP BY "page", ("detail" ->> 'flow'::"text")
  ORDER BY ("count"(*)) DESC;


ALTER VIEW "public"."dp_abandoned_flows" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."dp_backtracks" WITH ("security_invoker"='true') AS
 SELECT ("detail" ->> 'from'::"text") AS "bounced_off",
    "page" AS "returned_to",
    "count"(*) AS "times",
    "max"("created_at") AS "last_seen"
   FROM "public"."dp_events"
  WHERE ("type" = 'backtrack'::"text")
  GROUP BY ("detail" ->> 'from'::"text"), "page"
  ORDER BY ("count"(*)) DESC;


ALTER VIEW "public"."dp_backtracks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dp_feedback" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "email" "text",
    "app" "text" NOT NULL,
    "page" "text",
    "trying_to" "text",
    "confusing" "text",
    "surprising" "text",
    "missing" "text",
    "confidence" smallint,
    "notes" "text",
    CONSTRAINT "dp_feedback_confidence_check" CHECK ((("confidence" >= 1) AND ("confidence" <= 5)))
);


ALTER TABLE "public"."dp_feedback" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."dp_confidence" WITH ("security_invoker"='true') AS
 SELECT "page",
    "count"(*) AS "responses",
    "round"("avg"("confidence"), 2) AS "avg_confidence",
    "min"("confidence") AS "worst",
    "string_agg"(NULLIF("confusing", ''::"text"), ' | '::"text") FILTER (WHERE ("confidence" <= 2)) AS "low_confidence_confusions"
   FROM "public"."dp_feedback"
  WHERE ("confidence" IS NOT NULL)
  GROUP BY "page"
  ORDER BY ("round"("avg"("confidence"), 2));


ALTER VIEW "public"."dp_confidence" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."dp_confidence_trend" WITH ("security_invoker"='true') AS
 SELECT ("date_trunc"('week'::"text", "created_at"))::"date" AS "week",
    "count"(*) AS "responses",
    "round"("avg"("confidence"), 2) AS "avg_confidence",
    "count"(*) FILTER (WHERE ("confidence" <= 2)) AS "low_scores"
   FROM "public"."dp_feedback"
  WHERE ("confidence" IS NOT NULL)
  GROUP BY (("date_trunc"('week'::"text", "created_at"))::"date")
  ORDER BY (("date_trunc"('week'::"text", "created_at"))::"date") DESC;


ALTER VIEW "public"."dp_confidence_trend" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."dp_errors" WITH ("security_invoker"='true') AS
 SELECT "page",
    ("detail" ->> 'msg'::"text") AS "error",
    "count"(*) AS "times",
    "max"("created_at") AS "last_seen"
   FROM "public"."dp_events"
  WHERE ("type" = 'error'::"text")
  GROUP BY "page", ("detail" ->> 'msg'::"text")
  ORDER BY ("count"(*)) DESC;


ALTER VIEW "public"."dp_errors" OWNER TO "postgres";


ALTER TABLE "public"."dp_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."dp_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE OR REPLACE VIEW "public"."dp_feature_usage" WITH ("security_invoker"='true') AS
 SELECT "page",
    "count"(*) AS "views",
    "count"(DISTINCT "session_id") AS "sessions",
    "count"(DISTINCT "user_id") AS "people",
    "max"("created_at") AS "last_used",
    "round"((EXTRACT(epoch FROM ("now"() - "max"("created_at"))) / (86400)::numeric)) AS "days_since_used"
   FROM "public"."dp_events"
  WHERE (("type" = 'page_view'::"text") AND ("page" IS NOT NULL) AND ("page" <> '__end'::"text"))
  GROUP BY "page"
  ORDER BY ("count"(*)) DESC;


ALTER VIEW "public"."dp_feature_usage" OWNER TO "postgres";


ALTER TABLE "public"."dp_feedback" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."dp_feedback_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE OR REPLACE VIEW "public"."dp_nav_paths" WITH ("security_invoker"='true') AS
 WITH "ordered" AS (
         SELECT "dp_events"."session_id",
            "dp_events"."page",
            "dp_events"."created_at",
            "lead"("dp_events"."page") OVER (PARTITION BY "dp_events"."session_id" ORDER BY "dp_events"."created_at") AS "next_page"
           FROM "public"."dp_events"
          WHERE ("dp_events"."type" = 'page_view'::"text")
        )
 SELECT "page" AS "from_page",
    "next_page" AS "to_page",
    "count"(*) AS "times"
   FROM "ordered"
  WHERE (("next_page" IS NOT NULL) AND ("next_page" <> "page"))
  GROUP BY "page", "next_page"
  ORDER BY ("count"(*)) DESC;


ALTER VIEW "public"."dp_nav_paths" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."dp_onboarding_funnel" WITH ("security_invoker"='true') AS
 SELECT COALESCE(("detail" ->> 'flow'::"text"), '?'::"text") AS "flow",
    "count"(*) FILTER (WHERE ("type" = 'flow_start'::"text")) AS "started",
    "count"(*) FILTER (WHERE ("type" = 'flow_complete'::"text")) AS "completed",
    "count"(*) FILTER (WHERE ("type" = 'flow_abandon'::"text")) AS "abandoned",
        CASE
            WHEN ("count"(*) FILTER (WHERE ("type" = 'flow_start'::"text")) > 0) THEN "round"(((100.0 * ("count"(*) FILTER (WHERE ("type" = 'flow_complete'::"text")))::numeric) / ("count"(*) FILTER (WHERE ("type" = 'flow_start'::"text")))::numeric))
            ELSE NULL::numeric
        END AS "completion_pct"
   FROM "public"."dp_events"
  WHERE ("type" = ANY (ARRAY['flow_start'::"text", 'flow_complete'::"text", 'flow_abandon'::"text"]))
  GROUP BY COALESCE(("detail" ->> 'flow'::"text"), '?'::"text")
  ORDER BY ("count"(*) FILTER (WHERE ("type" = 'flow_start'::"text"))) DESC;


ALTER VIEW "public"."dp_onboarding_funnel" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."dp_page_time" WITH ("security_invoker"='true') AS
 SELECT "page",
    "count"(*) AS "visits",
    "round"(("avg"((("detail" ->> 'ms'::"text"))::numeric) / (1000)::numeric)) AS "avg_seconds",
    "round"(("max"((("detail" ->> 'ms'::"text"))::numeric) / (1000)::numeric)) AS "max_seconds",
    "sum"(
        CASE
            WHEN ((("detail" ->> 'repeats'::"text"))::integer > 4) THEN 1
            ELSE 0
        END) AS "visits_with_repeat_clicking"
   FROM "public"."dp_events"
  WHERE ("type" = 'page_leave'::"text")
  GROUP BY "page"
  ORDER BY ("count"(*)) DESC;


ALTER VIEW "public"."dp_page_time" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."dp_rage_spots" WITH ("security_invoker"='true') AS
 SELECT "page",
    ("detail" ->> 'sel'::"text") AS "target",
    ("detail" ->> 'text'::"text") AS "label",
    "count"(*) AS "rage_clicks",
    "max"("created_at") AS "last_seen"
   FROM "public"."dp_events"
  WHERE ("type" = 'rage_click'::"text")
  GROUP BY "page", ("detail" ->> 'sel'::"text"), ("detail" ->> 'text'::"text")
  ORDER BY ("count"(*)) DESC;


ALTER VIEW "public"."dp_rage_spots" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."dp_search_outcomes" WITH ("security_invoker"='true') AS
 SELECT "page",
    "count"(*) FILTER (WHERE ("type" = 'search'::"text")) AS "searches",
    "count"(*) FILTER (WHERE ("type" = 'search_click'::"text")) AS "found_something",
    "count"(*) FILTER (WHERE ("type" = 'search_abandon'::"text")) AS "gave_up",
        CASE
            WHEN ("count"(*) FILTER (WHERE ("type" = 'search'::"text")) > 0) THEN "round"(((100.0 * ("count"(*) FILTER (WHERE ("type" = 'search_abandon'::"text")))::numeric) / ("count"(*) FILTER (WHERE ("type" = 'search'::"text")))::numeric))
            ELSE NULL::numeric
        END AS "abandon_pct"
   FROM "public"."dp_events"
  WHERE ("type" = ANY (ARRAY['search'::"text", 'search_click'::"text", 'search_abandon'::"text"]))
  GROUP BY "page"
  ORDER BY ("count"(*) FILTER (WHERE ("type" = 'search_abandon'::"text"))) DESC;


ALTER VIEW "public"."dp_search_outcomes" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."dp_session_story" WITH ("security_invoker"='true') AS
 SELECT "session_id",
    "created_at",
    "app",
    "page",
    "type",
    COALESCE(("detail" ->> 'flow'::"text"), ("detail" ->> 'sel'::"text"), ("detail" ->> 'msg'::"text"), ''::"text") AS "what",
    "detail"
   FROM "public"."dp_events";


ALTER VIEW "public"."dp_session_story" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "category" "text" DEFAULT 'General'::"text" NOT NULL,
    "subject" "text" DEFAULT ''::"text" NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "purpose" "text" DEFAULT ''::"text" NOT NULL,
    "when_to_send" "text" DEFAULT ''::"text" NOT NULL,
    "auto_signal" "text",
    "favorite" boolean DEFAULT false NOT NULL,
    "archived" boolean DEFAULT false NOT NULL,
    "usage_count" integer DEFAULT 0 NOT NULL,
    "last_used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."email_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" bigint NOT NULL,
    "agency_id" "uuid" NOT NULL,
    "contact_id" "uuid",
    "project_id" "uuid",
    "actor" "text" DEFAULT 'system'::"text" NOT NULL,
    "type" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb",
    "client_visible" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."events" OWNER TO "postgres";


ALTER TABLE "public"."events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."file_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "file_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "author" "text" NOT NULL,
    "comment" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."file_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "name" "text" NOT NULL,
    "size" "text",
    "type" "text",
    "from_who" "text" DEFAULT 'eric'::"text",
    "status" "text" DEFAULT 'pending'::"text",
    "storage_path" "text",
    "url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "agency_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "tenant_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."growth_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "partnership_id" "uuid",
    "recommendation_id" "uuid",
    "from_who" "text" NOT NULL,
    "body" "text" NOT NULL,
    "is_read" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."growth_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."growth_quotes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "partnership_id" "uuid",
    "recommendation_id" "uuid",
    "client_note" "text",
    "status" "text" DEFAULT 'requested'::"text" NOT NULL,
    "amount" numeric,
    "eric_note" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "responded_at" timestamp with time zone,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."growth_quotes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."growth_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" DEFAULT "public"."dds_tenant"() NOT NULL,
    "partnership_id" "uuid",
    "title" "text" NOT NULL,
    "detail" "text",
    "status" "text" DEFAULT 'todo'::"text" NOT NULL,
    "priority" integer DEFAULT 2 NOT NULL,
    "due_at" timestamp with time zone,
    "source" "text" DEFAULT 'manual'::"text",
    "recommendation_id" "uuid",
    "request_id" "uuid",
    "client_facing_label" "text",
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    CONSTRAINT "growth_tasks_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'recommendation'::"text", 'request'::"text"]))),
    CONSTRAINT "growth_tasks_status_check" CHECK (("status" = ANY (ARRAY['todo'::"text", 'doing'::"text", 'done'::"text"])))
);


ALTER TABLE "public"."growth_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."health_metrics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" DEFAULT "public"."dds_tenant"() NOT NULL,
    "partnership_id" "uuid" NOT NULL,
    "period" "text" NOT NULL,
    "calls" integer,
    "forms" integer,
    "bookings" integer,
    "visits" integer,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."health_metrics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."intake_forms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "business_name" "text",
    "business_description" "text",
    "target_audience" "text",
    "brand_colors" "text",
    "has_logo" boolean DEFAULT false,
    "logo_notes" "text",
    "existing_site" "text",
    "competitors" "text",
    "goals" "text",
    "pages_wanted" "text",
    "content_status" "text",
    "hosting_domain" "text",
    "special_requests" "text",
    "status" "text" DEFAULT 'draft'::"text",
    "submitted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "agency_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "tenant_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."intake_forms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "name" "text" NOT NULL,
    "description" "text",
    "due_date" "text",
    "amount" "text",
    "status" "text" DEFAULT 'draft'::"text",
    "stripe_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "agency_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "tenant_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "deleted_at" timestamp with time zone,
    "last_reminder_at" timestamp with time zone,
    "reminder_level" integer DEFAULT 0,
    "stripe_session_id" "text",
    "paid_at" timestamp with time zone,
    "reminder_count" integer DEFAULT 0 NOT NULL,
    "thankyou_sent_at" timestamp with time zone
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "who" "text" NOT NULL,
    "body" "text" NOT NULL,
    "from_ai" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tenant_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL
);


ALTER TABLE "public"."lead_messages" OWNER TO "postgres";


COMMENT ON TABLE "public"."lead_messages" IS 'Studio OS: messages within a lead conversation. who = them | me | ai_draft.';



CREATE TABLE IF NOT EXISTS "public"."leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid",
    "name" "text",
    "email" "text",
    "phone" "text",
    "source" "text" DEFAULT 'website_form'::"text" NOT NULL,
    "subject" "text",
    "message" "text",
    "tag" "text",
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "value_note" "text",
    "unread" boolean DEFAULT true NOT NULL,
    "last_message" "text",
    "last_actor" "text",
    "replied_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tenant_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL
);


ALTER TABLE "public"."leads" OWNER TO "postgres";


COMMENT ON TABLE "public"."leads" IS 'Studio OS Customers module: one row per inbound inquiry (the inbox item).';



CREATE TABLE IF NOT EXISTS "public"."memberships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."member_role" DEFAULT 'staff'::"public"."member_role" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."memberships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."message_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "label" "text" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "agency_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "tenant_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL
);


ALTER TABLE "public"."message_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "from_who" "text" NOT NULL,
    "sender_name" "text" NOT NULL,
    "text" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "agency_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "tenant_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monitored_sites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "label" "text" NOT NULL,
    "url" "text" NOT NULL,
    "client_id" "uuid",
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tenant_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL
);


ALTER TABLE "public"."monitored_sites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monthly_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" DEFAULT "public"."dds_tenant"() NOT NULL,
    "partnership_id" "uuid" NOT NULL,
    "period" "text" NOT NULL,
    "improved" "text",
    "work_done" "text",
    "found" "text",
    "next_up" "text",
    "payoff" "text",
    "headline" "text",
    "intro" "text",
    "metrics" "jsonb" DEFAULT '{}'::"jsonb",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    CONSTRAINT "monthly_reviews_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text"])))
);


ALTER TABLE "public"."monthly_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "type" "text",
    "title" "text" NOT NULL,
    "body" "text",
    "link_tab" "text",
    "is_read" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "agency_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "tenant_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."opportunities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "audit_lead_id" "uuid",
    "lead_id" "uuid",
    "partnership_id" "uuid",
    "invoice_id" "uuid",
    "category" "text" NOT NULL,
    "signal" "text" NOT NULL,
    "source" "text",
    "dedupe_key" "text" NOT NULL,
    "title" "text" NOT NULL,
    "summary" "text",
    "why" "text",
    "recommended_action" "text",
    "value_estimate" numeric,
    "value_basis" "text",
    "status" "text" DEFAULT 'surfaced'::"text" NOT NULL,
    "confidence" "text" DEFAULT 'medium'::"text",
    "next_action" "text",
    "next_action_due" timestamp with time zone,
    "last_touch_at" timestamp with time zone,
    "dismissed_until" timestamp with time zone,
    "won_at" timestamp with time zone,
    "lost_at" timestamp with time zone,
    "lost_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."opportunities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."opportunity_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "opportunity_id" "uuid" NOT NULL,
    "event" "text" NOT NULL,
    "detail" "text",
    "actor" "text" DEFAULT 'engine'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."opportunity_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ops_errors" (
    "id" bigint NOT NULL,
    "kind" "text" NOT NULL,
    "detail" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."ops_errors" OWNER TO "postgres";


ALTER TABLE "public"."ops_errors" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."ops_errors_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agency_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "name" "text" NOT NULL,
    "website" "text",
    "city" "text",
    "industry" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."partnership_goals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" DEFAULT "public"."dds_tenant"() NOT NULL,
    "partnership_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "detail" "text",
    "metric" "text",
    "target" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "quarter" "text",
    "client_visible" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    CONSTRAINT "partnership_goals_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'hit'::"text", 'missed'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."partnership_goals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."partnerships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" DEFAULT "public"."dds_tenant"() NOT NULL,
    "client_id" "uuid",
    "contact_id" "uuid",
    "segment" "text" DEFAULT 'established'::"text" NOT NULL,
    "status" "text" DEFAULT 'onboarding'::"text" NOT NULL,
    "plan_label" "text",
    "monthly_amount" numeric(10,2),
    "primary_site" "text",
    "started_at" timestamp with time zone DEFAULT "now"(),
    "launched_at" timestamp with time zone,
    "renews_at" timestamp with time zone,
    "health" "text" DEFAULT 'green'::"text",
    "health_note" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    CONSTRAINT "partnerships_health_check" CHECK (("health" = ANY (ARRAY['green'::"text", 'yellow'::"text", 'red'::"text"]))),
    CONSTRAINT "partnerships_segment_check" CHECK (("segment" = ANY (ARRAY['new_business'::"text", 'established'::"text", 'maintenance'::"text", 'growth'::"text"]))),
    CONSTRAINT "partnerships_status_check" CHECK (("status" = ANY (ARRAY['onboarding'::"text", 'active'::"text", 'paused'::"text", 'ended'::"text"])))
);


ALTER TABLE "public"."partnerships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pi_reports" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "week_start" "date" NOT NULL,
    "events_n" integer DEFAULT 0 NOT NULL,
    "feedback_n" integer DEFAULT 0 NOT NULL,
    "body_md" "text" NOT NULL
);


ALTER TABLE "public"."pi_reports" OWNER TO "postgres";


ALTER TABLE "public"."pi_reports" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."pi_reports_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."pi_settings" (
    "id" smallint DEFAULT 1 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "min_events_for_ai" integer DEFAULT 50 NOT NULL,
    "min_feedback_for_ai" integer DEFAULT 3 NOT NULL,
    "min_active_partners" integer DEFAULT 1 NOT NULL,
    "min_confidence_responses" integer DEFAULT 3 NOT NULL,
    "max_recommendations" integer DEFAULT 5 NOT NULL,
    "report_day" smallint DEFAULT 1 NOT NULL,
    "report_recipients" "text" DEFAULT 'eric@davisdigitalstudio.com'::"text" NOT NULL,
    "dp_mode_enabled" boolean DEFAULT true NOT NULL,
    CONSTRAINT "pi_settings_id_check" CHECK (("id" = 1)),
    CONSTRAINT "pi_settings_report_day_check" CHECK ((("report_day" >= 0) AND ("report_day" <= 6)))
);


ALTER TABLE "public"."pi_settings" OWNER TO "postgres";


COMMENT ON TABLE "public"."pi_settings" IS 'Operational thresholds for Product Intelligence. Maturity presets: Early validation (events 50 / feedback 3 / partners 1), Growing (events 300 / feedback 10 / partners 3), Mature (events 1500 / feedback 25 / partners 5). Presets are conveniences in the admin card — nothing changes automatically.';



CREATE TABLE IF NOT EXISTS "public"."project_surveys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "text",
    "client_name" "text",
    "rating" integer,
    "what_worked" "text",
    "improve" "text",
    "quote" "text",
    "testimonial_consent" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."project_surveys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agency_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "tier" "text",
    "stage" "text" DEFAULT 'kickoff'::"text" NOT NULL,
    "ball_in_court" "text" DEFAULT 'agency'::"text" NOT NULL,
    "progress" integer DEFAULT 0,
    "launched_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "last_turn_reminder_at" timestamp with time zone,
    "tenant_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "projects_ball_in_court_check" CHECK (("ball_in_court" = ANY (ARRAY['agency'::"text", 'client'::"text"]))),
    CONSTRAINT "projects_progress_check" CHECK ((("progress" >= 0) AND ("progress" <= 100))),
    CONSTRAINT "projects_stage_check" CHECK (("stage" = ANY (ARRAY['kickoff'::"text", 'content'::"text", 'design'::"text", 'build'::"text", 'review'::"text", 'launch'::"text", 'complete'::"text"])))
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prospects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_name" "text" NOT NULL,
    "contact_name" "text",
    "email" "text",
    "phone" "text",
    "website" "text",
    "site_status" "text" DEFAULT 'No website'::"text",
    "source" "text",
    "notes" "text",
    "status" "text" DEFAULT 'New'::"text",
    "emailed" boolean DEFAULT false,
    "emailed_date" "date",
    "follow_up_date" "date",
    "replied" boolean DEFAULT false,
    "replied_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "priority" "text" DEFAULT 'Medium'::"text",
    "agency_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "contact_id" "uuid",
    "tenant_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "industry" "text",
    "location" "text",
    "opportunity" "text"
);


ALTER TABLE "public"."prospects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quotes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token" "text" NOT NULL,
    "client_name" "text" NOT NULL,
    "client_email" "text",
    "project" "text",
    "lines_json" "text" DEFAULT '[]'::"text" NOT NULL,
    "notes" "text",
    "pricing_explainer" "text",
    "expires" "text",
    "total" numeric DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'sent'::"text" NOT NULL,
    "view_count" integer DEFAULT 0 NOT NULL,
    "first_viewed_at" timestamp with time zone,
    "last_viewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."quotes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."raw_ingestions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "source" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "fetched_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "period" "text",
    "status" "text" DEFAULT 'ok'::"text" NOT NULL,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."raw_ingestions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recommendations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" DEFAULT "public"."dds_tenant"() NOT NULL,
    "partnership_id" "uuid" NOT NULL,
    "source" "text" DEFAULT 'eric'::"text" NOT NULL,
    "category" "text",
    "title" "text" NOT NULL,
    "detail" "text",
    "why" "text",
    "effort" "text" DEFAULT 'medium'::"text",
    "impact" "text" DEFAULT 'medium'::"text",
    "status" "text" DEFAULT 'suggested'::"text" NOT NULL,
    "client_visible" boolean DEFAULT false NOT NULL,
    "shared_at" timestamp with time zone,
    "decided_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "scheduled_for" "date",
    "scheduled_label" "text",
    "declined_at" timestamp with time zone,
    "declined_reason" "text",
    "needs_client_input" boolean DEFAULT false,
    "client_input_note" "text",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "confidence" integer,
    "ai_reasoning" "text",
    "ai_bucket" "text",
    "ai_evaluated_at" timestamp with time zone,
    "last_action_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "recommendations_effort_check" CHECK (("effort" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "recommendations_impact_check" CHECK (("impact" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "recommendations_source_check" CHECK (("source" = ANY (ARRAY['eric'::"text", 'ai'::"text"]))),
    CONSTRAINT "recommendations_status_check" CHECK (("status" = ANY (ARRAY['suggested'::"text", 'approved'::"text", 'shared'::"text", 'accepted'::"text", 'declined'::"text", 'done'::"text", 'dismissed'::"text"])))
);


ALTER TABLE "public"."recommendations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scheduler_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job" "text" NOT NULL,
    "period" "text" NOT NULL,
    "ran_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."scheduler_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."signals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "partnership_id" "uuid",
    "metric" "text" NOT NULL,
    "value" numeric,
    "unit" "text" DEFAULT 'count'::"text" NOT NULL,
    "period" "text" DEFAULT 'point'::"text" NOT NULL,
    "observed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text" NOT NULL,
    "confidence" "text" DEFAULT 'measured'::"text" NOT NULL,
    "scope" "text" DEFAULT 'internal'::"text" NOT NULL,
    "raw_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."signals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."site_checks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "overall" integer,
    "performance" integer,
    "mobile" integer,
    "visibility" integer,
    "local" integer,
    "https" boolean,
    "findings" "jsonb",
    "raw" "jsonb",
    "ok" boolean DEFAULT true NOT NULL,
    "error" "text",
    "checked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tenant_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL
);


ALTER TABLE "public"."site_checks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stripe_payments" (
    "id" bigint NOT NULL,
    "stripe_session_id" "text",
    "stripe_payment_intent" "text",
    "stripe_invoice_id" "text",
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "email" "text",
    "amount" numeric,
    "currency" "text" DEFAULT 'usd'::"text",
    "kind" "text" DEFAULT 'one_time'::"text",
    "status" "text" DEFAULT 'paid'::"text",
    "description" "text",
    "invoice_id" "uuid",
    "client_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."stripe_payments" OWNER TO "postgres";


ALTER TABLE "public"."stripe_payments" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."stripe_payments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."stripe_webhook_events" (
    "event_id" "text" NOT NULL,
    "type" "text",
    "received_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."stripe_webhook_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."studio_documents" (
    "key" "text" NOT NULL,
    "title" "text",
    "body" "text" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."studio_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."studio_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "title" "text" NOT NULL,
    "body" "text",
    "status" "text" DEFAULT 'open'::"text",
    "priority" "text" DEFAULT 'medium'::"text",
    "impact" "text" DEFAULT 'none'::"text",
    "due_date" "date",
    "source" "text" DEFAULT 'manual'::"text",
    "source_ref" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "done_at" timestamp with time zone
);


ALTER TABLE "public"."studio_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."suppressed_emails" (
    "email" "text" NOT NULL,
    "reason" "text" DEFAULT 'opt_out'::"text",
    "source" "text" DEFAULT 'manual'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."suppressed_emails" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."survey_responses" (
    "id" bigint NOT NULL,
    "client_id" "uuid",
    "client_name" "text",
    "client_email" "text",
    "message" "text",
    "sentiment_score" numeric,
    "sentiment_summary" "text",
    "sentiment_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."survey_responses" OWNER TO "postgres";


ALTER TABLE "public"."survey_responses" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."survey_responses_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sync_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "source" "text" NOT NULL,
    "status" "text" NOT NULL,
    "signals_written" integer DEFAULT 0 NOT NULL,
    "error" "text",
    "ran_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sync_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tenants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."timeline" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "date_label" "text",
    "icon" "text" DEFAULT '📋'::"text",
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "agency_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "tenant_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."timeline" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_partnership_overview" AS
 SELECT "p"."id",
    "p"."tenant_id",
    "p"."client_id",
    "p"."contact_id",
    "p"."segment",
    "p"."status",
    "p"."plan_label",
    "p"."monthly_amount",
    "p"."primary_site",
    "p"."started_at",
    "p"."launched_at",
    "p"."renews_at",
    "p"."health",
    "p"."health_note",
    "p"."created_at",
    "p"."updated_at",
    "c"."name" AS "client_name",
    "c"."contact_email" AS "client_email",
    "ct"."name" AS "contact_name",
    "ct"."email" AS "contact_email",
    ( SELECT "count"(*) AS "count"
           FROM "public"."growth_tasks" "t"
          WHERE (("t"."partnership_id" = "p"."id") AND ("t"."status" <> 'done'::"text"))) AS "open_tasks",
    ( SELECT "count"(*) AS "count"
           FROM "public"."recommendations" "r"
          WHERE (("r"."partnership_id" = "p"."id") AND ("r"."status" = 'suggested'::"text"))) AS "pending_recs",
    ( SELECT "count"(*) AS "count"
           FROM "public"."partnership_goals" "g"
          WHERE (("g"."partnership_id" = "p"."id") AND ("g"."status" = 'active'::"text"))) AS "active_goals",
    ( SELECT "max"("mr"."period") AS "max"
           FROM "public"."monthly_reviews" "mr"
          WHERE (("mr"."partnership_id" = "p"."id") AND ("mr"."status" = 'published'::"text"))) AS "last_review_period"
   FROM (("public"."partnerships" "p"
     LEFT JOIN "public"."clients" "c" ON (("c"."id" = "p"."client_id")))
     LEFT JOIN "public"."contacts" "ct" ON (("ct"."id" = "p"."contact_id")));


ALTER VIEW "public"."v_partnership_overview" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."work_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" DEFAULT "public"."dds_tenant"() NOT NULL,
    "partnership_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "detail" "text",
    "category" "text",
    "task_id" "uuid",
    "period" "text",
    "client_visible" boolean DEFAULT true NOT NULL,
    "done_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."work_log" OWNER TO "postgres";


ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admins"
    ADD CONSTRAINT "admins_pkey" PRIMARY KEY ("email");



ALTER TABLE ONLY "public"."agencies"
    ADD CONSTRAINT "agencies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agencies"
    ADD CONSTRAINT "agencies_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."approvals"
    ADD CONSTRAINT "approvals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_leads"
    ADD CONSTRAINT "audit_leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_orders"
    ADD CONSTRAINT "audit_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_audit_log"
    ADD CONSTRAINT "client_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_growth_tasks"
    ADD CONSTRAINT "client_growth_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_integrations"
    ADD CONSTRAINT "client_integrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_notes"
    ADD CONSTRAINT "client_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_onboarding"
    ADD CONSTRAINT "client_onboarding_pkey" PRIMARY KEY ("client_id");



ALTER TABLE ONLY "public"."client_renewals"
    ADD CONSTRAINT "client_renewals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_reports"
    ADD CONSTRAINT "client_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_requests"
    ADD CONSTRAINT "client_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_calendar"
    ADD CONSTRAINT "content_calendar_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."discovery_intake"
    ADD CONSTRAINT "discovery_intake_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dp_events"
    ADD CONSTRAINT "dp_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dp_feedback"
    ADD CONSTRAINT "dp_feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_templates"
    ADD CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."file_comments"
    ADD CONSTRAINT "file_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."growth_messages"
    ADD CONSTRAINT "growth_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."growth_quotes"
    ADD CONSTRAINT "growth_quotes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."growth_tasks"
    ADD CONSTRAINT "growth_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."health_metrics"
    ADD CONSTRAINT "health_metrics_partnership_id_period_key" UNIQUE ("partnership_id", "period");



ALTER TABLE ONLY "public"."health_metrics"
    ADD CONSTRAINT "health_metrics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."intake_forms"
    ADD CONSTRAINT "intake_forms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_messages"
    ADD CONSTRAINT "lead_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."memberships"
    ADD CONSTRAINT "memberships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."memberships"
    ADD CONSTRAINT "memberships_tenant_id_user_id_key" UNIQUE ("tenant_id", "user_id");



ALTER TABLE ONLY "public"."message_templates"
    ADD CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monitored_sites"
    ADD CONSTRAINT "monitored_sites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monthly_reviews"
    ADD CONSTRAINT "monthly_reviews_partnership_id_period_key" UNIQUE ("partnership_id", "period");



ALTER TABLE ONLY "public"."monthly_reviews"
    ADD CONSTRAINT "monthly_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."opportunities"
    ADD CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."opportunity_events"
    ADD CONSTRAINT "opportunity_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ops_errors"
    ADD CONSTRAINT "ops_errors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."partnership_goals"
    ADD CONSTRAINT "partnership_goals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."partnerships"
    ADD CONSTRAINT "partnerships_client_id_key" UNIQUE ("client_id");



ALTER TABLE ONLY "public"."partnerships"
    ADD CONSTRAINT "partnerships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pi_reports"
    ADD CONSTRAINT "pi_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pi_settings"
    ADD CONSTRAINT "pi_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_surveys"
    ADD CONSTRAINT "project_surveys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prospects"
    ADD CONSTRAINT "prospects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."raw_ingestions"
    ADD CONSTRAINT "raw_ingestions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recommendations"
    ADD CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scheduler_runs"
    ADD CONSTRAINT "scheduler_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."signals"
    ADD CONSTRAINT "signals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."site_checks"
    ADD CONSTRAINT "site_checks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_payments"
    ADD CONSTRAINT "stripe_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_payments"
    ADD CONSTRAINT "stripe_payments_stripe_invoice_id_key" UNIQUE ("stripe_invoice_id");



ALTER TABLE ONLY "public"."stripe_payments"
    ADD CONSTRAINT "stripe_payments_stripe_session_id_key" UNIQUE ("stripe_session_id");



ALTER TABLE ONLY "public"."stripe_webhook_events"
    ADD CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("event_id");



ALTER TABLE ONLY "public"."studio_documents"
    ADD CONSTRAINT "studio_documents_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."studio_tasks"
    ADD CONSTRAINT "studio_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."suppressed_emails"
    ADD CONSTRAINT "suppressed_emails_pkey" PRIMARY KEY ("email");



ALTER TABLE ONLY "public"."survey_responses"
    ADD CONSTRAINT "survey_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sync_log"
    ADD CONSTRAINT "sync_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."timeline"
    ADD CONSTRAINT "timeline_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."work_log"
    ADD CONSTRAINT "work_log_pkey" PRIMARY KEY ("id");



CREATE INDEX "activity_log_agency_idx" ON "public"."activity_log" USING "btree" ("agency_id");



CREATE INDEX "activity_log_deleted_at_idx" ON "public"."activity_log" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "approvals_agency_idx" ON "public"."approvals" USING "btree" ("agency_id");



CREATE INDEX "approvals_deleted_at_idx" ON "public"."approvals" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "audit_leads_agency_idx" ON "public"."audit_leads" USING "btree" ("agency_id");



CREATE INDEX "audit_leads_created_at_idx" ON "public"."audit_leads" USING "btree" ("created_at" DESC);



CREATE INDEX "audit_leads_tool_idx" ON "public"."audit_leads" USING "btree" ("tool");



CREATE INDEX "audit_orders_created_idx" ON "public"."audit_orders" USING "btree" ("created_at" DESC);



CREATE INDEX "client_audit_log_action_idx" ON "public"."client_audit_log" USING "btree" ("action", "created_at" DESC);



CREATE INDEX "client_audit_log_client_idx" ON "public"."client_audit_log" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "client_growth_tasks_deleted_at_idx" ON "public"."client_growth_tasks" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "client_notes_deleted_at_idx" ON "public"."client_notes" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "client_onboarding_deleted_at_idx" ON "public"."client_onboarding" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "client_renewals_client_idx" ON "public"."client_renewals" USING "btree" ("client_id");



CREATE INDEX "client_requests_agency_idx" ON "public"."client_requests" USING "btree" ("agency_id");



CREATE INDEX "client_requests_deleted_at_idx" ON "public"."client_requests" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "clients_agency_idx" ON "public"."clients" USING "btree" ("agency_id");



CREATE INDEX "clients_deleted_at_idx" ON "public"."clients" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "contacts_agency_idx" ON "public"."contacts" USING "btree" ("agency_id");



CREATE INDEX "contacts_deleted_at_idx" ON "public"."contacts" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "contacts_email_idx" ON "public"."contacts" USING "btree" ("agency_id", "lower"("email"));



CREATE INDEX "contacts_stage_idx" ON "public"."contacts" USING "btree" ("agency_id", "stage");



CREATE INDEX "content_calendar_deleted_at_idx" ON "public"."content_calendar" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "discovery_intake_agency_idx" ON "public"."discovery_intake" USING "btree" ("agency_id");



CREATE INDEX "dp_events_page_idx" ON "public"."dp_events" USING "btree" ("page");



CREATE INDEX "dp_events_session_idx" ON "public"."dp_events" USING "btree" ("session_id", "created_at");



CREATE INDEX "dp_events_type_idx" ON "public"."dp_events" USING "btree" ("type", "created_at" DESC);



CREATE INDEX "dp_feedback_page_idx" ON "public"."dp_feedback" USING "btree" ("page", "created_at" DESC);



CREATE UNIQUE INDEX "email_templates_name_key" ON "public"."email_templates" USING "btree" ("name");



CREATE INDEX "events_agency_idx" ON "public"."events" USING "btree" ("agency_id", "created_at" DESC);



CREATE INDEX "events_contact_idx" ON "public"."events" USING "btree" ("contact_id", "created_at" DESC);



CREATE INDEX "events_deleted_at_idx" ON "public"."events" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "events_project_idx" ON "public"."events" USING "btree" ("project_id", "created_at" DESC);



CREATE INDEX "events_type_idx" ON "public"."events" USING "btree" ("agency_id", "type");



CREATE INDEX "file_comments_deleted_at_idx" ON "public"."file_comments" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "files_agency_idx" ON "public"."files" USING "btree" ("agency_id");



CREATE INDEX "files_deleted_at_idx" ON "public"."files" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "growth_messages_deleted_at_idx" ON "public"."growth_messages" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "growth_quotes_deleted_at_idx" ON "public"."growth_quotes" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "growth_tasks_deleted_at_idx" ON "public"."growth_tasks" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "health_metrics_deleted_at_idx" ON "public"."health_metrics" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "idx_activity_log_tenant" ON "public"."activity_log" USING "btree" ("tenant_id");



CREATE INDEX "idx_approvals_tenant" ON "public"."approvals" USING "btree" ("tenant_id");



CREATE INDEX "idx_audit_leads_tenant" ON "public"."audit_leads" USING "btree" ("tenant_id");



CREATE INDEX "idx_client_requests_tenant" ON "public"."client_requests" USING "btree" ("tenant_id");



CREATE INDEX "idx_client_tasks_partnership" ON "public"."client_growth_tasks" USING "btree" ("partnership_id");



CREATE INDEX "idx_clients_tenant" ON "public"."clients" USING "btree" ("tenant_id");



CREATE INDEX "idx_contacts_tenant" ON "public"."contacts" USING "btree" ("tenant_id");



CREATE INDEX "idx_content_partnership" ON "public"."content_calendar" USING "btree" ("partnership_id");



CREATE INDEX "idx_content_sched" ON "public"."content_calendar" USING "btree" ("scheduled_for");



CREATE INDEX "idx_discovery_intake_tenant" ON "public"."discovery_intake" USING "btree" ("tenant_id");



CREATE INDEX "idx_events_tenant" ON "public"."events" USING "btree" ("tenant_id");



CREATE INDEX "idx_files_tenant" ON "public"."files" USING "btree" ("tenant_id");



CREATE INDEX "idx_goals_partnership" ON "public"."partnership_goals" USING "btree" ("partnership_id");



CREATE INDEX "idx_growth_messages_rec" ON "public"."growth_messages" USING "btree" ("recommendation_id");



CREATE INDEX "idx_growth_quotes_partnership" ON "public"."growth_quotes" USING "btree" ("partnership_id");



CREATE INDEX "idx_growth_tasks_partnership" ON "public"."growth_tasks" USING "btree" ("partnership_id");



CREATE INDEX "idx_health_partnership" ON "public"."health_metrics" USING "btree" ("partnership_id");



CREATE INDEX "idx_intake_forms_tenant" ON "public"."intake_forms" USING "btree" ("tenant_id");



CREATE INDEX "idx_invoices_tenant" ON "public"."invoices" USING "btree" ("tenant_id");



CREATE INDEX "idx_lead_messages_tenant" ON "public"."lead_messages" USING "btree" ("tenant_id");



CREATE INDEX "idx_leads_tenant" ON "public"."leads" USING "btree" ("tenant_id");



CREATE INDEX "idx_memberships_user" ON "public"."memberships" USING "btree" ("user_id");



CREATE INDEX "idx_message_templates_tenant" ON "public"."message_templates" USING "btree" ("tenant_id");



CREATE INDEX "idx_messages_tenant" ON "public"."messages" USING "btree" ("tenant_id");



CREATE INDEX "idx_monitored_sites_tenant" ON "public"."monitored_sites" USING "btree" ("tenant_id");



CREATE INDEX "idx_notes_partnership" ON "public"."client_notes" USING "btree" ("partnership_id");



CREATE INDEX "idx_notes_remind" ON "public"."client_notes" USING "btree" ("remind_at");



CREATE INDEX "idx_notifications_tenant" ON "public"."notifications" USING "btree" ("tenant_id");



CREATE INDEX "idx_organizations_tenant" ON "public"."organizations" USING "btree" ("tenant_id");



CREATE INDEX "idx_partnerships_renews" ON "public"."partnerships" USING "btree" ("renews_at");



CREATE INDEX "idx_partnerships_segment" ON "public"."partnerships" USING "btree" ("segment");



CREATE INDEX "idx_partnerships_status" ON "public"."partnerships" USING "btree" ("status");



CREATE INDEX "idx_projects_tenant" ON "public"."projects" USING "btree" ("tenant_id");



CREATE INDEX "idx_prospects_created" ON "public"."prospects" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_prospects_emailed" ON "public"."prospects" USING "btree" ("emailed");



CREATE INDEX "idx_prospects_status" ON "public"."prospects" USING "btree" ("status");



CREATE INDEX "idx_prospects_tenant" ON "public"."prospects" USING "btree" ("tenant_id");



CREATE INDEX "idx_raw_client_source" ON "public"."raw_ingestions" USING "btree" ("client_id", "source", "fetched_at" DESC);



CREATE INDEX "idx_recs_partnership" ON "public"."recommendations" USING "btree" ("partnership_id");



CREATE INDEX "idx_recs_status" ON "public"."recommendations" USING "btree" ("status");



CREATE INDEX "idx_reviews_partnership" ON "public"."monthly_reviews" USING "btree" ("partnership_id");



CREATE INDEX "idx_signals_latest" ON "public"."signals" USING "btree" ("client_id", "metric", "observed_at" DESC);



CREATE INDEX "idx_signals_metric_scope" ON "public"."signals" USING "btree" ("metric", "scope", "observed_at" DESC);



CREATE INDEX "idx_site_checks_tenant" ON "public"."site_checks" USING "btree" ("tenant_id");



CREATE INDEX "idx_sync_source_time" ON "public"."sync_log" USING "btree" ("source", "ran_at" DESC);



CREATE INDEX "idx_tasks_partnership" ON "public"."growth_tasks" USING "btree" ("partnership_id");



CREATE INDEX "idx_tasks_status" ON "public"."growth_tasks" USING "btree" ("status");



CREATE INDEX "idx_timeline_tenant" ON "public"."timeline" USING "btree" ("tenant_id");



CREATE INDEX "idx_worklog_partnership" ON "public"."work_log" USING "btree" ("partnership_id");



CREATE INDEX "idx_worklog_period" ON "public"."work_log" USING "btree" ("period");



CREATE INDEX "intake_forms_agency_idx" ON "public"."intake_forms" USING "btree" ("agency_id");



CREATE INDEX "intake_forms_deleted_at_idx" ON "public"."intake_forms" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "invoices_agency_idx" ON "public"."invoices" USING "btree" ("agency_id");



CREATE INDEX "invoices_deleted_at_idx" ON "public"."invoices" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "lead_messages_lead_idx" ON "public"."lead_messages" USING "btree" ("lead_id", "created_at");



CREATE INDEX "leads_org_status_idx" ON "public"."leads" USING "btree" ("org_id", "status", "updated_at" DESC);



CREATE INDEX "leads_status_idx" ON "public"."leads" USING "btree" ("status", "updated_at" DESC);



CREATE INDEX "leads_unanswered_idx" ON "public"."leads" USING "btree" ("status", "created_at") WHERE ("status" = 'new'::"text");



CREATE INDEX "memberships_user_id_idx" ON "public"."memberships" USING "btree" ("user_id");



CREATE INDEX "message_templates_agency_idx" ON "public"."message_templates" USING "btree" ("agency_id");



CREATE INDEX "messages_agency_idx" ON "public"."messages" USING "btree" ("agency_id");



CREATE INDEX "messages_deleted_at_idx" ON "public"."messages" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE UNIQUE INDEX "monitored_sites_url_key" ON "public"."monitored_sites" USING "btree" ("lower"("url"));



CREATE INDEX "monthly_reviews_deleted_at_idx" ON "public"."monthly_reviews" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "notifications_agency_idx" ON "public"."notifications" USING "btree" ("agency_id");



CREATE INDEX "notifications_deleted_at_idx" ON "public"."notifications" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "opportunities_client" ON "public"."opportunities" USING "btree" ("client_id") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "opportunities_dedupe" ON "public"."opportunities" USING "btree" ("dedupe_key") WHERE ("deleted_at" IS NULL);



CREATE INDEX "opportunities_due" ON "public"."opportunities" USING "btree" ("next_action_due") WHERE ("deleted_at" IS NULL);



CREATE INDEX "opportunities_status" ON "public"."opportunities" USING "btree" ("status") WHERE ("deleted_at" IS NULL);



CREATE INDEX "opportunity_events_opp" ON "public"."opportunity_events" USING "btree" ("opportunity_id", "created_at" DESC);



CREATE INDEX "ops_errors_created_idx" ON "public"."ops_errors" USING "btree" ("created_at" DESC);



CREATE INDEX "partnership_goals_deleted_at_idx" ON "public"."partnership_goals" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "partnerships_deleted_at_idx" ON "public"."partnerships" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "projects_agency_idx" ON "public"."projects" USING "btree" ("agency_id");



CREATE INDEX "projects_contact_idx" ON "public"."projects" USING "btree" ("contact_id");



CREATE INDEX "projects_deleted_at_idx" ON "public"."projects" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "prospects_agency_idx" ON "public"."prospects" USING "btree" ("agency_id");



CREATE INDEX "quotes_created_idx" ON "public"."quotes" USING "btree" ("created_at" DESC);



CREATE INDEX "quotes_token_idx" ON "public"."quotes" USING "btree" ("token");



CREATE INDEX "recommendations_deleted_at_idx" ON "public"."recommendations" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "scheduler_runs_job_period_idx" ON "public"."scheduler_runs" USING "btree" ("job", "period");



CREATE INDEX "site_checks_site_time" ON "public"."site_checks" USING "btree" ("site_id", "checked_at" DESC);



CREATE INDEX "stripe_payments_created_idx" ON "public"."stripe_payments" USING "btree" ("created_at" DESC);



CREATE INDEX "timeline_agency_idx" ON "public"."timeline" USING "btree" ("agency_id");



CREATE INDEX "timeline_deleted_at_idx" ON "public"."timeline" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE UNIQUE INDEX "uq_integration_client_provider" ON "public"."client_integrations" USING "btree" ("client_id", "provider");



CREATE UNIQUE INDEX "uq_signals_fact" ON "public"."signals" USING "btree" ("client_id", "metric", "period", "source");



CREATE INDEX "work_log_deleted_at_idx" ON "public"."work_log" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE OR REPLACE TRIGGER "leads_touch" BEFORE UPDATE ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_project_apply_event" AFTER INSERT ON "public"."events" FOR EACH ROW EXECUTE FUNCTION "public"."project_apply_event"();



CREATE OR REPLACE TRIGGER "trg_touch_content_calendar" BEFORE UPDATE ON "public"."content_calendar" FOR EACH ROW EXECUTE FUNCTION "public"."dds_touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_touch_growth_tasks" BEFORE UPDATE ON "public"."growth_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."dds_touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_touch_monthly_reviews" BEFORE UPDATE ON "public"."monthly_reviews" FOR EACH ROW EXECUTE FUNCTION "public"."dds_touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_touch_partnership_goals" BEFORE UPDATE ON "public"."partnership_goals" FOR EACH ROW EXECUTE FUNCTION "public"."dds_touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_touch_partnerships" BEFORE UPDATE ON "public"."partnerships" FOR EACH ROW EXECUTE FUNCTION "public"."dds_touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_touch_recommendations" BEFORE UPDATE ON "public"."recommendations" FOR EACH ROW EXECUTE FUNCTION "public"."dds_touch_updated_at"();



ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_agency_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE CASCADE NOT VALID;



ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."approvals"
    ADD CONSTRAINT "approvals_agency_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE CASCADE NOT VALID;



ALTER TABLE ONLY "public"."approvals"
    ADD CONSTRAINT "approvals_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."approvals"
    ADD CONSTRAINT "approvals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."audit_leads"
    ADD CONSTRAINT "audit_leads_agency_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE CASCADE NOT VALID;



ALTER TABLE ONLY "public"."audit_leads"
    ADD CONSTRAINT "audit_leads_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_leads"
    ADD CONSTRAINT "audit_leads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."client_growth_tasks"
    ADD CONSTRAINT "client_growth_tasks_partnership_id_fkey" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_growth_tasks"
    ADD CONSTRAINT "client_growth_tasks_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_notes"
    ADD CONSTRAINT "client_notes_partnership_id_fkey" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_onboarding"
    ADD CONSTRAINT "client_onboarding_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_renewals"
    ADD CONSTRAINT "client_renewals_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_requests"
    ADD CONSTRAINT "client_requests_agency_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE CASCADE NOT VALID;



ALTER TABLE ONLY "public"."client_requests"
    ADD CONSTRAINT "client_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_requests"
    ADD CONSTRAINT "client_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_agency_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE CASCADE NOT VALID;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_referred_by_fkey" FOREIGN KEY ("referred_by") REFERENCES "public"."contacts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."content_calendar"
    ADD CONSTRAINT "content_calendar_partnership_id_fkey" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."discovery_intake"
    ADD CONSTRAINT "discovery_intake_agency_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE CASCADE NOT VALID;



ALTER TABLE ONLY "public"."discovery_intake"
    ADD CONSTRAINT "discovery_intake_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."file_comments"
    ADD CONSTRAINT "file_comments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_agency_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE CASCADE NOT VALID;



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."growth_messages"
    ADD CONSTRAINT "growth_messages_partnership_id_fkey" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."growth_messages"
    ADD CONSTRAINT "growth_messages_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."growth_quotes"
    ADD CONSTRAINT "growth_quotes_partnership_id_fkey" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."growth_quotes"
    ADD CONSTRAINT "growth_quotes_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."growth_tasks"
    ADD CONSTRAINT "growth_tasks_partnership_id_fkey" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."growth_tasks"
    ADD CONSTRAINT "growth_tasks_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."health_metrics"
    ADD CONSTRAINT "health_metrics_partnership_id_fkey" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."intake_forms"
    ADD CONSTRAINT "intake_forms_agency_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE CASCADE NOT VALID;



ALTER TABLE ONLY "public"."intake_forms"
    ADD CONSTRAINT "intake_forms_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."intake_forms"
    ADD CONSTRAINT "intake_forms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_agency_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE CASCADE NOT VALID;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."lead_messages"
    ADD CONSTRAINT "lead_messages_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_messages"
    ADD CONSTRAINT "lead_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."memberships"
    ADD CONSTRAINT "memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."message_templates"
    ADD CONSTRAINT "message_templates_agency_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE CASCADE NOT VALID;



ALTER TABLE ONLY "public"."message_templates"
    ADD CONSTRAINT "message_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_agency_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE CASCADE NOT VALID;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."monitored_sites"
    ADD CONSTRAINT "monitored_sites_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."monthly_reviews"
    ADD CONSTRAINT "monthly_reviews_partnership_id_fkey" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_agency_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE CASCADE NOT VALID;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."opportunity_events"
    ADD CONSTRAINT "opportunity_events_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."partnership_goals"
    ADD CONSTRAINT "partnership_goals_partnership_id_fkey" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."partnerships"
    ADD CONSTRAINT "partnerships_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."partnerships"
    ADD CONSTRAINT "partnerships_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."prospects"
    ADD CONSTRAINT "prospects_agency_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE CASCADE NOT VALID;



ALTER TABLE ONLY "public"."prospects"
    ADD CONSTRAINT "prospects_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."prospects"
    ADD CONSTRAINT "prospects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."recommendations"
    ADD CONSTRAINT "recommendations_partnership_id_fkey" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."site_checks"
    ADD CONSTRAINT "site_checks_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."monitored_sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."site_checks"
    ADD CONSTRAINT "site_checks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."timeline"
    ADD CONSTRAINT "timeline_agency_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE CASCADE NOT VALID;



ALTER TABLE ONLY "public"."timeline"
    ADD CONSTRAINT "timeline_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timeline"
    ADD CONSTRAINT "timeline_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."work_log"
    ADD CONSTRAINT "work_log_partnership_id_fkey" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."work_log"
    ADD CONSTRAINT "work_log_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."growth_tasks"("id") ON DELETE SET NULL;



CREATE POLICY "Allow anon insert" ON "public"."audit_leads" FOR INSERT WITH CHECK (true);



ALTER TABLE "public"."activity_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "activity_log_client_all" ON "public"."activity_log" TO "authenticated" USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("lower"("clients"."email") = "lower"(("auth"."jwt"() ->> 'email'::"text")))))) WITH CHECK (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("lower"("clients"."email") = "lower"(("auth"."jwt"() ->> 'email'::"text"))))));



CREATE POLICY "activity_log_staff" ON "public"."activity_log" USING (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids"))) WITH CHECK (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids")));



ALTER TABLE "public"."admins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agencies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "anon can insert intake" ON "public"."discovery_intake" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "anon can insert surveys" ON "public"."project_surveys" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "anyone can submit a lead" ON "public"."audit_leads" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



ALTER TABLE "public"."approvals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "approvals_client_read" ON "public"."approvals" FOR SELECT USING (("client_id" IN ( SELECT "public"."my_client_ids"() AS "my_client_ids")));



ALTER TABLE "public"."audit_leads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_leads_staff" ON "public"."audit_leads" USING (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids"))) WITH CHECK (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids")));



ALTER TABLE "public"."audit_orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "authenticated full access" ON "public"."email_templates" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "client deletes own files" ON "public"."files" FOR DELETE TO "authenticated" USING (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids")));



CREATE POLICY "client inserts own activity" ON "public"."activity_log" FOR INSERT TO "authenticated" WITH CHECK (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids")));



CREATE POLICY "client inserts own file_comments" ON "public"."file_comments" FOR INSERT TO "authenticated" WITH CHECK (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids")));



CREATE POLICY "client inserts own files" ON "public"."files" FOR INSERT TO "authenticated" WITH CHECK (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids")));



CREATE POLICY "client inserts own intake" ON "public"."intake_forms" FOR INSERT TO "authenticated" WITH CHECK (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids")));



CREATE POLICY "client inserts own messages" ON "public"."messages" FOR INSERT TO "authenticated" WITH CHECK (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids")));



CREATE POLICY "client inserts own onboarding" ON "public"."client_onboarding" FOR INSERT TO "authenticated" WITH CHECK (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids")));



CREATE POLICY "client inserts own requests" ON "public"."client_requests" FOR INSERT TO "authenticated" WITH CHECK (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids")));



CREATE POLICY "client reads own approvals" ON "public"."approvals" FOR SELECT TO "authenticated" USING (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids")));



CREATE POLICY "client reads own file_comments" ON "public"."file_comments" FOR SELECT TO "authenticated" USING (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids")));



CREATE POLICY "client reads own files" ON "public"."files" FOR SELECT TO "authenticated" USING (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids")));



CREATE POLICY "client reads own intake" ON "public"."intake_forms" FOR SELECT TO "authenticated" USING (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids")));



CREATE POLICY "client reads own invoices" ON "public"."invoices" FOR SELECT TO "authenticated" USING (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids")));



CREATE POLICY "client reads own messages" ON "public"."messages" FOR SELECT TO "authenticated" USING (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids")));



CREATE POLICY "client reads own notifications" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids")));



CREATE POLICY "client reads own onboarding" ON "public"."client_onboarding" FOR SELECT TO "authenticated" USING (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids")));



CREATE POLICY "client reads own requests" ON "public"."client_requests" FOR SELECT TO "authenticated" USING (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids")));



CREATE POLICY "client reads own row" ON "public"."clients" FOR SELECT TO "authenticated" USING (("lower"("email") = "lower"(("auth"."jwt"() ->> 'email'::"text"))));



CREATE POLICY "client reads own timeline" ON "public"."timeline" FOR SELECT TO "authenticated" USING (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids")));



CREATE POLICY "client updates own approvals" ON "public"."approvals" FOR UPDATE TO "authenticated" USING (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids"))) WITH CHECK (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids")));



CREATE POLICY "client updates own files" ON "public"."files" FOR UPDATE TO "authenticated" USING (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids"))) WITH CHECK (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids")));



CREATE POLICY "client updates own intake" ON "public"."intake_forms" FOR UPDATE TO "authenticated" USING (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids"))) WITH CHECK (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids")));



CREATE POLICY "client updates own notifications" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids"))) WITH CHECK (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids")));



CREATE POLICY "client updates own onboarding" ON "public"."client_onboarding" FOR UPDATE TO "authenticated" USING (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids"))) WITH CHECK (("client_id" IN ( SELECT "public"."current_client_ids"() AS "current_client_ids")));



CREATE POLICY "client updates own row" ON "public"."clients" FOR UPDATE TO "authenticated" USING (("lower"("email") = "lower"(("auth"."jwt"() ->> 'email'::"text")))) WITH CHECK (("lower"("email") = "lower"(("auth"."jwt"() ->> 'email'::"text"))));



ALTER TABLE "public"."client_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_growth_tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_growth_tasks_client_rw" ON "public"."client_growth_tasks" TO "authenticated" USING (("partnership_id" IN ( SELECT "p"."id"
   FROM ("public"."partnerships" "p"
     JOIN "public"."contacts" "ct" ON (("ct"."id" = "p"."contact_id")))
  WHERE ("lower"("ct"."email") = "lower"(("auth"."jwt"() ->> 'email'::"text")))))) WITH CHECK (("partnership_id" IN ( SELECT "p"."id"
   FROM ("public"."partnerships" "p"
     JOIN "public"."contacts" "ct" ON (("ct"."id" = "p"."contact_id")))
  WHERE ("lower"("ct"."email") = "lower"(("auth"."jwt"() ->> 'email'::"text"))))));



CREATE POLICY "client_inserts_own_file_comments" ON "public"."file_comments" FOR INSERT WITH CHECK (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."email" = "auth"."email"()))));



ALTER TABLE "public"."client_integrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_notes_staff_all" ON "public"."client_notes" USING ("public"."dds_is_staff"("tenant_id")) WITH CHECK ("public"."dds_is_staff"("tenant_id"));



ALTER TABLE "public"."client_onboarding" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_onboarding_client_all" ON "public"."client_onboarding" TO "authenticated" USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("lower"("clients"."email") = "lower"(("auth"."jwt"() ->> 'email'::"text")))))) WITH CHECK (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("lower"("clients"."email") = "lower"(("auth"."jwt"() ->> 'email'::"text"))))));



CREATE POLICY "client_reads_own" ON "public"."clients" FOR SELECT TO "authenticated" USING (("email" = "auth"."email"()));



CREATE POLICY "client_reads_own_activity" ON "public"."activity_log" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."email" = "auth"."email"()))));



CREATE POLICY "client_reads_own_client_requests" ON "public"."client_requests" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."email" = "auth"."email"()))));



CREATE POLICY "client_reads_own_file_comments" ON "public"."file_comments" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."email" = "auth"."email"()))));



CREATE POLICY "client_reads_own_intake_forms" ON "public"."intake_forms" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."email" = "auth"."email"()))));



CREATE POLICY "client_reads_own_notifications" ON "public"."notifications" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."email" = "auth"."email"()))));



CREATE POLICY "client_reads_own_onboarding" ON "public"."client_onboarding" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."email" = "auth"."email"()))));



ALTER TABLE "public"."client_renewals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_requests_staff" ON "public"."client_requests" USING (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids"))) WITH CHECK (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids")));



CREATE POLICY "client_updates_own" ON "public"."clients" FOR UPDATE TO "authenticated" USING (("email" = "auth"."email"())) WITH CHECK (("email" = "auth"."email"()));



CREATE POLICY "client_updates_own_intake_forms" ON "public"."intake_forms" FOR UPDATE USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."email" = "auth"."email"()))));



CREATE POLICY "client_updates_own_onboarding" ON "public"."client_onboarding" FOR UPDATE USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."email" = "auth"."email"()))));



CREATE POLICY "client_writes_own_client_requests" ON "public"."client_requests" FOR INSERT WITH CHECK (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."email" = "auth"."email"()))));



CREATE POLICY "client_writes_own_intake_forms" ON "public"."intake_forms" FOR INSERT WITH CHECK (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."email" = "auth"."email"()))));



ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clients_read_own" ON "public"."clients" FOR SELECT TO "authenticated" USING (("email" = ("auth"."jwt"() ->> 'email'::"text")));



CREATE POLICY "clients_self_read" ON "public"."clients" FOR SELECT TO "authenticated" USING (("lower"("email") = "lower"(("auth"."jwt"() ->> 'email'::"text"))));



CREATE POLICY "clients_self_update" ON "public"."clients" FOR UPDATE TO "authenticated" USING (("lower"("email") = "lower"(("auth"."jwt"() ->> 'email'::"text")))) WITH CHECK (("lower"("email") = "lower"(("auth"."jwt"() ->> 'email'::"text"))));



CREATE POLICY "clients_staff" ON "public"."clients" USING (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids"))) WITH CHECK (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids")));



ALTER TABLE "public"."contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contacts_self" ON "public"."contacts" FOR SELECT TO "authenticated" USING (("auth_user_id" = "auth"."uid"()));



CREATE POLICY "contacts_self_read" ON "public"."contacts" FOR SELECT USING (("auth_user_id" = "auth"."uid"()));



CREATE POLICY "contacts_staff" ON "public"."contacts" USING (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids"))) WITH CHECK (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids")));



ALTER TABLE "public"."content_calendar" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "content_calendar_staff_all" ON "public"."content_calendar" USING ("public"."dds_is_staff"("tenant_id")) WITH CHECK ("public"."dds_is_staff"("tenant_id"));



CREATE POLICY "content_client_read" ON "public"."content_calendar" FOR SELECT USING (("client_visible" AND ("partnership_id" IN ( SELECT "partnerships"."id"
   FROM "public"."partnerships"
  WHERE ("partnerships"."contact_id" = "public"."dds_my_contact_id"())))));



ALTER TABLE "public"."discovery_intake" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "discovery_intake_staff" ON "public"."discovery_intake" USING (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids"))) WITH CHECK (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids")));



ALTER TABLE "public"."dp_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dp_events_insert" ON "public"."dp_events" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."dp_feedback" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dp_feedback_insert" ON "public"."dp_feedback" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."email_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "events_client_read" ON "public"."events" FOR SELECT USING ((("client_visible" = true) AND ("contact_id" IN ( SELECT "contacts"."id"
   FROM "public"."contacts"
  WHERE ("contacts"."auth_user_id" = "auth"."uid"())))));



CREATE POLICY "events_self" ON "public"."events" FOR SELECT TO "authenticated" USING ((("client_visible" = true) AND ("contact_id" IN ( SELECT "contacts"."id"
   FROM "public"."contacts"
  WHERE ("contacts"."auth_user_id" = "auth"."uid"())))));



CREATE POLICY "events_staff" ON "public"."events" USING (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids"))) WITH CHECK (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids")));



ALTER TABLE "public"."file_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."files" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "files_client_read" ON "public"."files" FOR SELECT USING (("client_id" IN ( SELECT "public"."my_client_ids"() AS "my_client_ids")));



CREATE POLICY "goals_client_read" ON "public"."partnership_goals" FOR SELECT USING (("client_visible" AND ("partnership_id" IN ( SELECT "partnerships"."id"
   FROM "public"."partnerships"
  WHERE ("partnerships"."contact_id" = "public"."dds_my_contact_id"())))));



ALTER TABLE "public"."growth_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "growth_messages_client_rw" ON "public"."growth_messages" TO "authenticated" USING (("partnership_id" IN ( SELECT "p"."id"
   FROM ("public"."partnerships" "p"
     JOIN "public"."contacts" "ct" ON (("ct"."id" = "p"."contact_id")))
  WHERE ("lower"("ct"."email") = "lower"(("auth"."jwt"() ->> 'email'::"text")))))) WITH CHECK (("partnership_id" IN ( SELECT "p"."id"
   FROM ("public"."partnerships" "p"
     JOIN "public"."contacts" "ct" ON (("ct"."id" = "p"."contact_id")))
  WHERE ("lower"("ct"."email") = "lower"(("auth"."jwt"() ->> 'email'::"text"))))));



ALTER TABLE "public"."growth_quotes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "growth_quotes_client_rw" ON "public"."growth_quotes" TO "authenticated" USING (("partnership_id" IN ( SELECT "p"."id"
   FROM ("public"."partnerships" "p"
     JOIN "public"."contacts" "ct" ON (("ct"."id" = "p"."contact_id")))
  WHERE ("lower"("ct"."email") = "lower"(("auth"."jwt"() ->> 'email'::"text")))))) WITH CHECK (("partnership_id" IN ( SELECT "p"."id"
   FROM ("public"."partnerships" "p"
     JOIN "public"."contacts" "ct" ON (("ct"."id" = "p"."contact_id")))
  WHERE ("lower"("ct"."email") = "lower"(("auth"."jwt"() ->> 'email'::"text"))))));



ALTER TABLE "public"."growth_tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "growth_tasks_client_rw" ON "public"."growth_tasks" TO "authenticated" USING (("partnership_id" IN ( SELECT "p"."id"
   FROM ("public"."partnerships" "p"
     JOIN "public"."contacts" "ct" ON (("ct"."id" = "p"."contact_id")))
  WHERE ("lower"("ct"."email") = "lower"(("auth"."jwt"() ->> 'email'::"text")))))) WITH CHECK (("partnership_id" IN ( SELECT "p"."id"
   FROM ("public"."partnerships" "p"
     JOIN "public"."contacts" "ct" ON (("ct"."id" = "p"."contact_id")))
  WHERE ("lower"("ct"."email") = "lower"(("auth"."jwt"() ->> 'email'::"text"))))));



CREATE POLICY "growth_tasks_staff_all" ON "public"."growth_tasks" USING ("public"."dds_is_staff"("tenant_id")) WITH CHECK ("public"."dds_is_staff"("tenant_id"));



CREATE POLICY "health_client_read" ON "public"."health_metrics" FOR SELECT USING (("partnership_id" IN ( SELECT "partnerships"."id"
   FROM "public"."partnerships"
  WHERE ("partnerships"."contact_id" = "public"."dds_my_contact_id"()))));



ALTER TABLE "public"."health_metrics" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "health_metrics_staff_all" ON "public"."health_metrics" USING ("public"."dds_is_staff"("tenant_id")) WITH CHECK ("public"."dds_is_staff"("tenant_id"));



ALTER TABLE "public"."intake_forms" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "intake_forms_client_all" ON "public"."intake_forms" TO "authenticated" USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("lower"("clients"."email") = "lower"(("auth"."jwt"() ->> 'email'::"text")))))) WITH CHECK (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("lower"("clients"."email") = "lower"(("auth"."jwt"() ->> 'email'::"text"))))));



CREATE POLICY "intake_forms_staff" ON "public"."intake_forms" USING (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids"))) WITH CHECK (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids")));



CREATE POLICY "integ_service_only" ON "public"."client_integrations" TO "authenticated" USING (false) WITH CHECK (false);



ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoices_client_read" ON "public"."invoices" FOR SELECT USING (("client_id" IN ( SELECT "public"."my_client_ids"() AS "my_client_ids")));



ALTER TABLE "public"."lead_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_messages_staff" ON "public"."lead_messages" USING (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids"))) WITH CHECK (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids")));



ALTER TABLE "public"."leads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "leads_staff" ON "public"."leads" USING (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids"))) WITH CHECK (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids")));



ALTER TABLE "public"."memberships" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "memberships_self_read" ON "public"."memberships" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."message_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "message_templates_staff" ON "public"."message_templates" USING (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids"))) WITH CHECK (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids")));



ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "messages_client_read" ON "public"."messages" FOR SELECT USING (("client_id" IN ( SELECT "public"."my_client_ids"() AS "my_client_ids")));



ALTER TABLE "public"."monitored_sites" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "monitored_sites_staff" ON "public"."monitored_sites" USING (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids"))) WITH CHECK (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids")));



ALTER TABLE "public"."monthly_reviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "monthly_reviews_staff_all" ON "public"."monthly_reviews" USING ("public"."dds_is_staff"("tenant_id")) WITH CHECK ("public"."dds_is_staff"("tenant_id"));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_client_all" ON "public"."notifications" TO "authenticated" USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("lower"("clients"."email") = "lower"(("auth"."jwt"() ->> 'email'::"text")))))) WITH CHECK (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("lower"("clients"."email") = "lower"(("auth"."jwt"() ->> 'email'::"text"))))));



CREATE POLICY "notifications_staff" ON "public"."notifications" USING (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids"))) WITH CHECK (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids")));



ALTER TABLE "public"."opportunities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."opportunity_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ops_errors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organizations_staff" ON "public"."organizations" USING (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids"))) WITH CHECK (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids")));



ALTER TABLE "public"."partnership_goals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "partnership_goals_staff_all" ON "public"."partnership_goals" USING ("public"."dds_is_staff"("tenant_id")) WITH CHECK ("public"."dds_is_staff"("tenant_id"));



ALTER TABLE "public"."partnerships" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "partnerships_client_read" ON "public"."partnerships" FOR SELECT USING (("contact_id" = "public"."dds_my_contact_id"()));



CREATE POLICY "partnerships_staff_all" ON "public"."partnerships" USING ("public"."dds_is_staff"("tenant_id")) WITH CHECK ("public"."dds_is_staff"("tenant_id"));



ALTER TABLE "public"."pi_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pi_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_surveys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "projects_client_read" ON "public"."projects" FOR SELECT USING (("contact_id" IN ( SELECT "contacts"."id"
   FROM "public"."contacts"
  WHERE ("contacts"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "projects_self" ON "public"."projects" FOR SELECT TO "authenticated" USING (("contact_id" IN ( SELECT "contacts"."id"
   FROM "public"."contacts"
  WHERE ("contacts"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "projects_staff" ON "public"."projects" USING (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids"))) WITH CHECK (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids")));



ALTER TABLE "public"."prospects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "prospects_staff" ON "public"."prospects" USING (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids"))) WITH CHECK (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids")));



ALTER TABLE "public"."quotes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."raw_ingestions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "raw_service_only" ON "public"."raw_ingestions" TO "authenticated" USING (false) WITH CHECK (false);



ALTER TABLE "public"."recommendations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "recommendations_staff_all" ON "public"."recommendations" USING ("public"."dds_is_staff"("tenant_id")) WITH CHECK ("public"."dds_is_staff"("tenant_id"));



CREATE POLICY "recs_client_read" ON "public"."recommendations" FOR SELECT USING (("client_visible" AND ("partnership_id" IN ( SELECT "partnerships"."id"
   FROM "public"."partnerships"
  WHERE ("partnerships"."contact_id" = "public"."dds_my_contact_id"())))));



CREATE POLICY "reviews_client_read" ON "public"."monthly_reviews" FOR SELECT USING ((("status" = 'published'::"text") AND ("partnership_id" IN ( SELECT "partnerships"."id"
   FROM "public"."partnerships"
  WHERE ("partnerships"."contact_id" = "public"."dds_my_contact_id"())))));



ALTER TABLE "public"."scheduler_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service role full access" ON "public"."admins" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."signals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "signals_service_only" ON "public"."signals" TO "authenticated" USING (false) WITH CHECK (false);



ALTER TABLE "public"."site_checks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "site_checks_staff" ON "public"."site_checks" USING (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids"))) WITH CHECK (("tenant_id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids")));



ALTER TABLE "public"."stripe_payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stripe_webhook_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."studio_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."studio_tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."suppressed_emails" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."survey_responses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sync_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sync_service_only" ON "public"."sync_log" TO "authenticated" USING (false) WITH CHECK (false);



ALTER TABLE "public"."tenants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenants_member_read" ON "public"."tenants" FOR SELECT USING (("id" IN ( SELECT "public"."current_tenant_ids"() AS "current_tenant_ids")));



ALTER TABLE "public"."timeline" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."work_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "work_log_staff_all" ON "public"."work_log" USING ("public"."dds_is_staff"("tenant_id")) WITH CHECK ("public"."dds_is_staff"("tenant_id"));



CREATE POLICY "worklog_client_read" ON "public"."work_log" FOR SELECT USING (("client_visible" AND ("partnership_id" IN ( SELECT "partnerships"."id"
   FROM "public"."partnerships"
  WHERE ("partnerships"."contact_id" = "public"."dds_my_contact_id"())))));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_client_ids"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_client_ids"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."emit"("p_agency" "uuid", "p_type" "text", "p_actor" "text", "p_contact" "uuid", "p_project" "uuid", "p_payload" "jsonb", "p_client_visible" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."emit"("p_agency" "uuid", "p_type" "text", "p_actor" "text", "p_contact" "uuid", "p_project" "uuid", "p_payload" "jsonb", "p_client_visible" boolean) TO "authenticated";



GRANT ALL ON FUNCTION "public"."my_client_ids"() TO "anon";
GRANT ALL ON FUNCTION "public"."my_client_ids"() TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."activity_log" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."activity_log" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_log" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."admins" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."admins" TO "authenticated";
GRANT ALL ON TABLE "public"."admins" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."agencies" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."agencies" TO "authenticated";
GRANT ALL ON TABLE "public"."agencies" TO "service_role";



GRANT ALL ON TABLE "public"."approvals" TO "anon";
GRANT ALL ON TABLE "public"."approvals" TO "authenticated";
GRANT ALL ON TABLE "public"."approvals" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_leads" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_leads" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_leads" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_orders" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_orders" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_audit_log" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."client_audit_log" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."client_growth_tasks" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."client_growth_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."client_growth_tasks" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_integrations" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_integrations" TO "authenticated";
GRANT ALL ON TABLE "public"."client_integrations" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_notes" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."client_notes" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_onboarding" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."client_onboarding" TO "authenticated";
GRANT ALL ON TABLE "public"."client_onboarding" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_renewals" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_renewals" TO "authenticated";
GRANT ALL ON TABLE "public"."client_renewals" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_reports" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."client_reports" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_requests" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."client_requests" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."contacts" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."contacts" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."content_calendar" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."content_calendar" TO "authenticated";
GRANT ALL ON TABLE "public"."content_calendar" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."discovery_intake" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."discovery_intake" TO "authenticated";
GRANT ALL ON TABLE "public"."discovery_intake" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_events" TO "anon";
GRANT INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_events" TO "authenticated";
GRANT ALL ON TABLE "public"."dp_events" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_abandoned_flows" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_abandoned_flows" TO "authenticated";
GRANT ALL ON TABLE "public"."dp_abandoned_flows" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_backtracks" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_backtracks" TO "authenticated";
GRANT ALL ON TABLE "public"."dp_backtracks" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_feedback" TO "anon";
GRANT INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."dp_feedback" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_confidence" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_confidence" TO "authenticated";
GRANT ALL ON TABLE "public"."dp_confidence" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_confidence_trend" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_confidence_trend" TO "authenticated";
GRANT ALL ON TABLE "public"."dp_confidence_trend" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_errors" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_errors" TO "authenticated";
GRANT ALL ON TABLE "public"."dp_errors" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_feature_usage" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_feature_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."dp_feature_usage" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_nav_paths" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_nav_paths" TO "authenticated";
GRANT ALL ON TABLE "public"."dp_nav_paths" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_onboarding_funnel" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_onboarding_funnel" TO "authenticated";
GRANT ALL ON TABLE "public"."dp_onboarding_funnel" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_page_time" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_page_time" TO "authenticated";
GRANT ALL ON TABLE "public"."dp_page_time" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_rage_spots" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_rage_spots" TO "authenticated";
GRANT ALL ON TABLE "public"."dp_rage_spots" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_search_outcomes" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_search_outcomes" TO "authenticated";
GRANT ALL ON TABLE "public"."dp_search_outcomes" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_session_story" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dp_session_story" TO "authenticated";
GRANT ALL ON TABLE "public"."dp_session_story" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."email_templates" TO "anon";
GRANT ALL ON TABLE "public"."email_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."email_templates" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."events" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."events_id_seq" TO "service_role";
GRANT SELECT,USAGE ON SEQUENCE "public"."events_id_seq" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."file_comments" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."file_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."file_comments" TO "service_role";



GRANT ALL ON TABLE "public"."files" TO "anon";
GRANT ALL ON TABLE "public"."files" TO "authenticated";
GRANT ALL ON TABLE "public"."files" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."growth_messages" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."growth_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."growth_messages" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."growth_quotes" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."growth_quotes" TO "authenticated";
GRANT ALL ON TABLE "public"."growth_quotes" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."growth_tasks" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."growth_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."growth_tasks" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."health_metrics" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."health_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."health_metrics" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."intake_forms" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."intake_forms" TO "authenticated";
GRANT ALL ON TABLE "public"."intake_forms" TO "service_role";



GRANT ALL ON TABLE "public"."invoices" TO "anon";
GRANT ALL ON TABLE "public"."invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."invoices" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."lead_messages" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."lead_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_messages" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."leads" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."leads" TO "authenticated";
GRANT ALL ON TABLE "public"."leads" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."memberships" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."memberships" TO "authenticated";
GRANT ALL ON TABLE "public"."memberships" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."message_templates" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."message_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."message_templates" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."monitored_sites" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."monitored_sites" TO "authenticated";
GRANT ALL ON TABLE "public"."monitored_sites" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."monthly_reviews" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."monthly_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."monthly_reviews" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."notifications" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."opportunities" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."opportunities" TO "authenticated";
GRANT ALL ON TABLE "public"."opportunities" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."opportunity_events" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."opportunity_events" TO "authenticated";
GRANT ALL ON TABLE "public"."opportunity_events" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."ops_errors" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."ops_errors" TO "authenticated";
GRANT ALL ON TABLE "public"."ops_errors" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."organizations" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."partnership_goals" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."partnership_goals" TO "authenticated";
GRANT ALL ON TABLE "public"."partnership_goals" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."partnerships" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."partnerships" TO "authenticated";
GRANT ALL ON TABLE "public"."partnerships" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pi_reports" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pi_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."pi_reports" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pi_settings" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pi_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."pi_settings" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."project_surveys" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."project_surveys" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."project_surveys" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."projects" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."prospects" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."prospects" TO "authenticated";
GRANT ALL ON TABLE "public"."prospects" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."quotes" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."quotes" TO "authenticated";
GRANT ALL ON TABLE "public"."quotes" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."raw_ingestions" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."raw_ingestions" TO "authenticated";
GRANT ALL ON TABLE "public"."raw_ingestions" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."recommendations" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."recommendations" TO "authenticated";
GRANT ALL ON TABLE "public"."recommendations" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."scheduler_runs" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."scheduler_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."scheduler_runs" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."signals" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."signals" TO "authenticated";
GRANT ALL ON TABLE "public"."signals" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."site_checks" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."site_checks" TO "authenticated";
GRANT ALL ON TABLE "public"."site_checks" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stripe_payments" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stripe_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."stripe_payments" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stripe_webhook_events" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stripe_webhook_events" TO "authenticated";
GRANT ALL ON TABLE "public"."stripe_webhook_events" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."studio_documents" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."studio_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."studio_documents" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."studio_tasks" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."studio_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."studio_tasks" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."suppressed_emails" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."suppressed_emails" TO "authenticated";
GRANT ALL ON TABLE "public"."suppressed_emails" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."survey_responses" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."survey_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."survey_responses" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sync_log" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sync_log" TO "authenticated";
GRANT ALL ON TABLE "public"."sync_log" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."tenants" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."tenants" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."tenants" TO "service_role";



GRANT ALL ON TABLE "public"."timeline" TO "anon";
GRANT ALL ON TABLE "public"."timeline" TO "authenticated";
GRANT ALL ON TABLE "public"."timeline" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."v_partnership_overview" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."v_partnership_overview" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."v_partnership_overview" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."work_log" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."work_log" TO "authenticated";
GRANT ALL ON TABLE "public"."work_log" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







