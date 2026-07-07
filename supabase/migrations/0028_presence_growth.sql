-- ── 0028 — M9.5E: the Growth Coach's storage ────────────────────────────────
-- Additive only. One new table; nothing existing changes.
--
-- presence_growth_opportunities — evidence-backed, timed business
-- opportunities. The Coach observes, plans, and prepares; it NEVER executes:
-- manual_possible and approval_required are schema-enforced constants, the
-- handoff routes only to the existing Writer/Editor workflows (or stays
-- manual), and no column carries content payloads. Dismissal memory lives in
-- (opp_key, opp_hash): a dismissed opportunity resurfaces only when its
-- evidence-state hash changes — new evidence or a meaningful change in
-- circumstances, never repetition.
create table if not exists public.presence_growth_opportunities (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  opp_key text not null,           -- stable identity (area + subject + occurrence) — dedup + memory
  opp_hash text not null,          -- hash of the grounding state; dismissed items resurface ONLY when this changes
  area text not null check (area in (
    'seasonal','holiday','industry_event','content_freshness','promotion','landing_page',
    'faq_opportunity','gbp_post','email_campaign','social_campaign','homepage_refresh',
    'service_launch','trust_building','review_request','customer_education','referral_campaign')),
  opportunity text not null,
  why_it_matters text not null,
  supporting_evidence jsonb not null default '[]',   -- [{source, detail}] — calendar facts, evidence observations, the customer's own content
  expected_benefit text not null,
  estimated_effort text not null,                    -- plain language ('about an hour', 'an afternoon', 'ongoing')
  timing_starts date,
  timing_ends date,
  timing_phrase text not null default '',            -- the sentence a customer reads ('three weeks before Valentine''s Day')
  suggested_next_step text not null,
  manual_possible boolean not null default true check (manual_possible = true),
  approval_required boolean not null default true check (approval_required = true),
  ai_can_draft boolean not null default false,
  handoff jsonb not null default '{"route":"manual"}',  -- {route: writer|editor|manual, kind?, action?, target_id?, brief?}
  status text not null default 'open' check (status in ('open','accepted','dismissed','deferred','superseded')),
  deferred_until date,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.presence_growth_opportunities is
  'M9.5E. Growth Coach opportunities: specific, evidence-or-seasonality-backed, timed suggestions. The Coach never writes, edits, publishes, schedules, or sends anything — accepted opportunities hand off to the existing Writer/Editor flows through the customer.';

create index if not exists presence_growth_site_idx
  on public.presence_growth_opportunities (site_id, status, timing_starts);
create index if not exists presence_growth_key_idx
  on public.presence_growth_opportunities (site_id, opp_key, created_at desc);

create trigger presence_growth_touch before update on public.presence_growth_opportunities
  for each row execute function public.presence_touch_updated_at();

alter table public.presence_growth_opportunities enable row level security;
create policy presence_growth_client_read on public.presence_growth_opportunities
  for select to authenticated
  using (site_id in (select public.my_presence_site_ids()));
grant select on public.presence_growth_opportunities to authenticated;
