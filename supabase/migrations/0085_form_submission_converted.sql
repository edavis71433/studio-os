-- ── P2-F G1: website enquiry → CRM continuity ────────────────────────────────
-- A form submission (website enquiry) can be converted into ONE CRM deal. Add a
-- terminal 'converted' status so the leads inbox reflects it and a second
-- conversion is prevented (belt-and-suspenders with the deal-side dedupe on
-- presence_deals.source_submission_id). Additive: widen the CHECK only.

do $$
declare c text;
begin
  select conname into c from pg_constraint
    where conrelid = 'public.presence_form_submissions'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%';
  if c is not null then execute 'alter table public.presence_form_submissions drop constraint ' || quote_ident(c); end if;
  alter table public.presence_form_submissions
    add constraint presence_form_submissions_status_check check (status in ('new','read','archived','converted'));
exception when others then null;
end $$;

-- helps the leads inbox + the dedupe lookup by (site, source submission)
create index if not exists presence_deals_source_submission_idx
  on public.presence_deals (site_id, source_submission_id) where source_submission_id is not null;

comment on column public.presence_form_submissions.status is
  'P2-F: new | read | archived (user-set) | converted (system-set when turned into a CRM deal).';

-- rollback:
--   drop index if exists public.presence_deals_source_submission_idx;
--   (status CHECK widening is forward-safe; no rollback needed)
