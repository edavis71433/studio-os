-- APPLY 0165 (production) — A site's photo storage is counted by the database (builder list item 144).
-- Safe to run more than once. Adds one read-only function, presence_media_usage(site); no rows change.
-- Paste into Supabase → SQL Editor → Run, BEFORE the backend deploy that calls it. Until it runs,
-- the server skips the storage check on an upload, as it does whenever that read fails.
create or replace function public.presence_media_usage(p_site uuid)
returns table (files bigint, bytes bigint)
language sql stable
set search_path = public
as $$
  select count(*)::bigint, coalesce(sum(m.bytes), 0)::bigint
  from public.presence_media m
  where m.site_id = p_site and m.deleted_at is null
$$;
revoke all on function public.presence_media_usage(uuid) from public, anon, authenticated;
grant execute on function public.presence_media_usage(uuid) to service_role;
-- check: select has_function_privilege('service_role', 'public.presence_media_usage(uuid)', 'execute') as server,
--               has_function_privilege('anon', 'public.presence_media_usage(uuid)', 'execute') as visitors,
--               has_function_privilege('authenticated', 'public.presence_media_usage(uuid)', 'execute') as signed_in;   -- true, false, false
