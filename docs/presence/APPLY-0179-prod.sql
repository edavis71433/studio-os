-- APPLY 0179 (production) — The studio can ask a client to approve the website draft (builder list item 179, part two).
-- Safe to run more than once. Widens which kinds of thing an approval can be about; nothing existing changes.
alter table public.presence_approvals drop constraint if exists presence_approvals_subject_type_check;
alter table public.presence_approvals add constraint presence_approvals_subject_type_check
  check (subject_type in ('deliverable','task','project','custom','website'));

-- Check: the constraint names all five kinds.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.presence_approvals'::regclass and conname = 'presence_approvals_subject_type_check';
