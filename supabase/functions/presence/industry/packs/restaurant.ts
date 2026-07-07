// ── Restaurant Industry Pack (L5.1) — the flagship, entirely additive ────────
// The FIRST complete Industry Pack. Every restaurant-specific thing lives HERE,
// in the pack — not in an engine. It plugs into the frozen platform through the
// same spread-extension the connected catalog uses, and its evidence provider
// SELF-GATES on the resolved industry, so a non-restaurant site is provably
// untouched (no restaurant evidence → no restaurant judgments/moments).
//
// No engine logic changed. This module only supplies DATA + one pure provider.
import type { Provider } from '../../evidence/providers.ts';
import type { Rule } from '../../judgment/rules.ts';
import type { Priority } from '../../judgment/contract.ts';
import type { RecRule } from '../../recommendation/rules.ts';
import type { MomentTemplate } from '../../moments/rules.ts';
import type { IndustryPack } from '../contract.ts';
import { makePack } from '../registry.ts';
import { packProvider, packType } from '../helpers.ts';
import { growthPackFor } from '../../coach/packs.ts';
import { packFor } from '../../writer/pack.ts';

const s = (v: unknown) => String(v ?? '');
type Facts = Record<string, string | number | boolean>;

// L5.2 hardening: collision-safe, industry-namespaced type keys via packType —
// `<category>.restaurant_<name>` (valid category prefix AND unique across packs).
const T_MENU_ABSENT = packType('restaurant', 'content', 'menu_absent');            // content.restaurant_menu_absent
const T_MENU_PRICES = packType('restaurant', 'content', 'menu_prices_missing');    // content.restaurant_menu_prices_missing
const T_FOOD_PHOTOS = packType('restaurant', 'media', 'food_photos_missing');      // media.restaurant_food_photos_missing

// ── evidence catalog (valid EXISTING categories; industry-namespaced type names).
//    Additive: merged into the ONE CATALOG via industry/compose. ──
export const RESTAURANT_CATALOG: Record<string, { category: string; severity: string; confidence: number; next_action: string; human: (f: Facts) => string; tech: (f: Facts) => string }> = {
  [T_MENU_ABSENT]: { category: 'content', severity: 'warning', confidence: 0.9,
    next_action: 'Add a menu page or section with your dishes.',
    human: () => `There isn’t a menu on the site yet — the page diners look for first.`,
    tech: () => `no page/section matched a menu heading or path.` },
  [T_MENU_PRICES]: { category: 'content', severity: 'info', confidence: 0.8,
    next_action: 'Add prices to the menu items.',
    human: () => `The menu is there, but it doesn’t show prices.`,
    tech: (f) => `menu present; ${s(f.prices)} price patterns detected.` },
  [T_FOOD_PHOTOS]: { category: 'media', severity: 'info', confidence: 0.85,
    next_action: 'Add a few real photographs of your food.',
    human: () => `There are no photographs of the food yet.`,
    tech: (f) => `media_count=${s(f.count)}.` },
};

// ── the pure provider — SELF-GATES via packProvider (can't forget to gate) ──
const hasMenu = (i: any): boolean => {
  const paths = (i.pages || []).map((p: any) => String(p.path || '').toLowerCase());
  if (paths.some((p: string) => /menu/.test(p))) return true;
  const html = (i.pages || []).map((p: any) => String(p.html || '')).join(' ').toLowerCase();
  return /(^|>)\s*menu\s*(<|$)|our menu|the menu|food menu|drinks? menu/.test(html);
};
const priceCount = (i: any): number => {
  const html = (i.pages || []).map((p: any) => String(p.html || '')).join(' ');
  return (html.match(/[$£€]\s?\d/g) || []).length;
};

export const restaurantProvider: Provider = packProvider('restaurant', 'restaurant', (i, emit) => {
  const menu = hasMenu(i);
  if (!menu) emit(T_MENU_ABSENT, 'content', '/');
  else if (priceCount(i) < 2) emit(T_MENU_PRICES, 'content', '/', { prices: priceCount(i) });
  const mediaCount = Array.isArray(i.mediaRows) ? i.mediaRows.length : 0;
  if (mediaCount === 0) emit(T_FOOD_PHOTOS, 'media', '', { count: mediaCount });
});

// ── judgment rules (consume ONLY this pack's evidence types → inert elsewhere) ──
export const RESTAURANT_JUDGMENT_RULES: Rule[] = [
  { key: 'restaurant_menu', category: 'content', audience: 'customer', timing: 'soon', ttlDays: 30,
    types: [T_MENU_ABSENT, T_MENU_PRICES],
    dimensions: ['conversion', 'search_visibility'],
    impactNote: 'the menu is the page diners open before deciding',
    customerImpact: 'diners can’t see what’s served or what it costs',
    priority: (ev): Priority => (ev.some((e) => e.type === T_MENU_ABSENT) ? 'medium' : 'low') },
  { key: 'restaurant_visuals', category: 'media', audience: 'customer', timing: 'whenever', ttlDays: 45,
    types: [T_FOOD_PHOTOS],
    dimensions: ['conversion'],
    impactNote: 'food photography is the strongest conversion lever for restaurants',
    customerImpact: 'diners choose with their eyes; no photos is a harder sell',
    priority: (): Priority => 'low' },
];

// ── recommendation rules (one per interruptible judgment rule) ──
export const RESTAURANT_REC_RULES: RecRule[] = [
  { judgmentRule: 'restaurant_menu', action: 'create',
    title: 'add or complete the menu',
    description: 'add a menu page/section with items and prices, into the draft, for review',
    expected_benefit: 'diners can see the dishes and prices before they visit or order',
    value: ['conversion', 'search_visibility'], effort: 'hour', risk: 'none', undoability: 'versioned', requires_ai: true, ttlDays: 30 },
  { judgmentRule: 'restaurant_visuals', action: 'create',
    title: 'add food photography',
    description: 'gather and add real photographs of the food; the owner supplies them (never generated)',
    expected_benefit: 'diners decide with their eyes — photographs lift bookings and orders',
    value: ['conversion', 'customer_experience'], effort: 'hour', risk: 'none', undoability: 'versioned', requires_ai: false, ttlDays: 45 },
];

// ── moment templates (customer copy in the restaurant's words; mergeable/calm) ──
export const RESTAURANT_MOMENT_TEMPLATES: MomentTemplate[] = [
  { recRule: 'rec_restaurant_menu', key: 'restaurant_menu', type: 'opportunity', tone: 'encouraging', mergeable: true, bundleWord: 'your menu', ttlDays: 21,
    headline: 'Your menu is what diners look for first.',
    summary: 'A menu with your dishes and their prices is the page people open before they choose. Getting it up — prices and all — makes the decision easy.' },
  { recRule: 'rec_restaurant_visuals', key: 'restaurant_photos', type: 'opportunity', tone: 'encouraging', mergeable: true, bundleWord: 'a few food photos', ttlDays: 30,
    headline: 'A few photos of the food go a long way.',
    summary: 'Diners choose with their eyes. Even a handful of real photographs of your dishes helps people picture the meal and pick you.' },
];

// ── the pack: all layers, reusing the existing coach + writer per-vertical data ──
export const RESTAURANT_PACK: IndustryPack = makePack({
  key: 'restaurant', label: 'Restaurant', family: 'food', status: 'installed', version: '1.0.0',
  profile: {
    summary: 'A place people go to eat and drink — the menu, hours, and atmosphere are the essentials.',
    typicalServices: ['dine-in', 'takeout', 'delivery', 'catering', 'private events'],
    keyFields: ['cuisine', 'dining_style', 'price_range', 'reservations', 'takeout', 'delivery', 'outdoor_seating', 'dietary_accommodations', 'parking', 'alcohol', 'kids', 'pets', 'private_events', 'payment_methods', 'accessibility'],
    bookingPosture: 'reservation',
  },
  vocabulary: { offerings: 'menu', offering: 'dish', services: 'menu', gallery: 'food photos', book: 'reserve a table' },
  evidence: { providerNames: ['restaurant'], catalogTypes: [T_MENU_ABSENT, T_MENU_PRICES, T_FOOD_PHOTOS] },
  intelligence: {
    judgmentRules: ['restaurant_menu', 'restaurant_visuals'],
    recommendationRules: ['rec_restaurant_menu', 'rec_restaurant_visuals'],
    momentTemplates: ['restaurant_menu', 'restaurant_photos'],
    conciergeIntents: [], coachAreas: ['seasonal', 'holiday', 'promotion'],
  },
  growth: { pack: growthPackFor('restaurant-classic'), notes: 'restaurant seasonal + holiday calendar (coach)' },
  creative: {
    writer: packFor('restaurant'),
    photographyGuidance: ['natural light, shot close and slightly from above', 'the hero dish, not the whole table', 'show freshness and steam; avoid heavy filters'],
    mediaSuggestions: ['a signature dish', 'the dining room', 'the storefront', 'the team at work'],
    brandDefaults: { tone: 'warm, appetite-forward', palette: 'appetizing warm neutrals' },
  },
  connected: { relevantProviders: ['google_business_profile', 'google_search_console', 'google_analytics', 'yelp', 'google_calendar'], defaults: { booking: 'google_calendar' }, emphasises: ['reviews', 'listings', 'booking'] },
  cms: {
    navigation: ['Home', 'Menu', 'About', 'Reservations', 'Gallery', 'Contact', 'Location'],
    pages: ['home', 'menu', 'about', 'reservations', 'private_events', 'gallery', 'contact', 'location', 'gift_cards', 'careers', 'faqs'],
    components: ['menu_section', 'hours_block', 'reservation_cta', 'photo_gallery', 'map'],
    servicePages: false, landingPages: ['seasonal_menu', 'holiday_hours', 'private_events'], blogCategories: ['seasonal', 'events', 'behind_the_scenes'],
  },
  compliance: { requirements: ['allergen information where required', 'alcohol-service disclaimers where applicable'], notes: 'Low regulatory burden; allergen and alcohol notices vary by locality.' },
  marketplace: { author: 'Studio OS', license: 'platform', exportable: true, shareable: true, minPlatformVersion: '5.0.0', changelog: [{ version: '1.0.0', note: 'Flagship restaurant pack.' }] },
});
