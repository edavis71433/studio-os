-- 0165 — A site's photo storage is counted by the database (builder list item 144, Nov 2026 review)
-- The upload door's storage limit (lib/media.ts createUpload) and the Files page's meter
-- used to fetch every live presence_media row of a site and add up the bytes in the
-- function. PostgREST hands rows back in pages of 1,000, so past 1,000 files the count
-- and the sum stopped short, and every upload downloaded the whole list to check it.
-- presence_media_usage(site) returns the two numbers instead, read through
-- presence_media_site_live_idx (0015). Only the server's own key may call it.
--
-- rollback: drop function if exists public.presence_media_usage(uuid);
--   (the server then skips the storage check until it is back, as it does on any failed read)
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
