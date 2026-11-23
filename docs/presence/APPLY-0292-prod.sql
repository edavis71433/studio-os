-- ===========================================================================
--  APPLY PACK - migration 0292  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), AFTER APPLY-0291 and
--  BEFORE the deploy.yml run that ships sales item 217 (the release refuses to go out until
--  production's ledger has 292). SAFE TO RE-RUN: a second run finds nothing still sent.
--
--  Why: item 182 for deals closed as Not a fit before the Nov 23 release. Their open documents
--  are withdrawn now the way the close does it (same statuses, withdrawn_at, withdrawn_why
--  'not_a_fit'). Expect on Nov 23: proposals_withdrawn 2, estimates 0, agreements 0.
--
--  Covers: supabase/migrations/0292_withdraw_lost_deals_docs.sql
-- ===========================================================================

with p as (
  update public.presence_proposals x
     set status = 'withdrawn', withdrawn_at = now(), withdrawn_why = 'not_a_fit'
    from public.presence_deals d
   where x.deal_id = d.id and x.site_id = d.site_id and d.stage = 'lost'
     and x.status = 'sent' and x.deleted_at is null
  returning x.id
), e as (
  update public.presence_estimates x
     set status = 'withdrawn', withdrawn_at = now(), withdrawn_why = 'not_a_fit'
    from public.presence_deals d
   where x.deal_id = d.id and x.site_id = d.site_id and d.stage = 'lost'
     and x.status = 'sent' and x.deleted_at is null
  returning x.id
), c as (
  update public.presence_contracts x
     set status = 'voided', withdrawn_at = now(), withdrawn_why = 'not_a_fit'
    from public.presence_deals d
   where x.deal_id = d.id and x.site_id = d.site_id and d.stage = 'lost'
     and x.status = 'sent' and x.deleted_at is null
  returning x.id
)
select (select count(*) from p) as proposals_withdrawn,
       (select count(*) from e) as estimates_withdrawn,
       (select count(*) from c) as agreements_taken_back;

-- Verify (expect 0: nothing left sent on a Not a fit deal):
select count(*) as still_sent_on_lost_deals from public.presence_proposals x join public.presence_deals d on d.id = x.deal_id
 where d.stage = 'lost' and x.status = 'sent' and x.deleted_at is null;

select public.presence_ledger_note(292, 'withdraw_lost_deals_docs');
