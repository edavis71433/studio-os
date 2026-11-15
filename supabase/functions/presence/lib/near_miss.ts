// ── Almost on page one (builder list item 219, Nov 2026) ──────────────────────
// Wix's site home says "Push 5 near-miss searches onto page one". The Search tab lists
// the searches where Google showed a client's site at places 8 to 20 last month: the
// bottom of page one or the top of page two, where a small change to the right page
// moves it most. Each comes with the page Google showed (Search Console's search and
// page pairs, kept by the daily sync as 'query_page', migration 0220) and one thing to
// fix on it, checked against that page's own search headline, never guessed:
//   hidden       the page is hidden from Google
//   title        its search headline doesn't have the search's words (named)
//   description  the headline has them; the page uses the site's general description
//   already      both are there; links from other sites and reviews help most
//   check        a page we can't read (a site hosted elsewhere, a blog post)
// Everything here is pure.
import { splitPairKey } from './gsc.ts';
import { searchWords, sameWord, type Headline } from './search_phrases.ts';

export const NEAR_FROM = 8, NEAR_TO = 20;
export const NEAR_MIN_SEEN = 5;   // a search Google showed fewer times than this in a month is noise
export const NEAR_MAX = 10;

export interface PairRow { key: string; clicks: number; impressions: number; position: number | null }
export type NearFix = 'hidden' | 'title' | 'description' | 'already' | 'check';
export interface NearMiss {
  term: string;
  place: number;              // Google's average place for the month, to one decimal
  prior_place: number | null; // the month before, when it was seen then
  seen: number; clicks: number;
  path: string;               // the page Google showed most for it
  page: string;               // its name: Home, About, or the page's own title
  key: string | null;         // its search settings key (home, offerings, page:slug), when it has one
  fix: NearFix; words: string;
}

const hostOf = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const pathOf = (u: string) => { try { const p = new URL(u).pathname || '/'; return p.endsWith('/') || /\.[a-z0-9]{2,5}$/i.test(p) ? p : p + '/'; } catch { return ''; } };

/** The search settings key of a page on a site built here, from its address: the home
 *  page, the template's own pages, or an owner's page. Null for anything else (a blog
 *  post, a file). Pure. */
export function pageKeyOf(path: string, offeringPath: string): string | null {
  const p = String(path || '');
  if (p === '/') return 'home';
  if (p === offeringPath) return 'offerings';
  const own: Record<string, string> = { '/about/': 'about', '/faq/': 'faq', '/updates/': 'updates', '/contact/': 'contact' };
  if (own[p]) return own[p];
  const m = p.match(/^\/([a-z0-9][a-z0-9-]*)\/$/);
  return m ? `page:${m[1]}` : null;
}

/** One search's place over its pages, weighted by how often each was shown. */
function folded(rows: Array<{ page: string; impressions: number; clicks: number; position: number }>) {
  const seen = rows.reduce((a, r) => a + r.impressions, 0);
  const clicks = rows.reduce((a, r) => a + r.clicks, 0);
  const place = seen ? rows.reduce((a, r) => a + r.position * r.impressions, 0) / seen : rows[0].position;
  const top = rows.slice().sort((a, b) => b.impressions - a.impressions || a.position - b.position)[0];
  return { seen, clicks, place: Math.round(place * 10) / 10, page: top.page };
}

/** The month's pairs grouped by search, on this site's own address only. */
function bySearch(rows: PairRow[] | null, host: string) {
  const out = new Map<string, Array<{ page: string; impressions: number; clicks: number; position: number }>>();
  for (const r of rows || []) {
    const kv = splitPairKey(r.key);
    if (!kv || typeof r.position !== 'number') continue;
    if (host && hostOf(kv.page) !== host) continue;   // a Domain property also lists other addresses (app., shop.)
    const list = out.get(kv.query) || [];
    list.push({ page: kv.page, impressions: Number(r.impressions) || 0, clicks: Number(r.clicks) || 0, position: r.position });
    out.set(kv.query, list);
  }
  return out;
}

const quoteWords = (ws: string[]) => `“${ws.join(' ')}”`;

/** What to fix on the page Google showed for a search, from the page's own headline. Pure. */
export function fixFor(term: string, i: { key: string | null; headline: Headline | null; hidden: Set<string>; ownDescription: boolean; readable: boolean }): { fix: NearFix; words: string } {
  const check = { fix: 'check' as const, words: `Check the page’s title on Google says ${quoteWords(searchWords(term))}.` };
  if (!i.readable || !i.key) return check;
  if (i.key !== 'home' && i.hidden.has(i.key)) return { fix: 'hidden', words: 'This page is hidden from Google. Showing it again comes first.' };
  if (!i.headline) return check;
  const have = searchWords(i.headline.title);
  const missing = searchWords(term).filter((w) => !have.some((x) => sameWord(w, x)));
  if (missing.length) return { fix: 'title', words: `The page’s title on Google doesn’t say ${quoteWords(missing.slice(0, 3))}.` };
  if (!i.ownDescription) return { fix: 'description', words: 'Its title says it. Give the page its own search description that says it too.' };
  return { fix: 'already', words: 'Its title and description already say it. Links from other websites and more reviews help most.' };
}

/** The searches just off page one, most seen first. `pairs`/`prior` are the month's and
 *  the month before's 'query_page' rows; `origin` the site's address (its pages only);
 *  `headlines` every page's search headline (null for a site we don't build). Pure. */
export function nearMisses(i: {
  pairs: PairRow[] | null; prior: PairRow[] | null; origin: string;
  headlines: Headline[] | null; hidden: string[]; ownDescriptions: string[]; offeringPath: string;
}): NearMiss[] {
  const host = hostOf(i.origin);
  const now = bySearch(i.pairs, host), was = bySearch(i.prior, host);
  const heads = new Map((i.headlines || []).map((h) => [h.key, h]));
  const hidden = new Set(i.hidden), own = new Set(i.ownDescriptions);
  const out: NearMiss[] = [];
  for (const [term, rows] of now) {
    const f = folded(rows);
    if (f.seen < NEAR_MIN_SEEN || f.place < NEAR_FROM - 0.5 || f.place >= NEAR_TO + 0.5) continue;
    const path = pathOf(f.page) || '/';
    const key = i.headlines ? pageKeyOf(path, i.offeringPath) : null;
    const headline = key ? heads.get(key) || null : null;
    const before = was.get(term);
    out.push({
      term, place: f.place, prior_place: before ? folded(before).place : null, seen: f.seen, clicks: f.clicks,
      path, page: headline ? headline.label : (path === '/' ? 'Home' : path), key,
      ...fixFor(term, { key, headline, hidden, ownDescription: key ? own.has(key) : false, readable: !!i.headlines }),
    });
  }
  return out.sort((a, b) => b.seen - a.seen || a.place - b.place || a.term.localeCompare(b.term)).slice(0, NEAR_MAX);
}
