// ── Phase AN-2: Analytics Foundation — pure visit parsing + aggregation ───────
// Deterministic, no AI, no library. Turns a raw beacon + request headers into a
// lean, privacy-first visit row, and aggregates stored rows into plain-English-
// ready counts. Everything here is pure (except the sha256 hash) → unit-tested.

// List item 157: 'button' is a press on a link drawn as a button (the templates' .btn) that
// isn't a call, an email or a download, with its words; 'leave' is how long a page stayed
// open and in view, sent once as the visitor leaves it.
export type VisitKind = 'pageview' | 'phone' | 'email' | 'cta' | 'download' | 'outbound' | 'button' | 'leave';
export const VISIT_KINDS: VisitKind[] = ['pageview', 'phone', 'email', 'cta', 'download', 'outbound', 'button', 'leave'];

/** A pressed button's words as the collector keeps them: text only, one line, 60 characters. */
export function cleanLabel(v: unknown): string {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}
/** List item 151: a page's largest contentful paint, in whole milliseconds, 1 ms to a minute; else null. */
export function cleanLcp(v: unknown): number | null {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 && n <= 60_000 ? n : null;
}
/** How long a page stayed open, in whole milliseconds: at least a second, at most half an hour; else null. */
export function cleanMs(v: unknown): number | null {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1000 ? Math.min(n, 1_800_000) : null;
}
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

// List item 153: the AI assistants a visit can come from, known by the address their links
// come from or the tag they put on them (ChatGPT adds utm_source=chatgpt.com). In the
// sources list they share one row, "AI assistants"; aiAssistantOf says which one it was.
// Google's AI answers arrive from google.com like any search, so they count as Google.
const AI_ASSISTANTS: Array<[RegExp, string]> = [
  [/(^|\.)(chatgpt\.com|chat\.openai\.com)$|^(chatgpt|openai)$/, 'ChatGPT'],
  [/(^|\.)perplexity\.ai$|^perplexity$/, 'Perplexity'],
  [/(^|\.)(gemini|bard)\.google\.com$|^gemini$/, 'Gemini'],
  [/(^|\.)copilot\.microsoft\.com$|^copilot$/, 'Copilot'],
  [/(^|\.)claude\.ai$|^claude$/, 'Claude'],
  [/(^|\.)chat\.deepseek\.com$|^deepseek$/, 'DeepSeek'],
  [/(^|\.)meta\.ai$/, 'Meta AI'],
  [/(^|\.)chat\.mistral\.ai$/, 'Mistral'],
  [/(^|\.)grok\.com$/, 'Grok'],
  [/(^|\.)you\.com$/, 'You.com'],
  [/(^|\.)poe\.com$/, 'Poe'],
];
export const AI_SOURCE = 'AI assistants';
/** Which AI assistant a visit came from, by its referrer host or utm_source; '' for none. */
export function aiAssistantOf(refHostName: string, utmSource: string): string {
  for (const v of [refHostName, utmSource]) {
    const h = String(v || '').trim().toLowerCase().replace(/^www\./, '');
    if (h) for (const [re, name] of AI_ASSISTANTS) if (re.test(h)) return name;
  }
  return '';
}

/** A friendly source label from referrer host + UTM. Deterministic. */
export function sourceLabel(refHostName: string, utmSource: string): string {
  if (aiAssistantOf(refHostName, utmSource)) return AI_SOURCE;
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
  pages: Array<{ path: string; views: number; visitors: number }>;   // the per-page table: more rows, and people as well as views
  topSources: Array<{ source: string; visits: number }>;
  /** Item 153: the "AI assistants" row, by assistant (visitors each), largest first. */
  aiAssistants: Array<{ name: string; visits: number }>;
  devices: Array<{ device: string; share: number }>;
  countries: Array<{ country: string; visits: number }>;
  events: { phone: number; email: number; cta: number; download: number };
  hasData: boolean;
  /** True when the source rows hit the fetch cap — the PRIOR window is then
   *  undercounted, so consumers must not state a trend (AN-4: never fake). */
  truncated: boolean;
}

const topN = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

// ── List item 151: how fast pages show for real visitors (pure) ──
// From the speed each visitor's browser reports as they leave a page (largest contentful
// paint, the measure Google uses). The figure is the 75th percentile, Google's own way:
// three visitors in four saw the page at least that fast. Under 2.5 s is good, over 4 s is
// slow. Too few visits to judge is no verdict at all, never a guess.
export const SPEED_GOOD_MS = 2500, SPEED_SLOW_MS = 4000;
const SPEED_MIN_DEVICE = 20, SPEED_MIN_PAGE = 5;
export interface SpeedRow { path: string; device?: string | null; lcp_ms?: number | null }
export interface SpeedGroup { p75_ms: number; samples: number }
export interface Speed {
  samples: number;
  phones: SpeedGroup | null; computers: SpeedGroup | null;
  pages: Array<{ path: string; phones_ms: number | null; computers_ms: number | null; samples: number }>;
  verdict: 'fast' | 'a_little_slow' | 'slow' | null;
  sentence: string | null;
}
const p75 = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.max(0, Math.ceil(s.length * 0.75) - 1)]; };
/** "the home page", "the menu page": a page's path as an owner says it. */
export function pageCalled(path: string): string {
  const bits = String(path || '/').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  return bits.length ? `the ${bits[bits.length - 1].replace(/[-_]+/g, ' ')} page` : 'the home page';
}
const secs = (ms: number): string => `${(Math.round(ms / 100) / 10).toFixed(1)} s`;
export function speedOf(rows: SpeedRow[]): Speed {
  const phones: number[] = [], computers: number[] = [];
  const pages = new Map<string, { phones: number[]; computers: number[] }>();
  for (const r of rows) {
    const ms = Number(r.lcp_ms);
    if (!Number.isFinite(ms) || ms <= 0) continue;
    const onPhone = r.device === 'mobile';
    (onPhone ? phones : computers).push(ms);
    const pg = pages.get(r.path) || { phones: [], computers: [] }; (onPhone ? pg.phones : pg.computers).push(ms); pages.set(r.path, pg);
  }
  const group = (xs: number[]): SpeedGroup | null => (xs.length >= SPEED_MIN_DEVICE ? { p75_ms: Math.round(p75(xs)), samples: xs.length } : null);
  const g = { phones: group(phones), computers: group(computers) };
  const pageRows = [...pages.entries()].map(([path, v]) => ({
    path, samples: v.phones.length + v.computers.length,
    phones_ms: v.phones.length >= SPEED_MIN_PAGE ? Math.round(p75(v.phones)) : null,
    computers_ms: v.computers.length >= SPEED_MIN_PAGE ? Math.round(p75(v.computers)) : null,
  })).sort((a, b) => b.samples - a.samples).slice(0, 10);
  // the verdict follows the slower of the two, and names the slowest page there
  const judged = (['phones', 'computers'] as const).filter((k) => g[k]).sort((a, b) => g[b]!.p75_ms - g[a]!.p75_ms);
  let verdict: Speed['verdict'] = null, sentence: string | null = null;
  if (judged.length) {
    const worst = judged[0], at = g[worst]!.p75_ms;
    const slowest = pageRows.map((p) => ({ path: p.path, ms: worst === 'phones' ? p.phones_ms : p.computers_ms })).filter((p) => p.ms !== null).sort((a, b) => b.ms! - a.ms!)[0];
    const where = slowest && slowest.ms! > SPEED_GOOD_MS ? `: ${pageCalled(slowest.path)} takes ${secs(slowest.ms!)} for most visitors` : '';
    if (at <= SPEED_GOOD_MS) { verdict = 'fast'; sentence = 'Loads fast for most visitors.'; }
    else if (at <= SPEED_SLOW_MS) { verdict = 'a_little_slow'; sentence = `A little slow on ${worst}${where}.`; }
    else { verdict = 'slow'; sentence = `Slow on ${worst}${where}.`; }
  }
  return { samples: phones.length + computers.length, ...g, pages: pageRows, verdict, sentence };
}

// ── Builder list item 211: how fast the site loaded, for the monthly report (pure) ──
/** A month's speed as the report keeps it: null when too few visits reported one. */
export interface ReportSpeed { phones_ms: number | null; computers_ms: number | null; verdict: 'fast' | 'a_little_slow' | 'slow'; sentence: string }
export function reportSpeed(rows: SpeedRow[] | null): ReportSpeed | null {
  if (!rows) return null;
  const s = speedOf(rows);
  return s.verdict && s.sentence ? { phones_ms: s.phones?.p75_ms ?? null, computers_ms: s.computers?.p75_ms ?? null, verdict: s.verdict, sentence: s.sentence } : null;
}
/** The report's sentence: three visitors in four saw a page that fast or faster (Google's
 *  own measure), then whether that is fast, and the slowest page when it isn't. */
export function speedWords(s: ReportSpeed | null): string | null {
  if (!s || (s.phones_ms === null && s.computers_ms === null)) return null;
  const sec = (ms: number) => `${(Math.round(ms / 100) / 10).toFixed(1)} seconds`;
  const where = [s.phones_ms !== null ? `${sec(s.phones_ms)} on phones` : '', s.computers_ms !== null ? `${sec(s.computers_ms)} on computers` : ''].filter(Boolean).join(' and ');
  return `Three visitors in four saw your pages within ${where}. ${s.verdict === 'fast' ? `That’s fast: Google counts under ${SPEED_GOOD_MS / 1000} seconds as good.` : s.sentence}`;
}

// ── List item 157: which buttons get pressed, and how long pages stay open (pure) ──
export interface EngagementRow { kind: string; path: string; label?: string | null; ms?: number | null; visitor_hash?: string }
export interface Engagement {
  buttons: Array<{ label: string; kind: string; path: string; presses: number; people: number }>;
  time: { median_seconds: number | null; pages: Array<{ path: string; seconds: number; visits: number }> };
}
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/** The presses with words (a button, a call, an email), most pressed first, and the middle
 *  time a page stayed open, per page and for the whole site. The middle, not the average,
 *  so one tab left open overnight doesn't speak for everyone. */
export function engagementOf(rows: EngagementRow[]): Engagement {
  const presses = new Map<string, { label: string; kind: string; path: string; presses: number; seen: Set<string> }>();
  const times = new Map<string, number[]>();
  const all: number[] = [];
  for (const r of rows) {
    if (r.kind === 'leave') {
      const ms = Number(r.ms);
      if (!Number.isFinite(ms) || ms < 1000) continue;
      const list = times.get(r.path) || []; list.push(ms); times.set(r.path, list); all.push(ms);
      continue;
    }
    const label = String(r.label || '').trim();
    if (!label) continue;
    const key = `${r.kind}|${r.path}|${label.toLowerCase()}`;
    const p = presses.get(key) || { label, kind: r.kind, path: r.path, presses: 0, seen: new Set<string>() };
    p.presses++; if (r.visitor_hash) p.seen.add(r.visitor_hash);
    presses.set(key, p);
  }
  return {
    buttons: [...presses.values()].sort((a, b) => b.presses - a.presses || a.label.localeCompare(b.label)).slice(0, 8)
      .map(({ seen, ...p }) => ({ ...p, people: seen.size })),
    time: {
      median_seconds: all.length ? Math.round(median(all) / 1000) : null,
      pages: [...times.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10)
        .map(([path, list]) => ({ path, seconds: Math.round(median(list) / 1000), visits: list.length })),
    },
  };
}

export function aggregateVisits(rows: VisitRow[], nowMs: number, windowDays: number): VisitAgg {
  const w = windowDays * 86_400_000;
  const curStart = nowMs - w, priorStart = nowMs - 2 * w;
  const curVisitors = new Set<string>(), priorVisitors = new Set<string>();
  const pages = new Map<string, number>(), sources = new Map<string, number>(), devices = new Map<string, number>(), countries = new Map<string, number>();
  const srcSeen = new Map<string, Set<string>>(); // source → distinct visitor set
  const aiSeen = new Map<string, Set<string>>(); // AI assistant → distinct visitor set
  const pageSeen = new Map<string, Set<string>>(); // path → distinct visitor set
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
      if (r.path) {
        pages.set(r.path, (pages.get(r.path) || 0) + 1);
        if (r.visitor_hash) { const seen = pageSeen.get(r.path) || new Set<string>(); seen.add(r.visitor_hash); pageSeen.set(r.path, seen); }
      }
      const src = sourceLabel(r.ref_host, r.utm_source);
      const set = srcSeen.get(src) || new Set<string>(); set.add(r.visitor_hash || String(ms)); srcSeen.set(src, set);
      const ai = src === AI_SOURCE ? aiAssistantOf(r.ref_host, r.utm_source) : '';
      if (ai) { const seen = aiSeen.get(ai) || new Set<string>(); seen.add(r.visitor_hash || String(ms)); aiSeen.set(ai, seen); }
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
    pages: topN(pages, 10).map(([path, views]) => ({ path, views, visitors: pageSeen.get(path)?.size || 0 })),
    topSources: topN(sources, 5).map(([source, visits]) => ({ source, visits })),
    aiAssistants: topN(new Map([...aiSeen].map(([name, set]) => [name, set.size])), 5).map(([name, visits]) => ({ name, visits })),
    devices: topN(devices, 3).map(([device, n]) => ({ device, share: Math.round((n / devTotal) * 100) })),
    countries: topN(countries, 5).map(([country, visits]) => ({ country, visits })),
    events,
    hasData: pageviews > 0 || curVisitors.size > 0,
    truncated: (rows as VisitRow[] & { truncated?: boolean }).truncated === true,
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
    `var b=/(^|\\s)btn(\\s|$)/.test(a.className||'');` +
    `var k=a.hasAttribute('download')||/\\.(pdf|zip|docx?|xlsx?|csv)$/i.test(h)?'download':/^tel:/i.test(h)?'phone':/^mailto:/i.test(h)?'email':a.hasAttribute('data-cta')?'cta':b?'button':(/^https?:/i.test(h)&&h.indexOf(location.host)<0)?'outbound':'';` +
    // list item 157: a button's own words, and a phone or email link's, so Analytics can say which ones get pressed
    `var l=b||k==='cta'||k==='phone'||k==='email'?(a.getAttribute('aria-label')||a.textContent||'').replace(/\\s+/g,' ').trim().slice(0,60):'';` +
    `if(k)s({k:k,p:location.pathname,l:l})},true);` +
    // list item 157: how long the page was open and in view, sent once as the visitor leaves it
    `var t0=document.visibilityState==='visible'?Date.now():0,seen=0,gone=0,lcp=0;` +
    // list item 151: how long the page's main content took to show, the measure Google uses (Safari doesn't report it)
    `try{new PerformanceObserver(function(l){var e=l.getEntries();if(e.length)lcp=e[e.length-1].startTime}).observe({type:'largest-contentful-paint',buffered:true})}catch(e){}` +
    `function leave(){if(t0){seen+=Date.now()-t0;t0=0}if(!gone&&seen>=1000){gone=1;s({k:'leave',p:location.pathname,ms:Math.min(seen,1800000),lcp:Math.round(lcp)})}}` +
    `document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')leave();else if(!gone)t0=Date.now()});` +
    `addEventListener('pagehide',leave)}catch(e){}})();`;
  return `<script id="presence-analytics" data-site="${siteId}">${js}</script>`;
}
