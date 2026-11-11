// ── List item 144: the app's safety rule names only what the pages use ───────
// The content rule in _headers (/*) covers every page of the app host and the
// marketing and tools pages. Over time it gathered addresses nothing loads any more
// (an old script CDN, Stripe and Calendly frames, the email provider's API, Google's
// APIs, two sample-photo sites, and Google Fonts once item 143 moved the fonts home).
// Each one was a place an injected script could load from or send data to. This pins
// the rule to what the pages need: a new outside address must be used by a page, or
// be named below with the reason it arrives from data instead of from page code.
//   deno run --allow-read tests/presence/app_csp_test.mjs
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

const results = [];
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${!p && d ? `\n      ${d}` : ''}`); };

const headers = read('_headers');
const star = headers.split(/\n(?=\S)/).find((b) => b.startsWith('/*\n')) || '';
const csp = (star.match(/^\s*Content-Security-Policy:\s*(.+)$/m) || [])[1] || '';
ok('the app host sends one content rule', !!csp && (headers.match(/Content-Security-Policy:/g) || []).length === 1);
const directives = new Map(csp.split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([k, ...v]) => [k, v]));

// ── what each directive allows ────────────────────────────────────────────────
ok('scripts: our own, the consent-gated analytics, the free tools\' human check, nothing else',
  (directives.get('script-src') || []).join(' ') === "'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://challenges.cloudflare.com");
ok('styles and fonts come only from the site itself (no Google Fonts)',
  (directives.get('style-src') || []).join(' ') === "'self' 'unsafe-inline'" && (directives.get('font-src') || []).join(' ') === "'self'");
ok('frames: only the human check', (directives.get('frame-src') || []).join(' ') === 'https://challenges.cloudflare.com');
ok('forms post only to the site and the contact form service', (directives.get('form-action') || []).join(' ') === "'self' https://formspree.io");
ok('no other site may frame a page (the same as X-Frame-Options: DENY)', (directives.get('frame-ancestors') || []).join(' ') === "'none'" && /X-Frame-Options: DENY/.test(star));
ok('plugins and <base> stay shut', (directives.get('object-src') || []).join(' ') === "'none'" && (directives.get('base-uri') || []).join(' ') === "'self'");
ok('anything not named falls back to the site itself', (directives.get('default-src') || []).join(' ') === "'self'");

// ── every outside address is used ────────────────────────────────────────────
// Addresses that come from data or from a script we load, not from page code, so no
// file names them: our own server (API, sign-in, stored photos); the stock library's
// photos (Pexels' search results carry their own addresses); and the addresses
// Google's tag sends to and draws from once a visitor says yes (analytics.js loads it).
const FROM_DATA = new Map([
  ['https://*.supabase.co', 'our server: every API call, sign-in, stored photos'],
  ['https://images.pexels.com', 'stock photo thumbnails, addresses from the search results'],
  ['https://www.google-analytics.com', "Google's tag, after consent"],
  ['https://analytics.google.com', "Google's tag, after consent"],
  ['https://region1.google-analytics.com', "Google's tag, after consent"],
]);
const INTERNAL = new Set(['email-signature.html', 'styleguide.html', 'a11y.html', 'provision.html']);
const files = [...Deno.readDirSync(ROOT)].filter((e) => e.isFile && /\.(html|js|css)$/.test(e.name) && !INTERNAL.has(e.name)).map((e) => e.name);
const code = files.map(read).join('\n');
const hosts = new Set([...directives.values()].flat().filter((v) => /^https:\/\//.test(v)));
const unused = [...hosts].filter((h) => !FROM_DATA.has(h) && !code.includes(h.replace(/^https:\/\//, '')));
ok('every outside address in the rule is used by a page, or arrives from data for a stated reason', unused.length === 0, unused.join(', '));
const RETIRED = ['cdn.jsdelivr.net', 'buy.stripe.com', 'calendly.com', 'api.resend.com', 'www.googleapis.com', 'pagespeedonline.googleapis.com', 'images.unsplash.com', 'plus.unsplash.com', 'picsum.photos', 'fonts.googleapis.com', 'fonts.gstatic.com'];
ok('the eleven addresses nothing used are gone', RETIRED.every((h) => !csp.includes(h)), RETIRED.filter((h) => csp.includes(h)).join(', '));

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) Deno.exit(1);
