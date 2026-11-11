-- 0167 — A payment recorded by hand, a proper invoice (sales items 77 and 81, Nov 2026 review,
-- file 01 finding 2 and file 07 findings 4 and 16).
--
-- presence_invoices
--   number       the studio's running invoice number (#0001, #0002 …), one sequence per site,
--                in the order invoices were made. A trigger gives every new invoice the next
--                one, whichever route made it (the invoice form, a payment plan, the deposit an
--                agreement adds, an estimate billed, a recurring invoice). Existing invoices are
--                numbered below in the order they were made. A part payment's own row (below)
--                gets none: its receipt names the invoice it paid toward.
--   paid_method  how a payment recorded by hand came in: check · cash · bank_transfer · zelle ·
--                other. Empty for a payment Stripe took (card or bank, online).
--   paid_note    what the studio typed beside it ("Check #1042").
--   payment_for  set on a PART payment's own row: the invoice it paid toward. That invoice's
--                amount drops by the same amount, so every total that reads invoice rows
--                (Who owes you, Paid, the money reports) stays right without knowing about it.
--   lines        the invoice's own lines when it was billed from the accepted proposal:
--                [{ label, qty, amount_cents }], negative for "less already billed". Null =
--                one line, the invoice's description.
-- presence_deal_events
--   kind         adds 'payment_undone': a payment recorded by hand and taken back (it was
--                recorded by mistake). The deal's history keeps both lines. Carries 0145's
--                whole list forward; the next migration that widens it must carry this one.
-- The client's address under "Billed to" is the contact's own (sales item 89, its own
-- migration); nothing here adds one.
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

-- rollback:
--   (the deal-event kind list: re-add 0145's list, without 'payment_undone', after deleting those rows)
--   drop trigger if exists presence_invoices_number on public.presence_invoices;
--   drop function if exists public.presence_invoice_number();
--   drop index if exists public.presence_invoices_site_number_uq;
--   drop index if exists public.presence_invoices_payment_for_idx;
--   alter table public.presence_invoices drop constraint if exists presence_invoices_paid_method_check,
--     drop constraint if exists presence_invoices_paid_note_len,
--     drop column if exists lines, drop column if exists payment_for, drop column if exists paid_note,
--     drop column if exists paid_method, drop column if exists number;
