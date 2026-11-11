-- APPLY 0151 (production) — Free-tool leads land on the Prospects page (sales review item 114).
-- Safe to run more than once. Adds one column and one index to audit_leads; no rows change.
-- Paste into Supabase → SQL Editor → Run. The deploy is tolerant either way: before this
-- runs, the page still lists the leads and converts them — it just can't remember which
-- deal a lead became, so the dedupe falls back to status alone.
alter table public.audit_leads
  add column if not exists deal_id uuid;
comment on column public.audit_leads.deal_id is
  'Sales item 114: the presence_deals row "→ Contact + deal" started from this lead (null = not converted). Dedupe for the convert, like presence_prospects.deal_id.';
create index if not exists audit_leads_created_idx
  on public.audit_leads (created_at desc);
-- check: select column_name from information_schema.columns where table_schema = 'public' and table_name = 'audit_leads'
--        and column_name = 'deal_id';   -- 1 row
