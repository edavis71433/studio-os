-- 0008_rate_limit_state.sql
-- rollback: see the "-- ROLLBACK" block at the bottom. Reversible: drops only
--           the table + function this migration adds. No other object touched.
--
-- WHAT / WHY
--   Durable, table-backed rate limiter for the request pipeline (pipeline-design.md
--   §3). Replaces the in-memory per-IP counter (which resets on every cold start
--   and is not shared across function instances). A fixed-window counter keyed by
--   an opaque bucket string + the window start.
--
--   Bucket key is chosen by the function, not the DB:
--     public / pre-auth routes  -> 'ip:<addr>'      (per-IP, as today)
--     authenticated staff routes -> 't:<tenant_id>' (per-tenant fair-use)
--
--   Ceilings stay the current numbers (12 / 60s) for now; entitlement-driven
--   per-tenant ceilings arrive in step 4.
--
--   The counter is incremented via the atomic rate_hit() RPC so concurrent
--   requests across instances count correctly (a plain read-modify-write would
--   race). SECURITY DEFINER + service-role invoked (a legitimate system function).
-- ============================================================================

create table if not exists "public"."rate_limit_state" (
  "bucket_key"   text        not null,
  "window_start" timestamptz not null,
  "count"        integer     not null default 0,
  primary key ("bucket_key", "window_start")
);

-- System table: no tenant/user ever touches it directly. RLS on, no permissive
-- policies => default-deny for anon/authenticated. The rate_hit() RPC is
-- SECURITY DEFINER so it operates regardless; service-role (bypass) may also
-- read it for ops. This keeps the limiter counters unreadable/unwritable by
-- callers, so a client cannot inspect or tamper with limits.
alter table "public"."rate_limit_state" enable row level security;

-- Atomic increment-and-check. Returns TRUE when the request is ALLOWED
-- (new count within p_max), FALSE when it is over the limit. One statement,
-- so concurrent callers serialize on the primary-key row.
create or replace function "public"."rate_hit"(p_bucket text, p_window timestamptz, p_max integer)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  new_count integer;
begin
  insert into "public"."rate_limit_state" ("bucket_key", "window_start", "count")
    values (p_bucket, p_window, 1)
  on conflict ("bucket_key", "window_start")
    do update set "count" = "rate_limit_state"."count" + 1
  returning "count" into new_count;
  return new_count <= p_max;
end;
$$;

-- Only the service role may call the RPC (the function invokes it with the
-- service key). Not exposed to anon/authenticated.
revoke all on function "public"."rate_hit"(text, timestamptz, integer) from public;
grant execute on function "public"."rate_hit"(text, timestamptz, integer) to "service_role";

-- ============================================================================
-- ROLLBACK (run manually if this migration must be reversed):
--   drop function if exists "public"."rate_hit"(text, timestamptz, integer);
--   drop table if exists "public"."rate_limit_state";
-- No business data is affected by either apply or rollback (transient counters).
-- Old windows can be pruned by the retention scheduler later; not required.
-- ============================================================================
