-- ── Phase AN-2: Analytics Foundation — privacy-first first-party visits ───────
-- ONE analytics collection layer. Lean, append-only, cookieless. No raw IP is
-- ever stored — a daily-rotating anonymous `visitor_hash` (sha256 of ip+ua+site+
-- day+salt) enables same-day unique-visitor counts and resets every day, so
-- there is no cross-day identity (privacy-first, Plausible/Fathom-style). No
-- personal data, no full referrer URL (host only), coarse geography only.
create table if not exists public.presence_visits (
  id bigint generated always as identity primary key,
  site_id uuid not null,
  ts timestamptz not null default now(),
  kind text not null default 'pageview'
    check (kind in ('pageview','phone','email','cta','download','outbound')),
  path text not null default '',            -- page path only (no query string)
  ref_host text not null default '',        -- referrer HOST only (privacy); '' if same-site/direct
  utm_source text not null default '',
  utm_medium text not null default '',
  utm_campaign text not null default '',
  device text not null default '' check (device in ('','mobile','desktop','tablet')),
  browser text not null default '',
  os text not null default '',
  country text not null default '',         -- 2-letter, best-effort; '' when unknown
  region text not null default '',          -- coarse; best-effort
  visitor_hash text not null default ''     -- daily-rotating anonymous id (no cross-day identity)
);
create index if not exists presence_visits_site_ts on public.presence_visits (site_id, ts desc);
create index if not exists presence_visits_site_kind_ts on public.presence_visits (site_id, kind, ts desc);

-- Deny-all: service role writes (public collector) + reads (analytics routes). A
-- customer never queries this directly; it is composed into plain-English insight.
alter table public.presence_visits enable row level security;
comment on table public.presence_visits is
  'AN-2. Privacy-first first-party visits. Bots dropped at collection; no raw IP, no cookies, no full referrer, coarse geo. Daily-rotating visitor_hash. Retention: prune ts < now()-180d (scheduled follow-up). Rollback: drop table.';
