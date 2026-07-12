// ⚠️ SPEC MODULE — NOT WIRED INTO PRODUCTION (verified Jul 12 2026: zero production
// imports; exercised only by its test). It documents a frozen-architecture contract
// awaiting its phase — do NOT assume it guards anything at runtime. Wire it or
// delete it (with an ADR note) when its phase arrives.
// ── Structured component library (Phase T) — blocks, not a page builder ──────
// The "structured site builder" is a catalog of REUSABLE BLOCKS defined as DATA:
// each declares its fields, validation, the schema.org it emits, its a11y
// contract, and whether AI can assist. Templates realize a selection of these;
// customers turn a block on and fill its fields (structured content → deterministic
// render). This is NOT drag-and-drop and NOT arbitrary layout — it preserves
// structured content, determinism, and approval-first. Adding a component is one
// data entry + a template realizing it; the architecture never changes.
//
// Pure + testable. The render engine and the SDK both read this catalog.

export type FieldType = 'text' | 'richtext' | 'url' | 'email' | 'phone' | 'image' | 'number' | 'time' | 'list' | 'enum' | 'boolean';
export interface ComponentField {
  key: string;
  type: FieldType;
  required?: boolean;
  repeatable?: boolean;         // a list of this field/group
  aiAssist?: boolean;           // the writer can draft this (still approval-first)
  max?: number;                 // length or count cap
}
export interface ComponentDef {
  key: string;
  label: string;
  category: 'header' | 'content' | 'proof' | 'commerce' | 'contact' | 'media' | 'community';
  purpose: string;
  fields: ComponentField[];
  /** schema.org type this block contributes (or null — presentational only). */
  schema: string | null;
  /** the a11y contract every realization MUST meet. */
  a11y: string;
  /** SEO role (what it contributes to discoverability). */
  seo: string;
  /** industries this block is especially relevant to ('*' = all). */
  industries: string[];
}

const t = (key: string, type: FieldType, extra: Partial<ComponentField> = {}): ComponentField => ({ key, type, ...extra });

// The V1 catalog. ~30 structured blocks covering the milestone's list.
export const COMPONENTS: ComponentDef[] = [
  { key: 'hero', label: 'Hero', category: 'header', purpose: 'The opening — who you are + the primary action.',
    fields: [t('headline', 'text', { required: true, aiAssist: true, max: 90 }), t('subhead', 'text', { aiAssist: true, max: 180 }), t('image', 'image'), t('primary_cta', 'text'), t('primary_cta_url', 'url')],
    schema: null, a11y: 'single h1, alt text on the image, CTA is a real focusable link', seo: 'carries the h1 + the OG image', industries: ['*'] },
  { key: 'services', label: 'Services / Offerings', category: 'content', purpose: 'What you offer, grouped.',
    fields: [t('items', 'list', { repeatable: true, required: true, aiAssist: true }), t('category', 'text'), t('price_text', 'text'), t('description', 'richtext', { aiAssist: true }), t('image', 'image')],
    schema: 'Service / MenuItem / Product (industry-driven)', a11y: 'list semantics, headings per group', seo: 'ItemList + per-item schema', industries: ['*'] },
  { key: 'features', label: 'Features / Highlights', category: 'content', purpose: 'A few reasons to choose you.',
    fields: [t('items', 'list', { repeatable: true, aiAssist: true }), t('icon', 'enum')], schema: null, a11y: 'list semantics', seo: 'supporting keywords', industries: ['*'] },
  { key: 'pricing', label: 'Pricing / Packages', category: 'commerce', purpose: 'Tiers or packages.',
    fields: [t('tiers', 'list', { repeatable: true }), t('price_text', 'text'), t('features', 'list', { repeatable: true }), t('cta_url', 'url')], schema: 'Offer', a11y: 'table or list, not color-only emphasis', seo: 'Offer/PriceSpecification', industries: ['professional', 'fitness', 'salon', 'home_services', 'generic'] },
  { key: 'testimonials', label: 'Testimonials', category: 'proof', purpose: 'Customers in their own words.',
    fields: [t('quote', 'richtext', { required: true }), t('author', 'text', { required: true }), t('source', 'text'), t('date', 'text')], schema: 'Review', a11y: 'blockquote + cite', seo: 'Review schema', industries: ['*'] },
  { key: 'reviews', label: 'Aggregate Reviews', category: 'proof', purpose: 'A star rating summary (from connected sources).',
    fields: [t('rating', 'number'), t('count', 'number'), t('source', 'text')], schema: 'AggregateRating', a11y: 'rating announced as text, not stars alone', seo: 'AggregateRating (rich result)', industries: ['*'] },
  { key: 'faq', label: 'FAQ', category: 'content', purpose: 'Answers to common questions.',
    fields: [t('question', 'text', { required: true, repeatable: true, aiAssist: true }), t('answer', 'richtext', { required: true, aiAssist: true })], schema: 'FAQPage', a11y: 'accessible disclosure or plain headings', seo: 'FAQPage (rich result)', industries: ['*'] },
  { key: 'team', label: 'Team', category: 'content', purpose: 'The people behind the business.',
    fields: [t('name', 'text', { required: true, repeatable: true }), t('role', 'text'), t('bio', 'richtext', { aiAssist: true }), t('image', 'image')], schema: 'Person', a11y: 'alt text = name + role', seo: 'Person schema', industries: ['professional', 'law', 'medical', 'salon', 'real_estate'] },
  { key: 'gallery', label: 'Gallery', category: 'media', purpose: 'Photos of your work or space.',
    fields: [t('images', 'image', { repeatable: true, required: true })], schema: 'ImageObject', a11y: 'meaningful alt text per image, not decorative', seo: 'ImageObject', industries: ['*'] },
  { key: 'before_after', label: 'Before / After', category: 'media', purpose: 'Show the transformation.',
    fields: [t('before', 'image', { required: true }), t('after', 'image', { required: true }), t('caption', 'text')], schema: 'ImageObject', a11y: 'labelled before/after, alt text on both', seo: 'ImageObject', industries: ['home_services', 'salon', 'cleaning', 'landscaping', 'medical'] },
  { key: 'process', label: 'Process / Timeline', category: 'content', purpose: 'How working with you goes, step by step.',
    fields: [t('step', 'text', { required: true, repeatable: true, aiAssist: true }), t('detail', 'richtext', { aiAssist: true })], schema: 'HowTo', a11y: 'ordered list semantics', seo: 'HowTo', industries: ['home_services', 'professional', 'contractor'] },
  { key: 'cta', label: 'Call to Action', category: 'header', purpose: 'A focused prompt to act.',
    fields: [t('text', 'text', { required: true, aiAssist: true }), t('button', 'text'), t('url', 'url')], schema: null, a11y: 'real link/button, visible focus', seo: 'internal linking', industries: ['*'] },
  { key: 'lead_form', label: 'Lead / Contact Form', category: 'contact', purpose: 'Capture enquiries (feeds Leads + CRM).',
    fields: [t('fields', 'enum', { repeatable: true }), t('intro', 'text', { aiAssist: true })], schema: 'ContactPoint', a11y: 'labels + error text tied to inputs; keyboard complete', seo: 'ContactPoint', industries: ['*'] },
  { key: 'newsletter', label: 'Newsletter', category: 'contact', purpose: 'Email sign-up — a link out to your newsletter provider\'s page (no third-party form embedded).',
    fields: [t('text', 'text', { aiAssist: true, max: 200 }), t('url', 'url', { required: true }), t('button', 'text', { max: 40 })], schema: null, a11y: 'a real labelled link out, visible focus', seo: 'engagement', industries: ['*'] },
  { key: 'appointment', label: 'Appointment Booking', category: 'commerce', purpose: 'Book a time (links a scheduler).',
    fields: [t('provider_url', 'url', { required: true }), t('intro', 'text')], schema: 'ReserveAction', a11y: 'clear link out, no trapped focus', seo: 'ReserveAction', industries: ['salon', 'medical', 'dental', 'fitness', 'professional'] },
  { key: 'hours', label: 'Business Hours', category: 'contact', purpose: 'When you\'re open, incl. holidays.',
    fields: [t('hours', 'time', { required: true, repeatable: true }), t('holidays', 'list', { repeatable: true })], schema: 'OpeningHoursSpecification', a11y: 'time announced as text; today highlighted not by color alone', seo: 'OpeningHoursSpecification', industries: ['*'] },
  { key: 'location', label: 'Location + Map', category: 'contact', purpose: 'Address + an embedded map.',
    fields: [t('address', 'text', { required: true }), t('map_embed', 'url')], schema: 'PostalAddress', a11y: 'address as text (not only a map iframe); map has a title', seo: 'PostalAddress + geo', industries: ['*'] },
  { key: 'service_areas', label: 'Service Areas', category: 'contact', purpose: 'Where you serve (for mobile/home businesses).',
    fields: [t('areas', 'list', { repeatable: true, required: true })], schema: 'areaServed', a11y: 'list semantics', seo: 'areaServed (local SEO)', industries: ['home_services', 'plumber', 'hvac', 'cleaning', 'landscaping'] },
  { key: 'locations', label: 'Multiple Locations', category: 'contact', purpose: 'For multi-location businesses.',
    fields: [t('name', 'text', { repeatable: true, required: true }), t('address', 'text', { required: true }), t('hours', 'time')], schema: 'LocalBusiness (per location)', a11y: 'each location a labelled region', seo: 'per-location LocalBusiness', industries: ['restaurant', 'retail', 'fitness', 'medical'] },
  { key: 'menu', label: 'Menu', category: 'commerce', purpose: 'Food/drink menu with sections.',
    fields: [t('section', 'text', { repeatable: true }), t('item', 'text', { required: true, aiAssist: true }), t('price_text', 'text'), t('description', 'richtext', { aiAssist: true })], schema: 'Menu', a11y: 'sections as headings, items as lists', seo: 'Menu/MenuItem', industries: ['restaurant', 'coffee_shop', 'bar', 'food_truck'] },
  { key: 'products', label: 'Products', category: 'commerce', purpose: 'Featured products (display; e-commerce is V1.1).',
    fields: [t('name', 'text', { required: true, repeatable: true }), t('price_text', 'text'), t('image', 'image'), t('description', 'richtext', { aiAssist: true })], schema: 'Product', a11y: 'image alt = product name', seo: 'Product', industries: ['retail'] },
  { key: 'events', label: 'Events', category: 'community', purpose: 'Upcoming events.',
    fields: [t('name', 'text', { required: true, repeatable: true }), t('date', 'text', { required: true }), t('time', 'text'), t('detail', 'richtext', { aiAssist: true }), t('url', 'url')], schema: 'Event', a11y: 'date as text, not only visual', seo: 'Event (rich result)', industries: ['restaurant', 'fitness', 'church', 'nonprofit', 'retail'] },
  { key: 'announcement', label: 'Announcement Bar', category: 'header', purpose: 'A timely notice (holiday hours, a sale).',
    fields: [t('text', 'text', { required: true, aiAssist: true }), t('url', 'url'), t('expires_at', 'text')], schema: null, a11y: 'dismissible, announced to AT, not color-only', seo: 'freshness', industries: ['*'] },
  { key: 'blog', label: 'Updates / Blog', category: 'content', purpose: 'News and posts.',
    fields: [t('title', 'text', { required: true, repeatable: true, aiAssist: true }), t('body', 'richtext', { required: true, aiAssist: true }), t('hero', 'image')], schema: 'BlogPosting', a11y: 'article semantics, headings', seo: 'BlogPosting + freshness', industries: ['*'] },
  { key: 'video', label: 'Video', category: 'media', purpose: 'An embedded intro or tour video.',
    fields: [t('url', 'url', { required: true }), t('caption', 'text')], schema: 'VideoObject', a11y: 'title on the embed, captions expected', seo: 'VideoObject', industries: ['*'] },
  { key: 'stats', label: 'Statistics', category: 'proof', purpose: 'Numbers that build trust (years, clients).',
    fields: [t('value', 'text', { repeatable: true, required: true }), t('label', 'text', { required: true })], schema: null, a11y: 'value + label read together', seo: 'trust signals', industries: ['professional', 'home_services', 'nonprofit'] },
  { key: 'awards', label: 'Awards', category: 'proof', purpose: 'Recognition and awards.',
    fields: [t('name', 'text', { repeatable: true, required: true }), t('year', 'text'), t('image', 'image')], schema: null, a11y: 'image alt = award name', seo: 'trust signals', industries: ['professional', 'restaurant', 'salon'] },
  { key: 'certifications', label: 'Certifications / Licenses', category: 'proof', purpose: 'Credentials and licenses (trust + compliance).',
    fields: [t('name', 'text', { repeatable: true, required: true }), t('issuer', 'text'), t('number', 'text')], schema: 'EducationalOccupationalCredential', a11y: 'plain text list', seo: 'trust signals', industries: ['home_services', 'medical', 'law', 'contractor'] },
  { key: 'partners', label: 'Partners / Brands', category: 'proof', purpose: 'Brands you work with.',
    fields: [t('logo', 'image', { repeatable: true, required: true }), t('name', 'text')], schema: null, a11y: 'logo alt = partner name', seo: 'trust signals', industries: ['professional', 'retail', 'marketing'] },
  { key: 'social', label: 'Social Links', category: 'community', purpose: 'Icon links to your social profiles — link-out only, never an embedded feed (no trackers).',
    fields: [t('network', 'enum', { repeatable: true }), t('url', 'url', { required: true })], schema: null, a11y: 'each icon link labelled by network name', seo: 'sameAs links', industries: ['*'] },
  { key: 'map', label: 'Map & Directions', category: 'contact', purpose: 'A privacy-safe map: your own map image + address text + a directions link — never a third-party embed.',
    fields: [t('image', 'image'), t('address', 'text'), t('directions_url', 'url')], schema: null, a11y: 'address as readable text; the map image is supplementary, never the only source', seo: 'local relevance (address on the page)', industries: ['*'] },
];

export function componentByKey(key: string): ComponentDef | null { return COMPONENTS.find((c) => c.key === key) || null; }
export function componentsForIndustry(industryKey: string): ComponentDef[] {
  return COMPONENTS.filter((c) => c.industries.includes('*') || c.industries.includes(industryKey));
}
/** Every field a component declares, for validation + the SDK schema. */
export function componentFields(key: string): ComponentField[] { return componentByKey(key)?.fields ?? []; }
