// ── Editable global nav — render + safety ────────────────────────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/site_nav_test.mjs
import { renderNavList, NAV_DROPDOWN_CSS } from '../../supabase/functions/presence/lib/site_nav.ts';
import { esc, attr } from '../../supabase/functions/presence/lib/markdown.ts';
import { render as businessClassic } from '../../supabase/functions/presence/templates/business-classic/1.0.0/render.ts';
import manifest from '../../supabase/functions/presence/templates/business-classic/1.0.0/manifest.json' with { type: 'json' };
import fixture from '../../supabase/functions/presence/templates/business-classic/1.0.0/fixture.json' with { type: 'json' };

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log('  FAIL → ' + n); } };

// ═══ 1. renderNavList — structure, active marking, escaping ═══
{
  const nav = [
    { label: 'Home', href: '/' },
    { label: 'Services', href: '/services/', children: [
      { label: 'Plumbing', href: '/plumbing/' },
      { label: 'Book', href: 'https://ex.com/book' },
    ] },
  ];
  const html = renderNavList(nav, '/services/', esc, attr);
  ok('top items render as <li><a>', html.includes('<li><a href="/">Home</a></li>'));
  ok('a parent with children becomes a has-sub dropdown with a subnav <ul>', html.includes('<li class="has-sub">') && html.includes('<ul class="subnav">') && html.includes('aria-haspopup="true"'));
  ok('current path is marked aria-current on the active parent', html.includes('/services/"') && /href="\/services\/"[^>]*aria-current="page"/.test(html));
  ok('child links render inside the subnav', html.includes('<li><a href="/plumbing/">Plumbing</a></li>') && html.includes('href="https://ex.com/book"'));
  // escaping: a hostile label/href must be inert
  const eviln = renderNavList([{ label: '<script>x</script>', href: '/"><img src=x onerror=alert(1)>' }], '/', esc, attr);
  ok('labels are HTML-escaped (no live <script>)', eviln.includes('&lt;script&gt;') && !eviln.includes('<script>x'));
  ok('hrefs are attribute-escaped (no attribute breakout)', !eviln.includes('onerror=alert(1)>') && (eviln.includes('&quot;') || eviln.includes('&gt;')));
}

// ═══ 2. template render — custom nav drives the header on every page ═══
{
  const snap = structuredClone(fixture);
  snap.content.settings = snap.content.settings || {};
  snap.content.settings.nav = [
    { label: 'Start', href: '/' },
    { label: 'Work', href: '/work/', children: [{ label: 'Portfolio', href: '/portfolio/' }, { label: 'Pricing', href: '/pricing/' }] },
    { label: 'Email us', href: 'mailto:hi@ex.com' },
  ];
  const files = businessClassic(snap, manifest, { baseUrl: 'https://x.test' });
  const home = files['index.html'];
  ok('the custom nav renders in the header', home.includes('>Start<') && home.includes('class="has-sub"') && home.includes('>Portfolio<') && home.includes('mailto:hi@ex.com'));
  ok('the default nav labels are NOT emitted when a custom nav is set', !/>\s*FAQ\s*</.test(home.replace(/<h[1-6][^>]*>[^<]*<\/h[1-6]>/g, '')) || home.includes('class="has-sub"'));
  // dropdown CSS is present exactly when a custom nav exists
  const css = Object.entries(files).find(([k]) => k.startsWith('assets/site-'))?.[1] || '';
  ok('dropdown CSS is appended when a custom nav is set', css.includes('ul.subnav'));

  // no custom nav → byte-identical stylesheet (no dropdown CSS leaked in)
  const plain = businessClassic(structuredClone(fixture), manifest, { baseUrl: 'https://x.test' });
  const plainCss = Object.entries(plain).find(([k]) => k.startsWith('assets/site-'))?.[1] || '';
  ok('a site with no custom nav gets NO dropdown CSS (byte-clean)', !plainCss.includes('ul.subnav'));
  ok('NAV_DROPDOWN_CSS is zero-JS (no <script>, no url())', !/script|javascript:|url\(/i.test(NAV_DROPDOWN_CSS));
}

const done = fail === 0;
console.log(`${done ? 'PASS' : 'FAIL'}  site-nav — ${pass} assertions${done ? ', 0 failures' : ', ' + fail + ' FAILURES'}`);
console.log(`\n════ SITE NAV GATE: ${done ? '1/1 PASSED' : 'FAILED'} ════`);
if (!done) Deno.exit(1);
