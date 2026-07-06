// ── The Evidence Contract (M9.0 — constitution 05 §2/§10) ────────────────────
// Observations ONLY. No interpretation, no prioritization, no recommendation
// engines, no AI — those are M9.1+ consumers of this data, never producers.
//
// Every evidence item carries the frozen ten fields. Three of them (severity,
// confidence, next_action) plus both explanation templates are CATALOG
// METADATA: fixed per evidence TYPE, deterministic, defined below — a provider
// can only emit types that exist in the catalog, with measured facts. That is
// how "recommended next action" stays an observation-time constant (like a
// lint rule's docs) and never becomes a judgment.
//
// Additivity rules (frozen): new evidence types = new catalog entries; new
// fields = new columns/keys; existing keys never change meaning. No free-form
// structures — `facts` keys are declared per type by the template functions.

export type Severity = 'critical' | 'warning' | 'info';

export type Category =
  | 'website' | 'seo' | 'accessibility' | 'performance' | 'structured_data'
  | 'metadata' | 'freshness' | 'business_info' | 'media' | 'links'
  | 'local_presence' | 'reviews' | 'trust' | 'content' | 'conversion';

export interface EvidenceItem {
  category: Category;
  type: string;              // catalog key: '<category>.<check>'
  severity: Severity;        // from catalog
  confidence: number;        // from catalog: 1.0 exact measurement … 0.6 heuristic
  source: string;            // provider@surface[:resource] — where this was observed
  resource: string;          // affected resource: page path, entity id, URL, field name
  human: string;             // plain-language observation (templated)
  tech: string;              // technical observation (templated)
  next_action: string;       // fixed remediation hint (catalog metadata, not judgment)
  facts: Record<string, string | number | boolean>; // the measured values
  observed_at: string;       // the run's clock — passed in; providers never read time
  fingerprint: string;       // site|type|resource — stable identity for deltas
}

interface CatalogEntry {
  category: Category;
  severity: Severity;
  confidence: number;
  next_action: string;
  human: (f: Facts) => string;
  tech: (f: Facts) => string;
}
type Facts = Record<string, string | number | boolean>;

const s = (v: unknown) => String(v ?? '');

/** The evidence type catalog. Every emittable observation, declared. */
export const CATALOG: Record<string, CatalogEntry> = {
  // ── website ──
  'website.not_live': { category: 'website', severity: 'info', confidence: 1,
    next_action: 'Publish when the draft is ready.',
    human: () => `The website has not been published yet.`,
    tech: () => `No publish row with status=live exists for this site.` },
  'website.hosting_missing': { category: 'website', severity: 'warning', confidence: 1,
    next_action: 'Run provisioning from the admin surface.',
    human: () => `The website has no hosting attached.`,
    tech: () => `presence_sites.netlify_site_id is null.` },
  'website.live_fetch_failed': { category: 'website', severity: 'warning', confidence: 0.9,
    next_action: 'Check hosting health from the admin surface.',
    human: (f) => `The live website did not answer when checked (${s(f.url)}).`,
    tech: (f) => `GET ${s(f.url)} failed: ${s(f.error)}.` },
  'website.http_status': { category: 'website', severity: 'critical', confidence: 1,
    next_action: 'Investigate hosting; the site is serving errors.',
    human: (f) => `The live website answered with an error (${s(f.status)}).`,
    tech: (f) => `GET ${s(f.url)} returned HTTP ${s(f.status)}.` },

  // ── seo ──
  'seo.title_missing': { category: 'seo', severity: 'critical', confidence: 1,
    next_action: 'Set a search-listing title for this page.',
    human: (f) => `The page ${s(f.page)} has no title for search results.`,
    tech: (f) => `${s(f.page)}: no <title> element or empty text.` },
  'seo.title_duplicate': { category: 'seo', severity: 'warning', confidence: 1,
    next_action: 'Give each page its own title.',
    human: (f) => `Pages ${s(f.pages)} share the same search title.`,
    tech: (f) => `Duplicate <title> "${s(f.title)}" across: ${s(f.pages)}.` },
  'seo.title_length': { category: 'seo', severity: 'info', confidence: 1,
    next_action: 'Aim for a title between 15 and 60 characters.',
    human: (f) => `The title of ${s(f.page)} is ${Number(f.length) < 15 ? 'very short' : 'long enough to be cut off'} in search results.`,
    tech: (f) => `${s(f.page)}: <title> length ${s(f.length)} (guide: 15–60).` },
  'seo.description_missing': { category: 'seo', severity: 'warning', confidence: 1,
    next_action: 'Write a one-sentence description for this page.',
    human: (f) => `The page ${s(f.page)} has no description for search results.`,
    tech: (f) => `${s(f.page)}: no <meta name="description"> or empty content.` },
  'seo.description_duplicate': { category: 'seo', severity: 'info', confidence: 1,
    next_action: 'Give each page its own description.',
    human: (f) => `Pages ${s(f.pages)} share the same search description.`,
    tech: (f) => `Duplicate meta description across: ${s(f.pages)}.` },
  'seo.description_length': { category: 'seo', severity: 'info', confidence: 1,
    next_action: 'Aim for a description between 50 and 160 characters.',
    human: (f) => `The description of ${s(f.page)} is ${Number(f.length) < 50 ? 'very short' : 'long enough to be cut off'} in search results.`,
    tech: (f) => `${s(f.page)}: meta description length ${s(f.length)} (guide: 50–160).` },
  'seo.canonical_missing': { category: 'seo', severity: 'info', confidence: 1,
    next_action: 'Template concern: add a canonical link tag.',
    human: (f) => `The page ${s(f.page)} does not declare its canonical address.`,
    tech: (f) => `${s(f.page)}: no <link rel="canonical">.` },
  'seo.robots_missing': { category: 'seo', severity: 'warning', confidence: 1,
    next_action: 'Template concern: emit robots.txt in the file map.',
    human: () => `The website has no robots.txt file.`,
    tech: () => `robots.txt absent from the rendered file map.` },
  'seo.sitemap_missing': { category: 'seo', severity: 'warning', confidence: 1,
    next_action: 'Template concern: emit sitemap.xml in the file map.',
    human: () => `The website has no sitemap.`,
    tech: () => `sitemap.xml absent from the rendered file map.` },
  'seo.h1_missing': { category: 'seo', severity: 'warning', confidence: 1,
    next_action: 'Template concern: every page needs one main heading.',
    human: (f) => `The page ${s(f.page)} has no main heading.`,
    tech: (f) => `${s(f.page)}: zero <h1> elements.` },
  'seo.h1_multiple': { category: 'seo', severity: 'info', confidence: 1,
    next_action: 'Template concern: keep one main heading per page.',
    human: (f) => `The page ${s(f.page)} has ${s(f.count)} main headings.`,
    tech: (f) => `${s(f.page)}: ${s(f.count)} <h1> elements.` },
  'seo.thin_content': { category: 'seo', severity: 'info', confidence: 0.7,
    next_action: 'Consider saying more on this page.',
    human: (f) => `The page ${s(f.page)} has very little text (${s(f.words)} words).`,
    tech: (f) => `${s(f.page)}: ~${s(f.words)} words of body text (heuristic floor ${s(f.floor)}).` },

  // ── accessibility ──
  'accessibility.img_alt_missing': { category: 'accessibility', severity: 'warning', confidence: 1,
    next_action: 'Describe this image in a sentence.',
    human: (f) => `${s(f.count)} image${Number(f.count) === 1 ? '' : 's'} on ${s(f.page)} ${Number(f.count) === 1 ? 'has' : 'have'} no description for people who can’t see ${Number(f.count) === 1 ? 'it' : 'them'}.`,
    tech: (f) => `${s(f.page)}: ${s(f.count)} <img> without alt (or empty alt on non-decorative).` },
  'accessibility.link_text_vague': { category: 'accessibility', severity: 'info', confidence: 0.8,
    next_action: 'Name the destination in the link text.',
    human: (f) => `A link on ${s(f.page)} just says “${s(f.text)}” — screen readers read links out of context.`,
    tech: (f) => `${s(f.page)}: anchor text "${s(f.text)}" is non-descriptive.` },
  'accessibility.landmark_missing': { category: 'accessibility', severity: 'info', confidence: 1,
    next_action: 'Template concern: include the missing landmark.',
    human: (f) => `The page ${s(f.page)} is missing a ${s(f.landmark)} landmark for assistive navigation.`,
    tech: (f) => `${s(f.page)}: no <${s(f.landmark)}> element.` },
  'accessibility.lang_missing': { category: 'accessibility', severity: 'warning', confidence: 1,
    next_action: 'Template concern: declare the page language.',
    human: (f) => `The page ${s(f.page)} doesn’t declare its language.`,
    tech: (f) => `${s(f.page)}: <html> has no lang attribute.` },
  'accessibility.heading_skip': { category: 'accessibility', severity: 'info', confidence: 1,
    next_action: 'Template concern: keep heading levels in order.',
    human: (f) => `Headings on ${s(f.page)} skip a level (${s(f.from)} to ${s(f.to)}).`,
    tech: (f) => `${s(f.page)}: heading sequence jumps h${s(f.from)}→h${s(f.to)}.` },

  // ── performance ──
  'performance.image_oversized': { category: 'performance', severity: 'warning', confidence: 1,
    next_action: 'Replace with a smaller photograph; the pipeline resizes but the source is heavy.',
    human: (f) => `A photograph (“${s(f.alt)}”) is ${s(f.kb)} KB — heavy for the web.`,
    tech: (f) => `media ${s(f.id)}: source ${s(f.kb)} KB > ${s(f.limit)} KB threshold.` },
  'performance.image_dimensions_missing': { category: 'performance', severity: 'info', confidence: 1,
    next_action: 'Re-upload so dimensions are recorded; prevents layout shift.',
    human: (f) => `A photograph (“${s(f.alt)}”) has no recorded size.`,
    tech: (f) => `media ${s(f.id)}: width/height null.` },
  'performance.page_weight': { category: 'performance', severity: 'info', confidence: 1,
    next_action: 'Template concern: keep pages under budget.',
    human: (f) => `The page ${s(f.page)} is ${s(f.kb)} KB of HTML — above the calm budget.`,
    tech: (f) => `${s(f.page)}: HTML ${s(f.kb)} KB > ${s(f.budget)} KB budget.` },
  'performance.blocking_scripts': { category: 'performance', severity: 'info', confidence: 1,
    next_action: 'Template concern: defer or remove render-blocking scripts.',
    human: (f) => `The page ${s(f.page)} loads ${s(f.count)} script${Number(f.count) === 1 ? '' : 's'} before it can draw.`,
    tech: (f) => `${s(f.page)}: ${s(f.count)} synchronous external <script> in <head>.` },
  'performance.font_swap_missing': { category: 'performance', severity: 'info', confidence: 0.9,
    next_action: 'Template concern: load fonts with display=swap.',
    human: (f) => `Text on ${s(f.page)} may wait for fonts before appearing.`,
    tech: (f) => `${s(f.page)}: webfont link without display=swap.` },

  // ── structured_data ──
  'structured_data.ldjson_invalid': { category: 'structured_data', severity: 'warning', confidence: 1,
    next_action: 'Template concern: fix the JSON-LD block.',
    human: (f) => `Machine-readable business data on ${s(f.page)} doesn’t parse.`,
    tech: (f) => `${s(f.page)}: ld+json block failed JSON.parse: ${s(f.error)}.` },
  'structured_data.schema_missing': { category: 'structured_data', severity: 'warning', confidence: 1,
    next_action: 'Template concern: emit the vertical’s schema type.',
    human: (f) => `The page ${s(f.page)} carries no machine-readable business data.`,
    tech: (f) => `${s(f.page)}: no ld+json block present.` },
  'structured_data.schema_field_missing': { category: 'structured_data', severity: 'info', confidence: 1,
    next_action: 'Fill the business fact that feeds this schema field.',
    human: (f) => `Search engines aren’t told the business’s ${s(f.field)}.`,
    tech: (f) => `Schema ${s(f.schema)} lacks ${s(f.field)} on ${s(f.page)}.` },

  // ── metadata ──
  'metadata.og_missing': { category: 'metadata', severity: 'info', confidence: 1,
    next_action: 'Template concern: emit Open Graph tags.',
    human: (f) => `Links to ${s(f.page)} won’t show a rich preview when shared.`,
    tech: (f) => `${s(f.page)}: missing og: tags (${s(f.missing)}).` },
  'metadata.favicon_missing': { category: 'metadata', severity: 'info', confidence: 1,
    next_action: 'Template concern: emit a favicon.',
    human: () => `The website has no browser-tab icon.`,
    tech: () => `No favicon link or file in the rendered file map.` },

  // ── freshness ──
  'freshness.publish_stale': { category: 'freshness', severity: 'info', confidence: 1,
    next_action: 'Worth confirming the site still says the right things.',
    human: (f) => `Nothing has been published in ${s(f.days)} days.`,
    tech: (f) => `Last live publish ${s(f.last)}; ${s(f.days)}d > ${s(f.threshold)}d threshold.` },
  'freshness.draft_idle': { category: 'freshness', severity: 'info', confidence: 1,
    next_action: 'Review and publish the waiting changes, or discard them.',
    human: (f) => `${s(f.count)} unpublished change${Number(f.count) === 1 ? ' has' : 's have'} been waiting ${s(f.days)} days.`,
    tech: (f) => `Oldest unpublished change ${s(f.oldest)}; ${s(f.days)}d idle.` },
  'freshness.updates_quiet': { category: 'freshness', severity: 'info', confidence: 1,
    next_action: 'An update — even one sentence — keeps the site alive.',
    human: (f) => `No update has been shown in ${s(f.days)} days.`,
    tech: (f) => `Newest published post ${s(f.last)}; ${s(f.days)}d > ${s(f.threshold)}d.` },
  'freshness.menu_unchanged': { category: 'freshness', severity: 'info', confidence: 0.9,
    next_action: 'Worth confirming the menu is still current.',
    human: (f) => `The menu hasn’t changed in ${s(f.days)} days.`,
    tech: (f) => `Last offering change event ${s(f.last)}; ${s(f.days)}d > ${s(f.threshold)}d.` },

  // ── business_info ──
  'business_info.identity_incomplete': { category: 'business_info', severity: 'warning', confidence: 1,
    next_action: 'Fill the missing business fact.',
    human: (f) => `The business’s ${s(f.field)} is missing.`,
    tech: (f) => `presence_identity.${s(f.field)} empty.` },
  'business_info.hours_incomplete': { category: 'business_info', severity: 'warning', confidence: 1,
    next_action: 'Set hours (or Closed) for every day.',
    human: (f) => `Hours are not set for ${s(f.days)}.`,
    tech: (f) => `location.hours missing/invalid for: ${s(f.days)}.` },
  'business_info.holiday_hours_missing': { category: 'business_info', severity: 'info', confidence: 1,
    next_action: 'Holiday hours can be added when a holiday approaches.',
    human: () => `No holiday hours are recorded.`,
    tech: () => `location.holiday_exceptions is empty.` },
  'business_info.address_incomplete': { category: 'business_info', severity: 'warning', confidence: 1,
    next_action: 'Complete the address.',
    human: (f) => `The address is missing its ${s(f.field)}.`,
    tech: (f) => `presence_locations.${s(f.field)} empty.` },
  'business_info.closed_longstanding': { category: 'business_info', severity: 'warning', confidence: 1,
    next_action: 'If the business has reopened, turn off the closed notice.',
    human: (f) => `The site has said “temporarily closed” for ${s(f.days)} days.`,
    tech: (f) => `temporarily_closed=true since ~${s(f.since)} (${s(f.days)}d).` },
  'business_info.phone_mismatch': { category: 'business_info', severity: 'warning', confidence: 1,
    next_action: 'Make the two phone numbers agree (or clear one).',
    human: () => `The business phone and the location phone disagree.`,
    tech: (f) => `identity.phone "${s(f.a)}" != location.phone "${s(f.b)}".` },

  // ── media ──
  'media.alt_short': { category: 'media', severity: 'info', confidence: 1,
    next_action: 'A fuller sentence helps customers and search engines.',
    human: (f) => `A photograph’s description is just “${s(f.alt)}”.`,
    tech: (f) => `media ${s(f.id)}: alt_text length ${s(f.length)} < ${s(f.floor)}.` },
  'media.unused': { category: 'media', severity: 'info', confidence: 1,
    next_action: 'Place it somewhere on the site, or leave it in the collection.',
    human: (f) => `${s(f.count)} photograph${Number(f.count) === 1 ? ' is' : 's are'} in the collection but not on the site.`,
    tech: (f) => `${s(f.count)} media rows with no offering/post/cover reference.` },
  'media.offering_photo_missing': { category: 'media', severity: 'info', confidence: 1,
    next_action: 'A photograph sells a dish better than its price.',
    human: (f) => `${s(f.count)} visible menu item${Number(f.count) === 1 ? ' has' : 's have'} no photograph.`,
    tech: (f) => `${s(f.count)} visible offerings with media_id null.` },

  // ── links ──
  'links.internal_broken': { category: 'links', severity: 'critical', confidence: 1,
    next_action: 'Template concern: the link target does not exist in the file map.',
    human: (f) => `A link on ${s(f.page)} points to a page that doesn’t exist (${s(f.href)}).`,
    tech: (f) => `${s(f.page)}: internal href ${s(f.href)} has no file-map entry.` },
  'links.redirect_to_missing': { category: 'links', severity: 'warning', confidence: 1,
    next_action: 'Point the redirect at an existing page.',
    human: (f) => `A saved redirect points to a page that doesn’t exist (${s(f.to)}).`,
    tech: (f) => `redirect ${s(f.from)} → ${s(f.to)}: target not in file map.` },

  // ── local_presence ──
  'local_presence.profile_unconnected': { category: 'local_presence', severity: 'info', confidence: 1,
    next_action: 'Business-profile observation arrives with the destinations milestone.',
    human: () => `No business profile source (e.g. Google) is connected yet.`,
    tech: () => `No external profile destination configured (M10).` },
  'local_presence.map_signal_missing': { category: 'local_presence', severity: 'info', confidence: 1,
    next_action: 'Complete address and hours; they are the local search signals.',
    human: (f) => `Local search signals are incomplete on the site (${s(f.missing)}).`,
    tech: (f) => `Rendered pages lack: ${s(f.missing)}.` },

  // ── reviews ──
  'reviews.source_unconnected': { category: 'reviews', severity: 'info', confidence: 1,
    next_action: 'Review observation arrives with the destinations milestone.',
    human: () => `No review source is connected yet.`,
    tech: () => `No review destination configured (M10).` },
  'reviews.testimonials_none': { category: 'reviews', severity: 'info', confidence: 1,
    next_action: 'Keep the first kind word — it appears on the site in their words.',
    human: () => `The site shows no kind words from customers yet.`,
    tech: () => `Zero visible testimonials.` },
  'reviews.testimonials_stale': { category: 'reviews', severity: 'info', confidence: 0.8,
    next_action: 'A recent kind word reads truer than an old one.',
    human: (f) => `The newest kind word on the site is ${s(f.days)} days old.`,
    tech: (f) => `Newest visible testimonial created ${s(f.last)} (${s(f.days)}d).` },

  // ── trust ──
  'trust.ssl_missing': { category: 'trust', severity: 'critical', confidence: 1,
    next_action: 'Investigate hosting/SSL from the admin surface.',
    human: () => `The website is not serving over a secure connection.`,
    tech: (f) => `Live fetch of ${s(f.url)} not over valid HTTPS.` },
  'trust.contact_missing': { category: 'trust', severity: 'warning', confidence: 1,
    next_action: 'Add a phone or email — customers need a way in.',
    human: () => `The site offers no phone number or email.`,
    tech: () => `identity.phone and identity.email both empty.` },
  'trust.hours_not_public': { category: 'trust', severity: 'warning', confidence: 1,
    next_action: 'Publish so customers can see the hours.',
    human: () => `Hours exist in the draft but aren’t published.`,
    tech: () => `Draft hours present; live snapshot missing/differs and no live publish.` },
  'trust.policy_page_missing': { category: 'trust', severity: 'info', confidence: 1,
    next_action: 'Policy pages arrive with contract page evolution; nothing to do today.',
    human: (f) => `The site has no ${s(f.page)} page.`,
    tech: (f) => `${s(f.page)} not a v1 contract page kind (05 §7 Class C).` },
  'trust.security_header_missing': { category: 'trust', severity: 'info', confidence: 1,
    next_action: 'Hosting concern: add the header at the edge.',
    human: (f) => `The website doesn’t send the ${s(f.header)} protection header.`,
    tech: (f) => `Live response lacks ${s(f.header)}.` },

  // ── content ──
  'content.faqs_none': { category: 'content', severity: 'info', confidence: 1,
    next_action: 'Answer the first question customers actually ask.',
    human: () => `The site answers no customer questions yet.`,
    tech: () => `Zero visible FAQs.` },
  'content.updates_none': { category: 'content', severity: 'info', confidence: 1,
    next_action: 'One sentence of news makes the business look alive.',
    human: () => `The site has no updates yet.`,
    tech: () => `Zero published posts.` },
  'content.description_thin': { category: 'content', severity: 'info', confidence: 0.8,
    next_action: 'A sentence or two more would say who this is for.',
    human: (f) => `The business description is very short (${s(f.words)} words).`,
    tech: (f) => `identity.description ~${s(f.words)} words < ${s(f.floor)}.` },
  'content.cta_missing': { category: 'content', severity: 'info', confidence: 0.9,
    next_action: 'A reservation or ordering link gives visitors a next step.',
    human: () => `Visitors have no clear next step (no reservation or ordering link).`,
    tech: () => `identity.booking_url and identity.ordering_url both empty.` },
  'content.reading_hard': { category: 'content', severity: 'info', confidence: 0.6,
    next_action: 'Shorter sentences read easier.',
    human: (f) => `The ${s(f.field)} reads at a difficult level.`,
    tech: (f) => `${s(f.field)}: Flesch reading ease ${s(f.score)} < ${s(f.floor)} (heuristic).` },
  'content.offering_duplicate': { category: 'content', severity: 'info', confidence: 1,
    next_action: 'Remove or rename the duplicate menu item.',
    human: (f) => `“${s(f.name)}” appears ${s(f.count)} times on the menu.`,
    tech: (f) => `${s(f.count)} visible offerings share name "${s(f.name)}".` },

  // ── conversion ──
  'conversion.booking_missing': { category: 'conversion', severity: 'info', confidence: 1,
    next_action: 'Add the reservation link if the business takes them.',
    human: () => `There’s no reservation link.`,
    tech: () => `identity.booking_url empty.` },
  'conversion.ordering_missing': { category: 'conversion', severity: 'info', confidence: 1,
    next_action: 'Add the online-ordering link if the business offers it.',
    human: () => `There’s no online-ordering link.`,
    tech: () => `identity.ordering_url empty.` },
  'conversion.prices_missing': { category: 'conversion', severity: 'info', confidence: 1,
    next_action: 'Add prices, or “MP” where the market decides.',
    human: (f) => `${s(f.count)} visible menu item${Number(f.count) === 1 ? ' has' : 's have'} no price.`,
    tech: (f) => `${s(f.count)} visible offerings with empty price_text.` },
};

/** Stable fingerprint: identity of an observation across runs. */
export function fingerprint(siteId: string, type: string, resource: string): string {
  let h = 5381;
  const str = `${siteId}|${type}|${resource}`;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0') + ':' + type + (resource ? ':' + resource.slice(0, 64) : '');
}

/** The only way a provider emits: catalog-checked, template-built. */
export function makeEmit(siteId: string, provider: string, observedAt: string, out: EvidenceItem[]) {
  return function emit(type: string, surface: string, resource: string, facts: Facts = {}) {
    const c = CATALOG[type];
    if (!c) throw new Error(`unknown evidence type: ${type}`); // additive catalog: emitting unregistered types is a bug
    out.push({
      category: c.category, type, severity: c.severity, confidence: c.confidence,
      source: `${provider}@${surface}${resource ? ':' + resource : ''}`,
      resource, human: c.human(facts), tech: c.tech(facts), next_action: c.next_action,
      facts, observed_at: observedAt, fingerprint: fingerprint(siteId, type, resource),
    });
  };
}
