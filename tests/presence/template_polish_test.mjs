// ── The website builder's and the templates' loose ends (list item 99) ───────
//   deno run --allow-read --allow-env tests/presence/template_polish_test.mjs
// In Comments mode the canvas toolbar offered Move, Duplicate, Cut, Hide and Delete, and
// Delete worked. Developer Mode let you set colours Slate quietly ignores. The offerings
// page jumped from h1 to h3. The search page showed its "hidden" label and took the
// keyboard on load. Only Restaurant Classic said "Open now", and it said "Closed now" with
// no hours entered. Favicons ignored the site's colours (Aurora wore Business Classic's
// green). The sitemap dated every page to the last publish.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const { renderSnapshot, tintFavicon, FIXED_COLOR_TEMPLATES } = await import('../../supabase/functions/presence/lib/render.ts');
const SITE = { baseUrl: 'https://example.test', brand: { credit: 'Site by Davis Digital Studio' } };
const SLUGS = ['atelier', 'aurora', 'business-classic', 'editorial', 'harbor', 'meadow', 'restaurant-classic', 'slate'];
const fixture = (slug) => JSON.parse(read(`supabase/functions/presence/templates/${slug}/1.0.0/fixture.json`));
const drawn = Object.fromEntries(SLUGS.map((s) => [s, renderSnapshot(fixture(s), SITE)]));
const html = (files) => Object.entries(files).filter(([k]) => k.endsWith('.html'));

// ═══ Open now, on every template's home page ═══
for (const s of SLUGS) {
  const f = drawn[s];
  const withScript = html(f).filter(([, h]) => String(h).includes("getElementById('open-now')")).map(([k]) => k);
  ok(`${s}: Open now on the home page, beside the address`, String(f['index.html']).includes('<span id="open-now" class="open-now" aria-live="polite"></span>') && String(f['index.html']).includes('<script id="hours-data" type="application/json">'));
  ok(`${s}: …and its script nowhere else`, withScript.join() === 'index.html', withScript.join());
}
{
  // the script itself, run against a stand-in page: the real clock, hours that always or never cover it
  const js = String(drawn['business-classic']['index.html']).match(/<script>(\(function\(\)\{var el=document\.getElementById\('open-now'\)[\s\S]*?)<\/script>/)?.[1];
  const run = (cfg) => {
    const el = { textContent: '', className: 'open-now' };
    const doc = { getElementById: (id) => (id === 'open-now' ? el : id === 'hours-data' ? { textContent: JSON.stringify(cfg) } : null), querySelector: () => null };
    new Function('document', js)(doc);
    return el;
  };
  const allDay = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, { closed: false, iv: [[0, 1440]] }]));
  const shut = Object.fromEntries(Object.keys(allDay).map((d) => [d, { closed: true, iv: [] }]));
  ok('the script finds the script on the page', !!js);
  ok('open all day → "Open now"', run({ tz: 'America/Los_Angeles', days: allDay, ex: {} }).textContent === 'Open now');
  ok('closed all week → "Closed now"', run({ tz: 'America/Los_Angeles', days: shut, ex: {} }).textContent === 'Closed now');
  ok('no hours entered → says nothing, never "Closed now"', run({ tz: 'America/Los_Angeles', days: {}, ex: {} }).textContent === '' && run({}).textContent === '');
  const same = SLUGS.map((s) => String(drawn[s]['index.html']).match(/<script>\(function\(\)\{var el=document\.getElementById\('open-now'\)[\s\S]*?<\/script>/)?.[0]);
  ok('every template runs the same script', same.every((x) => !!x && x === same[0]));
}

// ═══ the offerings page: h1, then h2 ═══
for (const s of SLUGS) {
  const page = Object.entries(drawn[s]).find(([k, h]) => k.endsWith('/index.html') && /class="cat-h"|class="menu-cat"/.test(String(h)))?.[1] || '';
  const heads = [...String(page).matchAll(/<h([1-6])[\s>]/g)].map((m) => +m[1]);
  ok(`${s}: the offerings page goes h1, then h2`, heads[0] === 1 && heads[1] === 2 && !heads.slice(1).some((n, i) => n - (i ? heads[i] : 1) > 1), heads.join(','));
}

// ═══ the favicon wears the site's accent ═══
{
  ok('Aurora’s own favicon is its own indigo, not Business Classic’s green', String(drawn.aurora['favicon.svg']).includes('fill="#4f46e5" data-accent="fill"'));
  const tinted = (s, accent) => { const fx = fixture(s); fx.dev_customization = { theme_tokens: { accent }, custom_css: '', custom_html: '' }; return String(renderSnapshot(fx, SITE)['favicon.svg']); };
  for (const s of SLUGS.filter((x) => x !== 'slate')) ok(`${s}: a chosen accent colours the favicon`, tinted(s, '#123456').includes('fill="#123456" data-accent="fill"'));
  ok('Slate keeps its own favicon, as it keeps its own colours', FIXED_COLOR_TEMPLATES.has('slate') && tinted('slate', '#123456') === String(drawn.slate['favicon.svg']));
  const svg = '<svg><rect fill="#111111" data-accent="fill"/><rect stroke="#222222" data-accent="stroke"/><text fill="#ffffff">A</text></svg>';
  const out = tintFavicon({ 'favicon.svg': svg }, '#abcdef', 'meadow')['favicon.svg'];
  ok('only the marked fill and stroke change; the letter keeps its colour', out === '<svg><rect fill="#abcdef" data-accent="fill"/><rect stroke="#abcdef" data-accent="stroke"/><text fill="#ffffff">A</text></svg>', out);
  const files = { 'favicon.svg': svg };
  ok('no accent, or one that isn’t a colour, changes nothing', tintFavicon(files, undefined, 'meadow') === files && tintFavicon(files, 'red;x', 'meadow') === files && tintFavicon(files, '#abc"><x', 'meadow') === files);
}

// ═══ the search page ═══
{
  const page = String(drawn.meadow['search/index.html']);
  ok('the search label hides itself, since no template defines .sr-only', /<label class="sr-only" for="search-q" style="position:absolute;width:1px;height:1px;[^"]*clip:rect\(0,0,0,0\)/.test(page));
  ok('the field waits to be chosen instead of taking the keyboard', !/inp\.focus\(\)/.test(page) && !/autofocus/.test(page));
}

// ═══ the sitemap dates what it knows ═══
for (const s of SLUGS) {
  const xml = String(drawn[s]['sitemap.xml']);
  const urls = [...xml.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?<\/url>/g)].map((m) => ({ loc: m[1], lastmod: m[2] || '' }));
  const posts = urls.filter((u) => /\/updates\/[^/]+\/$/.test(u.loc));
  const rest = urls.filter((u) => !/\/updates\/[^/]+\/$/.test(u.loc));
  ok(`${s}: pages without a known change date carry none; posts keep their own`, rest.length > 3 && rest.every((u) => !u.lastmod) && posts.every((u) => /^\d{4}-\d{2}-\d{2}$/.test(u.lastmod)), JSON.stringify(urls.slice(0, 3)));
}

// ═══ the builder ═══
{
  const p = read('presence.html');
  ok('the canvas toolbar shows only in Edit mode', /if \(IPE \|\| DC_MODE !== "edit"\) return;/.test(p));
  ok('in Comments mode the Contents rows keep their comment badge but offer no editing', (p.match(/if \(!CM_ON\) row\.appendChild\(acts\);/g) || []).length === 3);
  const d = read('developer.html');
  ok('Developer Mode says when the template keeps its own colors', /const FIXED_COLOR_TEMPLATES=new Set\(\['slate'\]\);/.test(d) && /Slate keeps its own dark colors, so the color tokens here don’t change your site\./.test(d));
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
