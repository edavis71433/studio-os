// ── Phase AN-2: Analytics Foundation — pure visit parsing + aggregation ───────
// Deterministic, no AI, no library. Turns a raw beacon + request headers into a
// lean, privacy-first visit row, and aggregates stored rows into plain-English-
// ready counts. Everything here is pure (except the sha256 hash) → unit-tested.

export type VisitKind = 'pageview' | 'phone' | 'email' | 'cta' | 'download' | 'outbound';
export const VISIT_KINDS: VisitKind[] = ['pageview', 'phone', 'email', 'cta', 'download', 'outbound'];
export const isVisitKind = (k: unknown): k is VisitKind => typeof k === 'string' && (VISIT_KINDS as string[]).includes(k);

/** Classify a user-agent — device / browser / os / isBot. Deterministic, no lib. */
export function parseUA(ua: string): { device: 'mobile' | 'desktop' | 'tablet'; browser: string; os: string; bot: boolean } {
  const s = ua || '';
  const bot = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|preview|monitor|lighthouse|pingdom|headless/i.test(s);
  const device: 'mobile' | 'desktop' | 'tablet' =
    /iPad|Tablet|PlayBook|Silk/i.test(s) ? 'tablet'
    : /Mobi|Android|iPhone|iPod|Windows Phone/i.test(s) ? 'mobile'
    : 'desktop';
  const browser =
    /Edg\//.test(s) ? 'Edge'
    : /OPR\/|Opera/.test(s) ? 'Opera'
    : /Chrome\//.test(s) ? 'Chrome'
    : /Firefox\//.test(s) ? 'Firefox'
    : /Safari\//.test(s) ? 'Safari'
    : 'Other';
  const os =
    /iPhone|iPad|iPod/.test(s) ? 'iOS'          // before "Mac OS X" — iOS UAs say "like Mac OS X"
    : /Windows/.test(s) ? 'Windows'
    : /Android/.test(s) ? 'Android'
    : /Mac OS X|Macintosh/.test(s) ? 'macOS'
    : /Linux/.test(s) ? 'Linux'
    : 'Other';
  return { device, browser, os, bot };
}

/** Referrer HOST only (privacy — never the full URL), '' when same-site or direct. */
export function refHost(referrer: string, siteHost?: string): string {
  if (!referrer) return '';
  try {
    const h = new URL(referrer).hostname.replace(/^www\./, '').toLowerCase();
    if (siteHost && h === siteHost.replace(/^www\./, '').toLowerCase()) return ''; // internal nav isn't a referral
    return h.slice(0, 120);
  } catch { return ''; }
}

/** A friendly source label from referrer host + UTM. Deterministic. */
export function sourceLabel(refHostName: string, utmSource: string): string {
  if (utmSource) return utmSource.slice(0, 60);
  if (!refHostName) return 'Direct';
  if (/google\./.test(refHostName)) return 'Google';
  if (/bing\./.test(refHostName)) return 'Bing';
  if (/duckduckgo\./.test(refHostName)) return 'DuckDuckGo';
  if (/facebook\.|fb\./.test(refHostName)) return 'Facebook';
  if (/instagram\./.test(refHostName)) return 'Instagram';
  if (/t\.co|twitter\.|x\.com/.test(refHostName)) return 'X / Twitter';
  if (/linkedin\./.test(refHostName)) return 'LinkedIn';
  if (/yelp\./.test(refHostName)) return 'Yelp';
  return refHostName;
}

/** Sanitize a path to a lean, query-free page path. */
export function cleanPath(p: string): string {
  if (!p || typeof p !== 'string') return '/';
  let path = p.split('?')[0].split('#')[0].trim();
  if (!path.startsWith('/')) path = '/' + path;
  return path.slice(0, 200);
}
const cleanUtm = (s: unknown) => String(s ?? '').replace(/[^\w.-]/g, '').slice(0, 60);
export function cleanUtms(u: any): { source: string; medium: string; campaign: string } {
  const o = u && typeof u === 'object' ? u : {};
  return { source: cleanUtm(o.s ?? o.source), medium: cleanUtm(o.m ?? o.medium), campaign: cleanUtm(o.c ?? o.campaign) };
}

/** Daily-rotating anonymous visitor id. No raw IP stored; resets each UTC day so
 *  there is no cross-day identity. */
export async function visitorDayHash(ip: string, ua: string, siteId: string, dayIso: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${ip}|${ua}|${siteId}|${dayIso}|${salt}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).slice(0, 10).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── aggregation (pure): stored rows → counts ready for plain-English composition ─
export interface VisitRow { ts: string; kind: string; path: string; ref_host: string; utm_source: string; device: string; country: string; visitor_hash: string; }
export interface VisitAgg {
  visitors: number; priorVisitors: number; pageviews: number;
  topPages: Array<{ path: string; views: number }>;
  topSources: Array<{ source: string; visits: number }>;
  devices: Array<{ device: string; share: number }>;
  countries: Array<{ country: string; visits: number }>;
  events: { phone: number; email: number; cta: number; download: number };
  hasData: boolean;
}

const topN = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

export function aggregateVisits(rows: VisitRow[], nowMs: number, windowDays: number): VisitAgg {
  const w = windowDays * 86_400_000;
  const curStart = nowMs - w, priorStart = nowMs - 2 * w;
  const curVisitors = new Set<string>(), priorVisitors = new Set<string>();
  const pages = new Map<string, number>(), sources = new Map<string, number>(), devices = new Map<string, number>(), countries = new Map<string, number>();
  const srcSeen = new Map<string, Set<string>>(); // source → distinct visitor set
  const events = { phone: 0, email: 0, cta: 0, download: 0 };
  let pageviews = 0;
  for (const r of rows) {
    const ms = Date.parse(r.ts); if (Number.isNaN(ms)) continue;
    // No upper bound on the current window: a row is never truly "in the future";
    // DB now() can read slightly ahead of the caller's clock (skew) and must count.
    const inCur = ms > curStart;
    const inPrior = ms > priorStart && ms <= curStart;
    if (inPrior && r.visitor_hash) priorVisitors.add(r.visitor_hash);
    if (!inCur) continue;
    if (r.kind === 'pageview') {
      pageviews++;
      if (r.visitor_hash) curVisitors.add(r.visitor_hash);
      if (r.path) pages.set(r.path, (pages.get(r.path) || 0) + 1);
      const src = sourceLabel(r.ref_host, r.utm_source);
      const set = srcSeen.get(src) || new Set<string>(); set.add(r.visitor_hash || String(ms)); srcSeen.set(src, set);
      if (r.device) devices.set(r.device, (devices.get(r.device) || 0) + 1);
      if (r.country) countries.set(r.country, (countries.get(r.country) || 0) + 1);
    } else if (r.kind in events) {
      (events as any)[r.kind]++;
    }
  }
  for (const [src, set] of srcSeen) sources.set(src, set.size);
  const devTotal = [...devices.values()].reduce((a, b) => a + b, 0) || 1;
  return {
    visitors: curVisitors.size, priorVisitors: priorVisitors.size, pageviews,
    topPages: topN(pages, 5).map(([path, views]) => ({ path, views })),
    topSources: topN(sources, 5).map(([source, visits]) => ({ source, visits })),
    devices: topN(devices, 3).map(([device, n]) => ({ device, share: Math.round((n / devTotal) * 100) })),
    countries: topN(countries, 5).map(([country, visits]) => ({ country, visits })),
    events,
    hasData: pageviews > 0 || curVisitors.size > 0,
  };
}

// ── the injected tracker (privacy-first, cookieless, ~700 bytes minified) ─────
// Honors Do-Not-Track, uses sendBeacon (zero latency, fire-and-forget), no
// cookies/localStorage, sends only path + referrer + UTM + click kind.
export function trackerScript(siteId: string, collectBase: string): string {
  const url = `${collectBase}/px/${siteId}`;
  const js = `(function(){try{if(navigator.doNotTrack=='1'||window.doNotTrack=='1')return;var U='${url}';` +
    `function q(k){var m=location.search.match(new RegExp('[?&]utm_'+k+'=([^&]+)'));return m?decodeURIComponent(m[1]):''}` +
    `function s(o){try{navigator.sendBeacon(U,JSON.stringify(o))}catch(e){}}` +
    `s({k:'pageview',p:location.pathname,r:document.referrer,u:{s:q('source'),m:q('medium'),c:q('campaign')}});` +
    `document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a');if(!a)return;var h=(a.getAttribute('href')||'');` +
    `var k=a.hasAttribute('download')||/\\.(pdf|zip|docx?|xlsx?|csv)$/i.test(h)?'download':/^tel:/i.test(h)?'phone':/^mailto:/i.test(h)?'email':a.hasAttribute('data-cta')?'cta':(/^https?:/i.test(h)&&h.indexOf(location.host)<0)?'outbound':'';` +
    `if(k)s({k:k,p:location.pathname})},true)}catch(e){}})();`;
  return `<script id="presence-analytics" data-site="${siteId}">${js}</script>`;
}
