-- ===========================================================================
--  APPLY PACK - migration 0290  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), AFTER APPLY-0260
--  (this writes into its ledger) and BEFORE the deploy.yml run that ships sales items 181,
--  182, 183, 184 and 185 (the release refuses to go out until production's ledger has 290).
--  IDEMPOTENT ("if not exists", "drop constraint if exists"), safe to re-run.
--
--  Why: a sent agreement can be taken back (181), a deal closed as Not a fit withdraws its
--  open proposal and estimates (182), estimates get versions and a typed name on Approve (183),
--  and a proposal's Accept takes a typed name while every signature, accept and approval keeps
--  its internet address and browser privately with it, for the certificate (184).
--
--  The two status lists keep every value they had and add 'withdrawn' only. They are written
--  from the repo's definitions (0074 for proposals, 0145 for estimates), which no migration
--  has changed since. FIRST run the check just below: if either list on production has any
--  value not in the lists further down, stop and add it to them before running the rest.
--
--  Covers: supabase/migrations/0290_documents_signing.sql
-- ===========================================================================

-- Check first (expect: ('draft','sent','accepted','declined') and ('draft','sent','approved','declined')):
select conname, pg_get_constraintdef(oid) as def from pg_constraint
 where conname in ('presence_proposals_status_check', 'presence_estimates_status_check');

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


select public.presence_ledger_note(290, 'documents_signing');

-- Verify right away (expect: both lists end with 'withdrawn'; 8 new columns; the table with no policy; then 290 in the ledger):
select conrelid::regclass as tbl, pg_get_constraintdef(oid) as def from pg_constraint
 where conname in ('presence_proposals_status_check', 'presence_estimates_status_check');
select table_name, column_name from information_schema.columns
 where table_schema = 'public' and column_name in ('decided_name', 'withdrawn_at', 'withdrawn_why', 'version')
   and table_name in ('presence_proposals', 'presence_estimates', 'presence_contracts') order by 1, 2;
select relname, relrowsecurity, (select count(*) from pg_policies where tablename = 'presence_sign_evidence') as policies
  from pg_class where relname = 'presence_sign_evidence';
select max(number) as ledger_newest from public.presence_change_ledger;
