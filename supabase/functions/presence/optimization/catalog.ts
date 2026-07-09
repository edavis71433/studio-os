// ── Optimization Engine catalog (M10) ───────────────────────────────────────
// New evidence TYPES, added through the Evidence Contract's frozen additivity
// rules: "new evidence types = new catalog entries." Same ten-field contract,
// same CatalogEntry shape, same discipline — severity/confidence/next_action
// are catalog metadata, observations carry only measured facts. Nothing here
// is customer-facing; these feed the existing deterministic architecture.
//
// Four new categories (infrastructure, aeo, analytics, knowledge) extend the
// Category union additively; the rest deepen existing categories.
import type { Category, Severity } from '../evidence/contract.ts';

type Facts = Record<string, string | number | boolean>;
interface CatalogEntry {
  category: Category; severity: Severity; confidence: number; next_action: string;
  human: (f: Facts) => string; tech: (f: Facts) => string;
}
const s = (v: unknown) => String(v ?? '');

export const OPT_CATALOG: Record<string, CatalogEntry> = {
  // ── infrastructure: DNS / domains / SSL posture / redirects ──
  'infrastructure.dns_apex_unresolved': { category: 'infrastructure', severity: 'critical', confidence: 0.9,
    next_action: 'Point the domain’s A/CNAME records at the hosting.',
    human: (f) => `The domain ${s(f.domain)} doesn’t answer — visitors typing it reach nothing.`,
    tech: (f) => `DoH A/CNAME lookup for ${s(f.domain)} returned no records (status ${s(f.status)}).` },
  'infrastructure.dns_www_unresolved': { category: 'infrastructure', severity: 'warning', confidence: 0.9,
    next_action: 'Add a www record pointing at the same hosting.',
    human: (f) => `www.${s(f.domain)} doesn’t answer — people who type “www.” reach nothing.`,
    tech: (f) => `DoH lookup for www.${s(f.domain)} returned no A/CNAME records.` },
  'infrastructure.domain_expiring': { category: 'infrastructure', severity: 'critical', confidence: 0.85,
    next_action: 'Renew the domain registration.',
    human: (f) => `The domain ${s(f.domain)} expires in ${s(f.days)} days (${s(f.expires)}).`,
    tech: (f) => `RDAP expiration event for ${s(f.domain)}: ${s(f.expires)} (${s(f.days)} days out).` },
  'infrastructure.http_not_redirected': { category: 'infrastructure', severity: 'warning', confidence: 0.9,
    next_action: 'Redirect plain http:// traffic to https://.',
    human: (f) => `Visiting http://${s(f.domain)} doesn’t forward to the secure site.`,
    tech: (f) => `GET http://${s(f.domain)} answered ${s(f.status)} without a redirect to https.` },
  'infrastructure.redirect_chain': { category: 'infrastructure', severity: 'info', confidence: 0.9,
    next_action: 'Collapse the redirect hops into one.',
    human: (f) => `Reaching the site takes ${s(f.hops)} forwarding steps — each adds a delay.`,
    tech: (f) => `${s(f.hops)} redirect hops observed from ${s(f.from)} before a 200.` },

  'infrastructure.caa_missing': { category: 'infrastructure', severity: 'info', confidence: 0.85,
    next_action: 'Add a CAA record naming the certificate authority you use.',
    human: (f) => `Any certificate authority can currently issue a certificate for ${s(f.domain)} — a CAA record locks that down.`,
    tech: (f) => `No CAA record on ${s(f.domain)} (apex resolves).` },

  // ── email authentication (its own provider; infrastructure category) ──
  'infrastructure.spf_missing': { category: 'infrastructure', severity: 'warning', confidence: 0.85,
    next_action: 'Add an SPF TXT record for the mail domain.',
    human: (f) => `Email sent from @${s(f.domain)} is easier to forge — no SPF record protects it.`,
    tech: (f) => `No TXT record beginning v=spf1 on ${s(f.domain)} (MX present).` },
  'infrastructure.dmarc_missing': { category: 'infrastructure', severity: 'warning', confidence: 0.85,
    next_action: 'Add a _dmarc TXT policy record.',
    human: (f) => `@${s(f.domain)} mail has no DMARC policy — inboxes trust it less.`,
    tech: (f) => `No TXT record at _dmarc.${s(f.domain)} (MX present).` },

  // ── technical SEO depth ──
  'seo.sitemap_page_missing': { category: 'seo', severity: 'info', confidence: 0.9,
    next_action: 'Regenerate or extend the sitemap to cover every page.',
    human: (f) => `The page ${s(f.page)} isn’t listed in the sitemap search engines read.`,
    tech: (f) => `${s(f.page)} absent from live sitemap.xml (${s(f.count)} URLs listed).` },
  'seo.robots_blocks_all': { category: 'seo', severity: 'critical', confidence: 1,
    next_action: 'Remove the blanket Disallow rule from robots.txt.',
    human: () => `robots.txt tells search engines to stay away from the whole site.`,
    tech: () => `robots.txt contains a global "Disallow: /" for all user agents.` },
  'seo.orphan_page': { category: 'seo', severity: 'info', confidence: 0.85,
    next_action: 'Link to the page from the site, or retire it.',
    human: (f) => `The page ${s(f.page)} exists but nothing on the site links to it.`,
    tech: (f) => `${s(f.page)} present in the file map; no internal href points to it.` },
  'seo.duplicate_page': { category: 'seo', severity: 'warning', confidence: 0.9,
    next_action: 'Differentiate the pages or canonicalize one to the other.',
    human: (f) => `Two pages (${s(f.a)}, ${s(f.b)}) read as the same content.`,
    tech: (f) => `Body text of ${s(f.a)} and ${s(f.b)} is identical after normalization.` },
  'seo.noindex': { category: 'seo', severity: 'warning', confidence: 0.95,
    next_action: 'Remove the noindex tag if the page should be found.',
    human: (f) => `The page ${s(f.page)} tells search engines not to list it — it won’t appear in results.`,
    tech: (f) => `${s(f.page)}: meta robots contains "noindex".` },

  // ── AI search (AEO) ──
  'aeo.faq_schema_missing': { category: 'aeo', severity: 'info', confidence: 0.9,
    next_action: 'Emit FAQPage structured data for the published questions.',
    human: (f) => `${s(f.count)} answered questions exist, but AI and search tools aren’t told they’re FAQs.`,
    tech: (f) => `${s(f.count)} visible FAQs; no FAQPage @type in any ld+json block.` },
  'aeo.entity_links_missing': { category: 'aeo', severity: 'info', confidence: 0.8,
    next_action: 'Add sameAs links (social profiles, maps listing) to the schema.',
    human: () => `The site never tells AI search which other profiles are the same business.`,
    tech: () => `Business schema present without a sameAs array; identity.social empty.` },
  'aeo.answers_thin': { category: 'aeo', severity: 'info', confidence: 0.85,
    next_action: 'Grow the shortest answers into two or three sentences.',
    human: (f) => `Answers average ${s(f.avg)} words — too thin for AI search to quote.`,
    tech: (f) => `Mean visible-FAQ answer length ${s(f.avg)} words (floor ${s(f.floor)}).` },
  'aeo.citation_facts_incomplete': { category: 'aeo', severity: 'info', confidence: 0.85,
    next_action: 'Get name, address, phone, and hours all onto the homepage.',
    human: (f) => `AI search can’t cite the basics — the homepage is missing ${s(f.missing)}.`,
    tech: (f) => `Citation fields absent from rendered home: ${s(f.missing)}.` },

  // ── accessibility depth ──
  'accessibility.form_label_missing': { category: 'accessibility', severity: 'warning', confidence: 0.9,
    next_action: 'Label every form field.',
    human: (f) => `${s(f.count)} form field${Number(f.count) > 1 ? 's have' : ' has'} no label a screen reader can speak (${s(f.page)}).`,
    tech: (f) => `${s(f.page)}: ${s(f.count)} input/select/textarea without label, aria-label, or aria-labelledby.` },
  'accessibility.tabindex_positive': { category: 'accessibility', severity: 'info', confidence: 1,
    next_action: 'Remove positive tabindex values; let document order rule.',
    human: (f) => `Keyboard order is forced out of reading order on ${s(f.page)}.`,
    tech: (f) => `${s(f.page)}: tabindex="${s(f.value)}" (positive) observed.` },
  'accessibility.aria_hidden_focusable': { category: 'accessibility', severity: 'warning', confidence: 0.85,
    next_action: 'Unhide the element or remove its focusable children.',
    human: (f) => `Something on ${s(f.page)} is hidden from screen readers but still keyboard-reachable.`,
    tech: (f) => `${s(f.page)}: aria-hidden="true" element contains a link or button.` },
  'accessibility.table_structure': { category: 'accessibility', severity: 'warning', confidence: 0.8,
    next_action: 'Give data tables header cells (<th>) a screen reader can announce.',
    human: (f) => `A table on ${s(f.page)} has no header cells — screen readers can’t explain what each column means.`,
    tech: (f) => `${s(f.page)}: <table> with <td> rows, no <th>, not role="presentation".` },

  // ── performance depth ──
  'performance.compression_missing': { category: 'performance', severity: 'warning', confidence: 0.9,
    next_action: 'Enable gzip/brotli compression at the host.',
    human: () => `Pages travel uncompressed — every visit downloads more than it needs to.`,
    tech: (f) => `Live response had no content-encoding (content-type ${s(f.type)}).` },
  'performance.cache_headers_missing': { category: 'performance', severity: 'info', confidence: 0.9,
    next_action: 'Set cache-control headers for static assets.',
    human: () => `Returning visitors re-download the whole site — nothing is told to cache.`,
    tech: () => `Live response carried no cache-control header.` },
  'performance.slow_response': { category: 'performance', severity: 'warning', confidence: 0.8,
    next_action: 'Investigate hosting latency.',
    human: (f) => `The site took ${s(f.ms)}ms to start answering — noticeably slow.`,
    tech: (f) => `TTFB ${s(f.ms)}ms against ${s(f.url)} (budget ${s(f.budget)}ms).` },
  'performance.cdn_absent': { category: 'performance', severity: 'info', confidence: 0.7,
    next_action: 'Serve the site through a CDN for faster loads worldwide.',
    human: () => `The site appears to load from a single location — distant visitors wait longer than they need to.`,
    tech: (f) => `No CDN edge headers and no CDN server token (server: ${s(f.server)}).` },
  'performance.lazy_loading_missing': { category: 'performance', severity: 'info', confidence: 0.8,
    next_action: 'Add loading="lazy" to below-the-fold images.',
    human: (f) => `The page ${s(f.page)} loads all ${s(f.images)} images at once — off-screen ones could wait.`,
    tech: (f) => `${s(f.page)}: ${s(f.images)} <img> elements, none with loading="lazy".` },

  // ── local presence depth ──
  'local_presence.nap_inconsistent': { category: 'local_presence', severity: 'warning', confidence: 0.9,
    next_action: 'Make name, address, and phone identical everywhere.',
    human: (f) => `The ${s(f.field)} differs between pages — directories and AI search punish disagreement.`,
    tech: (f) => `NAP field ${s(f.field)}: "${s(f.a)}" vs "${s(f.b)}" across rendered pages/draft.` },


  // ── analytics (observation of ABSENCE — no analytics integration exists) ──
  'analytics.not_connected': { category: 'analytics', severity: 'info', confidence: 1,
    next_action: 'Connect an analytics source when available.',
    human: () => `No visitor measurement is connected — traffic and conversion trends can’t be observed yet.`,
    tech: () => `No analytics destination configured for this site.` },

  // ── trust depth ──
  'trust.team_info_missing': { category: 'trust', severity: 'info', confidence: 0.8,
    next_action: 'Add a sentence about who runs the business.',
    human: () => `The site never says who’s behind the business — faces and names build trust.`,
    tech: () => `identity.story empty and no team/about content present.` },

  // ── visual assets (observation only — never generates imagery) ──
  'media.imagery_none': { category: 'media', severity: 'warning', confidence: 1,
    next_action: 'Add real photographs of the business.',
    human: () => `The site has no photographs at all — words are doing all the work.`,
    tech: () => `Zero media rows for this site.` },
  'media.og_image_missing': { category: 'media', severity: 'info', confidence: 1,
    next_action: 'Set a social-sharing image.',
    human: () => `Shared links show no picture — the site has no social-preview image.`,
    tech: (f) => `No og:image meta on ${s(f.page)}.` },

  // ── business knowledge import ──
  'knowledge.item_unlisted': { category: 'knowledge', severity: 'info', confidence: 0.8,
    next_action: 'Add the item to the website, or confirm it’s gone.',
    human: (f) => `“${s(f.name)}” appears in ${s(f.doc)} but isn’t on the website.`,
    tech: (f) => `Document item "${s(f.name)}" (${s(f.price)}) has no matching offering.` },
  'knowledge.price_mismatch': { category: 'knowledge', severity: 'warning', confidence: 0.85,
    next_action: 'Decide which price is right and fix the other.',
    human: (f) => `“${s(f.name)}” is ${s(f.doc_price)} in ${s(f.doc)} but ${s(f.site_price)} on the website.`,
    tech: (f) => `Price disagreement for "${s(f.name)}": document ${s(f.doc_price)} vs site ${s(f.site_price)}.` },
  'knowledge.phone_mismatch': { category: 'knowledge', severity: 'warning', confidence: 0.85,
    next_action: 'Make the document and the website agree on the phone number.',
    human: (f) => `${s(f.doc)} shows ${s(f.doc_phone)}, but the website says ${s(f.site_phone)}.`,
    tech: (f) => `Document phone ${s(f.doc_phone)} ≠ identity phone ${s(f.site_phone)}.` },
  'knowledge.hours_available': { category: 'knowledge', severity: 'info', confidence: 0.7,
    next_action: 'Copy the hours from the document into the site.',
    human: (f) => `${s(f.doc)} mentions opening hours, but the website’s hours are empty.`,
    tech: (f) => `Document contains ${s(f.count)} hour-like lines; draft hours are unset.` },
};
