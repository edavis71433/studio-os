-- ── 0095 · Service-loop edge wins — support aging + saved replies + FAQ ──────
-- Three tiny, additive changes backing the post-sale support edges. All are
-- OWNER-APPLY (like 0075–0079, 0094): the code degrades gracefully until this
-- runs — the aging sweep's raiseNotice is best-effort (a pre-apply insert simply
-- fails the check and no-ops), and the saved-replies / FAQ reads are wrapped so
-- a pre-apply "column does not exist" 400 returns an empty list, never an error.
-- Additive only; no data change. Safe to re-run.
--
-- ROUTES/SWEEP ARE DORMANT UNTIL THIS IS APPLIED:
--   • runSupportAging → 'support_aging' notice fails the kind check (no-op, no email)
--   • GET/PUT /service/saved-replies + /service/faq + /client/faq select these
--     columns → pre-apply select 400s → the route returns an empty list.

-- 1. Widen the ONE notice model's kind whitelist to admit 'support_aging' — the
--    owner nudge for a support request that has waited N days (never the
--    customer; mirrors lead_followup / deal_followup). Every new notice kind
--    needs this (see 0060/0061/0062/0088/0094): the check is enforced and
--    raiseNotice is best-effort, so an un-whitelisted kind fails SILENTLY.
alter table public.presence_plan_notices
  drop constraint if exists presence_plan_notices_kind_check;
alter table public.presence_plan_notices
  add constraint presence_plan_notices_kind_check
  check (kind in (
    'capacity','trial_ending','trial_ended','payment_trouble','account_lapsed',
    'search_setup','winddown_reminder','win_back','welcome_back',
    'deletion_requested','domain_expiry','lead_followup','renewal_reminder',
    'deal_signed','deal_followup','publish_failed','invoice_paid',
    'connection_expired','website_enquiry','approval_decided','site_down',
    -- added by 0095:
    'support_aging'
  ));

-- 2. Two owner-managed JSON settings — NO new table, mirroring how form
--    definitions live inside presence_settings. Both nullable + default null so a
--    site that never sets them is unchanged. Kept OUT of the main /settings
--    select (they have their own defensive endpoints) so the site editor never
--    depends on this migration having run.
--    • saved_replies : reusable studio reply snippets     [{id,title,body}]
--    • customer_faq  : a small studio-written Q&A for the portal  {intro?,items:[{q,a}]}
alter table public.presence_settings
  add column if not exists saved_replies jsonb,
  add column if not exists customer_faq jsonb;
comment on column public.presence_settings.saved_replies is
  'Owner-managed canned support/message reply snippets [{id,title,body}]. Normalized/capped by lib/saved_replies.ts on write. NULL = none.';
comment on column public.presence_settings.customer_faq is
  'Owner-managed mini knowledge base shown in the client portal {intro?,items:[{q,a}]}. Normalized by lib/faq.ts on write, rendered via the sanitizing markdown pipeline. NULL = none.';

-- rollback: delete support_aging notices; restore the 0094 kind check; drop the
-- two settings columns:
--   alter table public.presence_settings drop column if exists saved_replies;
--   alter table public.presence_settings drop column if exists customer_faq;
