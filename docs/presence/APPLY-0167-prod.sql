-- APPLY 0167 (production) — a payment recorded by hand and a proper invoice (sales items 77 and 81).
-- Safe to run more than once. Adds five columns to presence_invoices (number, paid_method, paid_note,
-- payment_for, lines), lets the deal history say "payment undone", numbers the invoices already there
-- per studio in the order they were made, and adds the trigger that numbers every new one. No other row changes.
-- Run BEFORE the backend deploy that reads them. The pages and server fall back to the old shape until then.
alter table public.presence_invoices
  add column if not exists number integer,
  add column if not exists paid_method text not null default '',
  add column if not exists paid_note text not null default '',
  add column if not exists payment_for uuid references public.presence_invoices(id) on delete cascade,
  add column if not exists lines jsonb;
alter table public.presence_invoices drop constraint if exists presence_invoices_paid_method_check;
alter table public.presence_invoices
  add constraint presence_invoices_paid_method_check
  check (paid_method in ('', 'check', 'cash', 'bank_transfer', 'zelle', 'other'));
alter table public.presence_invoices drop constraint if exists presence_invoices_paid_note_len;
alter table public.presence_invoices
  add constraint presence_invoices_paid_note_len check (char_length(paid_note) <= 300);
create index if not exists presence_invoices_payment_for_idx
  on public.presence_invoices (payment_for) where payment_for is not null;

alter table public.presence_deal_events
  drop constraint if exists presence_deal_events_kind_check;
alter table public.presence_deal_events
  add constraint presence_deal_events_kind_check
  check (kind in (
    'created','stage_change','note','proposal_sent','proposal_decided',
    'contract_sent','contract_signed','converted',
    -- added by 0088:
    'invoice_sent','invoice_paid',
    -- added by 0117:
    'proposal_deleted','contract_deleted',
    -- added by 0118:
    'invoice_voided',
    -- added by 0144:
    'doc_opened',
    -- added by 0145:
    'estimate_sent','estimate_decided','estimate_deleted','recurring_invoice',
    -- added by 0167:
    'payment_undone'
  ));

-- numbers for the invoices already there, per site, oldest first (after any already given)
with base as (
  select site_id, coalesce(max(number), 0) as top from public.presence_invoices group by site_id
), numbered as (
  select i.id, b.top + row_number() over (partition by i.site_id order by i.created_at, i.id) as n
  from public.presence_invoices i join base b on b.site_id = i.site_id
  where i.number is null and i.payment_for is null
)
update public.presence_invoices i set number = numbered.n from numbered where i.id = numbered.id;

create unique index if not exists presence_invoices_site_number_uq
  on public.presence_invoices (site_id, number) where number is not null;

-- every new invoice takes the next number on its site. The lock makes two invoices made
-- at once wait for each other; the unique index above is the backstop.
create or replace function public.presence_invoice_number() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.number is null and new.payment_for is null then
    perform pg_advisory_xact_lock(hashtextextended('presence_invoice_number:' || new.site_id::text, 0));
    select coalesce(max(number), 0) + 1 into new.number from public.presence_invoices where site_id = new.site_id;
  end if;
  return new;
end $$;
drop trigger if exists presence_invoices_number on public.presence_invoices;
create trigger presence_invoices_number before insert on public.presence_invoices
  for each row execute function public.presence_invoice_number();
revoke all on function public.presence_invoice_number() from public, anon, authenticated;   -- a trigger's own; nobody calls it

comment on column public.presence_invoices.number is 'Sales item 81: the studio''s running invoice number, per site (trigger presence_invoices_number). Null on a part payment''s own row.';
comment on column public.presence_invoices.paid_method is 'Sales item 77: how a payment recorded by hand came in (check, cash, bank_transfer, zelle, other). Empty = paid online through Stripe.';
comment on column public.presence_invoices.payment_for is 'Sales item 77: on a part payment''s own row, the invoice it paid toward (that invoice''s amount dropped by the same amount).';
comment on column public.presence_invoices.lines is 'Sales item 81: the invoice''s own lines when billed from the accepted proposal, [{label, qty, amount_cents}]. Null = one line, its description.';
-- check: select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'presence_invoices'
--          and column_name in ('number','paid_method','paid_note','payment_for','lines')) as invoice_cols,          -- 5
--        (select count(*) from pg_trigger where tgname = 'presence_invoices_number') as triggers,                     -- 1
--        (select pg_get_constraintdef(oid) like '%payment_undone%' from pg_constraint
--          where conname = 'presence_deal_events_kind_check') as undo_kind,                                           -- true
--        (select count(*) from public.presence_invoices where number is null and payment_for is null) as unnumbered;  -- 0
