// ── Site Review: find and fetch the pages worth reviewing ────────────────────
// Homepage first, then up to 7 more pages picked from the menu, the footer and
// the sitemap, preferring the pages a customer looks for (about, services or
// menu or products, contact, locations, pricing, the blog index). Every request
// goes through fetchPublic: SSRF guard on each hop, 10 s timeout, 2 MB cap,
// and the named DavisDigitalStudioBot user agent (spec: "Cost and abuse").

import { fetchPublic, looksLikeHtml, sameSite, sitemapInfo, type FetchLike, type UrlGuard } from '../../site_discovery.ts';

export const BOT_UA = 'Mozilla/5.0 (compatible; DavisDigitalStudioBot/1.0; +https://davisdigitalstudio.com/free-tools)';
export const MAX_PAGES = 8;
export const MAX_BYTES = 2 * 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 10_000;

export type FetchFail = 'unreachable' | 'not_html' | 'blocked';
export interface Fetched { url: string; status: number; html: string; truncated: boolean }

export interface CrawlDeps { guard: UrlGuard; fetchImpl?: FetchLike; now?: () => number }

const HTML_ACCEPT = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5';

/** Cloudflare / bot-wall challenge pages, and the plain 403 most WAFs send. */
export function looksBlocked(status: number, text: string): boolean {
  if (status === 403 || status === 429) return true;
  if (status === 503 || status === 200) {
    return /cf-chl-|challenge-platform|cf_chl_opt|<title>\s*(just a moment|attention required|access denied)/i.test(text.slice(0, 20000)) ||
      /(?:captcha-delivery\.com|perimeterx|px-captcha|_Incapsula_Resource|sucuri website firewall|botfailover|bm-verify|pardon our interruption|request unsuccessful\. incapsula|please enable js and disable any ad blocker|<title>\s*access denied)/i.test(text.slice(0, 20000));
  }
  return false;
}

export async function fetchHtml(url: string, deps: CrawlDeps, deadline: number): Promise<Fetched | FetchFail> {
  const now = deps.now || Date.now;
  const left = deadline - now();
  if (left < 500) return 'unreachable';
  const r = await fetchPublic(url, deps.guard, { ua: BOT_UA, accept: HTML_ACCEPT, timeoutMs: Math.min(REQUEST_TIMEOUT_MS, left), maxBytes: MAX_BYTES, maxHops: 5, fetchImpl: deps.fetchImpl });
  if (!r) return 'unreachable';
  if (looksBlocked(r.status, r.text)) return 'blocked';
  if (r.status >= 400) return 'unreachable';
  if (!looksLikeHtml(r.text)) return 'not_html';
  return { url: r.url, status: r.status, html: r.text, truncated: r.truncated };
}

// ── page picking ─────────────────────────────────────────────────────────────

const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|docx?|xlsx?|pptx?|mp[34]|mov|avi|css|js|json|xml|txt|rss|atom)$/i;
const SKIP_PATH = /\/(cart|checkout|account|login|log-in|signin|sign-in|register|wp-admin|wp-login|admin|search|tag|tags|category|author|feed|cdn-cgi|privacy-policy-generator)(\/|$)/i;

// [category, path/text pattern]; the order is the preference order.
const WANTED: [string, RegExp][] = [
  ['about', /\b(about|our-story|story|who-we-are|team|meet)\b/i],
  ['services', /\b(services?|menus?|products?|shop|store|treatments?|offerings?|what-we-do|classes|work|portfolio)\b/i],
  ['contact', /\b(contact|get-in-touch|reach-us|book|booking|appointments?|reservations?)\b/i],
  ['locations', /\b(locations?|visit|find-us|directions|hours)\b/i],
  ['pricing', /\b(pricing|prices|rates|plans|packages|fees)\b/i],
  ['blog', /\b(blog|news|journal|articles|insights|stories)\b/i],
];

export function normalizePath(u: URL): string {
  let p = u.pathname.replace(/\/{2,}/g, '/');
  if (p.length > 1) p = p.replace(/\/$/, '');
  return p.toLowerCase() || '/';
}

export interface Candidate { url: string; path: string; text: string; source: 'nav' | 'footer' | 'body' | 'sitemap' }

/** Same-site, page-like links, deduplicated by path, in discovery order. */
export function candidatesFrom(baseUrl: string, links: { href: string; text: string; inNav: boolean; inFooter: boolean }[], sitemapUrls: string[]): Candidate[] {
  const base = new URL(baseUrl);
  const seen = new Set<string>([normalizePath(base)]);
  const out: Candidate[] = [];
  const add = (href: string, text: string, source: Candidate['source']) => {
    let u: URL;
    try { u = new URL(href, base); } catch { return; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
    if (!sameSite(u.hostname, base.hostname)) return;
    if (SKIP_EXT.test(u.pathname) || SKIP_PATH.test(u.pathname)) return;
    const path = normalizePath(u);
    if (seen.has(path)) return;
    seen.add(path);
    u.hash = ''; u.search = '';
    out.push({ url: u.toString(), path, text, source });
  };
  for (const l of links) if (l.inNav) add(l.href, l.text, 'nav');
  for (const l of links) if (l.inFooter && !l.inNav) add(l.href, l.text, 'footer');
  for (const l of links) if (!l.inNav && !l.inFooter) add(l.href, l.text, 'body');
  for (const s of sitemapUrls) add(s, '', 'sitemap');
  return out;
}

/** Up to `max - 1` pages besides the homepage: one per wanted category first,
 *  then the remaining menu links in order, then anything else found. */
export function pickPages(cands: Candidate[], max = MAX_PAGES): Candidate[] {
  const picked: Candidate[] = [];
  const take = (c: Candidate | undefined) => { if (c && !picked.includes(c) && picked.length < max - 1) picked.push(c); };
  // Top-level pages first ("/services"); a nested one ("/blog/a-post") only
  // when the site has nothing else, and never more than one.
  const depth = (c: Candidate) => c.path.split('/').filter(Boolean).length;
  const top = (c: Candidate) => depth(c) <= 1;
  for (const [, re] of WANTED) {
    take(cands.find((c) => top(c) && (re.test(c.path) || re.test(c.text)) && c.source !== 'sitemap') ||
      cands.find((c) => top(c) && re.test(c.path)));
  }
  for (const c of cands.filter((c) => c.source === 'nav' && top(c))) take(c);
  for (const c of cands.filter((c) => c.source === 'footer' && top(c))) take(c);
  for (const c of cands.filter(top)) take(c);
  const nested = cands.find((c) => depth(c) === 2 && c.source !== 'sitemap') || cands.find((c) => depth(c) === 2);
  if (nested) take(nested);
  return picked;
}

export function sitemapLocs(xml: string, limit = 300): string[] {
  const info = sitemapInfo(xml);
  if (!info.valid || info.isIndex) return [];
  const out: string[] = [];
  for (const m of xml.matchAll(/<(?:[\w-]+:)?loc[^>]*>\s*([^<\s]+)\s*<\/(?:[\w-]+:)?loc>/gi)) {
    out.push(m[1].replace(/&amp;/g, '&'));
    if (out.length >= limit) break;
  }
  return out;
}

export async function fetchSitemapLocs(sitemapUrl: string | null, homeUrl: string, deps: CrawlDeps, deadline: number): Promise<string[]> {
  if (!sitemapUrl) return [];
  try { if (!sameSite(new URL(sitemapUrl).hostname, new URL(homeUrl).hostname)) return []; } catch { return []; }
  const left = deadline - (deps.now || Date.now)();
  if (left < 800) return [];
  const r = await fetchPublic(sitemapUrl, deps.guard, { ua: BOT_UA, accept: 'application/xml,text/xml,*/*;q=0.5', timeoutMs: Math.min(6000, left), maxBytes: MAX_BYTES, fetchImpl: deps.fetchImpl });
  return r && r.status === 200 ? sitemapLocs(r.text) : [];
}

// ── site-level probes ────────────────────────────────────────────────────────

/** Does http:// on the same host send visitors to https://? null = couldn't tell. */
export async function httpRedirectsToHttps(homeUrl: string, deps: CrawlDeps): Promise<boolean | null> {
  let u: URL;
  try { u = new URL(homeUrl); } catch { return null; }
  // The page's own path, not the root: on hosts like GitHub Pages the root is
  // someone else's (or nothing) while the site lives under a path.
  const httpUrl = `http://${u.host}${u.pathname || '/'}`;
  try { await deps.guard(httpUrl); } catch { return null; }
  const doFetch = deps.fetchImpl || ((i: string, init?: RequestInit) => fetch(i, init));
  try {
    const r = await doFetch(httpUrl, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': BOT_UA }, signal: AbortSignal.timeout(6000) });
    try { await r.body?.cancel(); } catch { /* */ }
    const loc = r.headers.get('location') || '';
    if (r.status >= 300 && r.status < 400 && loc) return /^https:\/\//i.test(new URL(loc, httpUrl).toString());
    return false;   // answered over plain http without redirecting
  } catch { return null; }
}

/** HEAD-check up to `limit` internal links; returns the ones that are broken
 *  (4xx/5xx after a GET retry for servers that refuse HEAD). Redirects are not
 *  followed: a 3xx counts as working, so a link can never steer the checker to
 *  an address the guard hasn't seen. */
export async function brokenLinks(urls: string[], deps: CrawlDeps, deadline: number, limit = 30): Promise<{ url: string; status: number }[]> {
  const doFetch = deps.fetchImpl || ((i: string, init?: RequestInit) => fetch(i, init));
  const now = deps.now || Date.now;
  const list = [...new Set(urls)].slice(0, limit);
  const broken: { url: string; status: number }[] = [];
  const check = async (url: string) => {
    if (deadline - now() < 1500) return;
    try { await deps.guard(url); } catch { return; }
    const go = async (method: string) => {
      const r = await doFetch(url, { method, redirect: 'manual', headers: { 'User-Agent': BOT_UA }, signal: AbortSignal.timeout(Math.min(5000, Math.max(500, deadline - now() - 500))) });
      try { await r.body?.cancel(); } catch { /* */ }
      return r.status;
    };
    try {
      let s = await go('HEAD');
      if (s === 405 || s === 403 || s === 501) s = await go('GET');
      if (s >= 400 && s !== 403 && s !== 429) broken.push({ url, status: s });
    } catch { /* timeouts and resets are not proof a link is broken */ }
  };
  // 6 at a time: polite to small hosts, still done in a few seconds.
  for (let i = 0; i < list.length; i += 6) await Promise.all(list.slice(i, i + 6).map(check));
  return broken;
}
