-- 0292 — Item 182 for deals closed as Not a fit before the Nov 23 release (sales item 217).
-- Closing a deal as Not a fit now withdraws what is still out on it (routes/sales.ts
-- withdrawOpenDocs), but deals closed before that release kept theirs: a proposal still 'sent',
-- offered Remind on the Documents page, under a banner saying it was withdrawn. This does once
-- what the close does: on deals whose stage is 'lost', a sent proposal or estimate becomes
-- 'withdrawn' and a sent (so unsigned) agreement 'voided', each with withdrawn_at now() and
-- withdrawn_why 'not_a_fit'. A signed agreement is never touched. Safe to run twice: the second
-- run finds nothing still sent and changes nothing. It reports what it changed.
-- Production on Nov 23 2026: 2 sent proposals on 2 lost deals; no sent estimates or agreements.
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

-- rollback: none needed for the data's meaning (a withdrawn document on a Not a fit deal is what
--   the close does today); to put one back: update ... set status = 'sent', withdrawn_at = null,
--   withdrawn_why = '' where withdrawn_why = 'not_a_fit' and id = '<id>'.

select public.presence_ledger_note(292, 'withdraw_lost_deals_docs');
