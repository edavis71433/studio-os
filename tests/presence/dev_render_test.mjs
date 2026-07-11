// ── Phase B1 Developer-Mode render integration suite ─────────────────────────
// Proves the ONE-pipeline guarantees: the dev layer rides in the snapshot; with
// no customization the render is byte-identical (no-op); with customization the
// injection is deterministic and idempotent; empty layers collapse to null so no
// snapshot churn. These are the invariants behind "same snapshot → same render →
// same bytes → same rollback/restore/preview".
//
//   deno run --allow-read --allow-env tests/presence/dev_render_test.mjs
import { injectDevLayer, devLayerFragments, injectCsp } from '../../supabase/functions/presence/lib/render.ts';
import { buildDevLayer } from '../../supabase/functions/presence/lib/serializer.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const sampleMap = () => ({
  'index.html': '<!doctype html><html><head><title>x</title></head><body><h1>Hi</h1></body></html>',
  'menu/index.html': '<!doctype html><html><head></head><body>menu</body></html>',
  'assets/app.css': 'body{color:#000}',
  'img/logo-800.webp': new Uint8Array([1, 2, 3]),
});
const DEV = { theme_tokens: { accent: '#123456', radius: '8px' }, custom_css: '.hero{color:var(--accent)}', custom_html: '<p>Family-owned.</p>' };

// ═══ 1. no customization → byte-identical (the no-op / no-regression guarantee) ═══
{
  for (const empty of [null, undefined, { theme_tokens: {}, custom_css: '', custom_html: '' }]) {
    const before = sampleMap();
    const after = injectDevLayer(before, empty);
    const same = JSON.stringify(Object.fromEntries(Object.entries(after).filter(([k]) => k.endsWith('.html'))))
      === JSON.stringify(Object.fromEntries(Object.entries(before).filter(([k]) => k.endsWith('.html'))));
    ok(`no-op when dev layer is ${empty === null ? 'null' : empty === undefined ? 'undefined' : 'empty'}`, same);
  }
}

// ═══ 2. injection: style before </head>, block before </body>, on every HTML page ═══
{
  const out = injectDevLayer(sampleMap(), DEV);
  const idx = out['index.html'], menu = out['menu/index.html'];
  ok('style injected before </head>', idx.includes('<style id="presence-dev">') && idx.indexOf('<style id="presence-dev">') < idx.indexOf('</head>'));
  ok('theme tokens become :root vars', idx.includes('--accent:#123456') && idx.includes('--radius:8px'));
  ok('custom css included', idx.includes('.hero{color:var(--accent)}'));
  ok('custom html block before </body>', idx.includes('<div class="presence-dev-block"><p>Family-owned.</p></div>') && idx.indexOf('presence-dev-block') < idx.indexOf('</body>'));
  ok('applied to every HTML page', menu.includes('presence-dev') && menu.includes('presence-dev-block'));
  ok('non-HTML files untouched', out['assets/app.css'] === 'body{color:#000}' && out['img/logo-800.webp'] instanceof Uint8Array);
}

// ═══ 3. determinism + idempotency ═══
{
  const a = injectDevLayer(sampleMap(), DEV);
  const b = injectDevLayer(sampleMap(), DEV);
  ok('same input → same bytes (deterministic)', JSON.stringify(a['index.html']) === JSON.stringify(b['index.html']));
  const once = injectDevLayer(sampleMap(), DEV);
  const twice = injectDevLayer(once, DEV);
  ok('idempotent — second pass adds nothing (marker guard)', JSON.stringify(twice['index.html']) === JSON.stringify(once['index.html']));
  const styleCount = (once['index.html'].match(/id="presence-dev"/g) || []).length;
  ok('exactly one dev style block after double-inject', (twice['index.html'].match(/id="presence-dev"/g) || []).length === 1 && styleCount === 1);
}

// ═══ 4. fragments: tokens-only, css-only, html-only ═══
{
  ok('tokens-only builds :root vars, no stray css', devLayerFragments({ theme_tokens: { ink: '#111' }, custom_css: '', custom_html: '' }).style === '<style id="presence-dev">:root{--ink:#111}</style>');
  ok('css-only, no :root', (() => { const s = devLayerFragments({ theme_tokens: {}, custom_css: '.a{color:red}', custom_html: '' }).style; return s.includes('.a{color:red}') && !s.includes(':root'); })());
  ok('html-only → block, empty style', (() => { const f = devLayerFragments({ theme_tokens: {}, custom_css: '', custom_html: '<p>x</p>' }); return f.style === '' && f.block === '<div class="presence-dev-block"><p>x</p></div>'; })());
  ok('null dev → empty fragments', (() => { const f = devLayerFragments(null); return f.style === '' && f.block === ''; })());
}

// ═══ 5. buildDevLayer: empty collapses to null (no snapshot churn); non-empty sanitizes ═══
{
  ok('empty row → null (byte-identical snapshot)', buildDevLayer({ theme_tokens: {}, custom_css: '', custom_html: '' }) === null);
  ok('undefined row → null', buildDevLayer(undefined) === null);
  ok('whitespace-only → null', buildDevLayer({ theme_tokens: {}, custom_css: '   ', custom_html: '  ' }) === null);
  const built = buildDevLayer({ theme_tokens: { accent: '#5b3fa0', evil: 'x' }, custom_css: '.a{}@import url(x);', custom_html: '<p>ok</p><script>bad()</script>' });
  ok('non-empty → sanitized layer', built && built.theme_tokens.accent === '#5b3fa0' && !('evil' in built.theme_tokens) && !built.custom_css.includes('@import') && !built.custom_html.toLowerCase().includes('<script'));
}

// ═══ 6. injection can never introduce executable code (values pre-sanitized) ═══
{
  // even if a raw script slipped into the map input via dev, the layer is built by
  // buildDevLayer (sanitized). Confirm the sanitized path strips it end-to-end.
  const layer = buildDevLayer({ theme_tokens: {}, custom_css: '', custom_html: '<p>hi</p><script>alert(1)</script>' });
  const out = injectDevLayer(sampleMap(), layer);
  ok('no <script> reaches rendered HTML', !out['index.html'].toLowerCase().includes('<script'));
}

// ═══ CSP + render-time re-sanitize (defense-in-depth) ═══
{
  const csp = injectCsp(sampleMap());
  ok('CSP meta injected into every HTML page', /Content-Security-Policy/.test(csp['index.html']) && /Content-Security-Policy/.test(csp['menu/index.html']));
  ok('CSP blocks object + base-uri', /object-src 'none'/.test(csp['index.html']) && /base-uri 'self'/.test(csp['index.html']));
  ok('CSP does not break inline (keeps unsafe-inline for analytics/styles)', /'unsafe-inline'/.test(csp['index.html']));
  ok('CSP idempotent (not double-injected)', injectCsp(csp)['index.html'].match(/Content-Security-Policy/g).length === 1);
  ok('CSP leaves non-HTML assets untouched', csp['assets/app.css'] === 'body{color:#000}');
  // render-time re-sanitize: a stored <script> in custom_html never reaches the block
  const evil = devLayerFragments({ theme_tokens: {}, custom_css: 'a{x:expression(alert(1))}', custom_html: '<p>ok</p><script>alert(1)</script><marquee>x</marquee>' });
  ok('render re-sanitizes stored HTML (<script> gone)', !/<script/i.test(evil.block) && evil.block.includes('<p>ok</p>'));
  ok('render re-sanitizes stored HTML (<marquee> gone)', !/<marquee/i.test(evil.block));
  ok('render re-sanitizes stored CSS (expression() gone)', !/expression\(/i.test(evil.style));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
