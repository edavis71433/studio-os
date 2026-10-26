-- ===========================================================================
--  APPLY PACK - migration 0136  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor), BEFORE the deploy.yml run that
--  ships tool-report, unlock-report and send-lead-alert. ADDITIVE and
--  IDEMPOTENT ("if not exists" tables and indexes, "create or replace"
--  function, "on conflict do nothing" sample row), so it is safe to re-run.
--  Nothing existing is changed: four new tables and one new function.
--
--  Why: Free Tools rebuild, Phase 1 (Free Tools Build Spec, Oct 2026). Site
--  Review and AI Visibility Check share one store for reports, captured
--  emails, the scan cache and the cost log behind the $10/day spend cap.
--  Service role only: anon and authenticated get no access to these tables.
--
--  The last statement adds ONE sample report (Cedar & Core, a made-up studio)
--  so the unlock flow can be tested end to end at
--    https://tools.davisdigitalstudio.com/report/5a3b1e00-0000-4000-8000-0000000ced0a
--  To remove it later:
--    delete from public.tool_reports where id = '5a3b1e00-0000-4000-8000-0000000ced0a';
--
--  Covers: supabase/migrations/0136_free_tools.sql
-- ===========================================================================

create table if not exists public.tool_leads (
  id                uuid        primary key default gen_random_uuid(),
  email             text        not null,
  name              text,
  business_name     text,
  business_type     text,
  city              text,
  website_url       text,
  source_tool       text        not null check (source_tool in ('site_review', 'ai_visibility')),
  consent_marketing boolean     not null default false,
  audit_lead_id     uuid,
  created_at        timestamptz not null default now()
);
create index if not exists tool_leads_email_idx on public.tool_leads (lower(email));
create index if not exists tool_leads_created_idx on public.tool_leads (created_at desc);

create table if not exists public.tool_reports (
  id          uuid        primary key default gen_random_uuid(),
  tool        text        not null check (tool in ('site_review', 'ai_visibility')),
  input       jsonb       not null default '{}'::jsonb,
  raw_results jsonb,
  findings    jsonb,
  scores      jsonb,
  unlocked    boolean     not null default false,
  unlocked_at timestamptz,
  lead_id     uuid        references public.tool_leads (id) on delete set null,
  pdf_url     text,
  cached_from uuid,
  created_at  timestamptz not null default now()
);
create index if not exists tool_reports_created_idx on public.tool_reports (created_at desc);

create table if not exists public.tool_scan_cache (
  tool       text        not null check (tool in ('site_review', 'ai_visibility')),
  cache_key  text        not null,
  report_id  uuid        not null references public.tool_reports (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (tool, cache_key)
);

create table if not exists public.tool_usage_log (
  id         uuid          primary key default gen_random_uuid(),
  tool       text          not null,
  kind       text          not null default 'scan' check (kind in ('scan', 'cache_hit', 'unlock', 'blocked')),
  ip_hash    text,
  email      text,
  report_id  uuid,
  cost_usd   numeric(10,4) not null default 0,
  note       text,
  created_at timestamptz   not null default now()
);
create index if not exists tool_usage_log_created_idx on public.tool_usage_log (created_at desc);

alter table public.tool_leads      enable row level security;
alter table public.tool_reports    enable row level security;
alter table public.tool_scan_cache enable row level security;
alter table public.tool_usage_log  enable row level security;

revoke all on public.tool_leads, public.tool_reports, public.tool_scan_cache, public.tool_usage_log from anon, authenticated;
grant all on public.tool_leads, public.tool_reports, public.tool_scan_cache, public.tool_usage_log to service_role;

-- Today's estimated spend across both tools, in dollars, for the daily cap.
-- "Today" is the studio's day (Los Angeles), so the cap resets at local midnight.
create or replace function public.tool_spend_today()
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select coalesce(sum(cost_usd), 0)
    from public.tool_usage_log
   where created_at >= (date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles');
$$;
revoke all on function public.tool_spend_today() from public, anon, authenticated;
grant execute on function public.tool_spend_today() to service_role;

comment on table public.tool_reports is
  'Free Tools (0136): one row per Site Review / AI Visibility scan. findings = {summary, items[], top_three[], tables[]}; scores = {overall, label, pillars[], highlights}. Locked rows are served as a teaser by the tool-report function.';
comment on table public.tool_leads is
  'Free Tools (0136): one row per email captured on a report unlock. Mirrored into audit_leads (audit_lead_id) so it shows in the Studio OS pipeline.';

-- Sample report for the Phase 1 end-to-end test (locked until an email unlocks it).
insert into public.tool_reports (id, tool, input, raw_results, findings, scores, unlocked)
values ('5a3b1e00-0000-4000-8000-0000000ced0a', 'site_review', '{"url": "https://cedarandcore.example", "business_name": "Cedar & Core", "business_type": "health and wellness", "city": "Burbank", "sample": true}'::jsonb, '{"sample": true}'::jsonb, '{"summary": "Cedar & Core''s site looks good and explains the classes clearly, but it loads slowly on phones and never says Burbank where Google looks for it. Fixing speed and local signals first would do the most for new bookings.", "items": [{"title": "The homepage takes almost 5 seconds to show its main image on a phone", "what_we_found": "Google''s speed test measured a Largest Contentful Paint (the moment the biggest thing on screen appears) of 4.8 seconds on mobile. The hero photo is a 3.1 MB file.", "why_it_matters": "Most people looking for a class nearby are on their phone, and many leave a page that is still blank after three seconds.", "fix": "Serve the hero photo at the size phones actually need.", "priority": "Fix now", "pillar": "Performance"}, {"title": "Burbank doesn''t appear in the title, main heading or opening paragraph", "what_we_found": "The homepage title is \"Cedar & Core | Pilates and Strength\" and the main heading is \"Move better, every day\". Neither mentions Burbank.", "why_it_matters": "People search for \"pilates Burbank\". Google leans on the title and main heading to decide which local studios match.", "fix": "Name the city where Google and visitors look first.", "priority": "Fix now", "pillar": "Local"}, {"title": "The phone number can''t be tapped to call", "what_we_found": "The number (818) 555-0142 appears in the footer as plain text on all 6 pages we checked.", "why_it_matters": "A visitor on a phone has to copy the number by hand, and some won''t bother.", "fix": "Make the phone number a tap-to-call link.", "priority": "Important", "pillar": "Trust and conversion"}, {"title": "Two pages share the same title", "what_we_found": "/classes and /schedule are both titled \"Cedar & Core | Pilates and Strength\".", "why_it_matters": "Matching titles make it harder for Google to tell the pages apart and show the right one.", "fix": "Give each page a title that says what''s on it.", "priority": "Important", "pillar": "Search"}, {"title": "No business details for Google in the code", "what_we_found": "We found no structured data (the hidden labels that tell Google your name, address, phone and hours).", "why_it_matters": "Without it, Google has to guess your hours and address, and the map listing can drift from your site.", "fix": "Add structured data that matches your Google listing.", "priority": "Later", "pillar": "Local"}], "top_three": ["Speed up the homepage on phones by right-sizing the hero photo.", "Put Burbank in the homepage title and main heading.", "Make the phone number tap-to-call on every page."], "tables": [{"title": "Core Web Vitals (mobile)", "note": "Google''s measures of how fast and steady a page feels. Measured on the homepage.", "columns": ["Measure", "Your site", "Good is under", "Status"], "rows": [["Largest Contentful Paint", "4.8 s", "2.5 s", "Slow"], ["Interaction to Next Paint", "180 ms", "200 ms", "Good"], ["Cumulative Layout Shift", "0.04", "0.1", "Good"], ["First Contentful Paint", "2.6 s", "1.8 s", "Needs work"]]}, {"title": "Page by page", "columns": ["Page", "Title", "Description", "H1", "Images missing alt", "Words", "Status"], "rows": [["/", "Cedar & Core | Pilates and Strength", "Present", "Move better, every day", "3 of 9", 412, "Needs work"], ["/classes", "Cedar & Core | Pilates and Strength", "Missing", "Classes", "0 of 4", 286, "Needs work"], ["/schedule", "Cedar & Core | Pilates and Strength", "Present", "Schedule", "0 of 1", 94, "Thin"], ["/about", "About Cedar & Core", "Present", "Meet the team", "1 of 5", 530, "Good"], ["/pricing", "Pricing | Cedar & Core", "Present", "Memberships", "0 of 0", 210, "Good"], ["/contact", "Contact | Cedar & Core", "Missing", "Say hello", "0 of 1", 120, "Thin"]]}]}'::jsonb, '{"overall": 64, "label": "Needs work", "pillars": [{"key": "performance", "name": "Performance", "score": 52, "weight": 30}, {"key": "search", "name": "Search", "score": 71, "weight": 30}, {"key": "trust", "name": "Trust and conversion", "score": 78, "weight": 20}, {"key": "local", "name": "Local", "score": 55, "weight": 20}], "notes": ["Sample report: Cedar & Core is a made-up studio used to test the report page."]}'::jsonb, false)
on conflict (id) do nothing;

-- Verify (expect 4 rows, every one with rowsecurity = true):
-- select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' and tablename like 'tool\_%' order by tablename;
