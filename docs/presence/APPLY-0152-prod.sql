-- APPLY 0152 (production) — A site can be made before its owner is invited (builder list item 135).
-- Safe to run more than once. Lets clients.email be empty for a client whose owner isn't
-- invited yet, and stops my_client_ids() matching an empty address. No rows change.
-- Paste into Supabase → SQL Editor → Run. Before it runs, "+ New site" says it needs one
-- database step and makes nothing; everything else works either way.
alter table public.clients alter column email drop not null;

create or replace function public.my_client_ids() returns setof uuid
    language sql stable security definer
    as $$
  select cl.id
  from public.clients cl
  where
    -- linked via contact -> auth_user_id
    cl.contact_id in (
      select co.id from public.contacts co where co.auth_user_id = auth.uid()
    )
    -- OR linked by email on the client row itself, never on an empty address
    or (
      coalesce(auth.jwt() ->> 'email', '') <> ''
      and (
        lower(coalesce(cl.email, '')) = lower(auth.jwt() ->> 'email')
        or lower(coalesce(cl.contact_email, '')) = lower(auth.jwt() ->> 'email')
      )
    )
$$;
-- check: select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'email';   -- YES
-- check: select prosecdef, position('<> ''''' in prosrc) > 0 as guards_empty from pg_proc where oid = 'public.my_client_ids()'::regprocedure;   -- true, true
