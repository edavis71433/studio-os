// ── Site discovery checks for the deep audit ────────────────────────────────
// Used by clever-api's deepAudit (the public Free Site Review, AI critique and
// report card). Before this module the audit never fetched robots.txt or the
// sitemap, so every site was told "No sitemap.xml found" and "No robots.txt",
// and social links were found by searching the raw HTML for "facebook.com" or
// "x.com" anywhere (Squarespace's xmlns:fb attribute counted as a Facebook
// profile, and "x.com" matched inside "dropbox.com").
//
// Everything that touches the network goes through fetchPublic, which runs the
// caller's URL guard (SSRF check) on the first URL and on every redirect, caps
// the body size and has a timeout. Only the audited site's own robots.txt and
// sitemap are fetched: a sitemap declared on some other host is reported but
// never requested, so the public endpoint cannot be used as a fetch proxy.

export type UrlGuard = (raw: string) => Promise<URL>;
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface Discoverability {
  robotsTxt: boolean;            // a real robots.txt answered (not an HTML page)
  robotsTxtBlocksAll: boolean;   // Googlebot may not crawl the homepage
  sitemapDeclared: boolean;      // robots.txt lists a Sitemap: line
  sitemapUrl: string | null;     // the sitemap found (or the first one declared)
  sitemapXml: boolean;           // a valid XML sitemap or sitemap index was found
  sitemapUrlCount: number;       // <loc> entries read (sitemaps, for an index)
  sitemapIsIndex: boolean;
}

export function emptyDiscoverability(): Discoverability {
  return { robotsTxt: false, robotsTxtBlocksAll: false, sitemapDeclared: false, sitemapUrl: null, sitemapXml: false, sitemapUrlCount: 0, sitemapIsIndex: false };
}

// ── robots.txt ──
interface RobotsRule { allow: boolean; path: string }
export interface RobotsInfo { blocksAll: boolean; sitemaps: string[] }

// Google's matching: a pattern is a path prefix where * matches anything and a
// trailing $ anchors the end.
function robotsPatternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = '^' + body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : '');
  return new RegExp(re).test(path);
}

// Is `path` allowed for these rules? Longest matching rule wins; on a tie the
// allow rule wins (Google's documented behavior).
export function robotsAllows(rules: RobotsRule[], path: string): boolean {
  let best: RobotsRule | null = null;
  for (const r of rules) {
    if (!r.path) continue;                       // "Disallow:" with no value allows everything
    if (!robotsPatternMatches(r.path, path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow && !best.allow)) best = r;
  }
  return !best || best.allow;
}

export function parseRobotsTxt(text: string, base: string): RobotsInfo {
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  const sitemaps: string[] = [];
  let cur: { agents: string[]; rules: RobotsRule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of String(text || '').split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === 'allow' || field === 'disallow') {
      if (cur) cur.rules.push({ allow: field === 'allow', path: value });
      lastWasAgent = false;
    } else if (field === 'sitemap') {
      try { const u = new URL(value, base); if (/^https?:$/.test(u.protocol) && !sitemaps.includes(u.toString())) sitemaps.push(u.toString()); } catch (_e) { /* not a URL */ }
      lastWasAgent = false;
    } else {
      lastWasAgent = false;                      // crawl-delay and friends end an agent run too
    }
  }
  // Googlebot obeys the groups that name it; only if none do, the * groups.
  const named = groups.filter((g) => g.agents.includes('googlebot'));
  const applicable = named.length ? named : groups.filter((g) => g.agents.includes('*'));
  const rules = applicable.flatMap((g) => g.rules);
  return { blocksAll: !robotsAllows(rules, '/'), sitemaps };
}

// ── sitemap ──
export function sitemapInfo(xml: string): { valid: boolean; isIndex: boolean; locCount: number } {
  const s = String(xml || '');
  const isIndex = /<(?:[\w-]+:)?sitemapindex[\s>]/i.test(s);
  const valid = isIndex || /<(?:[\w-]+:)?urlset[\s>]/i.test(s);
  return { valid, isIndex, locCount: valid ? (s.match(/<(?:[\w-]+:)?loc[\s>]/gi) || []).length : 0 };
}

export function looksLikeHtml(text: string): boolean {
  return /<(!doctype\s+html|html|head|body)[\s>]/i.test(String(text || '').slice(0, 2000));
}

// Same site: equal hosts ignoring "www.", or one is a subdomain of the other.
export function sameSite(a: string, b: string): boolean {
  const n = (h: string) => String(h || '').toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  const x = n(a), y = n(b);
  return !!x && !!y && (x === y || x.endsWith('.' + y) || y.endsWith('.' + x));
}

// ── guarded fetch ──
export async function readCapped(res: Response, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0, truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (size + value.length > maxBytes) {
        chunks.push(value.subarray(0, maxBytes - size)); size = maxBytes; truncated = true;
        break;
      }
      chunks.push(value); size += value.length;
    }
  } catch (_e) {
    truncated = true;                            // timed out or dropped mid-body: keep what arrived
  }
  if (truncated) { try { await reader.cancel(); } catch (_e) { /* already closed */ } }
  const bytes = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.length; }
  return { bytes, truncated };
}

async function gunzipCapped(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream('gzip'));   // slice(): an ArrayBuffer-backed copy, as Blob wants
    return (await readCapped(new Response(stream), maxBytes)).bytes;
  } catch (_e) { return null; }
}

export interface FetchOpts { ua: string; accept: string; timeoutMs: number; maxBytes: number; maxHops?: number; fetchImpl?: FetchLike }
export interface FetchResult { status: number; url: string; text: string; truncated: boolean }

export async function fetchPublic(raw: string, guard: UrlGuard, o: FetchOpts): Promise<FetchResult | null> {
  const doFetch: FetchLike = o.fetchImpl || ((input, init) => fetch(input, init));
  let current = raw;
  for (let hop = 0; hop <= (o.maxHops ?? 3); hop++) {
    try { await guard(current); } catch (_e) { return null; }   // SSRF: every hop is checked
    let res: Response;
    try {
      res = await doFetch(current, { headers: { 'User-Agent': o.ua, 'Accept': o.accept }, redirect: 'manual', signal: AbortSignal.timeout(Math.max(1, o.timeoutMs)) });
    } catch (_e) { return null; }
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      try { await res.body?.cancel(); } catch (_e) { /* */ }
      try { current = new URL(loc, current).toString(); } catch (_e) { return null; }
      continue;
    }
    let { bytes, truncated } = await readCapped(res, o.maxBytes);
    // A sitemap.xml.gz served as a file (not as Content-Encoding) arrives still compressed.
    if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const un = await gunzipCapped(bytes, o.maxBytes);
      if (un) { bytes = un; truncated = truncated || un.length >= o.maxBytes; }
    }
    return { status: res.status, url: current, text: new TextDecoder('utf-8').decode(bytes), truncated };
  }
  return null;                                  // too many redirects
}

// robots.txt + sitemap for the site at `siteUrl` (the audited page's final URL).
export async function checkDiscoverability(siteUrl: string, guard: UrlGuard, ua: string, opts: { budgetMs?: number; fetchImpl?: FetchLike } = {}): Promise<Discoverability> {
  const out = emptyDiscoverability();
  let origin: string, host: string;
  try { const u = new URL(siteUrl); origin = u.origin; host = u.hostname; } catch (_e) { return out; }
  const deadline = Date.now() + (opts.budgetMs ?? 15000);
  const left = () => Math.max(0, deadline - Date.now());
  const get = (url: string, accept: string, maxBytes: number) =>
    left() < 300 ? Promise.resolve(null) : fetchPublic(url, guard, { ua, accept, timeoutMs: Math.min(6000, left()), maxBytes, fetchImpl: opts.fetchImpl });
  const asSitemap = (r: FetchResult | null) => (r && r.status === 200 ? sitemapInfo(r.text) : null);
  const take = (url: string, info: { isIndex: boolean; locCount: number }) => {
    out.sitemapXml = true; out.sitemapUrl = url; out.sitemapUrlCount = info.locCount; out.sitemapIsIndex = info.isIndex;
  };

  // robots.txt and the conventional /sitemap.xml in parallel; most sites have both.
  const defaultSitemap = origin + '/sitemap.xml';
  const [robots, std] = await Promise.all([
    get(origin + '/robots.txt', 'text/plain,*/*;q=0.5', 512 * 1024),
    get(defaultSitemap, 'application/xml,text/xml,*/*;q=0.5', 2 * 1024 * 1024),
  ]);

  let declared: string[] = [];
  if (robots && robots.status === 200 && !looksLikeHtml(robots.text)) {   // some hosts answer every path with an HTML page
    out.robotsTxt = true;
    const info = parseRobotsTxt(robots.text, robots.url);
    out.robotsTxtBlocksAll = info.blocksAll;
    if (info.sitemaps.length) { out.sitemapDeclared = true; out.sitemapUrl = info.sitemaps[0]; }
    declared = info.sitemaps.filter((s) => { try { return sameSite(new URL(s).hostname, host); } catch (_e) { return false; } });
  }

  const stdInfo = asSitemap(std);
  const stdValid = stdInfo && stdInfo.valid ? stdInfo : null;
  if (stdValid && (!declared.length || declared.includes(defaultSitemap))) { take(defaultSitemap, stdValid); return out; }
  // Prefer what robots.txt declares, then the other usual location.
  const tried = new Set<string>([defaultSitemap]);
  for (const c of [...declared.slice(0, 2), origin + '/sitemap_index.xml']) {
    if (tried.has(c)) continue;
    tried.add(c);
    const info = asSitemap(await get(c, 'application/xml,text/xml,*/*;q=0.5', 2 * 1024 * 1024));
    if (info && info.valid) { take(c, info); return out; }
  }
  if (stdValid) take(defaultSitemap, stdValid);
  return out;
}

// ── social and business profiles ──
// [label, hosts (exact or any subdomain), optional path test for shared hosts]
const PROFILES: [string, string[], RegExp?][] = [
  ['facebook.com', ['facebook.com', 'fb.com', 'fb.me']],
  ['instagram.com', ['instagram.com', 'instagr.am']],
  ['x.com', ['x.com', 'twitter.com']],
  ['linkedin.com', ['linkedin.com', 'lnkd.in']],
  ['youtube.com', ['youtube.com', 'youtu.be']],
  ['tiktok.com', ['tiktok.com']],
  ['yelp.com', ['yelp.com', 'yelp.ca', 'yelp.co.uk', 'yelp.com.au']],
  ['pinterest.com', ['pinterest.com', 'pin.it']],
  ['nextdoor.com', ['nextdoor.com']],
  ['threads.net', ['threads.net', 'threads.com']],
  ['Google Business Profile', ['g.page', 'share.google', 'maps.app.goo.gl', 'business.google.com', 'maps.google.com']],
  ['Google Business Profile', ['google.com'], /^\/(maps|local\/writereview)(\/|$|\?)/i],
  ['Google Business Profile', ['goo.gl'], /^\/maps(\/|$)/i],
  ['Google Business Profile', ['g.co'], /^\/kgs\//i],
];
// Share buttons, embeds and link redirectors point at the platform, not at the business.
const NOT_A_PROFILE = /^\/(sharer|share|intent|dialog|plugins|sharearticle|sharing|pin\/create|home|l)(\/|\.php|$)/i;

function profileFor(href: string, base: string): string | null {
  let u: URL;
  try { u = new URL(href.replace(/&amp;/g, '&'), base); } catch (_e) { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '').replace(/^(www|m|mobile)\./, '');
  const path = u.pathname || '/';
  for (const [label, hosts, pathTest] of PROFILES) {
    if (!hosts.some((h) => host === h || host.endsWith('.' + h))) continue;
    if (pathTest && !pathTest.test(path + (u.search || ''))) continue;
    if (!pathTest && (path === '/' || NOT_A_PROFILE.test(path))) return null;   // bare platform link or a share button
    return label;
  }
  return null;
}

function collectSameAs(node: unknown, out: string[], depth = 0): void {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) { for (const n of node) collectSameAs(n, out, depth + 1); return; }
  if (typeof node !== 'object') return;
  const rec = node as Record<string, unknown>;
  const sa = rec.sameAs;
  if (typeof sa === 'string') out.push(sa);
  else if (Array.isArray(sa)) for (const s of sa) if (typeof s === 'string') out.push(s);
  for (const [k, v] of Object.entries(rec)) if (k !== 'sameAs' && v && typeof v === 'object') collectSameAs(v, out, depth + 1);
}

// Profiles the page actually links to (<a href>) or declares in JSON-LD sameAs.
export function socialProfiles(html: string, baseUrl: string, schemas: unknown[] = []): string[] {
  const found: string[] = [];
  const add = (label: string | null) => { if (label && !found.includes(label)) found.push(label); };
  for (const m of String(html || '').matchAll(/<a\b[^>]*?\shref\s*=\s*(["'])([^"']+)\1/gi)) add(profileFor(m[2], baseUrl));
  const same: string[] = [];
  collectSameAs(schemas, same);
  for (const s of same) add(profileFor(s, baseUrl));
  return found;
}
