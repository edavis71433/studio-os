-- ── 0097 — Contact custom fields (per-contact value bag) ─────────────────────
-- A few OPTIONAL owner-defined fields on a contact (≤5: text / number / date /
-- select). The field DEFINITIONS are site-level and live in the EXISTING
-- reserved-template store (the services-catalog idiom) — no schema here. The
-- per-contact VALUES need a home ON the contact row so they cascade-delete with
-- it, inherit its deny-all RLS, and read in the same query as the contact.
--
-- ONE small additive jsonb column, defaulting to an empty bag. The routes select
-- it deploy-order-tolerantly (they fall back to the pre-0097 column set), so a
-- deploy ahead of this migration never breaks the contacts surface — the same
-- posture 0089's next_step columns use. Additive only; safe to re-run.

alter table public.presence_contacts
  add column if not exists custom jsonb not null default '{}';

comment on column public.presence_contacts.custom is
  'CRM custom fields: a bag of { field_key: string } values for the owner-defined contact fields (≤5). Definitions live in the reserved presence_sales_templates row (name = __crm_contact_fields__). Function-mediated + validated (crm/custom_fields.ts); the contact''s deny-all RLS applies.';

-- rollback: alter table public.presence_contacts drop column custom;
