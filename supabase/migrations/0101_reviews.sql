-- ── 0101 — Native reviews / reputation loop (request → collect → approve → show) ──
-- The high-trust, high-local-SEO gap: let a small business collect REAL customer
-- reviews on its own site and show them — propose-then-approve, structured + safe,
-- native (the GBP/Yelp/Trustpilot connectors stay dormant; this is the MVP).
--
-- THE MOAT: a review is NEVER shown until the owner approves it. Collection is a
-- PUBLIC self-serve submission with the SAME safety as a form/booking submit
-- (honeypot + rate-limit + ip_hash + validation + escaping — all in routes/reviews.ts,
-- mirroring routes/commercial.handleFormSubmit + routes/booking.handleBookingCreate).
-- Display emits HONEST schema.org (AggregateRating + Review) over ONLY approved rows.
-- Reuse-first, no parallel systems:
--   • request email   → commerce/account.ts sendEmail (suppression + one-click
--                        unsubscribe at the ONE send point) + lib/email_brand
--   • owner alert      → lib/notice.raiseNotice (the ONE notice model → bell + push)
--   • CRM link         → presence_contacts (find-or-create by site+email, like a lead)
--   • display + schema → the site-blocks render pipeline (reviews_wall block), baked
--                        into the snapshot at serialize time (approved rows only)
--
-- ONE additive table, site_id-scoped, deny-all RLS + function-mediated, exactly like
-- the CRM/sales spine (0074), broadcasts (0098) and booking (0099):
--   • presence_reviews — the reviews themselves + their moderation status
--
-- Additive + deploy-order-tolerant (mirrors 0094–0100): the routes degrade
-- gracefully before this is applied — the public review page + submit answer calmly
-- ("reviews need a database update"), the owner Reviews area shows "unavailable", and
-- the reviews_wall block simply renders nothing (no approved rows to bake). OWNER-APPLY:
-- apply on staging + prod before the reviews surface goes live. Safe to re-run.

-- ── the reviews themselves (public self-serve submit → owner-moderated → shown) ──
-- status pending → approved (shown) / hidden (kept, never shown). owner_reply is an
-- optional short public response rendered under the review. rating is 1–5 (bounded).
create table if not exists public.presence_reviews (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  contact_id uuid references public.presence_contacts(id) on delete set null,
  reviewer_name text not null default '',
  reviewer_email text not null default '',              -- optional; drives the CRM link
  rating integer not null default 5 check (rating between 1 and 5),
  body text not null default '',
  status text not null default 'pending'
    check (status in ('pending','approved','hidden')),
  owner_reply text not null default '',                 -- optional public owner response
  source text not null default 'website',               -- website | request (owner-invited) | manual
  ip_hash text not null default '',                     -- privacy-safe throttling/audit (no raw IP)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz
);
-- the owner's moderation queue: pending first, newest first
create index if not exists presence_reviews_site_status_idx
  on public.presence_reviews (site_id, status, created_at desc);
-- the display + aggregate query: approved rows for a site, newest first
create index if not exists presence_reviews_site_approved_idx
  on public.presence_reviews (site_id, approved_at desc)
  where status = 'approved';
alter table public.presence_reviews enable row level security;  -- deny-all; function-mediated

-- Widen the ONE notice model's kind whitelist to admit 'new_review' (raised by
-- routes/reviews.ts → the ONE notice model → bell + push when a review lands).
-- raiseNotice() is best-effort, so WITHOUT this the owner's review alert would fail
-- SILENTLY against the CHECK (the exact latent trap 0088 fixed; 0099 mistakenly
-- DROPPED kinds when it re-declared this list — 0100 restored the full superset).
-- CARRY THE FULL 0100 SUPERSET FORWARD and add 'new_review'. Drop NO kind.
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
    -- added by 0101:
    'new_review'
  ));

comment on table public.presence_reviews is
  'Customer reviews (public self-serve submit → owner-approved → shown). status pending/approved/hidden. Displayed ONLY after approval; honest schema.org (AggregateRating + Review) is baked from approved rows at serialize time. Submit safety (honeypot + rate-limit + ip_hash + validation) reuses the form/booking path; owner alert reuses presence_plan_notices; contact reuses presence_contacts. Deny-all RLS; function-mediated.';
comment on constraint presence_plan_notices_kind_check on public.presence_plan_notices is
  'Notice kinds the code raises. 0101 added new_review (owner bell/push when a customer review lands, awaiting approval). Full 0100 superset carried forward — no kind dropped.';

-- rollback:
--   drop table if exists public.presence_reviews;
--   delete from public.presence_plan_notices where kind = 'new_review';
--   -- then restore the 0100 kind check (the 27-kind superset without new_review).
