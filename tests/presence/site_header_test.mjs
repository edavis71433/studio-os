// ── What the header does when the page scrolls (builder list items 50 and 123, Nov 2026) ──
// The owner picks one of four from pictures: scrolls away, stays on top, hides then comes back,
// fades away. It's the style setting header_scroll; with none, each template keeps its own.
// This proves, on every template:
//   · no choice leaves every page exactly as it was
//   · each choice adds one screen-only style (print keeps the template's own) and, for hide
//     and fade, the few lines that watch the scroll; once, on every page with a header
//   · a page without a header (a landing page) is left alone
//   · the setting is allowed with those four values only, and reaches the drawn site
//
//   deno run --allow-read tests/presence/site_header_test.mjs
import { renderSnapshot } from '../../supabase/functions/presence/lib/render.ts';
import { applyHeaderScroll, headerScrollOf, HEADER_CSS, HEADER_JS } from '../../supabase/functions/presence/lib/site_header.ts';
import { validateThemeTokens } from '../../supabase/functions/presence/lib/devmode.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const SITE = { baseUrl: 'https://example.test' };
const TEMPLATES = ['business-classic', 'restaurant-classic', 'editorial', 'aurora', 'slate', 'meadow', 'atelier', 'harbor'];
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; } else { fail++; console.log('FAIL  ' + n); } };

ok('the four values are the only ones', headerScrollOf('hide') === 'hide' && headerScrollOf('stay') === 'stay' && headerScrollOf('sticky') === null && headerScrollOf('') === null && headerScrollOf(undefined) === null);
ok('the style setting takes the four and nothing else', JSON.stringify(validateThemeTokens({ header_scroll: 'fade' }).tokens) === '{"header_scroll":"fade"}' && validateThemeTokens({ header_scroll: 'x;}body{display:none' }).rejected.includes('header_scroll'));
ok('stays-on-top and scrolls-away are style only; hide and fade watch the scroll', !HEADER_CSS.stay.includes('dds-hdr-off') && HEADER_CSS.hide.includes('translateY(-100%)') && HEADER_CSS.fade.includes('opacity:0') && HEADER_JS.includes('dds-hdr-off'));
ok('moving honours reduced motion', HEADER_CSS.hide.includes('prefers-reduced-motion') && HEADER_CSS.fade.includes('prefers-reduced-motion'));
ok('a page with no header is left alone', applyHeaderScroll({ 'a/index.html': '<html><head></head><body><main></main></body></html>' }, 'hide')['a/index.html'] === '<html><head></head><body><main></main></body></html>');

for (const slug of TEMPLATES) {
  const fx = JSON.parse(read(`supabase/functions/presence/templates/${slug}/1.0.0/fixture.json`));
  const plain = await renderSnapshot(fx, SITE);
  const pages = Object.keys(plain).filter((k) => k.endsWith('.html') && String(plain[k]).includes('<header class="site"'));
  ok(`[${slug}] has pages with the site's header`, pages.length >= 4);
  const withTok = (v) => ({ ...fx, dev_customization: { theme_tokens: { header_scroll: v }, custom_css: '', custom_html: '' } });
  for (const v of ['scroll', 'stay', 'hide', 'fade']) {
    const out = await renderSnapshot(withTok(v), SITE);
    const every = pages.every((k) => {
      const h = String(out[k]);
      const styles = h.split('id="dds-hdr"').length - 1, scripts = h.split('id="dds-hdr-js"').length - 1;
      return styles === 1 && h.includes(`@media screen{${HEADER_CSS[v]}}`) && h.indexOf('id="dds-hdr"') < h.indexOf('</head>') && scripts === (v === 'hide' || v === 'fade' ? 1 : 0);
    });
    ok(`[${slug}] ${v}: every page with a header carries it once, in the head`, every);
  }
  ok(`[${slug}] no choice: the pages are exactly as before`, pages.every((k) => !String(plain[k]).includes('dds-hdr')));
}

const done = fail === 0;
console.log(`${done ? 'PASS' : 'FAIL'}  site header — ${pass} assertions${done ? ', 0 failures' : ', ' + fail + ' FAILURES'}`);
if (!done) Deno.exit(1);
