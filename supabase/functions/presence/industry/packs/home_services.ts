// ── Home Services Base Pack (L5.3) — proves REUSABLE FOUNDATIONS ─────────────
// A PARENT pack, not a customer vertical of its own logic: the six trades
// (plumber, electrician, HVAC, roofer, landscaper, contractor) will each
// `extends: 'home_services'` and inherit ALL of this — service areas, licensing,
// emergency service, quotes, phone-first CTAs, before/after media, trust signals,
// per-service pages — declaring only their trade's differences. Built here ONCE.
// (No trade is implemented in this milestone — see the roadmap doc.)
import type { IndustryPack } from '../contract.ts';
import type { Rule } from '../../judgment/rules.ts';
import type { RecRule } from '../../recommendation/rules.ts';
import type { MomentTemplate } from '../../moments/rules.ts';
import { makePack } from '../registry.ts';
import { packProvider, packType } from '../helpers.ts';

const T_AREA = packType('home_services', 'business_info', 'service_area_missing'); // business_info.home_services_service_area_missing
const T_LICENSE = packType('home_services', 'trust', 'license_unlisted');          // trust.home_services_license_unlisted

export const HOME_SERVICES_CATALOG: Record<string, any> = {
  [T_AREA]: { category: 'business_info', severity: 'warning', confidence: 0.8,
    next_action: 'List the towns and areas you serve.',
    human: () => `The site doesn’t say which areas you serve — the first thing local customers check.`,
    tech: () => `no service-area / coverage signal found.` },
  [T_LICENSE]: { category: 'trust', severity: 'info', confidence: 0.8,
    next_action: 'State clearly that you’re licensed and insured.',
    human: () => `The site doesn’t say you’re licensed and insured — the trust signal that wins the call.`,
    tech: () => `no licensed / insured / bonded signal found.` },
};

// self-gates on 'home_services'; fires for any trade that IS-A home_services
export const homeServicesProvider = packProvider('home_services', 'home_services', (i, emit) => {
  const html = (i.pages || []).map((p: any) => String(p.html || '')).join(' ').toLowerCase();
  if (!/service area|areas we serve|areas served|serving |we serve|coverage area|proudly serv/.test(html)) emit(T_AREA, 'business_info', '/');
  if (!/licensed|insured|bonded|license #|lic\.\s*#|fully insured/.test(html)) emit(T_LICENSE, 'trust', '/');
});

export const HOME_SERVICES_JUDGMENT_RULES: Rule[] = [
  { key: 'home_services_trust', category: 'trust', audience: 'customer', timing: 'soon', ttlDays: 30,
    types: [T_AREA, T_LICENSE], dimensions: ['customer_trust', 'business_accuracy', 'conversion'],
    impactNote: 'coverage + licensing are the two things a local customer checks before calling a trade',
    customerImpact: 'callers can’t confirm you serve them or that you’re licensed — and they call the next result',
    priority: (ev): 'medium' | 'low' => (ev.some((e) => e.type === T_AREA) ? 'medium' : 'low') },
];

export const HOME_SERVICES_REC_RULES: RecRule[] = [
  { judgmentRule: 'home_services_trust', action: 'create',
    title: 'show service area and licensing',
    description: 'add the towns/areas served and a clear licensed-and-insured statement, into the draft, for review',
    expected_benefit: 'local callers confirm you cover them and trust the credentials before they call',
    value: ['trust', 'business_accuracy', 'conversion'], effort: 'minutes', risk: 'none', undoability: 'versioned', requires_ai: false, ttlDays: 30 },
];

export const HOME_SERVICES_MOMENT_TEMPLATES: MomentTemplate[] = [
  { recRule: 'rec_home_services_trust', key: 'home_services_trust', type: 'needs_attention', tone: 'attentive', mergeable: true, bundleWord: 'your service area and licensing', ttlDays: 21,
    headline: 'Show where you work and that you’re licensed.',
    summary: 'Local customers check two things before they call a trade: do you cover their area, and are you licensed and insured. Putting both up front wins more of those calls.' },
];

// The shared foundation. A trade pack `extends: 'home_services'` and inherits all
// of this, declaring only its own services, evidence, calendar, and voice.
export const HOME_SERVICES_PACK: IndustryPack = makePack({
  key: 'home_services', label: 'Home Services', family: 'home_services', status: 'available', version: '1.0.0', extends: null,
  profile: {
    summary: 'A local trade serving customers at their homes — trust, coverage, and fast scheduling are everything.',
    typicalServices: ['repairs', 'installation', 'maintenance', 'emergency service', 'free estimates'],
    keyFields: ['service_area', 'emergency_service', 'licensing', 'insurance', 'warranty', 'financing', 'business_hours', 'phone', 'technicians', 'vehicles'],
    bookingPosture: 'quote',
  },
  vocabulary: { offerings: 'services', offering: 'service', book: 'request a quote', gallery: 'before & after' },
  evidence: { providerNames: ['home_services'], catalogTypes: [T_AREA, T_LICENSE] },
  intelligence: { judgmentRules: ['home_services_trust'], recommendationRules: ['rec_home_services_trust'], momentTemplates: ['home_services_trust'], conciergeIntents: [], coachAreas: ['seasonal', 'promotion', 'landing_page'] },
  creative: { writer: null, photographyGuidance: ['before/after pairs shot from the same angle', 'the branded truck/van, clean', 'technicians at work, professional and safe'], mediaSuggestions: ['a before & after', 'the team / technicians', 'the branded vehicle', 'the finished job'], brandDefaults: { tone: 'trustworthy, prompt, local' } },
  connected: { relevantProviders: ['google_business_profile', 'google_calendar', 'google_analytics', 'yelp', 'hubspot'], defaults: { scheduling: 'google_calendar' }, emphasises: ['reviews', 'booking', 'listings'] },
  cms: {
    navigation: ['Services', 'Service Areas', 'Financing', 'Emergency Service', 'About', 'Reviews', 'FAQs'],
    pages: ['services', 'service_areas', 'financing', 'emergency_service', 'about', 'reviews', 'faqs'],
    components: ['service_list', 'service_area_map', 'quote_form', 'phone_cta', 'before_after_gallery', 'trust_badges'],
    servicePages: true, landingPages: ['emergency_service', 'financing', 'service_area'], blogCategories: ['maintenance_tips', 'seasonal'],
  },
  compliance: { requirements: ['state license number displayed where required', 'proof of insurance / bonding'], notes: 'Licensing and insurance display requirements vary by state and trade.' },
});
