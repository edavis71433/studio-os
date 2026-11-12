// ── The Search tab's new parts (builder list items 124 and 181, Nov 2026) ──────
//   GET /visibility            adds: tools (the row of tools), tasks (the ranked
//                              to-do list) and movers (the pages that moved most)
//   GET /visibility/follow     the searches this site follows, month by month, and
//                              suggestions from what people searched last month
//   PUT /visibility/follow     { terms: [...] } follow up to ten; a new one gets its
//                              last six months from Search Console after the answer
//   GET /visibility/llms-draft a first llms.txt from the business details
//   PUT /visibility/phrases    { phrases: [...] } the two or three phrases the business wants
//                              to be found for (builder list item 160); GET /visibility adds
//                              them, each with the page headline it's in, and ideas
// Under /visibility for the reason routes/visibility.ts gives: search works whoever
// hosts the site, and the /search segment is closed to a watch-only plan. Each read
// here is best-effort and leaves its own part out when it fails.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { readReservedJson, updateReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import { runAfterResponse } from '../lib/after_response.ts';
import { siteOrigin, type SiteRow } from '../lib/site.ts';
import { readSearchPages } from './analytics.ts';
import { searchTasks, pageMovers, normalizeFollowed, applyFollow, followedSeries, draftLlmsTxt, FOLLOW_MAX, LLMS_TXT_MAX, type SearchTask } from '../lib/search_tools.ts';
import { applyPhrases, normalizePhrases, pageHeadlines, phraseFoundIn, phraseIdeas, PHRASES_MAX } from '../lib/search_phrases.ts';
import type { Principal } from '../../_shared/auth.ts';

const rows = (r: unknown): any[] => { const j = (r as { json?: unknown } | null)?.json; return Array.isArray(j) ? j : []; };
const safe = async <T>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };
const fresh = (r: unknown) => !!(r && (r as { ok?: boolean }).ok);

/** The month before a 'YYYY-MM'. Pure. */
export function monthBefore(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, (m || 1) - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The settings the tools row reads. Before migration 0171 the two new columns 400
 *  the read, so it asks again without them and the two tools say they aren't ready. */
async function searchSettings(siteId: string): Promise<{ row: Record<string, any>; ready: boolean }> {
  const base = 'google_site_verification,bing_site_verification';
  const a = await safe(svc(`presence_settings?site_id=eq.${siteId}&select=${base},search_hidden,llms_txt&limit=1`));
  if (fresh(a)) return { row: rows(a)[0] || {}, ready: true };
  const b = await safe(svc(`presence_settings?site_id=eq.${siteId}&select=${base}&limit=1`));
  return { row: rows(b)[0] || {}, ready: false };
}

/** The phrases the business wants to be found for (item 160), each with the page headline
 *  it's in or null, and ideas from its services and area. Best-effort reads. */
export async function phrasesView(site: SiteRow, stored?: unknown) {
  const [raw, identQ, setQ, locQ, offQ] = await Promise.all([
    stored !== undefined ? Promise.resolve(stored) : safe(readReservedJson(site.id, RESERVED_NAMES.searchPhrases)),
    safe(svc(`presence_identity?site_id=eq.${site.id}&select=business_name,seo_title,service_area&limit=1`)),
    safe(svc(`presence_settings?site_id=eq.${site.id}&select=page_seo,pages,pages_noindex,industry_key&limit=1`)),
    safe(svc(`presence_locations?site_id=eq.${site.id}&select=city&limit=1`)),
    safe(svc(`presence_offerings?site_id=eq.${site.id}&deleted_at=is.null&is_visible=is.true&select=name,category&limit=60`)),
  ]);
  const ident = rows(identQ)[0] || {}, set = rows(setQ)[0] || {}, loc = rows(locQ)[0] || {};
  const { phrases } = normalizePhrases(raw);
  const headlines = pageHeadlines({ name: String(ident.business_name || ''), seoTitle: ident.seo_title, industry: set.industry_key, pageSeo: set.page_seo, pages: set.pages, hidden: Array.isArray(set.pages_noindex) ? set.pages_noindex.map(String) : [] });
  return {
    max: PHRASES_MAX,
    list: phrases.map((phrase) => { const h = phraseFoundIn(phrase, headlines); return { phrase, found: h ? { key: h.key, label: h.label, title: h.title } : null }; }),
    ideas: phraseIdeas({ industry: set.industry_key, offerings: rows(offQ), city: loc.city, serviceArea: ident.service_area, chosen: phrases }),
  };
}

/** What GET /visibility adds for the new Search tab. */
export async function searchTabExtras(site: SiteRow, i: { address: { url: string } | null; consoleConnected: boolean; listingConnected: boolean; period: string | null; review: { issues?: Array<{ title: string; priority: string; fix?: string }> } | null }) {
  const [set, identQ, redirQ, followRaw, healthQ, nowPages, priorPages, phrases] = await Promise.all([
    searchSettings(site.id),
    safe(svc(`presence_identity?site_id=eq.${site.id}&select=seo_title,seo_description&limit=1`)),
    safe(svc(`presence_redirects?site_id=eq.${site.id}&select=id&limit=50`)),
    safe(readReservedJson(site.id, RESERVED_NAMES.followedSearches)),
    safe(svc(`presence_health_days?site_id=eq.${site.id}&select=day,issues&order=day.desc&limit=1`)),
    i.period ? safe(readSearchPages(site.client_id, i.period, 25)) : Promise.resolve(null),
    i.period ? safe(readSearchPages(site.client_id, monthBefore(i.period), 25)) : Promise.resolve(null),
    phrasesView(site),
  ]);
  const s = set.row, ident = rows(identQ)[0] || {};
  const followed = normalizeFollowed(followRaw).terms;
  const issues = fresh(healthQ) && rows(healthQ)[0] && Array.isArray(rows(healthQ)[0].issues) ? rows(healthQ)[0].issues : null;
  const hidden = s.search_hidden === true, llms = String(s.llms_txt || '').trim();
  const tasks: SearchTask[] = searchTasks({
    edition: site.edition, live: site.edition === 'monitor' ? !!i.address : !!site.last_published_at || site.status === 'live',
    customDomain: !!site.custom_domain, hidden, console: i.consoleConnected, listing: i.listingConnected,
    title: !!String(ident.seo_title || '').trim(), description: !!String(ident.seo_description || '').trim(),
    llms: !!llms, followed: followed.length, issues, review: i.review?.issues || null,
    phrases: phrases.list.map((p) => ({ phrase: p.phrase, found: !!p.found })),
  });
  const movers = i.period && nowPages && priorPages && priorPages.length ? { period: i.period, prior_period: monthBefore(i.period), ...pageMovers(nowPages, priorPages) } : null;
  const origin = i.address ? i.address.url.replace(/\/$/, '') : '';
  return {
    tools: {
      ready: set.ready,
      redirects: fresh(redirQ) ? rows(redirQ).length : null,
      verification: { google: !!String(s.google_site_verification || '').trim(), bing: !!String(s.bing_site_verification || '').trim() },
      sitemap: origin ? `${origin}/sitemap.xml` : null,
      llms: { set: !!llms, chars: llms.length, url: origin ? `${origin}/llms.txt` : null, max: LLMS_TXT_MAX },
      hidden,
    },
    tasks,
    movers,
    follow: { count: followed.length, max: FOLLOW_MAX },
    phrases,
  };
}

/** PUT /visibility/phrases { phrases }: the two or three phrases, as asked (item 160). A new
 *  one is also followed on Google when there's room, so the month-by-month place shows. */
export async function handlePhrasesPut(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'bad_json', message: 'That didn’t read right. Nothing changed.' }, 400, cors); }
  const asked = applyPhrases(body?.phrases);
  if ('error' in asked) return json({ error: 'validation', message: asked.error }, 422, cors);
  const who = principal.email || principal.userId || 'owner';
  const before = normalizePhrases(await safe(readReservedJson(site.id, RESERVED_NAMES.searchPhrases))).phrases;
  const saved = await updateReservedJson(site.id, RESERVED_NAMES.searchPhrases, () => ({ phrases: asked.phrases }), who);
  if (!saved) return json({ error: 'write_failed', message: 'That didn’t save. Nothing changed; try again.' }, 502, cors);
  const fresh = asked.phrases.filter((p) => !before.includes(p));
  if (fresh.length) {
    let added: string[] = [];
    await safe(updateReservedJson(site.id, RESERVED_NAMES.followedSearches, (cur) => {
      const now = normalizeFollowed(cur);
      const want = [...now.terms.map((t) => t.term), ...fresh.filter((p) => !now.terms.some((t) => t.term === p))].slice(0, FOLLOW_MAX);
      const next = applyFollow(now, want, who, new Date().toISOString());
      if ('error' in next) return cur;
      added = next.added;
      return { terms: next.terms };
    }, who));
    if (added.length) runAfterResponse(import('../ops/gsc_sync.ts').then((m) => m.backfillFollowed(site, added)).catch(() => 0));
  }
  return json({ data: await phrasesView(site, { phrases: asked.phrases }) }, 200, cors);
}

/** GET /visibility/follow: each followed search's months and its last two compared,
 *  with suggestions from last month's searches not followed yet. */
export async function handleFollowGet(site: SiteRow, cors: Record<string, string>) {
  return json({ data: await followData(site) }, 200, cors);
}
async function followData(site: SiteRow, override?: ReturnType<typeof normalizeFollowed>['terms']) {
  const [raw, gscQ, connQ] = await Promise.all([
    override ? Promise.resolve(null) : safe(readReservedJson(site.id, RESERVED_NAMES.followedSearches)),
    safe(svc(`signals?client_id=eq.${encodeURIComponent(site.client_id)}&source=eq.gsc&metric=eq.search_clicks&select=period&order=period.desc&limit=1`)),
    safe(svc(`presence_connections?site_id=eq.${site.id}&provider_key=eq.google_search_console&select=status&limit=1`)),
  ]);
  const terms = override || normalizeFollowed(raw).terms;
  const month = String(rows(gscQ)[0]?.period || ''), prior = month ? monthBefore(month) : '';
  const since = month ? (() => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 6, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })() : '';
  const list = terms.map((t) => encodeURIComponent(`"${t.term.replace(/"/g, '')}"`)).join(',');
  const [termQ, topQ] = await Promise.all([
    terms.length && month ? safe(svc(`presence_search_terms?client_id=eq.${encodeURIComponent(site.client_id)}&dimension=eq.query&key=in.(${list})&period=gte.${since}&select=key,period,clicks,impressions,position&limit=200`)) : Promise.resolve(null),
    month ? safe(svc(`presence_search_terms?client_id=eq.${encodeURIComponent(site.client_id)}&dimension=eq.query&period=eq.${month}&select=key,clicks,impressions&order=impressions.desc&limit=25`)) : Promise.resolve(null),
  ]);
  const followedSet = new Set(terms.map((t) => t.term));
  return {
    terms: followedSeries(terms, rows(termQ), month, prior),
    suggestions: rows(topQ).filter((r) => !followedSet.has(String(r.key))).slice(0, 8).map((r) => ({ term: String(r.key), clicks: Number(r.clicks) || 0, impressions: Number(r.impressions) || 0 })),
    max: FOLLOW_MAX, month: month || null, prior: prior || null,
    connected: rows(connQ)[0]?.status === 'connected',
  };
}

/** PUT /visibility/follow { terms }: the list as asked, ten at most. A search followed
 *  for the first time gets its last six months from Search Console after the answer. */
export async function handleFollowPut(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let b: { terms?: unknown } = {}; try { b = await req.json(); } catch { /* answered below */ }
  let added: string[] = [], refused = '';
  const saved = await updateReservedJson(site.id, RESERVED_NAMES.followedSearches, (cur) => {
    const r = applyFollow(normalizeFollowed(cur), b.terms, principal.email || null, new Date().toISOString());
    if ('error' in r) { refused = r.error; throw new Error('refused'); }
    added = r.added;
    return { terms: r.terms };
  }, principal.email || 'search').catch(() => null);
  if (refused) return json({ error: 'bad_request', message: refused }, 400, cors);
  if (!saved) return json({ error: 'write_failed', message: 'That didn’t save. Nothing changed; try again.' }, 502, cors);
  if (added.length) {
    runAfterResponse(import('../ops/gsc_sync.ts').then((m) => m.backfillFollowed(site, added)).catch(() => 0));
  }
  return json({ data: { ...(await followData(site, normalizeFollowed(saved).terms)), added } }, 200, cors);
}

/** GET /visibility/llms-draft: a first llms.txt from the business details and pages. */
export async function handleLlmsDraft(site: SiteRow, cors: Record<string, string>) {
  const [identQ, locQ, setQ] = await Promise.all([
    safe(svc(`presence_identity?site_id=eq.${site.id}&select=*&limit=1`)),   // * so the short description is there once 0182 is
    safe(svc(`presence_locations?site_id=eq.${site.id}&select=address_line1,city,region,postal_code,phone&limit=1`)),
    safe(svc(`presence_settings?site_id=eq.${site.id}&select=pages,pages_noindex&limit=1`)),
  ]);
  const ident = rows(identQ)[0] || {}, loc = rows(locQ)[0] || {}, set = rows(setQ)[0] || {};
  const hidden = new Set(Array.isArray(set.pages_noindex) ? set.pages_noindex.map(String) : []);
  const own = (Array.isArray(set.pages) ? set.pages : [])
    .filter((p: any) => p && p.slug && !hidden.has(`page:${p.slug}`))
    .map((p: any) => ({ title: String(p.title || p.slug), path: `/${String(p.slug).replace(/^\/|\/$/g, '')}/` }));
  const text = draftLlmsTxt({
    // builder list item 127: the short description is the line written for AI tools to quote, so it leads
    name: String(ident.business_name || ''), origin: siteOrigin(site), description: ident.short_description || ident.seo_description || ident.tagline || ident.description || null,
    city: loc.city, region: loc.region, phone: ident.phone || loc.phone, email: ident.email, street: loc.address_line1, postal: loc.postal_code,
    pages: [{ title: 'Home', path: '/' }, ...own, { title: 'Contact', path: '/contact/' }],
  });
  return json({ data: { text, max: LLMS_TXT_MAX } }, 200, cors);
}
