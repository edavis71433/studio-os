// ── Coffee Shop Pack (L5.3) — proves CHILD-PACK INHERITANCE (extends) ────────
// Coffee Shop `extends: 'restaurant'`. It duplicates NOTHING: composePack folds
// Restaurant underneath it (CMS, vocabulary, growth calendar, creative voice,
// profile, connected guidance all inherited), and the restaurant evidence
// provider fires for a coffee shop automatically (coffee_shop IS-A restaurant,
// via the inheritance-aware self-gate). Only the DIFFERENCES live here.
import type { IndustryPack } from '../contract.ts';
import type { Rule } from '../../judgment/rules.ts';
import type { RecRule } from '../../recommendation/rules.ts';
import type { MomentTemplate } from '../../moments/rules.ts';
import { makePack } from '../registry.ts';
import { packProvider, packType } from '../helpers.ts';

const T_WORKSPACE = packType('coffee_shop', 'content', 'workspace_unlisted'); // content.coffee_shop_workspace_unlisted

export const COFFEE_SHOP_CATALOG: Record<string, any> = {
  [T_WORKSPACE]: { category: 'content', severity: 'info', confidence: 0.75,
    next_action: 'Mention Wi-Fi, seating, and whether it’s laptop-friendly.',
    human: () => `The site doesn’t say whether it’s a good place to sit and work.`,
    tech: () => `no wifi/seating/work-friendly signal found.` },
};

// self-gates on 'coffee_shop'; the restaurant provider ALSO fires here (is-a)
export const coffeeShopProvider = packProvider('coffee_shop', 'coffee_shop', (i, emit) => {
  const html = (i.pages || []).map((p: any) => String(p.html || '')).join(' ').toLowerCase();
  if (!/wi-?fi|seating|laptop|work|study|remote|outlets?/.test(html)) emit(T_WORKSPACE, 'content', '/');
});

export const COFFEE_SHOP_JUDGMENT_RULES: Rule[] = [
  { key: 'coffee_shop_workspace', category: 'content', audience: 'customer', timing: 'whenever', ttlDays: 45,
    types: [T_WORKSPACE], dimensions: ['conversion', 'customer_trust'],
    impactNote: 'remote workers choose cafes by whether they can sit and work',
    customerImpact: 'work-from-cafe regulars can’t tell if they’re welcome',
    priority: () => 'low' },
];

export const COFFEE_SHOP_REC_RULES: RecRule[] = [
  { judgmentRule: 'coffee_shop_workspace', action: 'create',
    title: 'say whether it’s a good place to work',
    description: 'add a line about Wi-Fi, seating, outlets, and laptop-friendliness, into the draft, for review',
    expected_benefit: 'the work-from-cafe crowd knows they’re welcome and becomes regulars',
    value: ['conversion', 'customer_experience'], effort: 'minutes', risk: 'none', undoability: 'versioned', requires_ai: true, ttlDays: 45 },
];

export const COFFEE_SHOP_MOMENT_TEMPLATES: MomentTemplate[] = [
  { recRule: 'rec_coffee_shop_workspace', key: 'coffee_shop_workspace', type: 'opportunity', tone: 'encouraging', mergeable: true, bundleWord: 'a note for remote workers', ttlDays: 30,
    headline: 'Let the laptop crowd know they’re welcome.',
    summary: 'A short line about Wi-Fi, seating, and outlets tells work-from-cafe regulars this is their spot — and they’re some of the most loyal customers a cafe has.' },
];

// Only the DIFFERENCES from Restaurant. Everything omitted inherits via extends.
export const COFFEE_SHOP_PACK: IndustryPack = makePack({
  key: 'coffee_shop', label: 'Coffee Shop', family: 'food', status: 'installed', version: '1.0.0', extends: 'restaurant',
  profile: {
    summary: 'A cafe serving coffee, espresso drinks, tea, and light food — often a place people linger and work.',
    typicalServices: ['espresso drinks', 'drip coffee', 'tea', 'pastries', 'breakfast', 'mobile ordering'],
    keyFields: ['wifi', 'seating', 'roaster', 'loyalty', 'mobile_ordering', 'drive_through'],
    bookingPosture: 'order',
  },
  vocabulary: { offering: 'drink', signature: 'signature drink' },
  evidence: { providerNames: ['coffee_shop'], catalogTypes: [T_WORKSPACE] },
  intelligence: { judgmentRules: ['coffee_shop_workspace'], recommendationRules: ['rec_coffee_shop_workspace'], momentTemplates: ['coffee_shop_workspace'], conciergeIntents: [], coachAreas: ['seasonal', 'loyalty', 'promotion'] },
  creative: { writer: null, photographyGuidance: ['latte art and the cup in natural light', 'the counter and pastry case', 'the seating / work vibe'], mediaSuggestions: ['a signature drink', 'where people sit', 'beans / roasting if you roast'], brandDefaults: { tone: 'warm, neighborhood, unpretentious' } },
  connected: { relevantProviders: ['google_business_profile', 'google_analytics', 'yelp'], defaults: { ordering: 'mobile' }, emphasises: ['reviews', 'listings', 'booking'] },
  cms: { navigation: ['Seasonal Drinks', 'Loyalty', 'Events'], pages: ['seasonal_drinks', 'loyalty', 'events'], components: ['loyalty_signup', 'seasonal_menu_block'], servicePages: false, landingPages: ['seasonal_drinks', 'loyalty'], blogCategories: ['seasonal', 'community'] },
});
