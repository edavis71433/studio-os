-- ── 0096 · Service retainers + agreement-renewal reminder ────────────────────
-- Backs recurring SERVICE-retainer billing on a deal and the signed-agreement
-- renewal/expiry reminder. OWNER-APPLY (like 0075–0079, 0094, 0095): the code
-- degrades gracefully until this runs —
--   • the retainer SETUP route writes presence_deals.retainer FIRST (before any
--     Stripe object), so a pre-apply "column does not exist" 400 returns a calm
--     "retainers need a one-time database update" and NEVER mints an orphan
--     subscription;
--   • the agreement-renewal sweep's terms_snapshot->>term_end filter matches
--     nothing pre-apply (no term_end is ever stored), so it is a clean no-op; and
--   • raiseNotice('agreement_renewal') is best-effort — a pre-apply insert simply
--     fails the kind check and no-ops (no email, no throw).
-- Additive only; no data change. Safe to re-run.
--
-- FROZEN BILLING BOUNDARY: a retainer is SERVICE billing, told apart from the
-- customer's SaaS subscription (presence_entitlements, product='presence') by
-- PURPOSE METADATA on ONE Stripe + ONE webhook. Its state lives HERE, on the deal
-- — never on presence_entitlements — so no SaaS lifecycle/reconcile/renewal sweep
-- (all product=eq.presence) can ever see or touch it.

-- 1. The retainer state rides ONE nullable jsonb column on the deal it belongs to
--    (no new table). Shape (lib: commerce/retainers.ts RetainerState):
--    { status: pending|active|past_due|canceled, amount_cents, interval: month|year,
--      stripe_subscription_id, stripe_customer_id, stripe_payment_link_id,
--      checkout_url, current_period_end, created_at, updated_at, canceled_at }
alter table public.presence_deals
  add column if not exists retainer jsonb;
comment on column public.presence_deals.retainer is
  'Service-retainer (recurring SERVICE billing) state for this deal. NULL = none. Purpose-tagged Stripe subscription, DISTINCT from the SaaS entitlement. Written by routes/sales.ts + synced by commerce/retainers.ts applyRetainerSync (webhook, by purpose). See migration 0096.';
-- A partial index so the webhook can resolve a deal by its retainer subscription id
-- and the sweeps/lists can find live retainers, without scanning every deal.
create index if not exists presence_deals_retainer_sub_idx
  on public.presence_deals ((retainer->>'stripe_subscription_id')) where retainer is not null;

-- 2. Widen the ONE notice model's kind whitelist to admit 'agreement_renewal' —
--    the OWNER nudge before a signed service agreement's term lapses (distinct
--    from the SaaS 'renewal_reminder'). Every new notice kind needs this
--    (see 0060/0061/0062/0088/0094/0095): the check is enforced and raiseNotice is
--    best-effort, so an un-whitelisted kind fails SILENTLY. Carries forward the
--    full 0095 list unchanged.
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
    'support_aging',
    -- added by 0096:
    'agreement_renewal'
  ));

-- rollback: delete agreement_renewal notices; restore the 0095 kind check; then
--   drop index if exists public.presence_deals_retainer_sub_idx;
--   alter table public.presence_deals drop column if exists retainer;
