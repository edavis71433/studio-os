-- 0009_audit_log.sql
-- rollback: see the "-- ROLLBACK" block at the bottom. Reversible: drops only
--           the table + function this migration adds.
--
-- WHAT / WHY
--   Append-only security audit trail for the request pipeline (Brief §12,
--   pipeline-design.md §4). One row per privileged action and one row per gate
--   rejection (auth_failure / permission_denied / revoked / rate_limited), each
--   carrying the resolver's request_id so an event can be traced across the
--   request path and correlated with the structured log line.
--
--   Append-only BY CONSTRUCTION:
--     - RLS enabled, and NO policy grants select/update/delete to anon or
--       authenticated => default-deny. Normal callers cannot read, change, or
--       remove audit rows.
--     - Writes go ONLY through audit_write(), a SECURITY DEFINER function, so
--       the function inserts regardless of the caller's rights but nothing can
--       UPDATE or DELETE through application code. (Hard deletion, when needed,
--       is a future retention-scheduler job — Brief §13.)
--   Distinct from the existing events/emit spine (product/business events,
--   client-visible). audit_log is internal, security-grade, append-only.
-- ============================================================================

create table if not exists "public"."audit_log" (
  "id"            bigint generated always as identity primary key,
  "created_at"    timestamptz not null default now(),
  "request_id"    text        not null,
  "tenant_id"     uuid,                 -- resolved tenant; null for public/system
  "actor_user_id" uuid,                 -- null for anonymous
  "actor_label"   text,                 -- email / 'system' / 'anon'
  "event_type"    text        not null, -- 'action' | 'auth_failure' | 'permission_denied' | 'revoked' | 'rate_limited'
  "route"         text,                 -- the dispatch type
  "target"        text,                 -- affected entity id, when known
  "detail"        jsonb       not null default '{}'::jsonb
);

create index if not exists "audit_log_request_id_idx" on "public"."audit_log" ("request_id");
create index if not exists "audit_log_created_at_idx"  on "public"."audit_log" ("created_at");
create index if not exists "audit_log_tenant_idx"      on "public"."audit_log" ("tenant_id");

-- RLS on, NO permissive policies => anon/authenticated get nothing (default-deny
-- for select/insert/update/delete). service_role bypasses RLS for ops reads.
alter table "public"."audit_log" enable row level security;

-- The ONLY write path. SECURITY DEFINER so the edge function (service-role
-- invoked) can append regardless, while application code has no UPDATE/DELETE
-- path at all. Returns the new row id.
create or replace function "public"."audit_write"(
  p_request_id text,
  p_event_type text,
  p_tenant_id uuid default null,
  p_actor_user_id uuid default null,
  p_actor_label text default null,
  p_route text default null,
  p_target text default null,
  p_detail jsonb default '{}'::jsonb
) returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare new_id bigint;
begin
  insert into "public"."audit_log"
    ("request_id","event_type","tenant_id","actor_user_id","actor_label","route","target","detail")
  values
    (p_request_id, p_event_type, p_tenant_id, p_actor_user_id, p_actor_label, p_route, p_target, coalesce(p_detail,'{}'::jsonb))
  returning "id" into new_id;
  return new_id;
end;
$$;

revoke all on function "public"."audit_write"(text,text,uuid,uuid,text,text,text,jsonb) from public;
grant execute on function "public"."audit_write"(text,text,uuid,uuid,text,text,text,jsonb) to "service_role";

-- ============================================================================
-- ROLLBACK (run manually if this migration must be reversed):
--   drop function if exists "public"."audit_write"(text,text,uuid,uuid,text,text,text,jsonb);
--   drop table if exists "public"."audit_log";
-- No business data affected (audit_log is a new, self-contained trail).
-- ============================================================================
