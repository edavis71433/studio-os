-- ── Phase AN-3.1: Google Search Console — query/page detail store ────────────
-- The aggregate GSC metrics (impressions/clicks/ctr/position) live in the shared
-- `signals` time-series (client_id, metric, period, source='gsc') — reused, not
-- duplicated. But `signals` has no dimension column, so per-QUERY / per-PAGE /
-- per-country/device breakdowns need their own lean store. One row per
-- (client, period, dimension, key). Deny-all RLS; service-role sync writes, the
-- Analytics routes read via svc. No new reporting product — this just feeds the
-- existing plain-English Search surface (AN-3).
create table if not exists public.presence_search_terms (
  id bigint generated always as identity primary key,
  client_id uuid not null,
  period text not null,                       -- 'YYYY-MM'
  dimension text not null check (dimension in ('query','page','country','device')),
  key text not null default '',               -- the query text / page path / country / device
  clicks integer not null default 0,
  impressions integer not null default 0,
  position numeric,                            -- average rank for this key (nullable)
  created_at timestamptz not null default now(),
  unique (client_id, period, dimension, key)
);
create index if not exists pst_client_period_idx on public.presence_search_terms (client_id, period, dimension, clicks desc);

alter table public.presence_search_terms enable row level security;
comment on table public.presence_search_terms is
  'AN-3.1. GSC query/page/country/device breakdowns (aggregate metrics stay in signals). Service-role sync write; staff/owner read via Analytics. Retention: prune period older than 13 months. Rollback: drop table.';
