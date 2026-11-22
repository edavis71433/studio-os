// ── Is this website live? ONE rule, worked out on the server ─────────────────
// Builder list item 261 (full review of Nov 22, 2026): the editor called a site "Live"
// as soon as it had an address, Sites called it live once it was published, Health
// Center counted a third way, and the blog's Publish menu had its own. Now every page
// reads the same answer, made here:
//   published once  the site has a published version (status live, or a publish on
//                   record), the question most pages ask ("can anyone visit it?");
//   live now        published once AND not taken offline AND its address answering
//                   the uptime probe (monitor/heartbeat.ts), the word on a card.
// Sites and Home draw siteState; GET /site hands the editor the same (`live`), so the
// bar's "Live" and "See live site" follow it instead of the address.
/** Two misses in a row of the 15-minute uptime probe (monitor/heartbeat.ts) is "not answering". */
export const DOWN_THRESHOLD = 2;

export interface LiveFacts { edition?: string | null; status?: string | null; last_published_at?: string | null }
export interface SiteExtra { id: string; client_id?: string | null; netlify_site_id?: string | null; offline_at?: string | null; uptime_ok?: boolean | null; uptime_fail_streak?: number | null; domain_checked_at?: string | null; template_slug?: string | null; created_at?: string | null }
export type StateKey = 'live' | 'not_live' | 'elsewhere' | 'offline' | 'down' | 'paused';
const STATE_WORDS: Record<StateKey, string> = { live: 'Live', not_live: 'Not live yet', elsewhere: 'Hosted elsewhere', offline: 'Offline', down: 'Not answering', paused: 'Paused' };

/** Has this site ever been published? Status live, or a publish on record. A watched
 *  site on someone else's host is their business: false here (callers that treat a
 *  watch plan as live say so themselves). Pure. */
export function publishedOnce(p: LiveFacts | null | undefined): boolean {
  return !!p && (p.status === 'live' || !!p.last_published_at);
}

/** Home's rule (agency.html statusWord) for live, not live yet and hosted elsewhere,
 *  plus the three facts only the website knows: taken offline, not answering the uptime
 *  probe (two misses in a row, monitor/heartbeat.ts), paused. Pure. */
export function siteState(p: LiveFacts, x?: SiteExtra | null, comingSoon = false): { key: StateKey; words: string } {
  const at = (key: StateKey) => ({ key, words: STATE_WORDS[key] });
  if (p.edition === 'monitor') return at('elsewhere');
  if (p.status === 'paused') return at('paused');
  // builder list item 158: still not live, but its address shows a Coming soon page, so the card says so
  if (!publishedOnce(p)) return comingSoon ? { key: 'not_live', words: 'Coming soon' } : at('not_live');
  if (x?.offline_at) return at('offline');
  if ((Number(x?.uptime_fail_streak) || 0) >= DOWN_THRESHOLD) return at('down');
  return at('live');
}

/** What the editor and the portal read: the state, its words, and the two plain answers.
 *  `is_live` is "visitors can reach it right now"; `published` is "it has gone live once". Pure. */
export function siteLive(p: LiveFacts, x?: SiteExtra | null): { key: StateKey; words: string; is_live: boolean; published: boolean } {
  const s = siteState(p, x);
  return { ...s, is_live: s.key === 'live', published: p.edition !== 'monitor' && publishedOnce(p) };
}
