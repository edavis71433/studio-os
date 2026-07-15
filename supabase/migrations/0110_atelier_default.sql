-- ── Atelier becomes the new-site default template (Eric's pick, #183 follow-on) ──
-- New sites start on the 'atelier' family (boutique serif; industry vocabulary
-- still adapts per vocabFor). Existing rows keep their pinned template —
-- immutability holds, exactly as 0052 did for business-classic.
alter table public.presence_sites
  alter column template_slug set default 'atelier';

-- rollback:
--   alter table public.presence_sites alter column template_slug set default 'business-classic';
