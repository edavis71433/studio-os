-- Phase 4 (overhaul): enquiry triage.
-- A website enquiry can be New, Read, Replied, Converted, Not a fit (or Archived,
-- the old name for the same shelf). Spam stays the existing boolean. Only `new`
-- rows count as "needs you", so Replied / Not a fit / Spam drop off Today, the
-- bell and the Inbox the moment they are marked — six vendor pitches no longer
-- read as six things waiting for eight weeks.
do $$
declare c text;
begin
  select conname into c from pg_constraint
    where conrelid = 'public.presence_form_submissions'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%';
  if c is not null then execute 'alter table public.presence_form_submissions drop constraint ' || quote_ident(c); end if;
  alter table public.presence_form_submissions
    add constraint presence_form_submissions_status_check
    check (status in ('new','read','replied','archived','not_a_fit','converted'));
exception when others then null;
end $$;

comment on column public.presence_form_submissions.status is
  'new | read | replied | not_a_fit | archived (user-set) | converted (system-set when turned into a CRM deal). Spam is the boolean column.';
