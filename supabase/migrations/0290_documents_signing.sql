-- 0290 — Documents: taking one back, a typed name on every yes, and where a signature came
-- from (sales items 181, 182, 183 and 184, Nov 22 2026 review).
--
-- presence_proposals
--   status         adds 'withdrawn' (sales item 182): a deal closed as Not a fit takes back its
--                  open proposal, and the client's link refuses it. Carries 0074's list forward.
--   decided_name   the name the client typed to accept (sales item 184); '' before.
--   withdrawn_at   when it was taken back; withdrawn_why says why ('not_a_fit', 'studio').
-- presence_estimates
--   status         adds 'withdrawn', for the same Not a fit close. Carries 0145's list forward.
--   decided_name   the name typed to approve (sales item 183); '' before.
--   version        1, 2, ... (sales item 183): Revise makes the next version and marks the old
--                  one replaced (in its line_items meta, as proposals do).
--   withdrawn_at, withdrawn_why   as on proposals.
-- presence_contracts
--   withdrawn_at, withdrawn_why   (sales item 181) "Take it back" sets status 'voided', which
--                  0074 already allows, and these say when and why.
-- presence_sign_evidence (new, sales item 184)
--   The internet address and browser an agreement was signed from, or a proposal accepted or an
--   estimate approved from, with the name typed. Kept privately: row level security with no
--   policy, so only the server reads it, and it is printed on the signed certificate. It goes
--   with the deal (on delete cascade), so erasing the deal, or the whole account
--   (commerce/erase.ts deletes the deals), erases it.
-- No deal-event or notice kind is added: the history lines ride kind='note' rows (detail.change).

alter table public.presence_proposals
  drop constraint if exists presence_proposals_status_check;
alter table public.presence_proposals
  add constraint presence_proposals_status_check
  check (status in ('draft','sent','accepted','declined',
    -- added by 0290:
    'withdrawn'));
alter table public.presence_proposals
  add column if not exists decided_name text not null default '',
  add column if not exists withdrawn_at timestamptz,
  add column if not exists withdrawn_why text not null default '';

alter table public.presence_estimates
  drop constraint if exists presence_estimates_status_check;
alter table public.presence_estimates
  add constraint presence_estimates_status_check
  check (status in ('draft','sent','approved','declined',
    -- added by 0290:
    'withdrawn'));
alter table public.presence_estimates
  add column if not exists decided_name text not null default '',
  add column if not exists version integer not null default 1,
  add column if not exists withdrawn_at timestamptz,
  add column if not exists withdrawn_why text not null default '';

alter table public.presence_contracts
  add column if not exists withdrawn_at timestamptz,
  add column if not exists withdrawn_why text not null default '';

create table if not exists public.presence_sign_evidence (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  deal_id uuid not null references public.presence_deals(id) on delete cascade,
  doc_kind text not null check (doc_kind in ('contract','proposal','estimate')),
  doc_id uuid not null,
  signer_name text not null default '',
  ip text not null default '',
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  unique (doc_kind, doc_id)
);
create index if not exists presence_sign_evidence_deal_idx on public.presence_sign_evidence (deal_id);
alter table public.presence_sign_evidence enable row level security;   -- no policy: the server only
revoke all on table public.presence_sign_evidence from anon, authenticated, public;

comment on table public.presence_sign_evidence is
  'Sales item 184: where a signature, an accept or an approval came from (internet address and browser), kept privately with it and printed on the certificate. Goes with the deal.';
comment on column public.presence_proposals.decided_name is 'Sales item 184: the name the client typed to accept.';
comment on column public.presence_estimates.decided_name is 'Sales item 183: the name the client typed to approve.';

-- rollback:
--   drop table if exists public.presence_sign_evidence;
--   alter table public.presence_contracts drop column if exists withdrawn_at, drop column if exists withdrawn_why;
--   alter table public.presence_estimates drop column if exists decided_name, drop column if exists version,
--     drop column if exists withdrawn_at, drop column if exists withdrawn_why;
--   alter table public.presence_proposals drop column if exists decided_name, drop column if exists withdrawn_at,
--     drop column if exists withdrawn_why;
--   (the two status lists: put 'withdrawn' rows back to 'sent' first, then re-add 0074's and 0145's lists)

select public.presence_ledger_note(290, 'documents_signing');
