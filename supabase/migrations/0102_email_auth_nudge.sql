-- ── 0102 — DNS misconfig hardening: email-auth nudge + apex-drift finding ─────
-- Two owner-facing DNS findings graduate from PASSIVE (buried on the Foundations
-- page) to ACTIVE (a calm nudge on the ONE notice model → bell + push + email):
--   • email_auth — a site's email has been UNAUTHENTICATED (SPF/DMARC missing, or
--                  a DKIM record the guided email_setup plan expected but which was
--                  never published) for a persistence threshold. "Your email isn't
--                  fully set up — messages may go to spam." Send-once per site.
--   • apex_drift — a guided-connected custom domain's APEX has drifted: it resolves,
--                  but to the WRONG place (not the netlify target, not the apex IP),
--                  so the bare domain reaches nothing. Monthly re-alert, clears on
--                  recovery. (A NON-resolving apex stays the existing observation
--                  dns_apex_unresolved — not duplicated here.)
--
-- Both raised via lib/notice.raiseNotice (the ONE notice model — no second store).
-- raiseNotice() is best-effort: WITHOUT this migration the two kinds fail the CHECK
-- and the nudge no-ops SILENTLY (the exact latent trap 0088 fixed and 0099
-- reintroduced). So the sweeps (commerce/lifecycle.runEmailAuthNudges +
-- runApexDriftWatch, wired into /system/run) ship DORMANT and light up only once an
-- owner applies this — identical to the 0094–0101 no-op-until-owner-apply pattern.
--
-- CARRY THE FULL 0101 SUPERSET FORWARD and add the two new kinds. Drop NO kind
-- (0099 mistakenly dropped kinds when it re-declared this list; 0100/0101 restored
-- and preserved the superset — this migration keeps that discipline). Additive,
-- owner-apply, safe to re-run.

alter table public.presence_plan_notices
  drop constraint if exists presence_plan_notices_kind_check;
alter table public.presence_plan_notices
  add constraint presence_plan_notices_kind_check
  check (kind in (
    'capacity','trial_ending','trial_ended','payment_trouble','account_lapsed',
    'search_setup','winddown_reminder','win_back','welcome_back',
    'deletion_requested','domain_expiry','lead_followup','renewal_reminder',
    'deal_signed','deal_followup','publish_failed','invoice_paid',
    'connection_expired','website_enquiry','approval_decided','new_booking',
    'site_down','support_aging','agreement_renewal',
    'booking_reminder','booking_followup',
    'new_review',
    -- added by 0102:
    'email_auth','apex_drift'
  ));

comment on constraint presence_plan_notices_kind_check on public.presence_plan_notices is
  'Notice kinds the code raises. 0102 added email_auth (persistent SPF/DMARC/DKIM gap → one calm owner nudge, send-once) and apex_drift (a resolving-but-wrong apex → owner finding, monthly, clears on recovery). Full 0101 superset carried forward — no kind dropped.';

-- rollback:
--   delete from public.presence_plan_notices where kind in ('email_auth','apex_drift');
--   -- then restore the 0101 kind check (the 28-kind superset without email_auth/apex_drift).
