// ── M4 renderer test suite ───────────────────────────────────────────────────
// Golden files (the approval mechanism for renderer changes), determinism,
// hostile/XSS fixtures, accessibility structure, manifest validation, and
// performance measurement. Pure local run: no network, no env.
//
//   deno run --allow-read [--allow-write] tests/presence/render_test.mjs [--update-golden]
//
// --update-golden regenerates tests/presence/golden/restaurant-classic-1.0.0.json
// (path -> sha256). Committing that file IS the approval of a renderer change.
import { renderSnapshot, getTemplate } from '../../supabase/functions/presence/lib/render.ts';
import { validateSnapshot } from '../../supabase/functions/presence/lib/manifest_validate.ts';
import { renderMarkdown } from '../../supabase/functions/presence/lib/markdown.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const UPDATE = Deno.args.includes('--update-golden');
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
async function sha(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const fixture = JSON.parse(read('supabase/functions/presence/templates/restaurant-classic/1.0.0/fixture.json'));
const SITE = { baseUrl: 'https://vermilionandvine.example', brand: { credit: 'Site by Davis Digital Studio' } };

// ═══ 1. determinism: identical input → byte-identical output, twice ═══
const a = renderSnapshot(fixture, SITE);
const b = renderSnapshot(fixture, SITE);
{
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  let same = ka.length === kb.length && ka.every((k, ix) => k === kb[ix]);
  if (same) for (const k of ka) if (a[k] !== b[k]) { same = false; break; }
  ok('determinism: render twice → identical file maps', same, `${ka.length} files`);
}
{ // input mutation must change output (drift detection sanity)
  const mut = structuredClone(fixture);
  mut.content.identity.tagline = 'CHANGED';
  const c = renderSnapshot(mut, SITE);
  ok('determinism: changed input → changed output', c['index.html'] !== a['index.html']);
}

// ═══ 2. golden files ═══
const goldenPath = new URL('tests/presence/golden/restaurant-classic-1.0.0.json', ROOT);
const digest = {};
for (const k of Object.keys(a).sort()) digest[k] = await sha(String(a[k]));
if (UPDATE) {
  await Deno.mkdir(new URL('tests/presence/golden/', ROOT), { recursive: true });
  await Deno.writeTextFile(goldenPath, JSON.stringify(digest, null, 1) + '\n');
  console.log(`golden updated: ${Object.keys(digest).length} files`);
} else {
  let golden = null;
  try { golden = JSON.parse(await Deno.readTextFile(goldenPath)); } catch { /* absent */ }
  if (!golden) ok('golden: baseline exists', false, 'run with --update-golden once');
  else {
    const gk = Object.keys(golden).sort(), dk = Object.keys(digest).sort();
    const sameSet = gk.length === dk.length && gk.every((k, i) => k === dk[i]);
    const drift = sameSet ? gk.filter((k) => golden[k] !== digest[k]) : ['<file set changed>'];
    ok('golden: output matches committed baseline', sameSet && drift.length === 0, drift.slice(0, 3).join(', '));
  }
}

// ═══ 3. hostile / XSS fixtures ═══
const hostile = structuredClone(fixture);
hostile.content.identity.business_name = `<script>alert(1)</script> Bistro`;
hostile.content.identity.tagline = `" onmouseover="alert(1)" data-x="`;
hostile.content.identity.description = `<img src=x onerror=alert(1)>`;
hostile.content.identity.booking_url = `javascript:alert(1)`;
hostile.content.identity.social = { instagram: `javascript:alert(2)` };
hostile.content.offerings.push({ id: 'hx', name: `<svg onload=alert(1)>`, category: `"><script>`, description: `<iframe src="https://evil.example"></iframe>`, price_text: `<b>$0</b>` });
hostile.content.faqs.push({ id: 'fx', question: `</dt><script>alert(1)</script>`, answer: `<style>*{display:none}</style>` });
hostile.content.testimonials.push({ id: 'tx', quote: `';alert(1);//`, author: `<a href="javascript:alert(1)">x</a>` });
hostile.content.posts.push({
  id: 'px', title: `<script>t</script>`, slug: 'hostile-post', published_at: '2026-02-02T00:00:00Z',
  body_md: `# raw h1 demoted\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[click](javascript:alert(1)) and [ok](https://safe.example)\n\n[data](data:text/html,<script>alert(1)</script>)\n\n> quote with <b>html</b>\n\n- item <script>x</script>\n\n**bold** and *em* survive`,
});
hostile.content.redirects.push({ from_path: '/x', to_path: '/y' });
const h = renderSnapshot(hostile, SITE);
{
  const htmlFiles = Object.entries(h).filter(([k]) => k.endsWith('.html'));
  let bad = [];
  for (const [k, v] of htmlFiles) {
    const s = String(v);
    // strip the template's OWN legitimate blocks (critical CSS, hours island,
    // open-now script, JSON-LD) before hunting for INJECTED markup. Anything
    // hostile is escaped to &lt;/&quot; and can never form a real tag/attr.
    const stripped = s
      .replace(/<style>[\s\S]*?<\/style>/g, '')
      .replace(/<script id="hours-data" type="application\/json">[\s\S]*?<\/script>/, '')
      .replace(/<script>\(function\(\)\{[\s\S]*?<\/script>/, '')
      .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
    if (/<script[\s>]/i.test(stripped)) bad.push(`${k}: <script survived`);
    // a real event handler = on\w+= INSIDE an actual element tag (escaped text can't be)
    if (/<[a-z][a-z0-9]*\b[^>]*\son\w+\s*=/i.test(stripped)) bad.push(`${k}: event handler survived`);
    // javascript:/data: only dangerous inside a real href/src attribute
    if (/(?:href|src)\s*=\s*"(?:javascript|data):/i.test(stripped)) bad.push(`${k}: dangerous-scheme url survived`);
    if (/<iframe[\s>]|<svg\b[^>]*\sonload|<object[\s>]|<embed[\s>]/i.test(stripped)) bad.push(`${k}: embedded element survived`);
  }
  ok('hostile: no script/handler/javascript:/iframe survives in any page', bad.length === 0, bad.slice(0, 3).join(' | '));
}
{
  const post = String(h['updates/hostile-post/index.html']);
  ok('hostile: markdown bold/em still render (content preserved, meaning stripped)', post.includes('<strong>bold</strong>') && post.includes('<em>em</em>'));
  ok('hostile: safe link kept, javascript:/data: links dropped to text', post.includes('href="https://safe.example"') && !post.includes('href="javascript:') && !post.includes('href="data:'));
  ok('hostile: raw # h1 demoted to h2 (heading hierarchy preserved)', /<h2>raw h1 demoted<\/h2>/.test(post));
}
{ // markdown unit: escaped-first property
  const md = renderMarkdown('<script>x</script> **b**');
  ok('markdown: escape-first (no raw html ever)', md.includes('&lt;script&gt;') && md.includes('<strong>b</strong>'));
}

// ═══ 4. accessibility structure (every page) ═══
{
  const pages = Object.entries(a).filter(([k]) => k.endsWith('.html'));
  let bad = [];
  for (const [k, v] of pages) {
    const s = String(v);
    const h1s = (s.match(/<h1[\s>]/g) || []).length;
    if (h1s !== 1) bad.push(`${k}: h1 count ${h1s}`);
    if (!s.includes('class="skip"')) bad.push(`${k}: no skip link`);
    if (!/<main id="main">/.test(s)) bad.push(`${k}: no main landmark`);
    if (!/<nav class="primary" aria-label="Main">/.test(s)) bad.push(`${k}: no labeled nav`);
    if (!/<html lang="en">/.test(s)) bad.push(`${k}: no lang`);
    if (!/aria-current="page"/.test(s) && !k.startsWith('404') && !k.startsWith('updates/') && !k.startsWith('privacy/') && !k.startsWith('accessibility/')) bad.push(`${k}: no aria-current`);   // footer utility pages aren't nav destinations
    // every <img has non-empty alt
    for (const m of s.matchAll(/<img\b[^>]*>/g)) {
      const alt = m[0].match(/alt="([^"]*)"/);
      if (!alt || !alt[1].trim()) bad.push(`${k}: img missing alt`);
    }
    if (!/viewport-fit=cover/.test(s)) bad.push(`${k}: viewport-fit missing`);
  }
  ok('a11y: single h1, skip link, landmarks, lang, aria-current, alt on every img', bad.length === 0, bad.slice(0, 4).join(' | '));
  ok('a11y: reduced-motion + focus-visible in stylesheet', String(a[Object.keys(a).find((k) => k.startsWith('assets/'))]).includes('prefers-reduced-motion') && String(a[Object.keys(a).find((k) => k.startsWith('assets/'))]).includes(':focus-visible'));
}

// ═══ 5. SEO / AEO output ═══
{
  const home = String(a['index.html']);
  ok('seo: canonical + og + twitter + description on home', home.includes('rel="canonical"') && home.includes('property="og:title"') && home.includes('name="twitter:card"') && home.includes('name="description"'));
  ok('seo: Restaurant JSON-LD with special hours', home.includes('"@type":"Restaurant"') && home.includes('specialOpeningHoursSpecification'));
  ok('seo: visible-HTML hours table on every page footer', home.includes('<table class="hours"') && String(a['menu/index.html']).includes('<table class="hours"'));
  ok('regions: R3 marker attributes present', home.includes('data-pr="identity.business_name"') && home.includes('data-pr="location.hours"') && String(a['menu/index.html']).includes('data-pr="offering" data-pr-id='));
  ok('aeo: FAQPage JSON-LD + always-visible answers', String(a['faq/index.html']).includes('"@type":"FAQPage"') && !String(a['faq/index.html']).includes('<details'));
  ok('seo: menu JSON-LD', String(a['menu/index.html']).includes('"@type":"Menu"'));
  ok('seo: sitemap lists all pages, robots points at it', String(a['sitemap.xml']).includes('/updates/winter-menu-2026/') && String(a['robots.txt']).includes('sitemap.xml'));
  ok('redirects: 301 map emitted', String(a['_redirects']).includes('/menu.html  /menu/  301'));
  ok('assets: immutable cache headers emitted', String(a['_headers']).includes('immutable'));
  ok('404 page + svg favicon emitted', '404.html' in a && 'favicon.svg' in a);
}

// ═══ 6. purity: no external origins in output ═══
{
  let leaks = [];
  for (const [k, v] of Object.entries(a)) {
    const s = String(v);
    for (const m of s.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)) {
      const u = m[1];
      if (u.startsWith(SITE.baseUrl)) continue;
      // allowed external references: user-entered links (booking/social/maps/mailto handled elsewhere)
      if (/^https:\/\/(resy\.example|instagram\.com|www\.google\.com\/maps|safe\.example)/.test(u)) continue;
      if (k === 'sitemap.xml' || k === 'robots.txt') continue;
      leaks.push(`${k}: ${u.slice(0, 60)}`);
    }
    if (/fonts\.googleapis|fonts\.gstatic|cdn\./i.test(s)) leaks.push(`${k}: CDN reference`);
  }
  ok('purity: zero external ASSET origins (fonts/cdn) — only user links leave the site', leaks.length === 0, leaks.slice(0, 3).join(' | '));
}

// ═══ 7. manifest validation (pass/fail drafts) ═══
{
  const t = getTemplate('restaurant-classic', '1.0.0');
  const good = validateSnapshot(fixture, t.manifest);
  ok('validate: fixture passes with expected warnings only', good.ok && good.blockers.length === 0, `warnings=${good.warnings.length}`);
  const badSnap = structuredClone(fixture);
  badSnap.content.identity.business_name = '';
  badSnap.content.identity.phone = ''; badSnap.content.identity.email = '';
  badSnap.content.locations[0].hours = badSnap.content.locations[0].hours.slice(0, 3);
  badSnap.content.posts.push({ id: 'bad', title: '', slug: 'Bad Slug!', body_md: '', published_at: '2026-01-01T00:00:00Z' });
  badSnap.content.redirects.push({ from_path: '/a', to_path: '/b' }, { from_path: '/b', to_path: '/c' });
  const bad2 = validateSnapshot(badSnap, t.manifest);
  const fields = bad2.blockers.map((x) => x.field).join(',');
  ok('validate: blockers fire (name, contact, hours, post, redirect chain)',
    !bad2.ok && fields.includes('identity.business_name') && fields.includes('identity.phone') && fields.includes('location.hours') && fields.includes('posts.bad') && fields.includes('redirects'),
    `${bad2.blockers.length} blockers`);
  const capSnap = structuredClone(fixture);
  for (let i = 0; i < 100; i++) capSnap.content.offerings.push({ id: 'c' + i, name: 'X' + i, category: 'Cap' });
  ok('validate: entity caps enforced', !validateSnapshot(capSnap, t.manifest).ok);
}

// ═══ 8. performance (measured, budgets from M3.75) ═══
{
  // maxed fixture: fill to manifest caps
  const t = getTemplate('restaurant-classic', '1.0.0');
  const maxed = structuredClone(fixture);
  while (maxed.content.offerings.length < 80) maxed.content.offerings.push({ id: 'm' + maxed.content.offerings.length, name: 'Dish number ' + maxed.content.offerings.length + ' with a reasonably long name', category: 'Section ' + (maxed.content.offerings.length % 8), description: 'A hearty description of this dish with seasonal ingredients and local produce, about this long.', price_text: '$' + (10 + (maxed.content.offerings.length % 30)) });
  while (maxed.content.faqs.length < 20) maxed.content.faqs.push({ id: 'mf' + maxed.content.faqs.length, question: 'Question number ' + maxed.content.faqs.length + ' about the restaurant?', answer: 'A thorough plain-language answer that runs a sentence or three, giving customers everything they need to know.'.repeat(2) });
  while (maxed.content.testimonials.length < 12) maxed.content.testimonials.push({ id: 'mt' + maxed.content.testimonials.length, quote: 'Wonderful evening, superb plates, we will absolutely return with friends.', author: 'Guest ' + maxed.content.testimonials.length });
  while (maxed.content.posts.length < 50) maxed.content.posts.push({ id: 'mp' + maxed.content.posts.length, title: 'Update number ' + maxed.content.posts.length, slug: 'update-' + maxed.content.posts.length, body_md: ('Paragraph of news.\n\n## Details\n\n- point one\n- point two\n\n**Bold** closing line.\n').repeat(6), published_at: '2026-03-01T00:00:00Z' });
  const vr = validateSnapshot(maxed, t.manifest);
  ok('perf: maxed fixture is cap-legal', vr.ok, vr.blockers.map((x) => x.field).slice(0, 3).join(','));

  const N = 5; const times = [];
  for (let i = 0; i < N; i++) { const t0 = performance.now(); renderSnapshot(maxed, SITE); times.push(performance.now() - t0); }
  times.sort((x, y) => x - y);
  const p50 = times[Math.floor(N / 2)];
  const out = renderSnapshot(maxed, SITE);
  const nFiles = Object.keys(out).length;
  const totalKB = Math.round(Object.values(out).reduce((s, v) => s + String(v).length, 0) / 1024);
  const homeKB = Math.round(String(out['index.html']).length / 1024);
  const cssKB = Math.round(String(out[Object.keys(out).find((k) => k.startsWith('assets/'))]).length / 1024);
  console.log(`\nPERF maxed fixture: render p50=${p50.toFixed(1)}ms max=${times[N - 1].toFixed(1)}ms | ${nFiles} files, ${totalKB}KB total | home ${homeKB}KB | css ${cssKB}KB`);
  ok('perf: maxed render p50 < 250ms (edge headroom >> 50%)', p50 < 250, `${p50.toFixed(1)}ms`);
  ok('perf: home HTML + CSS < 200KB above-the-fold budget', homeKB + cssKB < 200, `${homeKB + cssKB}KB`);
  ok('perf: inline JS < 10KB budget', String(out['index.html']).match(/<script>([\s\S]*?)<\/script>/)[1].length < 10240);
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ RENDERER SUITE: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) { for (const f of fails) console.log(' FAIL:', f.n); Deno.exit(1); }
