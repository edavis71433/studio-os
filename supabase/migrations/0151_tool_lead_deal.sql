-- 0150_tool_lead_deal.sql
-- rollback: alter table public.audit_leads drop column deal_id;
--           drop index if exists audit_leads_created_idx;
--
-- WHAT / WHY (sales review item 114)
--   Free-tool results land where you work: the Prospects page now lists
--   audit_leads (the rows the free Site Review / AI Visibility unlock mirrors
--   in — 0136), and one click turns a lead into a contact AND a deal. The
--   contact already has a home (audit_leads.contact_id); the deal needs one,
--   so a second click can open the same deal instead of starting a twin.
--   No foreign key on purpose: audit_leads is platform-level (no site_id),
--   presence_deals is site-scoped, and the deal may live in any site the
--   staff member was working in when they converted.

alter table public.audit_leads
  add column if not exists deal_id uuid;

comment on column public.audit_leads.deal_id is
  'Sales item 114: the presence_deals row "→ Contact + deal" started from this lead (null = not converted). Dedupe for the convert, like presence_prospects.deal_id.';

-- the Prospects page reads newest first; baseline only indexed agency_id
create index if not exists audit_leads_created_idx
  on public.audit_leads (created_at desc);
