-- ── Phase DAM-1: Files Excellence — accept documents (PDF) in the ONE store ──
-- The Files experience is the existing DAM (presence_media) evolved. Customers
-- keep contracts, brand guidelines, and downloads here — not just photos. This
-- is a bounded EXTENSION of the single media store (one bucket, one table, one
-- RLS model), never a second store: we only widen the mime allow-list to include
-- application/pdf. Documents are stored + versioned + approval-gated like any
-- file; they are served as secure signed downloads and are NOT image-transformed
-- or auto-embedded into the rendered site (the serializer only references image
-- fields), so the publish pipeline is untouched.
--
-- alt_text (>= 3 chars) is unchanged: a document's row carries its title there,
-- which satisfies the a11y CHECK without weakening it.
alter table public.presence_media drop constraint if exists presence_media_mime_check;
alter table public.presence_media add constraint presence_media_mime_check
  check (mime in ('', 'image/jpeg', 'image/png', 'image/webp', 'application/pdf'));

comment on constraint presence_media_mime_check on public.presence_media is
  'DAM-1: images (jpeg/png/webp) + documents (application/pdf). Rollback: restore the image-only CHECK — no PDF rows may exist first.';
