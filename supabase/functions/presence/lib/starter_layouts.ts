// ── Phase T-STARTER · pre-arranged, pre-filled starter layouts ────────────────
// A blank home page is a cold start — the owner stares at nothing and has to
// imagine the whole thing. This module hands them the OPPOSITE: a small set of
// ready-LAID-OUT layouts (a sensible sequence of sections already filled with
// short GUIDING placeholder copy), tuned per industry family, so they always
// EDIT real starter content instead of facing an empty canvas.
//
// A layout is just a pre-arranged `blocks` array. It is applied through the
// EXISTING save path (PUT /settings {blocks} → validateBlocks), so every starter
// block is the same structured, validated, deterministic block the render engine
// already knows — no new render code, no new storage, no new endpoint. To stay
// applicable with no photos yet, every starter uses TEXT-FIRST blocks only (the
// ones that survive validateBlocks with zero media), so the owner sees the whole
// shape immediately and swaps in their words, then adds photos where they like.
//
// Pure: no I/O, no clock, no randomness. Typed against the REAL block schema
// (StoredBlock), and the test suite re-validates every layout through the actual
// validateBlocks() — so a starter can never drift out of the schema.

import type { StoredBlock } from './site_blocks.ts';

export interface StarterLayout {
  /** stable key (also the recommended-match key per industry family). */
  key: string;
  /** owner-facing name (plain words). */
  name: string;
  /** one calm line describing what this lays out. */
  description: string;
  /** the pre-arranged, pre-filled sequence of sections. */
  blocks: StoredBlock[];
}

// A shared, guiding call-to-action close. Text-only on purpose: safeHref only
// accepts real https:/mailto:/tel: links, so the owner adds their own — the copy
// tells them exactly what to put here rather than shipping a dead button.
const cta = (text: string): StoredBlock => ({ type: 'cta', text });

// ── The layouts. Each is a hero-follows-through sequence the core sections
//    (hero / about / testimonials / FAQ live in their own tabs) complement:
//    intro → why-us → what-we-offer → how/pricing → a clear close. ──
export const STARTER_LAYOUTS: StarterLayout[] = [
  {
    key: 'generic',
    name: 'Simple business',
    description: 'A calm, all-purpose home page: a welcome, why choose you, what you offer, and a clear next step.',
    blocks: [
      { type: 'richtext', title: 'Welcome', body: 'Tell visitors who you are and what you do, in two or three friendly sentences. Write it the way you’d greet someone at your door — warm, plain and specific. You can format this text with the toolbar above.' },
      { type: 'features', title: 'Why choose us', items: [
        { title: 'A reason to choose you', text: 'What do you do better than anyone else? Say it in one clear line.' },
        { title: 'A second strength', text: 'Reliability, experience, care, value — pick one and be specific.' },
        { title: 'A third reason to trust you', text: 'Real details win trust. Replace this with something true about you.' },
      ] },
      { type: 'cards', id: 'starter_offerings', title: 'What we offer', cards: [
        { heading: 'Your first offering', text: 'Describe one product or service in a single clear line.' },
        { heading: 'Your second offering', text: 'Add another here — keep each one short and scannable.' },
        { heading: 'Your third offering', text: 'One more. Three is a friendly number to start with.' },
      ] },
      { type: 'stats', title: 'By the numbers', items: [
        { value: '10+', label: 'Years doing this' },
        { value: '500+', label: 'Happy customers' },
        { value: '100%', label: 'Focused on you' },
      ] },
      cta('Ready to get started? Tell customers the best way to reach you — add your phone, email or a booking link.'),
    ],
  },
  {
    key: 'services_business',
    name: 'Services business',
    description: 'For trades, pros and studios: a welcome, why choose you, your services, how you work, and a call to reach out.',
    blocks: [
      { type: 'richtext', title: 'About us', body: 'Introduce your business in a few friendly sentences — what you do, who you help, and why you care about doing it well. This is the first thing most visitors read, so make it human.' },
      { type: 'features', title: 'Why choose us', items: [
        { title: 'What sets you apart', text: 'Experience, speed, honesty, craftsmanship — lead with your strongest one.' },
        { title: 'A second reason', text: 'Something customers consistently thank you for. Keep it concrete.' },
        { title: 'A third reason', text: 'Licensed, insured, local, guaranteed — whatever earns their trust.' },
      ] },
      { type: 'cards', id: 'starter_services', title: 'Our services', cards: [
        { heading: 'First service', text: 'Name a service and describe it in one clear line.' },
        { heading: 'Second service', text: 'Add another service you offer here.' },
        { heading: 'Third service', text: 'List a third — you can add more once you’re happy with these.' },
      ] },
      { type: 'process', title: 'How it works', steps: [
        { step: 'Get in touch', detail: 'Describe the first step — a call, a message, or a free quote.' },
        { step: 'We make a plan', detail: 'Explain what happens next in a sentence.' },
        { step: 'We get it done', detail: 'Finish with the result the customer walks away with.' },
      ] },
      cta('Ready to start? Tell customers the best way to reach you — a phone number, email or a quick contact form.'),
    ],
  },
  {
    key: 'restaurant',
    name: 'Restaurant & cafe',
    description: 'For food places: a warm welcome, what makes you special, a few favourites, good-to-know details, and a booking prompt.',
    blocks: [
      { type: 'richtext', title: 'Welcome', body: 'Set the scene in a few sentences — the kind of food you serve, the feeling of the room, what makes a visit special. Make people hungry to come in.' },
      { type: 'features', title: 'What makes us special', items: [
        { title: 'Your signature', text: 'The dish, drink or detail people come back for. Name it.' },
        { title: 'How you cook', text: 'Fresh, local, from scratch, family recipes — what’s your approach?' },
        { title: 'The experience', text: 'Cosy, lively, quick, special-occasion — describe the vibe.' },
      ] },
      { type: 'cards', id: 'starter_favourites', title: 'A few favourites', cards: [
        { heading: 'A popular dish', text: 'Name a favourite and tempt people in a single line.' },
        { heading: 'Another favourite', text: 'Add a second dish or drink here.' },
        { heading: 'One more', text: 'A third to round it out. Your full menu lives in its own tab.' },
      ] },
      { type: 'accordion', title: 'Good to know', items: [
        { summary: 'Hours & finding us', body: 'Add your opening hours and where to find you.' },
        { summary: 'Bookings & walk-ins', body: 'Let guests know whether to reserve ahead or just drop by.' },
        { summary: 'Dietary options', body: 'Mention vegetarian, vegan or gluten-free choices if you have them.' },
      ] },
      cta('Hungry? Add a booking link or your phone number so guests can reserve a table.'),
    ],
  },
  {
    key: 'retail',
    name: 'Shop & retail',
    description: 'For shops: an intro, what you stock, why shop with you, and an invitation to visit or buy.',
    blocks: [
      { type: 'richtext', title: 'Our shop', body: 'Introduce your shop in a few sentences — what you sell, what makes your selection special, and the kind of customer you love to help.' },
      { type: 'cards', id: 'starter_range', title: 'What we stock', cards: [
        { heading: 'A category you carry', text: 'Name a range or collection and describe it in one line.' },
        { heading: 'Another category', text: 'Add a second here to show your range.' },
        { heading: 'One more', text: 'A third category. Add photos later to bring these to life.' },
      ] },
      { type: 'features', title: 'Why shop with us', items: [
        { title: 'Curated selection', text: 'What makes your choices better than the big stores?' },
        { title: 'Real expertise', text: 'The advice or service customers get from you in person.' },
        { title: 'A reason to return', text: 'Loyalty, quality, values — why people come back.' },
      ] },
      cta('Come and see us — add your address, opening hours or a link to your online store.'),
    ],
  },
  {
    key: 'wellness',
    name: 'Wellness & appointments',
    description: 'For salons, clinics and studios: a welcome, your services, why choose you, simple packages, and a booking prompt.',
    blocks: [
      { type: 'richtext', title: 'Welcome', body: 'Introduce your practice in a few calm, reassuring sentences — what you offer, who it’s for, and how people feel when they leave. Warmth and clarity matter here.' },
      { type: 'cards', id: 'starter_services', title: 'Services & treatments', cards: [
        { heading: 'A treatment', text: 'Name a service and describe it in one clear, calming line.' },
        { heading: 'Another treatment', text: 'Add a second service you offer here.' },
        { heading: 'One more', text: 'A third to start with — add pricing and more below.' },
      ] },
      { type: 'features', title: 'Why choose us', items: [
        { title: 'Your approach', text: 'Gentle, expert, personalised — what defines your care?' },
        { title: 'Your people', text: 'The experience and warmth of your team.' },
        { title: 'The results', text: 'How clients feel and what they achieve with you.' },
      ] },
      { type: 'pricing', title: 'Packages', tiers: [
        { name: 'Starter', price_text: '$—', features: ['Add what’s included', 'A second line', 'A third line'] },
        { name: 'Most popular', price_text: '$—', features: ['List the key benefits', 'Highlight the best value', 'Keep each line short'] },
      ] },
      cta('Ready to book? Add your booking link or phone number so clients can reserve a time.'),
    ],
  },
];

// ── Which starter suits an industry. Mirrors the vertical_presets FAMILY grouping
//    so the recommendation is consistent with the recommended-BLOCKS layer.
//    Every mapped key resolves to a real STARTER_LAYOUTS entry; unknown → generic.
const STARTER_FOR: Record<string, string> = {
  // home & trades → services business
  home_services: 'services_business', plumber: 'services_business', hvac: 'services_business',
  electrician: 'services_business', contractor: 'services_business', roofing: 'services_business',
  landscaping: 'services_business', cleaning: 'services_business', pest_control: 'services_business',
  moving: 'services_business', auto_repair: 'services_business', auto_detailing: 'services_business',
  // professional & creative → services business
  professional: 'services_business', law: 'services_business', accounting: 'services_business',
  insurance: 'services_business', consulting: 'services_business', marketing: 'services_business',
  real_estate: 'services_business', childcare: 'services_business', tutoring: 'services_business',
  photography: 'services_business', videography: 'services_business', interior_design: 'services_business',
  event_planning: 'services_business',
  // community → services business (about → what we do → get involved)
  nonprofit: 'services_business', church: 'services_business',
  // beauty, fitness & medical → wellness / appointments
  salon: 'wellness', barber: 'wellness', spa: 'wellness', nail_salon: 'wellness', massage: 'wellness',
  pet_grooming: 'wellness', fitness: 'wellness', gym: 'wellness', yoga: 'wellness',
  medical: 'wellness', dental: 'wellness', veterinary: 'wellness',
  // retail / product → shop
  retail: 'retail', florist: 'retail', jewelry: 'retail', boutique: 'retail', bookstore: 'retail', furniture: 'retail',
  // food → restaurant
  restaurant: 'restaurant', coffee_shop: 'restaurant', cafe: 'restaurant', bar: 'restaurant',
  food_truck: 'restaurant', bakery: 'restaurant', catering: 'restaurant', brewery: 'restaurant', winery: 'restaurant',
  // explicit generics
  generic: 'generic', business: 'generic',
};

/** The starter layout KEY recommended for an industry (never null; generic is the
 *  baseline). Pure. */
export function starterKeyFor(industryKey: string | null | undefined): string {
  return STARTER_FOR[String(industryKey || 'generic')] || 'generic';
}

/** The starter layout recommended for an industry (falls back to generic). Pure. */
export function starterLayoutFor(industryKey: string | null | undefined): StarterLayout {
  const key = starterKeyFor(industryKey);
  return STARTER_LAYOUTS.find((l) => l.key === key) || STARTER_LAYOUTS[0];
}

/** Every starter layout (for the "Start from a layout" picker). Pure. */
export function listStarterLayouts(): StarterLayout[] {
  return STARTER_LAYOUTS;
}
