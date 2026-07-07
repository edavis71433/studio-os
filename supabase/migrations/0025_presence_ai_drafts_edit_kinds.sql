-- ── 0025 — M9.5B: the AI Editor's proposal kinds ────────────────────────────
-- Additive only: widens the kind check on presence_ai_drafts to admit editing
-- proposals. Same table, same lifecycle, same schema-enforced approval — the
-- Editor rides the Writer's rails end to end.
alter table public.presence_ai_drafts drop constraint if exists presence_ai_drafts_kind_check;
alter table public.presence_ai_drafts add constraint presence_ai_drafts_kind_check check (kind in (
  -- M9.5A writer kinds
  'identity_copy','faqs','offering_descriptions','post','testimonial_request',
  'policy_doc','social_post','email_doc','page_copy','starter_site',
  -- M9.5B editor kinds (improve existing content, in place)
  'edit_identity','edit_faq','edit_offering','edit_post','edit_document','site_polish'));
comment on constraint presence_ai_drafts_kind_check on public.presence_ai_drafts is
  'M9.5A writer kinds + M9.5B editor kinds. Editing proposals carry a compare pack (before/after/summary/why/benefit) inside options.';
