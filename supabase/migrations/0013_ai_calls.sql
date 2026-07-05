-- 0013_ai_calls.sql
-- rollback: see block below. Reversible: drops only the table + function added.
--
-- WHAT / WHY  (AI Gateway, ai-architecture.md — telemetry)
--   One row per AI Gateway call so "what is AI costing me and where" finally has
--   an answer. Records agent, task, model, ok/cached, token counts (incl. cache
--   reads), and latency. Append-only by construction, same shape as audit_log:
--   RLS on with no permissive policies (default-deny for anon/authenticated),
--   writes only through a SECURITY DEFINER function; service_role reads for ops.
-- ============================================================================

create table if not exists "public"."ai_calls" (
  "id"                bigint generated always as identity primary key,
  "created_at"        timestamptz not null default now(),
  "request_id"       text,
  "agent"             text not null,      -- 'concierge' | 'drafting' | ...
  "task"              text,               -- stable task id, for grouping
  "model"             text,
  "tier"              text,               -- 'fast' | 'deep'
  "ok"                boolean not null default true,
  "cached"            boolean not null default false,
  "input_tokens"      integer,
  "output_tokens"     integer,
  "cache_read_tokens" integer,
  "cache_write_tokens" integer,
  "latency_ms"        integer,
  "attempts"          integer,
  "fell_back"         boolean not null default false,  -- returned the safe fallback
  "error"             text,
  "tenant_id"         uuid
);

create index if not exists "ai_calls_created_at_idx" on "public"."ai_calls" ("created_at");
create index if not exists "ai_calls_agent_idx"      on "public"."ai_calls" ("agent");
create index if not exists "ai_calls_task_idx"       on "public"."ai_calls" ("task");

alter table "public"."ai_calls" enable row level security;

create or replace function "public"."ai_log"(
  p_request_id text,
  p_agent text,
  p_task text,
  p_model text,
  p_tier text,
  p_ok boolean,
  p_cached boolean,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cache_read_tokens integer,
  p_cache_write_tokens integer,
  p_latency_ms integer,
  p_attempts integer,
  p_fell_back boolean,
  p_error text,
  p_tenant_id uuid default null
) returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare new_id bigint;
begin
  insert into "public"."ai_calls"
    ("request_id","agent","task","model","tier","ok","cached","input_tokens",
     "output_tokens","cache_read_tokens","cache_write_tokens","latency_ms",
     "attempts","fell_back","error","tenant_id")
  values
    (p_request_id, p_agent, p_task, p_model, p_tier, coalesce(p_ok,true),
     coalesce(p_cached,false), p_input_tokens, p_output_tokens, p_cache_read_tokens,
     p_cache_write_tokens, p_latency_ms, p_attempts, coalesce(p_fell_back,false),
     p_error, p_tenant_id)
  returning "id" into new_id;
  return new_id;
end;
$$;

revoke all on function "public"."ai_log"(text,text,text,text,text,boolean,boolean,integer,integer,integer,integer,integer,integer,boolean,text,uuid) from public;
grant execute on function "public"."ai_log"(text,text,text,text,text,boolean,boolean,integer,integer,integer,integer,integer,integer,boolean,text,uuid) to "service_role";

-- ============================================================================
-- ROLLBACK:
--   drop function if exists "public"."ai_log"(text,text,text,text,text,boolean,boolean,integer,integer,integer,integer,integer,integer,boolean,text,uuid);
--   drop table if exists "public"."ai_calls";
-- ============================================================================
