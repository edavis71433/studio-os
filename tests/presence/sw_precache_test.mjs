// ── Builder item 264 (Nov 22 review): the service worker's install list must be fetchable ──
//   deno run --allow-read tests/presence/sw_precache_test.mjs
// A worker installs only if every page on its PRECACHE list can be fetched. Four of the
// five pages it listed (/about, /services, /work, /contact) now forward to the Squarespace
// site (_redirects: the app-host rules), whose answer a worker may not read, so in a new
// browser the worker never installed and the installable app and phone alerts were gone.
// This reads sw.js and _redirects together: no stored page may be one that forwards off
// this site, and every stored page must be a file that exists here.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const sw = read('sw.js');
const list = (name) => {
  const m = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(sw);
  return m ? [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]) : null;
};
const PRECACHE = list('PRECACHE'), NETWORK_FIRST = list('NETWORK_FIRST');
ok('sw.js has a PRECACHE list and a NETWORK_FIRST list', Array.isArray(PRECACHE) && Array.isArray(NETWORK_FIRST));

// _redirects, as Netlify reads it: "from to [status]" per line, the first match wins. A rule
// whose "from" names the app host applies there; a bare path applies on every host.
const APP = 'https://app.davisdigitalstudio.com';
const rules = read('_redirects').split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean).map((l) => l.split(/\s+/)).filter((p) => p.length >= 2)
  .map(([from, to, status]) => ({ from: from.startsWith(APP) ? from.slice(APP.length) || '/' : from, hostOnly: from.startsWith(APP), to, status: String(status || '301').replace('!', '') }))
  .filter((r) => !/^https?:\/\//.test(r.from));   // rules for other hosts don't apply here
const matches = (rule, path) => rule.from === path || (rule.from.endsWith('/*') && path.startsWith(rule.from.slice(0, -1)));
/** Where the app host sends a path: 'away' (another site), 'here' (a page of its own), or '' (no rule). */
export function forwardOf(path) {
  const r = rules.find((x) => matches(x, path));
  if (!r) return '';
  return /^https?:\/\//.test(r.to) && !r.to.startsWith(APP) && /^30[1278]$/.test(r.status) ? 'away' : 'here';
}

for (const p of PRECACHE) {
  ok(`PRECACHE ${p}: stays on this site (no forward away)`, forwardOf(p) !== 'away', `_redirects sends it to ${(rules.find((x) => matches(x, p)) || {}).to}`);
  const file = p.replace(/^\//, '') + (/\.[a-z0-9]+$/i.test(p) ? '' : '.html');
  let exists = false; try { Deno.statSync(new URL(file, ROOT)); exists = true; } catch { /* missing */ }
  ok(`PRECACHE ${p}: is a file in the repo (${file})`, exists);
}
ok('PRECACHE is not empty (the worker still stores its own not-found page)', PRECACHE.length >= 1 && PRECACHE.includes('/404.html'));
for (const p of NETWORK_FIRST) ok(`NETWORK_FIRST ${p}: stays on this site`, forwardOf(p) !== 'away', `_redirects sends it to ${(rules.find((x) => matches(x, p)) || {}).to}`);
// the pages the review measured as forwarding away may not come back
for (const p of ['/about', '/services', '/work', '/contact']) {
  ok(`${p} forwards to the marketing site today, so the worker must not list it`, forwardOf(p) === 'away' && !PRECACHE.includes(p) && !NETWORK_FIRST.includes(p));
}
ok('the cache name moved on from dds-v18, so browsers holding the old worker rotate to this one', /CACHE_NAME = 'dds-v(19|[2-9]\d)'/.test(sw));

const passed = results.filter(Boolean).length;
console.log(`\n════ SERVICE WORKER INSTALL LIST (builder item 264): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
