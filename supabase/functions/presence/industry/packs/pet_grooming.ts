// ── Pet Grooming Pack (L5.4) — the THIRD-PARTY sample ────────────────────────
// Written as an OUTSIDE developer would: every import is from the published SDK
// (../sdk.ts) — nothing from a platform engine, no hidden knowledge. If this file
// compiles and validatePack() passes, the SDK is complete enough to build a pack
// from the docs alone. Business depth is secondary; this exists to prove the
// developer experience.
import {
  makePack, packProvider, packType,
} from '../sdk.ts';
import type { IndustryPack, JudgmentRule, RecommendationRule, MomentTemplate } from '../sdk.ts';

const T_SERVICES = packType('pet_grooming', 'content', 'services_unlisted');   // content.pet_grooming_services_unlisted
const T_BOOKING = packType('pet_grooming', 'conversion', 'booking_missing');    // conversion.pet_grooming_booking_missing

export const PET_GROOMING_CATALOG: Record<string, any> = {
  [T_SERVICES]: { category: 'content', severity: 'warning', confidence: 0.85,
    next_action: 'List the grooming services you offer.',
    human: () => `The site doesn’t list which grooming services you offer.`,
    tech: () => `no grooming-services signal found.` },
  [T_BOOKING]: { category: 'conversion', severity: 'info', confidence: 0.8,
    next_action: 'Add a way to book an appointment online.',
    human: () => `There’s no way to book an appointment online.`,
    tech: () => `no booking/appointment/schedule link found.` },
};

export const petGroomingProvider = packProvider('pet_grooming', 'pet_grooming', (i, emit) => {
  const html = (i.pages || []).map((p: any) => String(p.html || '')).join(' ').toLowerCase();
  if (!/groom|bath|nail|haircut|de-?shed|services|breeds?/.test(html)) emit(T_SERVICES, 'content', '/');
  if (!/book|appointment|schedule|reserve/.test(html)) emit(T_BOOKING, 'conversion', '/');
});

export const PET_GROOMING_JUDGMENT_RULES: JudgmentRule[] = [
  { key: 'pet_grooming_essentials', category: 'conversion', audience: 'customer', timing: 'soon', ttlDays: 30,
    types: [T_SERVICES, T_BOOKING], dimensions: ['conversion', 'business_accuracy'],
    impactNote: 'pet owners look for the service they need and a way to book it',
    customerImpact: 'owners can’t see what’s offered or how to book, and go elsewhere',
    priority: (ev): 'medium' | 'low' => (ev.some((e) => e.type === T_SERVICES) ? 'medium' : 'low') },
];

export const PET_GROOMING_REC_RULES: RecommendationRule[] = [
  { judgmentRule: 'pet_grooming_essentials', action: 'create',
    title: 'list services and add online booking',
    description: 'add the grooming services offered and an appointment-booking link, into the draft, for review',
    expected_benefit: 'owners find the service they need and can book it on the spot',
    value: ['conversion', 'business_accuracy'], effort: 'hour', risk: 'none', undoability: 'versioned', requires_ai: true, ttlDays: 30 },
];

export const PET_GROOMING_MOMENT_TEMPLATES: MomentTemplate[] = [
  { recRule: 'rec_pet_grooming_essentials', key: 'pet_grooming_essentials', type: 'opportunity', tone: 'encouraging', mergeable: true, bundleWord: 'services and booking', ttlDays: 21,
    headline: 'Show your services and let people book.',
    summary: 'Pet owners come looking for a specific service and a way to book it. Listing what you offer with a booking link turns those visits into appointments.' },
];

export const PET_GROOMING_PACK: IndustryPack = makePack({
  key: 'pet_grooming', label: 'Pet Grooming', family: 'professional', status: 'available', version: '1.0.0',
  profile: {
    summary: 'A grooming business caring for pets — services, breeds handled, and easy booking are what owners look for.',
    typicalServices: ['bath & brush', 'full groom', 'nail trim', 'de-shedding', 'teeth brushing'],
    keyFields: ['breeds_handled', 'pet_sizes', 'mobile_grooming', 'pickup_dropoff', 'appointment_only'],
    bookingPosture: 'appointment',
  },
  vocabulary: { offerings: 'services', offering: 'service', book: 'book an appointment', gallery: 'before & after' },
  evidence: { providerNames: ['pet_grooming'], catalogTypes: [T_SERVICES, T_BOOKING] },
  intelligence: { judgmentRules: ['pet_grooming_essentials'], recommendationRules: ['rec_pet_grooming_essentials'], momentTemplates: ['pet_grooming_essentials'], conciergeIntents: [], coachAreas: ['promotion', 'seasonal'] },
  creative: { writer: null, photographyGuidance: ['happy pet after the groom, natural light', 'before/after pairs', 'the groomer with a calm animal'], mediaSuggestions: ['a before & after', 'a happy groomed pet', 'the space'], brandDefaults: { tone: 'friendly, caring, reassuring' } },
  connected: { relevantProviders: ['google_business_profile', 'google_calendar', 'google_analytics', 'yelp'], defaults: { scheduling: 'google_calendar' }, emphasises: ['reviews', 'booking', 'listings'] },
  cms: {
    navigation: ['Services', 'Pricing', 'Book', 'Gallery', 'About', 'Reviews', 'Contact'],
    pages: ['services', 'pricing', 'book', 'gallery', 'about', 'reviews', 'contact'],
    components: ['service_list', 'booking_widget', 'before_after_gallery', 'reviews_block'],
    servicePages: true, landingPages: ['book', 'services'], blogCategories: ['pet_care_tips', 'seasonal'],
  },
  marketplace: { author: 'Acme Pet Co (community sample)', license: 'community', exportable: true, shareable: true, minPlatformVersion: '5.0.0', changelog: [{ version: '1.0.0', note: 'Sample third-party pack.' }] },
});
