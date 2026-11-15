-- rollback: update public.presence_site_members set status = 'revoked' where role = 'designer';
--           then put back the four-role check and drop column can_publish (see the APPLY pack).
--
-- ── A Designer seat, and its publish switch (builder list item 220) ──
-- APPLY THIS BEFORE DEPLOYING THE FUNCTION. The function reads can_publish when it
-- finds a member's seat, so a deploy that lands first would find no seats at all
-- until this runs: invited members would be signed out of their sites (nothing would
-- leak; they would see "No Presence site is set up").
--
-- WHY
--   Wix's Manage Roles has a Website Designer who "cannot access Inbox, contacts and
--   other sensitive info" (Nov 12 review, file 02, finding 4). Here, a client who
--   invited their nephew to fix the photos had to make him Staff, who reads every
--   customer message. A Designer seat sees the website, its pages, styles and photos,
--   and never customers, contacts, deals, invoices or messages (index.ts holds them to
--   lib/site_roles.ts designerAllowed on every request, reads included).
--
-- WHAT CHANGES
--   presence_site_members.role may be 'designer' as well as the four roles from 0045.
--   presence_site_members.can_publish (default false): whether a Designer's changes go
--   live when they press Publish. Off unless the owner or the studio turns it on; every
--   other role stores it off and ignores it. Rows already there keep their roles.
do $$
declare c text;
begin
  -- 0045 wrote the role check inline, so its name is Postgres's; find it by what it says
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
