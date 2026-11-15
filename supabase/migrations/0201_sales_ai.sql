-- 0201 — AI help on the sales side (sales item 94, Nov 2026; the Nov 10 review's
-- file 01, finding 12, moved up by the Nov 12 review's file 05, finding 2).
--
-- presence_sales_ai: one row each time someone presses "Draft a reply" or "Sum them up".
--   site_id     the studio's own site: the one that pays, and whose book the record is in
--               (a press from inside a client is still the studio's)
--   kind        'draft' or 'summary'
--   subject     what it was about: 'deal:<id>', 'contact:<id>', 'client:<id>',
--               'enquiry:<id>' or 'support:<id>'
--   body        a summary is kept, so the record shows it again without asking (and
--               paying) again; a draft is never kept: it goes into the reply box only
--   cost_cents  what the call cost, from the tokens Claude reports (Sonnet 5.5, $2 in and
--               $10 out per million), so Settings can say what this month used
-- The rows also give the day's count for the limit of 50 a day per studio. Studio-wide
-- spend still meets the tools' own daily cap (tool_usage_log, 0136) as the AI answers
-- check does. Only the function reads and writes it (service role); no one else may.
create table if not exists public.presence_sales_ai (
  id          uuid          primary key default gen_random_uuid(),
  site_id     uuid          not null references public.presence_sites (id) on delete cascade,
  kind        text          not null check (kind in ('draft', 'summary')),
  subject     text,
  body        text,
  cost_cents  numeric(8,3)  not null default 0,
  made_by     text,
  created_at  timestamptz   not null default now()
);
create index if not exists presence_sales_ai_site_idx on public.presence_sales_ai (site_id, created_at desc);
create index if not exists presence_sales_ai_summary_idx on public.presence_sales_ai (site_id, subject, created_at desc) where kind = 'summary';

alter table public.presence_sales_ai enable row level security;
revoke all on public.presence_sales_ai from anon, authenticated;
grant all on public.presence_sales_ai to service_role;

comment on table public.presence_sales_ai is
  'Sales item 94 (0201): one row per AI help press on the sales side (Draft a reply, Sum them up). Summaries keep their words; drafts never do. cost_cents from the tokens used. Service role only.';

-- ============================================================================
-- ROLLBACK (run manually if this migration must be reversed):
--   drop table if exists public.presence_sales_ai;
-- Kept summaries go with it; the pages say "Sum them up" again.
-- ============================================================================
