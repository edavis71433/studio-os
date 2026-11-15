// ── Why visits fell (builder list item 219, Nov 2026) ─────────────────────────
// Wix's site home says "Find out why direct traffic dropped 70%". A drop in visits here
// showed only as a red number. Now it comes with its likely reason, in a sentence,
// wherever it shows (the Sites table, the Search tab, the monthly report), from what
// is already counted: where each visit came from (the visit counter keeps the
// referrer's host and any utm tag, migration 0066) and, for Google, which searches
// brought fewer clicks (Search Console's month by search, 0067). Nothing is guessed:
// a drop too small to explain says nothing more, and one spread thin says so.
import { svc } from './db.ts';
import { aiAssistantOf } from './visits.ts';
import { searchWords } from './search_phrases.ts';

export type Channel = 'google' | 'search' | 'direct' | 'social' | 'ai' | 'links' | 'sites';
// name: a row's label; from: in a sentence ("came from …"); fewer: the line under a red number
export const CHANNEL_WORDS: Record<Channel, { name: string; from: string; fewer: string }> = {
  google: { name: 'Google searches', from: 'Google searches', fewer: 'fewer Google searches' },
  search: { name: 'Other search engines', from: 'Bing and other search engines', fewer: 'fewer visits from Bing and other search engines' },
  direct: { name: 'Straight to the site', from: 'people coming straight to the site', fewer: 'fewer visits straight to the site' },
  social: { name: 'Social media', from: 'social media', fewer: 'fewer visits from social media' },
  ai: { name: 'AI assistants', from: 'AI assistants', fewer: 'fewer visits from AI assistants' },
  links: { name: 'Your own links', from: 'your own links (emails, ads, QR codes)', fewer: 'fewer visits from your own links (emails, ads, QR codes)' },
  sites: { name: 'Other websites', from: 'other websites', fewer: 'fewer visits from other websites' },
};
/** A drop is explained once the month before had this many visits and this month fell
 *  by at least this much: below that a few visits either way say nothing. */
export const DROP_MIN_WAS = 20, DROP_MIN_PCT = 10;
/** Search Console keeps a month's top 25 searches (ops/gsc_sync.ts). */
export const TOP_TERMS = 25;

const OTHER_SEARCH = /(^|\.)(bing|duckduckgo|yahoo|ecosia|yandex|baidu|startpage|qwant)\.|(^|\.)search\.brave\.com$/;
const SOCIAL = /(^|\.)(facebook|fb|instagram|linkedin|lnkd|pinterest|tiktok|youtube|reddit|nextdoor|threads|twitter|snapchat|whatsapp)\.|(^|\.)(t\.co|x\.com|fb\.me)$/;

/** Which way a visit came, from its referrer's host and utm tag. Pure. */
export function channelOf(refHost: string, utmSource: string): Channel {
  const h = String(refHost || '').trim().toLowerCase().replace(/^www\./, ''), u = String(utmSource || '').trim();
  if (aiAssistantOf(h, u)) return 'ai';
  if (u) return 'links';
  if (!h) return 'direct';
  if (/(^|\.)google\.[a-z.]+$/.test(h)) return 'google';
  if (OTHER_SEARCH.test(h)) return 'search';
  if (SOCIAL.test(h)) return 'social';
  return 'sites';
}

export interface SourceRow { ref_host: string; utm_source: string; visits: number }
export interface TermRow { key: string; clicks: number }
export interface VisitDrop {
  pct: number; now: number; was: number;
  short: string;        // the line under a red number: "Mostly fewer Google searches"
  sentence: string;     // the reason in full
  parts: Array<{ channel: Channel; name: string; now: number; was: number; change: number }>;
  search: { term: string; now: number; was: number; own_name: boolean } | null;
}

const n1 = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, w: string) => `${n1(n)} ${w}${n === 1 ? '' : 's'}`;

/** The search that lost the most clicks from one month to the next. A search missing from
 *  this month's list counts as none only when the list is shorter than Search Console's top
 *  25, so every search with a click is in it; otherwise it can't be known and is passed. */
export function biggestLoss(now: TermRow[] | null, was: TermRow[] | null): { term: string; now: number; was: number } | null {
  if (!now || !was) return null;
  const nowBy = new Map(now.map((t) => [t.key, Number(t.clicks) || 0]));
  let best: { term: string; now: number; was: number } | null = null;
  for (const t of was) {
    const before = Number(t.clicks) || 0;
    const after = nowBy.has(t.key) ? nowBy.get(t.key)! : now.length < TOP_TERMS ? 0 : null;
    if (after === null || after >= before) continue;
    if (!best || before - after > best.was - best.now) best = { term: t.key, now: after, was: before };
  }
  return best;
}

/** True when a search names the business: every word of its name is in it ("maple and main
 *  realty" for Maple & Main Realty). Pure. */
export function namesBusiness(term: string, name: string): boolean {
  const want = searchWords(name).filter((w) => w.length > 1);
  if (!want.length) return false;
  const have = new Set(searchWords(term));
  return want.every((w) => have.has(w));
}

/** Why visits fell from one month to the next, or null when they didn't fall enough to say.
 *  `sources*` are visits by referrer host and utm tag (null when unread); `terms*` the
 *  months' top searches from Search Console (null when not connected). Pure. */
export function visitDrop(i: {
  now: number; was: number; wasLabel: string;
  sourcesNow: SourceRow[] | null; sourcesWas: SourceRow[] | null;
  termsNow?: TermRow[] | null; termsWas?: TermRow[] | null; name?: string | null;
}): VisitDrop | null {
  const now = Math.max(0, Number(i.now) || 0), was = Math.max(0, Number(i.was) || 0);
  if (was < DROP_MIN_WAS || now >= was) return null;
  const pct = Math.round((was - now) / was * 100);
  if (pct < DROP_MIN_PCT) return null;
  const head = `${n1(now)} visits, against ${n1(was)} in ${i.wasLabel}.`;
  if (!i.sourcesNow || !i.sourcesWas) return { pct, now, was, short: '', sentence: head, parts: [], search: null };
  const sum = (rows: SourceRow[]) => { const m = new Map<Channel, number>(); for (const r of rows) { const c = channelOf(r.ref_host, r.utm_source); m.set(c, (m.get(c) || 0) + (Number(r.visits) || 0)); } return m; };
  const a = sum(i.sourcesNow), b = sum(i.sourcesWas);
  const parts = (Object.keys(CHANNEL_WORDS) as Channel[])
    .map((c) => ({ channel: c, name: CHANNEL_WORDS[c].name, now: a.get(c) || 0, was: b.get(c) || 0, change: (a.get(c) || 0) - (b.get(c) || 0) }))
    .filter((p) => p.change !== 0)
    .sort((x, y) => x.change - y.change || x.name.localeCompare(y.name));
  const fell = parts.filter((p) => p.change < 0);
  if (!fell.length) return { pct, now, was, short: '', sentence: head, parts, search: null };
  const top = fell[0], lost = was - now;
  const loss = top.channel === 'google' ? biggestLoss(i.termsNow ?? null, i.termsWas ?? null) : null;
  const ownName = !!(loss && i.name && namesBusiness(loss.term, i.name));
  const search = loss ? { ...loss, own_name: ownName } : null;
  let short: string, why: string;
  if (-top.change * 2 >= lost) {
    short = `Mostly ${top.channel === 'google' && ownName ? 'fewer Google searches for your name' : CHANNEL_WORDS[top.channel].fewer}`;
    why = `Most of the drop came from ${CHANNEL_WORDS[top.channel].from}: ${n1(-top.change)} fewer visit${-top.change === 1 ? '' : 's'}.`;
  } else {
    short = 'Fewer visits from several places';
    why = `The drop was spread out: ${fell.slice(0, 3).map((p) => `${n1(-p.change)} fewer from ${CHANNEL_WORDS[p.channel].from}`).join(', ')}.`;
  }
  if (search) why += ownName
    ? ` Fewer people looked you up by name: “${search.term}” brought ${plural(search.now, 'click')} from Google, against ${n1(search.was)}.`
    : ` The search that lost the most was “${search.term}”: ${plural(search.now, 'click')} from Google, against ${n1(search.was)}.`;
  return { pct, now, was, short, sentence: `${head} ${why}`, parts, search };
}

/** A month's visits by where they came from, from the visit rows already read (the
 *  monthly report reads them all): page views only, a person once a day, as the
 *  database counts them (0194). Pure. */
export function sourcesFromRows(rows: Array<{ kind?: string; ref_host?: string; utm_source?: string; visitor_hash?: string; ts?: string }>): SourceRow[] {
  const by = new Map<string, { ref_host: string; utm_source: string; who: Set<string> }>();
  for (const r of rows) {
    if ((r.kind || 'pageview') !== 'pageview') continue;
    const k = `${r.ref_host || ''}|${r.utm_source || ''}`;
    const e = by.get(k) || { ref_host: r.ref_host || '', utm_source: r.utm_source || '', who: new Set<string>() };
    e.who.add(r.visitor_hash || `ts:${r.ts || ''}`);
    by.set(k, e);
  }
  return [...by.values()].map((e) => ({ ref_host: e.ref_host, utm_source: e.utm_source, visits: e.who.size }));
}

/** Last whole month and the one before (UTC), as the Sites table compares them: their
 *  keys, names and bounds. Pure. */
export function lastWholeMonths(nowIso: string): { month: string; prior: string; label: string; priorLabel: string; startIso: string; endIso: string; priorStartIso: string } {
  const now = new Date(nowIso);
  const at = (back: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
  const key = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const name = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  const m = at(1), p = at(2), e = at(0);
  return { month: key(m), prior: key(p), label: name(m), priorLabel: name(p), startIso: m.toISOString(), endIso: e.toISOString(), priorStartIso: p.toISOString() };
}

// ── the reads (I/O) ──
const rowsOf = (r: unknown): any[] => { const j = (r as { ok?: boolean; json?: unknown } | null); return j && j.ok && Array.isArray(j.json) ? j.json as any[] : []; };
const okOf = (r: unknown) => !!(r && (r as { ok?: boolean }).ok);

/** One window's visits and where they came from, counted in the database (0194). */
async function windowSources(siteId: string, startIso: string, endIso: string): Promise<{ visits: number; sources: SourceRow[] } | null> {
  const r = await svc('rpc/presence_visit_stats', { method: 'POST', body: JSON.stringify({ p_site_id: siteId, p_start: startIso, p_end: endIso, p_now: endIso }) }).catch(() => null);
  const j = r && r.ok ? (r.json as { visitors?: number; sources?: SourceRow[] } | null) : null;
  return j && typeof j === 'object' ? { visits: Number(j.visitors) || 0, sources: Array.isArray(j.sources) ? j.sources : [] } : null;
}

/** Why one site's visits fell from the month before to this one, or null when there's no
 *  drop to explain or the reads failed. `now`/`was` are the numbers a page already shows,
 *  so the sentence says the same (read here when not given); the sources are read here
 *  unless the caller has this month's, and the months' top searches when the client has
 *  Search Console. */
export async function readVisitDrop(site: { id: string; client_id?: string | null }, w: { startIso: string; endIso: string; priorStartIso: string; month: string; prior: string; wasLabel: string; name?: string | null; now?: number; was?: number; sourcesNow?: SourceRow[] | null }): Promise<VisitDrop | null> {
  const given = typeof w.now === 'number' && typeof w.was === 'number';
  if (given && !visitDrop({ now: w.now!, was: w.was!, wasLabel: w.wasLabel, sourcesNow: null, sourcesWas: null })) return null;
  const cid = String(site.client_id || '');
  const [a, b] = await Promise.all([
    w.sourcesNow ? Promise.resolve({ visits: w.now ?? 0, sources: w.sourcesNow }) : windowSources(site.id, w.startIso, w.endIso),
    windowSources(site.id, w.priorStartIso, w.startIso),
  ]);
  const now = given ? w.now! : a ? a.visits : null, was = given ? w.was! : b ? b.visits : null;
  if (now === null || was === null || !visitDrop({ now, was, wasLabel: w.wasLabel, sourcesNow: null, sourcesWas: null })) return null;
  // only a drop worth explaining reads Search Console's months
  const t = /^[0-9a-f-]{36}$/i.test(cid) ? await svc(`presence_search_terms?client_id=eq.${cid}&dimension=eq.query&period=in.(${w.month},${w.prior})&select=key,period,clicks&order=clicks.desc&limit=${TOP_TERMS * 4}`).catch(() => null) : null;   // the top 25 a month, and the searches followed beside them
  const terms = okOf(t) ? rowsOf(t) : null;
  const of = (p: string) => (terms ? terms.filter((x) => x.period === p).map((x) => ({ key: String(x.key), clicks: Number(x.clicks) || 0 })) : null);
  const termsNow = of(w.month), termsWas = of(w.prior);
  return visitDrop({
    now, was, wasLabel: w.wasLabel,
    sourcesNow: a ? a.sources : null, sourcesWas: b ? b.sources : null,
    // a month Search Console hasn't kept says nothing about searches
    termsNow: termsNow && termsNow.length ? termsNow : null, termsWas: termsWas && termsWas.length ? termsWas : null,
    name: w.name || null,
  });
}
