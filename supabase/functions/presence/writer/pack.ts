// ── Industry pack: restaurant (M9.5A) — the shipped vertical ────────────────
// Pack anatomy per constitution 05 §13. One pack for the one flagship
// vertical; future packs are entries in this registry, nothing more.
export interface IndustryPack {
  slug: string;
  sectionWord: string;                 // what 'offerings' are called
  voiceGuardrails: string;             // hard writing constraints for this vertical
  vocabularyHints: string;             // words that ring true here
  toneDefaults: string[];              // the directions offered when the customer doesn't choose
}

export const PACKS: Record<string, IndustryPack> = {
  'restaurant-classic': {
    slug: 'restaurant',
    sectionWord: 'menu',
    voiceGuardrails:
      'Appetite-forward, sensory, and concrete. Never make health, dietary-safety, or sourcing claims ' +
      'the owner did not provide. Never rate the food or claim rankings. Prices, hours, and address ' +
      'come only from the fact sheet.',
    vocabularyHints: 'seasonal, house-made, neighborhood, plate, table, kitchen, pour. Avoid cuisine-speak clichés like "culinary journey", "explosion of flavor", "hidden gem".',
    toneDefaults: ['warm', 'professional', 'playful'],
  },
};

export function packFor(templateSlug: string): IndustryPack {
  return PACKS[templateSlug] || PACKS['restaurant-classic'];
}
