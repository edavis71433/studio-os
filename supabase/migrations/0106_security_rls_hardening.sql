-- ── Security Advisor hardening (staging + prod) ──────────────────────────────
-- The Supabase linter flagged 5 errors: four public tables with Row-Level Security
-- OFF, and one SECURITY DEFINER view. This closes all five.
--
-- SAFE FOR THE APP: every one of these is reached ONLY through the edge function,
-- which uses the SERVICE ROLE — and the service role bypasses RLS. Enabling RLS with
-- NO policies is deny-all: it blocks the anon/public PostgREST role (which never
-- touches these directly) while leaving the service-role app path unchanged. No
-- frontend reads these tables directly, so nothing breaks.
alter table public.presence_signups         enable row level security;   -- deny-all (service-role only)
alter table public.presence_ai_usage        enable row level security;   -- deny-all
alter table public.presence_ai_usage_events enable row level security;   -- deny-all
alter table public.presence_scheduled_runs  enable row level security;   -- deny-all

-- v_partnership_overview ran as a SECURITY DEFINER view (owner's privileges → can read
-- past RLS). Switch it to SECURITY INVOKER so it runs with the CALLER's privileges and
-- respects RLS. The app (service role) still reads it fine; anon can't use it to peek
-- past RLS on the underlying tables.
alter view public.v_partnership_overview set (security_invoker = on);

-- rollback:
--   alter table public.presence_signups         disable row level security;
--   alter table public.presence_ai_usage        disable row level security;
--   alter table public.presence_ai_usage_events disable row level security;
--   alter table public.presence_scheduled_runs  disable row level security;
--   alter view public.v_partnership_overview reset (security_invoker);
