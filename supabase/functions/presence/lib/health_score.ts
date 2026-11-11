// ── A site's health, kept day by day (builder list items 129, 180 and 183, Nov 2026) ──
// The evidence engine checks every site through the day and keeps each run
// (evidence/engine.ts). This turns one run's problems into what the Sites page and
// the Search tab's Website health show, and what presence_health_days keeps once a
// day (the last run of a day wins):
//   • the things to look at: each problem TYPE that is critical or a warning, once,
//     with how many pages or parts it touches. Ideas (the `info` items) aren't counted;
//   • a 0 to 100 number for the studio's Sites page. Law 13 (constitution 05 §12): a
//     client never sees a score, only how many things there are to look at and what
//     they are, so the number stays on studio pages;
//   • the fingerprints (site|type|resource), so a later day can say what was fixed
//     and what is new.
// Pure.

/** What one critical or warning problem type costs the studio's number. */
export const HEALTH_WEIGHTS = { critical: 12, warning: 4 } as const;

/** Facts about where a site is, not problems with it: a site we don't host, or one
 *  not published yet. They never count. */
export const STATE_TYPES: ReadonlySet<string> = new Set(['website.not_live', 'website.hosting_missing']);

export type HeadingKey = 'reach' | 'speed' | 'google' | 'everyone' | 'words' | 'links' | 'business';

/** The plain headings problems sit under, in the order the Search tab shows them. */
export const HEADINGS: ReadonlyArray<{ key: HeadingKey; title: string }> = [
  { key: 'reach', title: 'Can people reach it' },
  { key: 'speed', title: 'Speed' },
  { key: 'google', title: 'Google can read it' },
  { key: 'everyone', title: 'Everyone can use it' },
  { key: 'words', title: 'Words and pictures' },
  { key: 'links', title: 'Links' },
  { key: 'business', title: 'Business details' },
];

const CATEGORY_HEADING: Record<string, HeadingKey> = {
  website: 'reach', infrastructure: 'reach',
  performance: 'speed',
  seo: 'google', structured_data: 'google', metadata: 'google', aeo: 'google', analytics: 'google',
  accessibility: 'everyone',
  content: 'words', media: 'words', freshness: 'words',
  links: 'links',
  business_info: 'business', trust: 'business', local_presence: 'business', knowledge: 'business', reviews: 'business', conversion: 'business',
};

/** Which plain heading a problem type sits under. The padlock is about reaching the
 *  site, though its category is trust. */
export function headingOf(type: string): HeadingKey {
  if (type === 'trust.ssl_missing') return 'reach';
  return CATEGORY_HEADING[String(type).split('.')[0]] || 'business';
}

/** A short title for each problem type that can count, in the owner's words. A
 *  type added to the catalog without one falls back to its run's own sentence
 *  (health_score_test.mjs fails until it has one). */
export const TYPE_TITLES: Record<string, string> = {
  'website.hosting_missing': 'The site isn’t hosted with us yet',
  'website.live_fetch_failed': 'The live site couldn’t be read',
  'website.http_status': 'The site answers with an error',
  'seo.title_missing': 'Pages without a title for Google',
  'seo.title_duplicate': 'Pages sharing the same title',
  'seo.description_missing': 'Pages without a search description',
  'seo.robots_missing': 'No robots.txt file for search engines',
  'seo.sitemap_missing': 'No sitemap for Google',
  'seo.h1_missing': 'Pages without a main heading',
  'seo.robots_blocks_all': 'Search engines are told to stay away',
  'seo.duplicate_page': 'Two pages that say the same thing',
  'seo.noindex': 'Pages hidden from Google',
  'accessibility.img_alt_missing': 'Photos without a description',
  'accessibility.lang_missing': 'Pages that don’t say their language',
  'accessibility.form_label_missing': 'Form boxes without a label',
  'accessibility.aria_hidden_focusable': 'Hidden parts a keyboard can still reach',
  'accessibility.table_structure': 'Tables without heading cells',
  'performance.image_oversized': 'Photos bigger than they need to be',
  'performance.compression_missing': 'Pages sent without compression',
  'performance.slow_response': 'The site is slow to answer',
  'structured_data.ldjson_invalid': 'Business details for Google that don’t read',
  'structured_data.schema_missing': 'No business details written for Google',
  'business_info.identity_incomplete': 'Business details are missing',
  'business_info.hours_incomplete': 'Opening hours aren’t set for every day',
  'business_info.address_incomplete': 'The address isn’t complete',
  'business_info.closed_longstanding': 'A closed notice has been up a long time',
  'business_info.phone_mismatch': 'Two different phone numbers',
  'business_info.home_services_service_area_missing': 'No list of the areas served',
  'links.internal_broken': 'Links to pages that aren’t there',
  'links.redirect_to_missing': 'Forwards to pages that aren’t there',
  'trust.ssl_missing': 'The padlock is missing',
  'trust.contact_missing': 'No phone or email on the site',
  'trust.hours_not_public': 'Opening hours aren’t on the site yet',
  'infrastructure.dns_apex_unresolved': 'The domain doesn’t point at the site',
  'infrastructure.dns_www_unresolved': 'The www address doesn’t work',
  'infrastructure.domain_expiring': 'The domain is about to run out',
  'infrastructure.http_not_redirected': 'The plain http address doesn’t move to the secure one',
  'infrastructure.spf_missing': 'Email from the domain may land in spam: no SPF record',
  'infrastructure.dmarc_missing': 'Email from the domain may land in spam: no DMARC record',
  'local_presence.nap_inconsistent': 'Name, address or phone differ between places',
  'media.imagery_none': 'No photos of the business',
  'knowledge.price_mismatch': 'Two different prices for the same thing',
  'knowledge.phone_mismatch': 'A document and the site disagree on the phone number',
  'reviews.connected_rating_low': 'Recent reviews are low',
  'content.restaurant_menu_absent': 'No menu on the site',
  'content.pet_grooming_services_unlisted': 'Grooming services aren’t listed',
};

/** The title for a type, or the run's own sentence when the type has none. */
export function titleOf(type: string, fallback?: string | null): string {
  return TYPE_TITLES[type] || String(fallback || '').trim() || 'Something to look at';
}

export interface HealthItem { type: string; severity: string; fingerprint?: string | null; resource?: string | null }
export interface HealthIssue { type: string; severity: 'critical' | 'warning'; n: number; heading: HeadingKey }
export interface HealthDay {
  score: number;              // 0 to 100, for studio pages only
  critical: number;           // problem types that are critical
  warning: number;            // problem types that are warnings
  issues: HealthIssue[];      // the things to look at, critical first, then the most pages
  fingerprints: string[];     // every failing item, for fixed and new
}

/** Does a problem type count for this site? State never does; "hidden from Google"
 *  is what a site not published yet, or hidden on purpose, is meant to be. */
export function counts(type: string, o: { live: boolean; hidden?: boolean }): boolean {
  if (STATE_TYPES.has(type)) return false;
  if (type === 'seo.noindex' && (!o.live || o.hidden)) return false;
  return true;
}

/** One run's items as the day's health. Pure. */
export function healthOf(items: HealthItem[], o: { live: boolean; hidden?: boolean }): HealthDay {
  const byType = new Map<string, HealthIssue>();
  const fps = new Set<string>();
  for (const it of items || []) {
    const sev = it?.severity;
    if (sev !== 'critical' && sev !== 'warning') continue;
    const type = String(it.type || '');
    if (!type || !counts(type, o)) continue;
    const cur = byType.get(type);
    if (cur) { cur.n++; if (sev === 'critical') cur.severity = 'critical'; }
    else byType.set(type, { type, severity: sev, n: 1, heading: headingOf(type) });
    if (it.fingerprint) fps.add(String(it.fingerprint));
  }
  const issues = [...byType.values()].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1) || b.n - a.n || a.type.localeCompare(b.type));
  const critical = issues.filter((i) => i.severity === 'critical').length;
  const warning = issues.length - critical;
  const score = Math.max(0, 100 - HEALTH_WEIGHTS.critical * critical - HEALTH_WEIGHTS.warning * warning);
  return { score, critical, warning, issues, fingerprints: [...fps].sort() };
}

/** What changed between two days, by fingerprint: fixed ones were failing before and
 *  aren't now; new ones weren't failing before. Pure. */
export function sinceThen(before: readonly string[] | null | undefined, now: readonly string[] | null | undefined): { fixed: string[]; added: string[] } {
  const b = new Set(before || []), n = new Set(now || []);
  return { fixed: [...b].filter((f) => !n.has(f)).sort(), added: [...n].filter((f) => !b.has(f)).sort() };
}

/** The type part of a fingerprint (site|type|resource). */
export const typeOfFingerprint = (fp: string): string => String(fp || '').split('|')[1] || '';
