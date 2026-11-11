// ── Item 64: the service worker caches the marketing pages and pictures, never an app page ──
//   deno run --allow-read tests/presence/service_worker_test.mjs
// Runs sw.js against a fake worker scope and asks it, request by request, whether it answers
// (and from where). An app page the worker answers from its cache reaches the visitor one
// deploy late; that was Settings, Customers and Send an update, and any new page.
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const src = Deno.readTextFileSync(new URL('../../sw.js', import.meta.url));

const listeners = {};
const scope = { addEventListener: (k, fn) => { listeners[k] = fn; }, location: { origin: 'https://app.example' }, registration: {}, clients: {}, skipWaiting() {} };
const cacheHits = [];
const caches = { match: (r) => { cacheHits.push(r.url); return Promise.resolve(undefined); }, open: () => Promise.resolve({ put() {}, addAll() { return Promise.resolve(); } }), keys: () => Promise.resolve([]) };
const fetchCalls = [];
const fakeFetch = (r) => { fetchCalls.push(r.url); return Promise.resolve({ ok: true, clone() { return this; } }); };
new Function('self', 'caches', 'fetch', 'location', src)(scope, caches, fakeFetch, scope.location);

// what the worker does with one GET: 'network' = left to the browser, else how it answered
async function handled(path) {
  let answer = null;
  cacheHits.length = 0; fetchCalls.length = 0;
  listeners.fetch({ request: { method: 'GET', url: `https://app.example${path}` }, respondWith: (p) => { answer = p; } });
  if (!answer) return 'network';
  await answer;
  return cacheHits.length && !fetchCalls.length ? 'cache' : cacheHits.length ? 'cache-then-refresh' : 'network-first';
}

for (const p of ['/settings', '/settings.html', '/customers', '/broadcasts', '/sales/today', '/presence.html', '/today.html', '/inbox', '/a-page-added-next-year', '/shell.js', '/tokens.css', '/vendor/supabase.js', '/report/abc', '/site-review']) {
  ok(`app and unknown: ${p} is left to the network`, (await handled(p)) === 'network');
}
for (const p of ['/', '/about', '/about.html', '/about/', '/services', '/contact', '/burbank-web-design', '/privacy']) {
  ok(`marketing: ${p} comes fresh from the network, the cache only offline`, (await handled(p)) === 'network-first');
}
for (const p of ['/eric-davis.webp', '/icon-192.png', '/fonts/library/inter-400.woff2', '/favicon.png']) {
  ok(`pictures and fonts: ${p} from the cache, refreshed behind`, (await handled(p)) === 'cache-then-refresh');
}
ok('a POST is never touched', (() => { let a = null; listeners.fetch({ request: { method: 'POST', url: 'https://app.example/about' }, respondWith: (p) => { a = p; } }); return a === null; })());
ok('another origin is never touched', (() => { let a = null; listeners.fetch({ request: { method: 'GET', url: 'https://cdn.example/x.png' }, respondWith: (p) => { a = p; } }); return a === null; })());
// list item 139: the old report card forwards to the Site Review, so the worker leaves it to the network
ok('a retired page that forwards elsewhere is left to the network: /report-card', (await handled('/report-card')) === 'network');
ok('the cache name moved on, so old copies are deleted on activate', /const CACHE_NAME = 'dds-v18'/.test(src));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SERVICE WORKER: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
