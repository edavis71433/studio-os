-- ── Phase T3: business-classic becomes the production default ────────────────
-- 1) The site's INDUSTRY joins the presentation settings so it rides into the
--    snapshot — the pure renderer reads vocabFor(industry) from there (correct
--    schema.org type + vocabulary per industry, deterministic + restore-safe).
-- 2) New sites default to the neutral, vocabulary-driven business-classic
--    template. Existing rows keep their pinned template (immutability holds).
alter table public.presence_settings
  add column if not exists industry_key text not null default 'generic';
comment on column public.presence_settings.industry_key is
  'Phase T3. The business''s industry (lib/industry_vocab.ts key). Rides into the snapshot; templates read vocabFor(industry) for correct schema + vocabulary. Set at onboarding; editable via /settings.';

alter table public.presence_sites
  alter column template_slug set default 'business-classic';

-- rollback:
--   alter table public.presence_settings drop column if exists industry_key;
--   alter table public.presence_sites alter column template_slug set default 'restaurant-classic';
