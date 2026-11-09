// ── M4 renderer test suite ───────────────────────────────────────────────────
// Golden files (the approval mechanism for renderer changes), determinism,
// hostile/XSS fixtures, accessibility structure, manifest validation, and
// performance measurement. Pure local run: no network, no env.
//
//   deno run --allow-read --allow-env [--allow-write] tests/presence/render_test.mjs [--update-golden]
//
// Restaurant Classic's own sample runs the deep checks (1 to 6). Then every template draws
// its own sample and its full sample (full_fixture.mjs: every section the builder offers, a
// page of the owner's own, a dropdown menu) through the structure checks, the hostile pass
// and its golden (7).
//
// --update-golden rewrites, for every template, tests/presence/golden/<slug>-1.0.0.json (each
// drawn file's sha256: the exact check) and tests/presence/golden/<slug>-1.0.0/ (the same
// files with a line break between tags, to read in a pull request). Committing both IS the
// approval of a renderer change.
import { renderSnapshot, getTemplate } from '../../supabase/functions/presence/lib/render.ts';
import { validateSnapshot } from '../../supabase/functions/presence/lib/manifest_validate.ts';
import { renderMarkdown } from '../../supabase/functions/presence/lib/markdown.ts';
import { sectionStyles, pageClasses } from '../../supabase/functions/presence/lib/site_blocks.ts';
import { vocabFor } from '../../supabase/functions/presence/lib/industry_vocab.ts';
import { TEMPLATES, fixture as sampleOf, fullFixture, storedSections, PAGE } from './full_fixture.mjs';

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

// The structure every real page keeps (a redirect stub isn't one): one h1, the skip link,
// the main landmark, a labelled menu, the language, room for a phone's notch, alt text on
// every picture (empty only on one marked decorative), and a menu that links to the page
// marks the link as the page you're on.
function structureProblems(files) {
  const bad = [];
  for (const [k, v] of Object.entries(files)) {
    if (!k.endsWith('.html')) continue;
    const s = String(v);
    if (s.includes('http-equiv="refresh"')) continue;
    const h1s = (s.match(/<h1[\s>]/g) || []).length;
    if (h1s !== 1) bad.push(`${k}: h1 count ${h1s}`);
    if (!s.includes('class="skip"')) bad.push(`${k}: no skip link`);
    if (!/<main id="main">/.test(s)) bad.push(`${k}: no main landmark`);
    const menu = s.match(/<nav class="primary" aria-label="Main">([\s\S]*?)<\/nav>/);
    if (!menu) bad.push(`${k}: no labeled nav`);
    if (!/<html lang="en">/.test(s)) bad.push(`${k}: no lang`);
    if (!/viewport-fit=cover/.test(s)) bad.push(`${k}: viewport-fit missing`);
    for (const m of s.matchAll(/<img\b[^>]*>/g)) {
      const alt = m[0].match(/alt="([^"]*)"/);
      if (!alt || (!alt[1].trim() && !m[0].includes('role="presentation"'))) bad.push(`${k}: img missing alt`);
    }
    const here = k === 'index.html' ? '/' : `/${k.replace(/index\.html$/, '')}`;
    if (menu && menu[1].includes(`href="${here}"`) && !new RegExp(`href="${here.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*aria-current="page"`).test(menu[1])) bad.push(`${k}: the menu links here without marking it current`);
  }
  return bad;
}
// Nothing loads from another site: an outside address is only ever a link a visitor follows.
function loadsFromElsewhere(files, base) {
  const leaks = [];
  for (const [k, v] of Object.entries(files)) {
    const s = String(v);
    for (const [tag] of s.matchAll(/<[a-z][a-z0-9]*\b[^>]*>/gi)) {
      for (const m of tag.matchAll(/\s(?:src|srcset|poster)="([^"]*)"/gi)) if (/(?:^|,\s*)(?:https?:)?\/\//i.test(m[1]) && !m[1].startsWith(base)) leaks.push(`${k}: ${m[1].slice(0, 60)}`);
      if (/^<link\b/i.test(tag)) for (const m of tag.matchAll(/\shref="((?:https?:)?\/\/[^"]+)"/gi)) if (!m[1].startsWith(base)) leaks.push(`${k}: ${m[1].slice(0, 60)}`);
    }
    if (/url\(\s*['"]?(?:https?:)?\/\/|@import/i.test(s)) leaks.push(`${k}: a stylesheet reaches out`);
    if (/fonts\.googleapis|fonts\.gstatic|cdn\./i.test(s)) leaks.push(`${k}: CDN reference`);
  }
  return leaks;
}

// ═══ 1. determinism: identical input → byte-identical output, twice ═══
const a = await renderSnapshot(fixture, SITE);
const b = await renderSnapshot(fixture, SITE);
{
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  let same = ka.length === kb.length && ka.every((k, ix) => k === kb[ix]);
  if (same) for (const k of ka) if (a[k] !== b[k]) { same = false; break; }
  ok('determinism: render twice → identical file maps', same, `${ka.length} files`);
}
{ // input mutation must change output (drift detection sanity)
  const mut = structuredClone(fixture);
  mut.content.identity.tagline = 'CHANGED';
  const c = await renderSnapshot(mut, SITE);
  ok('determinism: changed input → changed output', c['index.html'] !== a['index.html']);
}

// ═══ 2. hostile / XSS fixtures ═══
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
const h = await renderSnapshot(hostile, SITE);
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
      .replace(/<script>\(function\(\)\{[\s\S]*?<\/script>/g, '')
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

// ═══ 3. SEO / AEO output ═══
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
  const leaks = loadsFromElsewhere(a, SITE.baseUrl);
  ok('purity: zero external ASSET origins (fonts/cdn) — only user links leave the site', leaks.length === 0, leaks.slice(0, 3).join(' | '));
}

// ═══ 4. manifest validation (pass/fail drafts) ═══
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

// ═══ 5. performance (measured, budgets from M3.75) ═══
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
  for (let i = 0; i < N; i++) { const t0 = performance.now(); await renderSnapshot(maxed, SITE); times.push(performance.now() - t0); }
  times.sort((x, y) => x - y);
  const p50 = times[Math.floor(N / 2)];
  const out = await renderSnapshot(maxed, SITE);
  const nFiles = Object.keys(out).length;
  const totalKB = Math.round(Object.values(out).reduce((s, v) => s + String(v).length, 0) / 1024);
  const homeKB = Math.round(String(out['index.html']).length / 1024);
  const cssKB = Math.round(String(out[Object.keys(out).find((k) => k.startsWith('assets/'))]).length / 1024);
  console.log(`\nPERF maxed fixture: render p50=${p50.toFixed(1)}ms max=${times[N - 1].toFixed(1)}ms | ${nFiles} files, ${totalKB}KB total | home ${homeKB}KB | css ${cssKB}KB`);
  ok('perf: maxed render p50 < 250ms (edge headroom >> 50%)', p50 < 250, `${p50.toFixed(1)}ms`);
  ok('perf: home HTML + CSS < 200KB above-the-fold budget', homeKB + cssKB < 200, `${homeKB + cssKB}KB`);
  ok('perf: inline JS < 10KB budget', String(out['index.html']).match(/<script>([\s\S]*?)<\/script>/)[1].length < 10240);
}

// ═══ 6. reduced motion + focus in Restaurant Classic's stylesheet ═══
{
  const css = String(a[Object.keys(a).find((k) => k.startsWith('assets/'))]);
  ok('a11y: reduced-motion + focus-visible in stylesheet', css.includes('prefers-reduced-motion') && css.includes(':focus-visible'));
}

// ═══ 7. every template: its own sample, its full sample, the hostile pass, its golden ═══
// Adding a template = registering it (lib/render.ts) + committing its golden.
const HOSTILE_PAYLOADS = [
  '<script>alert(1)</script>',
  '" onmouseover="alert(1)" x="',
  'javascript:alert(1)',
  '<img src=x onerror=alert(1)>',
  '<iframe src="https://evil.example"></iframe>',
  'data:text/html,<script>alert(1)</script>',
];
let _hp = 0;
// Structural identifiers are validated to a safe charset by validateSnapshot
// BEFORE anything renders/publishes (slugs build file paths + internal links),
// so a hostile slug is unreachable in production — keep them valid here, exactly
// as prod does, to test the real threat (hostile DISPLAY content) not a fiction.
// The sections' kinds, ids and switches are the serializer's to refuse in the same way.
const CONTENT_KEYS = new Set(['slug']);
const SECTION_KEYS = new Set(['type', 'id', 'style', 'size', 'side', 'aspect', 'kind', 'network']);
const keepContent = (key) => CONTENT_KEYS.has(key);
const keepSection = (key) => SECTION_KEYS.has(key) || /_ids?$/.test(key || '');
// deep-replace every non-structural STRING leaf with a rotating hostile payload;
// structure (keys, arrays, numbers) is preserved so the template still renders.
const hostilify = (v, key, keep) => {
  if (typeof v === 'string') return keep(key) ? v : HOSTILE_PAYLOADS[(_hp++) % HOSTILE_PAYLOADS.length];
  if (Array.isArray(v)) return v.map((x) => hostilify(x, key, keep));
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = hostilify(v[k], k, keep); return o; }
  return v;
};

// The golden's reading copy: a line break between tags and after each rule. The stylesheet's
// name carries its hash, and the section styles come from one place (reviewed in
// lib/site_blocks.ts's own diff; a site keeps the ones its pages use), so the copy calls the
// stylesheet assets/site.css and leaves the section styles out. The digests still cover every
// byte of every file.
const GOLDEN = new URL('tests/presence/golden/', ROOT);
const isCss = (path) => /^assets\/site-[0-9a-f]+\.css$/.test(path);
const copyName = (path) => (isCss(path) ? 'assets/site.css' : path);
const sectionPart = (files) => {
  const classes = new Set();
  for (const [k, v] of Object.entries(files)) if (k.endsWith('.html')) pageClasses(String(v), classes);
  return sectionStyles(classes);
};
const readable = (body, sections = '') => (sections ? String(body).replace(sections, () => '/* the section styles its pages use: BLOCK_CSS in lib/site_blocks.ts, less the rest */') : String(body))
  .replace(/\/assets\/site-[0-9a-f]+\.css/g, '/assets/site.css')
  .replace(/></g, '>\n<')
  .replace(/\}(?!\n|$)/g, '}\n');
const readTree = (dir, pre = '') => {
  const out = {};
  for (const e of Deno.readDirSync(dir)) {
    if (e.isDirectory) Object.assign(out, readTree(new URL(`${e.name}/`, dir), `${pre}${e.name}/`));
    else out[pre + e.name] = Deno.readTextFileSync(new URL(e.name, dir));
  }
  return out;
};
const firstDiff = (was, now) => {
  const x = was.split('\n'), y = now.split('\n');
  let i = 0; while (i < x.length && x[i] === y[i]) i++;
  return `line ${i + 1} was «${(x[i] ?? '').slice(0, 80)}» now «${(y[i] ?? '').slice(0, 80)}»`;
};
const sidTypes = (html) => [...String(html || '').matchAll(/ data-dds-sid="([^"]+)"/g)].map((m) => m[1].split(/[#:]/)[0]);

const [homeStored, pageStored] = storedSections();
for (const slug of TEMPLATES) {
  const own = sampleOf(slug);
  ok(`sample [${slug}]: its fixture names its own template`, own.template_slug === slug && own.template_version === '1.0.0', `${own.template_slug}@${own.template_version}`);
  const plain = await renderSnapshot(own, SITE);
  const fx = fullFixture(slug);
  const r1 = await renderSnapshot(fx, SITE), r2 = await renderSnapshot(fullFixture(slug), SITE);

  // determinism: render twice → byte-identical
  {
    const k1 = Object.keys(r1).sort(), k2 = Object.keys(r2).sort();
    let same = k1.length === k2.length && k1.every((k, i) => k === k2[i]);
    if (same) for (const k of k1) if (r1[k] !== r2[k]) { same = false; break; }
    ok(`determinism [${slug}]: render twice → identical`, same, `${k1.length} files`);
  }

  // structure: both samples, every page
  {
    const badOwn = structureProblems(plain), badFull = structureProblems(r1);
    ok(`structure [${slug}]: its own sample — one h1, skip link, landmarks, lang, menu marks the page, alt on every img`, badOwn.length === 0, badOwn.slice(0, 4).join(' | '));
    ok(`structure [${slug}]: the full sample — the same on every page`, badFull.length === 0, badFull.slice(0, 4).join(' | '));
    const css = String(r1[Object.keys(r1).find((k) => k.startsWith('assets/'))]);
    ok(`structure [${slug}]: reduced-motion + focus-visible in the stylesheet`, css.includes('prefers-reduced-motion') && css.includes(':focus-visible'));
    const vr = validateSnapshot(fx, getTemplate(slug, '1.0.0').manifest);
    ok(`structure [${slug}]: the full sample is a draft the template accepts`, vr.ok && vr.blockers.length === 0, vr.blockers.map((x) => x.field).slice(0, 3).join(','));
  }

  // the full sample's own parts: every section, the owner's page, the dropdown, the stamps
  {
    const home = String(r1['index.html']), page = String(r1[`${PAGE.slug}/index.html`] || '');
    const want = (list) => list.map((x) => x.type).join(',');
    ok(`sections [${slug}]: the home page draws each of its sections, in order`, sidTypes(home).join(',') === want(homeStored), sidTypes(home).join(','));
    ok(`sections [${slug}]: the owner's page draws each of the rest, in order`, sidTypes(page).join(',') === want(pageStored), sidTypes(page).join(','));
    const stamped = (s) => { const n = (re) => (s.match(re) || []).length; const sid = n(/ data-dds-sid="/g); return sid > 0 && n(/ data-dds-key="block_/g) === sid && n(/ data-dds-src="\d+"/g) === sid; };
    ok(`sections [${slug}]: every section carries the canvas's stamps (sid, key, stored index)`, stamped(home) && stamped(page));
    ok(`page [${slug}]: the owner's page has its own file, its title as the h1, and the site's header and footer`,
      page.includes(`<h1>${PAGE.title}</h1>`) && page.includes('<header class="site"') && page.includes('<footer class="site"'));
    const pages = Object.entries(r1).filter(([k, v]) => k.endsWith('.html') && !String(v).includes('http-equiv="refresh"'));
    const dropdown = new RegExp(`<li class="has-sub"><a href="/about/"[^>]*aria-haspopup="true">[^<]*<span class="sub-caret"[^>]*>[^<]*</span></a><ul class="subnav">(?:(?!</ul>)[\\s\\S])*href="/${PAGE.slug}/"`);
    const noDrop = pages.filter(([, v]) => !dropdown.test(String(v))).map(([k]) => k);
    ok(`menu [${slug}]: every page's menu has the dropdown under About, opening onto the owner's page`, noDrop.length === 0, noDrop.slice(0, 3).join(', '));
    const css = String(r1[Object.keys(r1).find((k) => k.startsWith('assets/'))]);
    ok(`menu [${slug}]: the stylesheet carries the dropdown's styles`, css.includes('ul.subnav'));
  }

  // what search engines and other sites read
  {
    const home = String(r1['index.html']), page = String(r1[`${PAGE.slug}/index.html`] || '');
    const v = vocabFor(fx.content.settings?.industry);
    const kind = slug === 'restaurant-classic' ? 'Restaurant' : v.schemaType;
    ok(`seo [${slug}]: canonical + og + twitter + description on the home page and the owner's page`,
      [home, page].every((s) => s.includes('rel="canonical"') && s.includes('property="og:title"') && s.includes('name="twitter:card"') && s.includes('name="description"')));
    ok(`seo [${slug}]: the business JSON-LD names its kind (${kind})`, home.includes(`"@type":"${kind}"`));
    ok(`aeo [${slug}]: FAQPage JSON-LD on the questions page`, String(r1['faq/index.html']).includes('"@type":"FAQPage"'));
    const offerings = slug === 'restaurant-classic' ? '/menu/' : v.offeringPath;
    const want = ['/', offerings, '/about/', '/faq/', '/contact/', '/updates/', ...fx.content.posts.map((p) => `/updates/${p.slug}/`), `/${PAGE.slug}/`];
    const missing = want.filter((p) => !String(r1['sitemap.xml']).includes(`<loc>${SITE.baseUrl}${p}</loc>`));
    ok(`seo [${slug}]: the sitemap lists every page, the owner's too, and robots points at it`, missing.length === 0 && String(r1['robots.txt']).includes('sitemap.xml'), missing.join(', '));
    ok(`seo [${slug}]: a 404 page and an svg favicon`, '404.html' in r1 && 'favicon.svg' in r1);
    const leaks = loadsFromElsewhere(r1, SITE.baseUrl);
    ok(`purity [${slug}]: nothing loads from another site; only links lead out`, leaks.length === 0, leaks.slice(0, 3).join(' | '));
  }

  // golden: every file the full sample draws, plus the home page as its own sample draws it
  // (the template's own menu, no sections) under _plain/
  {
    const drawn = { ...r1, '_plain/index.html': plain['index.html'] };
    const digest = {};
    for (const k of Object.keys(drawn).sort()) digest[k] = await sha(String(drawn[k]));
    const sections = sectionPart(r1);
    const copy = Object.fromEntries(Object.entries(drawn).map(([k, v]) => [copyName(k), readable(v, isCss(k) ? sections : '')]));
    const gPath = new URL(`${slug}-1.0.0.json`, GOLDEN), cDir = new URL(`${slug}-1.0.0/`, GOLDEN);
    if (UPDATE) {
      await Deno.mkdir(GOLDEN, { recursive: true });
      await Deno.writeTextFile(gPath, JSON.stringify(digest, null, 1) + '\n');
      await Deno.remove(cDir, { recursive: true }).catch(() => {});
      for (const [k, v] of Object.entries(copy)) {
        const f = new URL(k, cDir);
        await Deno.mkdir(new URL('./', f), { recursive: true });
        await Deno.writeTextFile(f, v);
      }
      console.log(`golden updated [${slug}]: ${Object.keys(digest).length} files`);
    } else {
      let g = null, stored = null;
      try { g = JSON.parse(await Deno.readTextFile(gPath)); } catch { /* absent */ }
      try { stored = readTree(cDir); } catch { /* absent */ }
      if (!g || !stored) ok(`golden [${slug}]: baseline exists`, false, 'run with --update-golden once');
      else {
        const gone = Object.keys(g).filter((k) => !(k in digest)), added = Object.keys(digest).filter((k) => !(k in g));
        const drift = Object.keys(digest).filter((k) => k in g && g[k] !== digest[k]);
        ok(`golden [${slug}]: every file matches its committed digest`, !gone.length && !added.length && !drift.length,
          [...added.map((k) => `new ${k}`), ...gone.map((k) => `gone ${k}`), ...drift].slice(0, 4).join(', '));
        const missing = Object.keys(copy).filter((k) => !(k in stored)), extra = Object.keys(stored).filter((k) => !(k in copy));
        const changed = Object.keys(copy).filter((k) => k in stored && stored[k] !== copy[k]);
        ok(`golden [${slug}]: the reading copy matches, file for file`, !missing.length && !extra.length && !changed.length,
          [...missing.map((k) => `new ${k}`), ...extra.map((k) => `gone ${k}`), ...changed.map((k) => `${k} ${firstDiff(stored[k], copy[k])}`)].slice(0, 3).join(' | '));
      }
    }
  }

  // hostile: every content string is a hostile payload, and the owner's words in the
  // sections and the menu go through the serializer's step first; no LIVE dangerous markup
  // may survive (escaped forms like &lt;script&gt; are fine and expected).
  {
    _hp = 0;
    const full = fullFixture(slug, (x) => hostilify(x, undefined, keepSection));
    const content = hostilify(own.content, 'content', keepContent);
    const { blocks, blocks_src, pages, nav } = full.content.settings;
    const hSnap = { ...full, content: { ...content, settings: { ...content.settings, blocks, blocks_src, pages, nav } } };
    const hr = await renderSnapshot(hSnap, SITE);
    let bad = [], sawEscaped = false;
    for (const [k, v] of Object.entries(hr)) {
      if (!k.endsWith('.html')) continue;
      const s = String(v);
      if (s.includes('&lt;script&gt;')) sawEscaped = true;
      if (s.includes('<script>alert(1)')) bad.push(`${k}: live <script>`);
      if (s.includes('<img src=x onerror')) bad.push(`${k}: live onerror <img>`);
      if (s.includes('<iframe src="https://evil.example"')) bad.push(`${k}: live <iframe>`);
      if (s.includes(' onmouseover="alert(1)"')) bad.push(`${k}: live handler attribute`);
      if (/(?:href|src)\s*=\s*"javascript:/i.test(s)) bad.push(`${k}: javascript: URL`);
      if (/(?:href|src)\s*=\s*"data:text\/html/i.test(s)) bad.push(`${k}: data:text/html URL`);
    }
    ok(`hostile [${slug}]: no script/handler/js-url/iframe survives in any page`, bad.length === 0, bad.slice(0, 3).join(' | '));
    ok(`hostile [${slug}]: hostile markup present but escaped (proves escaping ran)`, sawEscaped, 'expected &lt;script&gt; in output');
    const drew = sidTypes(hr['index.html']).length + sidTypes(hr[`${PAGE.slug}/index.html`]).length;
    ok(`hostile [${slug}]: most sections still draw with hostile words in them`, drew >= 0.75 * (homeStored.length + pageStored.length), `${drew} of ${homeStored.length + pageStored.length}`);
  }
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ RENDERER SUITE: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) { for (const f of fails) console.log(' FAIL:', f.n); Deno.exit(1); }
