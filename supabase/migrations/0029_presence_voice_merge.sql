-- ── 0029 — M9.5G: one canonical voice source ────────────────────────────────
-- Additive/backfill only; no tables created, none dropped, no columns changed.
--
-- M9.5F found a split brain: presence_voice (M9.5A: tone_notes,
-- preferred_vocabulary, never_claim) and presence_brand_profile (M9.5D:
-- voice_characteristics, preferred_vocabulary, never_claims) both claimed to
-- hold the customer's voice — the Writer read one, the Guardian the other.
--
-- After this migration the Brand Profile is THE canonical voice source:
-- existing presence_voice values are copied into empty profile fields
-- (customer-entered profile text is never overwritten), and the function
-- code now reads and writes only the profile. presence_voice remains in the
-- schema (frozen v1) but is retired: nothing reads it, nothing writes it.
insert into public.presence_brand_profile (site_id, voice_characteristics, preferred_vocabulary, never_claims)
select v.site_id,
       coalesce(v.tone_notes, ''),
       coalesce(v.preferred_vocabulary, ''),
       coalesce(v.never_claim, '')
from public.presence_voice v
on conflict (site_id) do update set
  voice_characteristics = case when public.presence_brand_profile.voice_characteristics = ''
                               then excluded.voice_characteristics
                               else public.presence_brand_profile.voice_characteristics end,
  preferred_vocabulary  = case when public.presence_brand_profile.preferred_vocabulary = ''
                               then excluded.preferred_vocabulary
                               else public.presence_brand_profile.preferred_vocabulary end,
  never_claims          = case when public.presence_brand_profile.never_claims = ''
                               then excluded.never_claims
                               else public.presence_brand_profile.never_claims end;

comment on table public.presence_voice is
  'RETIRED (M9.5G). Voice preferences now live in presence_brand_profile — the one canonical source. Kept for schema stability (frozen v1); no code reads or writes this table.';
