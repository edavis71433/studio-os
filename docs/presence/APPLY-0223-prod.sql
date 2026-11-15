-- ===========================================================================
--  APPLY PACK - migration 0223  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE
--  the deploy.yml run that ships the Designer role. IDEMPOTENT: safe to re-run.
--  Nothing existing is removed: the role check gains 'designer', and one new
--  column (can_publish, default false) joins presence_site_members.
--
--  Why: builder list item 220. A Designer seat sees the website, its pages,
--  styles and photos, and never customers, contacts, deals, invoices or
--  messages. Publishing is a switch on the seat, off unless the owner or the
--  studio turns it on.
--
--  ORDER MATTERS: the function reads can_publish when it looks up a member's
--  seat. If the deploy went first, invited members would find no site until
--  this ran (nothing leaks; they would be told no site is set up).
--
--  Rollback (only if ever needed):
--    update public.presence_site_members set status = 'revoked' where role = 'designer';
--    alter table public.presence_site_members drop constraint if exists presence_site_members_role_check;
--    alter table public.presence_site_members add constraint presence_site_members_role_check
--      check (role in ('business_owner', 'business_staff', 'client_reviewer', 'developer'));
--    alter table public.presence_site_members drop column if exists can_publish;
--
--  Covers: supabase/migrations/0223_designer_seat.sql
-- ===========================================================================

do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.presence_site_members'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%business_staff%'
  loop
    execute format('alter table public.presence_site_members drop constraint %I', c);
  end loop;
end $$;

alter table public.presence_site_members
  add constraint presence_site_members_role_check
  check (role in ('business_owner', 'business_staff', 'client_reviewer', 'developer', 'designer'));

alter table public.presence_site_members
  add column if not exists can_publish boolean not null default false;

comment on column public.presence_site_members.can_publish is
  'List item 220: a Designer seat publishes only when this is true (set by the owner or the studio on People). Every other role stores false and ignores it.';


-- Verify (expect: one role check naming designer, and can_publish boolean not null default false):
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.presence_site_members'::regclass and contype = 'c';
-- select column_name, data_type, is_nullable, column_default from information_schema.columns
--   where table_schema = 'public' and table_name = 'presence_site_members' and column_name = 'can_publish';
