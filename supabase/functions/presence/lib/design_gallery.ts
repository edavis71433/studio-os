// ── + New site's gallery: the built-in designs and "what kind of business?" (item 198) ──
// A new site used to ask for a business name only and always start on one look, and
// the design gallery sat three levels down inside the editor (file 06, finding 43).
// + New site now asks what kind of business it is and shows the eight built-in designs
// as pictures, the three that suit that kind first; the Templates tab lists them too.
//
// Pure data and two lookups. The kind is saved as the site's industry_key, the same
// setting as Settings → Kind of business, so every key here is one lib/industry_vocab.ts
// knows (that file decides the words a site uses: Menu or Services, Book or Get a quote).
// The designs are the template registry's own (lib/render.ts listTemplates); this file
// adds the words a studio reads on each card. The pictures are thumbs/templates/<slug>.jpg
// (scripts/thumbnails), which the pages load straight from the app.

export type Family = 'food' | 'beauty' | 'home' | 'health' | 'professional' | 'retail' | 'fitness' | 'creative' | 'community' | 'other';

/** One chip under "What kind of business is it?", and the closer kinds under "More exactly". */
export interface BusinessKind { key: string; label: string; hint: string; family: Family; exact: Array<{ key: string; label: string }> }

export const BUSINESS_KINDS: readonly BusinessKind[] = [
  { key: 'restaurant', label: 'Restaurant or café', hint: 'Bars, bakeries, catering', family: 'food', exact: [
    { key: 'restaurant', label: 'Restaurant' }, { key: 'coffee_shop', label: 'Coffee shop or café' }, { key: 'bar', label: 'Bar' },
    { key: 'bakery', label: 'Bakery' }, { key: 'catering', label: 'Catering' }, { key: 'food_truck', label: 'Food truck' },
    { key: 'brewery', label: 'Brewery' }, { key: 'winery', label: 'Winery' }] },
  { key: 'salon', label: 'Salon or spa', hint: 'Barbers, nails, massage', family: 'beauty', exact: [
    { key: 'salon', label: 'Hair salon' }, { key: 'barber', label: 'Barber' }, { key: 'spa', label: 'Spa' },
    { key: 'nail_salon', label: 'Nail salon' }, { key: 'massage', label: 'Massage' }] },
  { key: 'home_services', label: 'Home services', hint: 'Plumbers and roofers', family: 'home', exact: [
    { key: 'home_services', label: 'Home services' }, { key: 'plumber', label: 'Plumber' }, { key: 'hvac', label: 'Heating and cooling' },
    { key: 'electrician', label: 'Electrician' }, { key: 'contractor', label: 'Contractor' }, { key: 'roofing', label: 'Roofing' },
    { key: 'landscaping', label: 'Landscaping' }, { key: 'cleaning', label: 'Cleaning' }, { key: 'pest_control', label: 'Pest control' },
    { key: 'moving', label: 'Moving' }] },
  { key: 'medical', label: 'Health care', hint: 'Doctors, dentists, vets', family: 'health', exact: [
    { key: 'medical', label: 'Doctor or clinic' }, { key: 'dental', label: 'Dentist' }, { key: 'veterinary', label: 'Vet' }] },
  { key: 'professional', label: 'Professional', hint: 'Law, money, insurance', family: 'professional', exact: [
    { key: 'professional', label: 'Professional services' }, { key: 'law', label: 'Law firm' }, { key: 'accounting', label: 'Accounting' },
    { key: 'insurance', label: 'Insurance' }, { key: 'consulting', label: 'Consulting' }, { key: 'marketing', label: 'Marketing' },
    { key: 'real_estate', label: 'Real estate' }] },
  { key: 'retail', label: 'Shop', hint: 'Florists, boutiques, gifts', family: 'retail', exact: [
    { key: 'retail', label: 'Shop' }, { key: 'florist', label: 'Florist' }, { key: 'boutique', label: 'Clothing boutique' },
    { key: 'jewelry', label: 'Jewelry' }, { key: 'bookstore', label: 'Bookstore' }, { key: 'furniture', label: 'Furniture' }] },
  { key: 'fitness', label: 'Fitness', hint: 'Gyms, yoga, classes', family: 'fitness', exact: [
    { key: 'fitness', label: 'Fitness studio' }, { key: 'gym', label: 'Gym' }, { key: 'yoga', label: 'Yoga' }] },
  { key: 'photography', label: 'Photo and creative', hint: 'Photos, events, design', family: 'creative', exact: [
    { key: 'photography', label: 'Photographer' }, { key: 'videography', label: 'Video' }, { key: 'event_planning', label: 'Events' },
    { key: 'interior_design', label: 'Interior design' }] },
  { key: 'nonprofit', label: 'Nonprofit or church', hint: 'Charities, churches', family: 'community', exact: [
    { key: 'nonprofit', label: 'Nonprofit' }, { key: 'church', label: 'Church' }, { key: 'childcare', label: 'Childcare' },
    { key: 'tutoring', label: 'Tutoring' }] },
  { key: 'generic', label: 'Something else', hint: 'Any other business', family: 'other', exact: [
    { key: 'generic', label: 'Any other business' }, { key: 'auto_repair', label: 'Auto repair' }, { key: 'auto_detailing', label: 'Auto detailing' },
    { key: 'pet_grooming', label: 'Pet grooming' }] },
];

/** The words on each built-in design's card. Every template in the registry has one (the test checks). */
export const DESIGN_WORDS: Record<string, { line: string; good_for: string }> = {
  'atelier': { line: 'Quiet and elegant: a fine serif, centered, with lots of room.', good_for: 'salons, shops and photographers' },
  'aurora': { line: 'Bright and modern: bold type, round buttons, a soft glow.', good_for: 'fitness, consultants and events' },
  'business-classic': { line: 'Clean and dependable: crisp cards and a calm green.', good_for: 'professional services and health care' },
  'editorial': { line: 'Like a magazine: a classic print serif, centered.', good_for: 'law, nonprofits and churches' },
  'harbor': { line: 'Facts first: a card with what you offer and how to reach you.', good_for: 'home services, health care and insurance' },
  'meadow': { line: 'Soft and natural: gentle greens, round buttons, a light serif.', good_for: 'spas, florists and cafés' },
  'restaurant-classic': { line: 'Made for food: a Menu page and a Reserve a table button.', good_for: 'restaurants, cafés and bars' },
  'slate': { line: 'Dark and bold: night colors with a bright teal.', good_for: 'bars, gyms and photographers' },
};

/** The three designs each family sees first, best first. "Something else" keeps Atelier first,
 *  the look every new site had before (migration 0110). */
export const SUGGESTED: Record<Family, readonly string[]> = {
  food: ['restaurant-classic', 'editorial', 'meadow'],
  beauty: ['atelier', 'meadow', 'aurora'],
  home: ['harbor', 'business-classic', 'meadow'],
  health: ['harbor', 'business-classic', 'meadow'],
  professional: ['business-classic', 'editorial', 'harbor'],
  retail: ['atelier', 'meadow', 'aurora'],
  fitness: ['slate', 'aurora', 'business-classic'],
  creative: ['atelier', 'slate', 'editorial'],
  community: ['editorial', 'meadow', 'business-classic'],
  other: ['atelier', 'business-classic', 'aurora'],
};

/** The badge on a suggested design ("Good for shops"). */
export const FAMILY_BADGE: Record<Family, string> = {
  food: 'Good for restaurants', beauty: 'Good for salons', home: 'Good for home services', health: 'Good for health care',
  professional: 'Good for professionals', retail: 'Good for shops', fitness: 'Good for fitness', creative: 'Good for creative work',
  community: 'Good for nonprofits', other: 'A good start',
};

/** Item 332: + New site's optional first draft. Three things each kind of business usually
 *  offers, filled in for the studio to change, and how the words can sound: each tone's name
 *  on its chip, and what the writer is told. */
export const STARTER_SERVICES: Record<Family, readonly string[]> = {
  food: ['Dinner', 'Lunch', 'Catering'],
  beauty: ['Haircuts and styling', 'Color', 'Treatments'],
  home: ['Repairs', 'Installations', 'Maintenance'],
  health: ['Checkups', 'Same-day visits', 'Preventive care'],
  professional: ['Consultations', 'Ongoing support', 'Project work'],
  retail: ['In-store shopping', 'Gift cards', 'Local delivery'],
  fitness: ['Classes', 'Personal training', 'Memberships'],
  creative: ['Portraits', 'Events', 'Weddings'],
  community: ['Programs', 'Volunteering', 'Ways to give'],
  other: [],
};
export const DRAFT_TONES: ReadonlyArray<{ key: string; label: string; words: string }> = [
  { key: 'friendly', label: 'Friendly', words: 'friendly and welcoming' },
  { key: 'professional', label: 'Professional', words: 'professional and clear' },
  { key: 'warm', label: 'Warm', words: 'warm and personal' },
  { key: 'bold', label: 'Bold', words: 'bold and confident' },
  { key: 'calm', label: 'Calm', words: 'calm and reassuring' },
];

/** Item 331: the kind of business each design's own sample is (its picture with no kind
 *  picked), and what each kind's sample business is, in words ("A sample salon"). */
export const DESIGN_FAMILY: Record<string, Family> = {
  'atelier': 'beauty', 'aurora': 'creative', 'business-classic': 'professional', 'editorial': 'professional',
  'harbor': 'home', 'meadow': 'retail', 'restaurant-classic': 'food', 'slate': 'fitness',
};
export const SAMPLE_NOUN: Record<Family, string> = {
  food: 'restaurant', beauty: 'salon', home: 'plumber', health: 'dental practice', professional: 'bookkeeper',
  retail: 'florist', fitness: 'gym', creative: 'events company', community: 'community kitchen', other: 'auto repair shop',
};

/** The ten families, in the order + New site lists the kinds. */
export const FAMILIES: readonly Family[] = ['food', 'beauty', 'home', 'health', 'professional', 'retail', 'fitness', 'creative', 'community', 'other'];

/** Which family an industry key belongs to; anything unknown is "other". */
export function familyOf(industryKey: string | null | undefined): Family {
  const k = String(industryKey || '');
  for (const kind of BUSINESS_KINDS) if (kind.key === k || kind.exact.some((e) => e.key === k)) return kind.family;
  return 'other';
}

/** The designs a kind of business sees first. */
export function suggestedFor(industryKey: string | null | undefined): readonly string[] {
  return SUGGESTED[familyOf(industryKey)];
}

/** Every key the gallery offers (each one a key lib/industry_vocab.ts knows). */
export function galleryIndustryKeys(): string[] {
  return [...new Set(BUSINESS_KINDS.flatMap((k) => [k.key, ...k.exact.map((e) => e.key)]))];
}

/** What GET /agency/designs answers: the registry's designs with their words, the kinds,
 *  and the suggestions. A template with no words yet still shows, with its name only. */
export function galleryPayload(templates: ReadonlyArray<{ slug: string; name: string }>) {
  return {
    // item 331: each design drawn with each kind's own sample business (scripts/thumbnails)
    designs: templates.map((t) => ({ slug: t.slug, name: t.name, line: DESIGN_WORDS[t.slug]?.line || '', good_for: DESIGN_WORDS[t.slug]?.good_for || '', picture: `/thumbs/templates/${t.slug}.jpg`,
      pictures: Object.fromEntries(FAMILIES.map((f) => [f, `/thumbs/templates/${t.slug}/${f}.jpg`])), family: DESIGN_FAMILY[t.slug] || 'other' })),
    sample_nouns: SAMPLE_NOUN,
    kinds: BUSINESS_KINDS.map((k) => ({ key: k.key, label: k.label, hint: k.hint, family: k.family, exact: k.exact, services: STARTER_SERVICES[k.family] })),
    tones: DRAFT_TONES.map((t) => ({ key: t.key, label: t.label })),
    suggested: SUGGESTED,
    badges: FAMILY_BADGE,
    default_kind: 'generic',
  };
}
