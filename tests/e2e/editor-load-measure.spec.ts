import { test, expect, devices, BrowserContext, Page, CDPSession, Route } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { installApp } from './helpers/app';
import { API, PAGE_HTML, SECTIONS, SETTINGS } from './helpers/editor';

// ── How the website editor loads (builder items 37, 38 and 142) ───────────────
// Not a pass/fail test: a measurement, run by hand before and after a change to how the editor
// loads, against a built folder served the way the app host serves it:
//   bash scripts/build-public.sh
//   node scripts/measure/serve-like-netlify.mjs dist 4729 &
//   MEASURE_EDITOR=1 MEASURE_BASE=http://127.0.0.1:4729 MEASURE_OUT=/tmp/m.json \
//     npx playwright test tests/e2e/editor-load-measure.spec.ts --project=desktop-chromium --workers=1
// It opens the Website page as a signed-in owner (the pretend server answers each read after
// MEASURE_API_MS, 450 ms by default: the live reads took 0.4 to 0.56 s once pinned to the
// database's region) on a desktop and on a phone slowed the way Lighthouse slows one (4x slower
// processor, 150 ms round trips, 1.6 Mbit/s down), and counts:
//   · every request the page makes until it has gone quiet, and the bytes they bring
//   · when the Overview shows the site (the status line set, the picture drawn)
//   · when the page is usable: the end of the last long task before two quiet seconds
//   · the time the page was frozen (long tasks' time over 50 ms, Lighthouse's "blocking time")
//   · how long Edit site takes to open, from the press to the canvas drawn
// and, signed out, which of the page's own files a second visit downloads or re-checks again.
test.skip(!process.env.MEASURE_EDITOR, 'a measurement, run by hand (MEASURE_EDITOR=1)');
test.skip(({ browserName }) => browserName !== 'chromium', 'slowing the processor needs Chromium');

const BASE = process.env.MEASURE_BASE || 'http://127.0.0.1:4729';
const RUNS = Number(process.env.MEASURE_RUNS || 5);
const API_MS = Number(process.env.MEASURE_API_MS || 450);

const PROFILES = {
  desktop: { context: { viewport: { width: 1280, height: 800 } }, cpu: 1, net: { latency: 40, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: (10 * 1024 * 1024) / 8 } },
  phone: { context: { ...devices['Pixel 5'] }, cpu: Number(process.env.MEASURE_PHONE_CPU || 6), net: { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 } },
} as const;
type Profile = keyof typeof PROFILES;

interface Req { url: string; method: string; type: string; t0: number; t1?: number; bytes: number; raw: number; status?: number; cached?: boolean }

async function watchNetwork(cdp: CDPSession) {
  const reqs = new Map<string, Req>();
  await cdp.send('Network.enable');
  cdp.on('Network.requestWillBeSent', (e) => { if (!/^(data|blob):/.test(e.request.url)) reqs.set(e.requestId, { url: e.request.url, method: e.request.method, type: e.type || '', t0: e.timestamp, bytes: 0, raw: 0 }); });
  cdp.on('Network.responseReceived', (e) => { const r = reqs.get(e.requestId); if (r) { r.status = e.response.status; r.cached = !!(e.response.fromDiskCache || e.response.fromServiceWorker || (e.response as { fromPrefetchCache?: boolean }).fromPrefetchCache); } });
  cdp.on('Network.requestServedFromCache', (e) => { const r = reqs.get(e.requestId); if (r) r.cached = true; });
  cdp.on('Network.dataReceived', (e) => { const r = reqs.get(e.requestId); if (r) r.raw += e.dataLength; });
  cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) { r.t1 = e.timestamp; r.bytes = e.encodedDataLength; } });
  cdp.on('Network.loadingFailed', (e) => { const r = reqs.get(e.requestId); if (r) r.t1 = e.timestamp; });
  return reqs;
}

// long tasks and paints, from the first moment the page exists
const OBSERVE = () => {
  const w = window as unknown as { __lt: Array<[number, number]>; __fcp: number };
  w.__lt = []; w.__fcp = 0;
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch { /* not Chromium */ }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') w.__fcp = e.startTime; }).observe({ type: 'paint', buffered: true }); } catch { /* not Chromium */ }
};

const kind = (u: string) => /\/functions\/v1\/presence/.test(u) ? 'api' : u.startsWith(BASE) ? 'page' : 'other';

async function quiet(page: Page, reqs: Map<string, Req>, ms = 2000, cap = 30_000) {
  const t0 = Date.now();
  let lastBusy = Date.now();
  let seen = -1;
  while (Date.now() - t0 < cap) {
    const open = [...reqs.values()].filter((r) => r.t1 === undefined).length;
    const lt = await page.evaluate(() => (window as unknown as { __lt: unknown[] }).__lt.length);
    if (open > 0 || lt !== seen) { lastBusy = Date.now(); seen = lt; }
    if (Date.now() - lastBusy >= ms) return;
    await page.waitForTimeout(100);   // measuring quiet: a fixed poll, nothing on the page to wait on
  }
}

async function openOnce(context: BrowserContext, profile: Profile) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const reqs = await watchNetwork(cdp);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...PROFILES[profile].net });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: PROFILES[profile].cpu });
  await installApp(page, { api: { ...API, '/settings': { data: SETTINGS } } });
  await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE_HTML(SECTIONS) }));
  // every read takes as long as a live one (registered last, so it runs first)
  await page.route('**/functions/v1/presence/**', async (route: Route) => { await new Promise((r) => setTimeout(r, API_MS)); return route.fallback(); });
  await page.addInitScript(OBSERVE);
  await page.goto(BASE + '/presence', { waitUntil: 'commit' });
  // the Overview shows the site: its status line is set and the picture is drawn
  await page.waitForFunction(() => {
    const st = document.getElementById('ssStatus');
    const f = document.getElementById('siteFrame') as HTMLIFrameElement | null;
    const drawn = !!(f && f.contentDocument && f.contentDocument.querySelector('section'));
    if (st && st.textContent && drawn && !(window as unknown as { __shown?: number }).__shown) (window as unknown as { __shown?: number }).__shown = performance.now();
    return !!(window as unknown as { __shown?: number }).__shown;
  }, null, { timeout: 60_000, polling: 'raf' });
  await quiet(page, reqs);
  const m = await page.evaluate(() => {
    const w = window as unknown as { __lt: Array<[number, number]>; __fcp: number; __shown: number };
    const lt = w.__lt;
    const usable = Math.max(w.__shown, ...lt.filter(([s]) => s <= w.__shown + 2000).map(([s, d]) => s + d));
    const tbt = lt.filter(([s]) => s >= w.__fcp && s < usable).reduce((a, [, d]) => a + Math.max(0, d - 50), 0);
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return { fcp: Math.round(w.__fcp), shown: Math.round(w.__shown), usable: Math.round(usable), tbt: Math.round(tbt), longTasks: lt.length, dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd) };
  });
  const all = [...reqs.values()];
  const sum = (rs: Req[], k: 'bytes' | 'raw') => rs.reduce((a, r) => a + r[k], 0);
  const page_ = all.filter((r) => kind(r.url) === 'page');
  const api = all.filter((r) => kind(r.url) === 'api' && r.method !== 'OPTIONS' && r.type !== 'Preflight');
  const asks = all.filter((r) => kind(r.url) === 'api' && (r.method === 'OPTIONS' || r.type === 'Preflight'));
  const open = {
    ...m,
    requests: all.length - asks.length, pageFiles: page_.length, apiCalls: api.length, preflights: asks.length, other: all.length - page_.length - api.length - asks.length,
    pageBytes: sum(page_, 'bytes'), pageRaw: sum(page_, 'raw'),
    scriptRaw: sum(page_.filter((r) => r.type === 'Script' || /\.m?js(\?|$)/.test(r.url)), 'raw'),
    files: page_.map((r) => `${r.url.replace(BASE, '')} ${r.bytes}`),
    apis: api.map((r) => `${r.method} ${r.url.replace(/^.*\/functions\/v1\/presence/, '')}`),
  };
  // Edit site: from the press to the canvas drawn and its toolbar wired
  const t0 = Date.now();
  await page.locator('#btnEditSite, [data-act="edit-site"]').first().click();
  await expect(page.locator('html')).toHaveClass(/dc-edit/, { timeout: 60_000 });
  await expect(page.frameLocator('#designPreview').locator('#dds-dc-bar')).toBeAttached({ timeout: 60_000 });
  const editOpen = Date.now() - t0;
  await page.close();
  return { ...open, editOpen };
}

// signed out (no page.route, so the browser keeps files the way it would): open the editor, go
// to another app page, come back, and see which of the page's own files the return downloads
// again, asks about again (a 304), or takes from what the browser kept.
async function secondVisit(context: BrowserContext) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await page.goto(BASE + '/presence');
  await page.waitForLoadState('load');
  await page.goto(BASE + '/today');
  await page.waitForLoadState('load');
  const reqs = await watchNetwork(cdp);
  await page.goto(BASE + '/presence');
  await page.waitForLoadState('load');
  await page.waitForTimeout(1500);   // the page's idle-time scripts
  const own = [...reqs.values()].filter((r) => kind(r.url) === 'page' && !/\/presence$/.test(r.url));
  await page.close();
  return {
    all: own.map((r) => `${r.status} ${r.cached ? 'kept' : 'net'} ${r.url.replace(BASE, '')}`),
    fetched: own.filter((r) => !r.cached && r.status === 200).length,
    rechecked: own.filter((r) => r.status === 304).length,
    kept: own.filter((r) => r.cached).length,
  };
}

test('measure how the editor loads', async ({ browser }) => {
  test.setTimeout(30 * 60_000);
  const out: Record<string, unknown> = {};
  for (const profile of Object.keys(PROFILES) as Profile[]) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const context = await browser.newContext({ ...PROFILES[profile].context, serviceWorkers: 'block' });
      runs.push(await openOnce(context, profile));
      await context.close();
    }
    const med = (k: string) => { const v = runs.map((r) => (r as unknown as Record<string, number>)[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
    out[profile] = {
      median: Object.fromEntries(['fcp', 'shown', 'usable', 'tbt', 'longTasks', 'editOpen', 'requests', 'pageFiles', 'apiCalls', 'preflights', 'other', 'pageBytes', 'pageRaw', 'scriptRaw'].map((k) => [k, med(k)])),
      runs: runs.map(({ files, apis, ...r }) => r),
      files: runs[0].files, apis: runs[0].apis,
    };
  }
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  out.secondVisit = await secondVisit(ctx);
  await ctx.close();
  const json = JSON.stringify(out, null, 2);
  if (process.env.MEASURE_OUT) writeFileSync(process.env.MEASURE_OUT, json);
  console.log(json);
});
