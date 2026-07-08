-- ── Phase SD: search visibility as human questions ───────────────────────────
--   settings.pages_noindex  — "Show this page on Google?" per fixed page (off = noindex + sitemap exclusion)
--   settings.page_seo       — per-page search headline/description overrides (empty = the good defaults)
--   posts.noindex           — the same question per update/post
-- Redirect rows already exist (presence_redirects); this phase gives them a UI.
alter table public.presence_settings
  add column if not exists pages_noindex jsonb not null default '[]',
  add column if not exists page_seo jsonb not null default '{}';
alter table public.presence_posts
  add column if not exists noindex boolean not null default false;
-- widen the notice rail for the one search nudge (verification missing, once)
alter table public.presence_plan_notices
  drop constraint if exists presence_plan_notices_kind_check;
alter table public.presence_plan_notices
  add constraint presence_plan_notices_kind_check
  check (kind in ('capacity','trial_ending','trial_ended','payment_trouble','account_lapsed','search_setup'));
-- rollback: drop the three columns; restore the previous kind check.
