-- ── 0092 · Free-review lead nurture — the day-7 second touch ─────────────────
-- A free-score lead who left an email gets the report and then silence unless
-- they reply (the CRO audit's top remaining funnel gap). This adds the ONE
-- column the send-once dedupe needs. The sweep itself ships OFF: it is gated
-- on the NURTURE_DRIP=1 edge-function secret so the owner approves the copy
-- and flips it deliberately — automated outbound in the owner's name is never
-- turned on by a deploy. Additive; safe to re-run.

alter table public.audit_leads
  add column if not exists nurture_sent_at timestamptz;

comment on column public.audit_leads.nurture_sent_at is
  'When the day-7 follow-up email was sent (null = not yet). Send-once dedupe for runProspectNurture; the sweep is owner-gated on NURTURE_DRIP=1.';

create index if not exists audit_leads_nurture_idx
  on public.audit_leads (created_at)
  where nurture_sent_at is null and client_email is not null;

-- rollback: alter table public.audit_leads drop column nurture_sent_at;
