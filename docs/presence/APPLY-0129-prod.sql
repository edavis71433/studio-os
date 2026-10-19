-- ═══════════════════════════════════════════════════════════════════════════
--  APPLY PACK · migration 0129  (owner-apply, prod)
-- ═══════════════════════════════════════════════════════════════════════════
--  Run this ONCE (Supabase → SQL Editor). IDEMPOTENT: it drops whatever status
--  check is on presence_form_submissions and re-adds the widened one, so a
--  re-run is a no-op.
--
--  Why: Phase 4 enquiry triage (PR #8). Marking an enquiry Replied or Not a fit
--  writes status='replied' / 'not_a_fit'; the old check only allowed
--  new | read | archived | converted. Until this runs, those two marks are
--  refused by the database and the page says "That didn't update." (Spam uses
--  the existing boolean column and works regardless.)
--
--  Covers: supabase/migrations/0129_enquiry_triage.sql
-- ═══════════════════════════════════════════════════════════════════════════

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
end $$;

comment on column public.presence_form_submissions.status is
  'new | read | replied | not_a_fit | archived (user-set) | converted (system-set when turned into a CRM deal). Spam is the boolean column.';

-- Verify (expect the six values in the definition):
-- select pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.presence_form_submissions'::regclass and conname = 'presence_form_submissions_status_check';
