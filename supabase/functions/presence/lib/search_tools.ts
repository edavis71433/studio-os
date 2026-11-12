// ── The Search tab's tools and to-do list (builder list items 124 and 181, Nov 2026) ──
// Wix's SEO Assistant ranks plain tasks Critical, High and Medium with a done dot; its
// dashboard lists the pages that moved most; Squarespace and Wix both offer an
// editable llms.txt; Wix keeps a row of tools. This is ours, pure:
//   • Hide from search (settings.search_hidden, migration 0171): every page says
//     noindex. robots.txt stays open on purpose: a search engine has to read a page
//     to see its noindex, and a blocked page can still be listed by its address;
//   • llms.txt (settings.llms_txt, 0171): the owner's own words for AI tools, written
//     at /llms.txt on the next publish; a first draft comes from the business details.
//     The old docs (FD-Z3) said watch, don't build; list item 124 asks for it;
//   • the to-do list, from what the Search tab and the health check already know;
//   • the pages that moved most on Google, last month against the month before;
//   • the searches a client follows (item 181), up to ten, kept on the site.
import type { FileMap } from './render_types.ts';
import { TYPE_TITLES, headingOf } from './health_score.ts';

export const LLMS_TXT_MAX = 4000;

/** The drawn site with the owner's Search choices applied. Unchanged (the same object)
 *  when neither is set, so a site without them draws byte for byte as before. */
export function withSearchChoices(files: FileMap, settings: { search_hidden?: boolean; llms_txt?: string } | undefined): FileMap {
  const hidden = settings?.search_hidden === true;
  const llms = String(settings?.llms_txt || '').trim();
  if (!hidden && !llms) return files;
  const out: FileMap = { ...files };
  if (hidden) {
    for (const [path, body] of Object.entries(out)) {
      if (!/\.html$/.test(path) || typeof body !== 'string') continue;
      if (/<meta\s+name=["']robots["'][^>]*noindex/i.test(body)) continue;
      out[path] = body.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n<meta name="robots" content="noindex">`);
    }
  }
  if (llms) out['llms.txt'] = llms.slice(0, LLMS_TXT_MAX) + '\n';
  return out;
}

export interface LlmsFacts {
  name: string; origin: string; description?: string | null; city?: string | null; region?: string | null;
  phone?: string | null; email?: string | null; street?: string | null; postal?: string | null;
  pages?: Array<{ title: string; path: string }>;
}
/** A first llms.txt from the business details, in the shape llmstxt.org describes:
 *  the name, a one-line summary, then contact and pages as lists. Pure. */
export function draftLlmsTxt(f: LlmsFacts): string {
  const clean = (s: unknown) => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  const name = clean(f.name) || 'Our business';
  const where = [clean(f.city), clean(f.region)].filter(Boolean).join(', ');
  const lines = [`# ${name}`, ''];
  const summary = clean(f.description) || (where ? `${name} in ${where}.` : `${name}.`);
  lines.push(`> ${summary}`, '');
  const contact = [
    clean(f.phone) && `- Phone: ${clean(f.phone)}`,
    clean(f.email) && `- Email: ${clean(f.email)}`,
    (clean(f.street) || where) && `- Address: ${[clean(f.street), where, clean(f.postal)].filter(Boolean).join(', ')}`,
  ].filter(Boolean) as string[];
  if (contact.length) lines.push('## Contact', ...contact, '');
  const origin = String(f.origin || '').replace(/\/$/, '');
  const pages = (f.pages || []).filter((p) => clean(p.title) && /^\/[a-z0-9/_-]*$/i.test(p.path)).slice(0, 30);
  if (origin && pages.length) lines.push('## Pages', ...pages.map((p) => `- [${clean(p.title)}](${origin}${p.path})`), '');
  return lines.join('\n').trim().slice(0, LLMS_TXT_MAX);
}

// ── the to-do list ──
export type Priority = 'critical' | 'high' | 'medium';
export interface SearchTask { key: string; priority: Priority; done: boolean; title: string; sub: string; go: string | null }
export interface SearchFacts {
  edition: string;                 // 'presence' (we host it) or 'monitor' (we watch it)
  live: boolean;                   // published, or watched where it already lives
  customDomain: boolean;
  hidden: boolean;
  console: boolean;                // Search Console connected
  listing: boolean;                // Google listing connected
  title: boolean; description: boolean;   // the home page's search wording
  llms: boolean;
  followed: number;
  issues: Array<{ type: string; severity: string; n: number }> | null;   // today's health problems
  review: Array<{ title: string; priority: string; fix?: string }> | null;   // the Site Review's findings
  phrases?: Array<{ phrase: string; found: boolean }>;   // builder list item 160: what people type to find you, each in a page headline or not
}
const RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2 };
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('{n}', String(n)));

/** One High task per phrase the business wants to be found for (builder list item 160),
 *  done when some page's search headline has it. The Search tab's phrases card rebuilds
 *  these after a change without reading the whole tab again. Pure. */
export function phraseTasks(phrases: Array<{ phrase: string; found: boolean }>): SearchTask[] {
  return phrases.map((p) => ({ key: `phrase:${p.phrase}`, priority: 'high' as Priority, done: p.found, title: `Put “${p.phrase}” in a page’s search headline`,
    sub: p.found ? '' : 'Google reads the headline first. Pick the page that is about it.', go: p.found ? null : 'phrases' }));
}

/** The Search tab's to-do list: open tasks first, Critical, High, then Medium; the
 *  checklist's finished tasks after them, each with its done dot. Only true things:
 *  a task shows when its fact says so. Pure. */
export function searchTasks(f: SearchFacts): SearchTask[] {
  const t: SearchTask[] = [];
  const add = (key: string, priority: Priority, done: boolean, title: string, sub: string, go: string | null) => t.push({ key, priority, done, title, sub, go });
  const hosted = f.edition !== 'monitor';
  if (hosted) add('publish', 'critical', f.live, f.live ? 'Your site is published' : 'Publish your site so Google can find it', f.live ? '' : 'Nothing is on Google until the site is live.', f.live ? null : 'publish');
  else if (!f.live) add('address', 'critical', false, 'Tell us your website’s address', 'Search Console and the checks need to know where it lives.', 'monitor');
  if (f.hidden) add('hidden', 'critical', false, 'Let search engines list this site', 'It is hidden from search on purpose. Switch it back on when you’re ready to be found.', 'tool:hide');
  for (const i of f.issues || []) {
    if (i.severity !== 'critical' || !['google', 'reach', 'links'].includes(headingOf(i.type))) continue;
    add(`health:${i.type}`, 'critical', false, TYPE_TITLES[i.type] || 'A problem Google will notice', plural(i.n, 'On one page or part.', 'On {n} pages or parts.'), 'health');
  }
  add('console', 'high', f.console, 'Connect Google Search Console', f.console ? '' : 'See what people search to find you, and what they click.', f.console ? null : 'connect:console');
  if (hosted) add('domain', 'high', f.customDomain, 'Put the site on your own domain', f.customDomain ? '' : 'Google trusts yourbusiness.com more than a built-in address.', f.customDomain ? null : 'domain');
  add('title', 'high', f.title, 'Add a search headline', f.title ? '' : 'The blue words people click on Google.', f.title ? null : 'wording');
  // builder list item 160: each phrase the business wants to be found for, in some page's headline
  t.push(...phraseTasks(f.phrases || []));
  add('description', 'high', f.description, 'Add a search description', f.description ? '' : 'The line under the headline. Google writes its own when there is none.', f.description ? null : 'wording');
  const desc = (f.issues || []).find((i) => i.type === 'seo.description_missing');
  if (desc) add('health:seo.description_missing', 'high', false, plural(desc.n, 'Add a search description to one more page', 'Add a search description to {n} pages'), 'Each page’s settings button on the Pages tab.', 'pages');
  for (const r of (f.review || []).slice(0, 6)) {
    if (!r.title) continue;
    add(`review:${r.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`, /now/i.test(r.priority) ? 'high' : 'medium', false, r.title, String(r.fix || ''), 'review');
  }
  add('listing', 'medium', f.listing, 'Connect your Google listing', f.listing ? '' : 'Your reviews, calls and directions, here.', f.listing ? null : 'connect:listing');
  const alt = (f.issues || []).find((i) => i.type === 'accessibility.img_alt_missing');
  if (alt) add('health:accessibility.img_alt_missing', 'medium', false, plural(alt.n, 'Describe one photo for Google', 'Describe {n} photos for Google'), 'Alt text, in Files. Google can’t see pictures.', 'files');
  for (const i of f.issues || []) {
    if (i.severity !== 'warning' || headingOf(i.type) !== 'google' || i.type === 'seo.description_missing' || (i.type === 'seo.noindex' && f.hidden)) continue;
    add(`health:${i.type}`, 'medium', false, TYPE_TITLES[i.type] || 'Something Google will notice', plural(i.n, 'On one page or part.', 'On {n} pages or parts.'), 'health');
  }
  add('llms', 'medium', f.llms, 'Write your llms.txt for AI tools', f.llms ? '' : 'A short file that tells ChatGPT and Claude what you do.', f.llms ? null : 'tool:llms');
  if (f.console) add('follow', 'medium', f.followed > 0, 'Follow the searches that matter', f.followed > 0 ? '' : 'Pick up to ten and see your place on Google month by month.', f.followed > 0 ? null : 'follow');
  return t.filter((x, n) => t.findIndex((y) => y.key === x.key) === n)
    .sort((a, b) => Number(a.done) - Number(b.done) || RANK[a.priority] - RANK[b.priority]);
}

// ── the pages that moved most ──
export interface PageClicks { path: string; clicks: number }
export interface PageMove { path: string; clicks: number; prior: number; delta: number }
/** Last month's pages against the month before's, by clicks: the three that rose most
 *  and the three that fell most. A page in only one month counts zero in the other. Pure. */
export function pageMovers(now: PageClicks[], before: PageClicks[], max = 3): { up: PageMove[]; down: PageMove[] } {
  const a = new Map(now.map((p) => [p.path, Number(p.clicks) || 0]));
  const b = new Map(before.map((p) => [p.path, Number(p.clicks) || 0]));
  const all = [...new Set([...a.keys(), ...b.keys()])].map((path) => ({ path, clicks: a.get(path) || 0, prior: b.get(path) || 0, delta: (a.get(path) || 0) - (b.get(path) || 0) }));
  return {
    up: all.filter((m) => m.delta > 0).sort((x, y) => y.delta - x.delta || x.path.localeCompare(y.path)).slice(0, max),
    down: all.filter((m) => m.delta < 0).sort((x, y) => x.delta - y.delta || x.path.localeCompare(y.path)).slice(0, max),
  };
}

// ── searches to follow (item 181) ──
export const FOLLOW_MAX = 10;
export interface Followed { term: string; added_at: string; added_by: string | null }
/** One search as Search Console spells queries: lower case, single spaces, no
 *  control characters, at most 100 long. Empty when nothing is left. Pure. */
export function followTerm(v: unknown): string {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 100);
}
/** The stored list, cleaned: each search once, at most ten, oldest first. Pure. */
export function normalizeFollowed(raw: unknown): { terms: Followed[] } {
  const list = Array.isArray((raw as { terms?: unknown })?.terms) ? (raw as { terms: unknown[] }).terms : [];
  const seen = new Set<string>(); const terms: Followed[] = [];
  for (const x of list) {
    const term = followTerm((x as { term?: unknown })?.term);
    if (!term || seen.has(term)) continue;
    seen.add(term);
    terms.push({ term, added_at: String((x as { added_at?: unknown })?.added_at || ''), added_by: (x as { added_by?: unknown })?.added_by ? String((x as { added_by: unknown }).added_by) : null });
    if (terms.length >= FOLLOW_MAX) break;
  }
  return { terms };
}
/** A save: the asked-for searches in order, keeping when each was first followed. Pure. */
export function applyFollow(cur: { terms: Followed[] }, asked: unknown, who: string | null, nowIso: string): { terms: Followed[]; added: string[] } | { error: string } {
  if (!Array.isArray(asked)) return { error: 'Say which searches to follow, as a list.' };
  const wanted = [...new Set(asked.map(followTerm).filter(Boolean))];
  if (wanted.length > FOLLOW_MAX) return { error: `Up to ${FOLLOW_MAX} searches. Stop following one first.` };
  const had = new Map(cur.terms.map((t) => [t.term, t]));
  const terms = wanted.map((term) => had.get(term) || { term, added_at: nowIso, added_by: who });
  return { terms, added: wanted.filter((w) => !had.has(w)) };
}
export interface TermMonth { period: string; clicks: number; impressions: number; position: number | null }
/** Each followed search with its months, oldest first, and the last two compared.
 *  A month the search didn't appear in is missing, never a zero place. Pure. */
export function followedSeries(terms: Followed[], rows: Array<{ key: string; period: string; clicks: number; impressions: number; position: number | null }>, month: string, prior: string) {
  return terms.map((t) => {
    const months = rows.filter((r) => r.key === t.term).map((r) => ({ period: r.period, clicks: Number(r.clicks) || 0, impressions: Number(r.impressions) || 0, position: typeof r.position === 'number' ? Math.round(r.position * 10) / 10 : null }))
      .sort((a, b) => a.period.localeCompare(b.period)).slice(-6);
    const at = (p: string) => months.find((m) => m.period === p) || null;
    return { term: t.term, added_at: t.added_at, months, now: at(month), prior: at(prior) };
  });
}
