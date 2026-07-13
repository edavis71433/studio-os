// ── Custom CSS safety-boundary suite ("Developer" story, layer 1) ────────────
// Proves the non-negotiable moat: sanitizeCustomCss makes it IMPOSSIBLE for a
// technical owner's CSS to break out of <style> into HTML/JS, run script, or leak
// a visitor's data to a third-party origin — while PRESERVING valid CSS (the child
// combinator and media-range syntax). Also proves the render pipeline injects the
// sanitized CSS after the base stylesheet as a scoped <style> and neutralizes a
// hostile `</style><script>` payload end-to-end.
//
//   deno run --allow-read --allow-env tests/presence/custom_css_test.mjs
import { sanitizeCustomCss, isAllowedCssUrl } from '../../supabase/functions/presence/lib/custom_css.ts';
import { sanitizeDevCss } from '../../supabase/functions/presence/lib/devmode.ts';
import { injectDevLayer } from '../../supabase/functions/presence/lib/render.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ═══ 1. Strips fetch/exec/exfil constructs ═══
{
  ok('strips @import (url form)', !sanitizeCustomCss('@import url(//evil.com/x.css); .a{color:red}').toLowerCase().includes('@import'));
  ok('strips @import (string form)', !sanitizeCustomCss('@import "https://evil.com/x.css";').toLowerCase().includes('@import'));
  ok('neutralizes expression()', !sanitizeCustomCss('.a{width:expression(alert(1))}').toLowerCase().includes('expression('));
  ok('strips behavior:', !sanitizeCustomCss('.a{behavior:url(x.htc)}').toLowerCase().includes('behavior:'));
  ok('strips -moz-binding:', !sanitizeCustomCss('.a{-moz-binding:url(x.xml#e)}').toLowerCase().includes('-moz-binding'));
  ok('blanks url(javascript:)', !sanitizeCustomCss('.a{background:url(javascript:alert(1))}').toLowerCase().includes('javascript:'));
  ok('blanks url(vbscript:)', !sanitizeCustomCss('.a{background:url(vbscript:msgbox)}').toLowerCase().includes('vbscript:'));
}

// ═══ 2. External url() exfiltration blocked; safe url() forms preserved ═══
{
  const ext = sanitizeCustomCss('.a{background:url(https://evil.com/pixel.png)}');
  ok('external https url() blocked', !ext.includes('evil.com') && ext.includes('none'));
  ok('protocol-relative url() blocked', !sanitizeCustomCss('.a{background:url(//evil.com/p.png)}').includes('evil.com'));
  ok('root-relative url() kept', sanitizeCustomCss('.a{background:url(/img/hero.webp)}').includes('/img/hero.webp'));
  ok('quoted root-relative url() kept', sanitizeCustomCss('.a{background:url("/img/hero.webp")}').includes('/img/hero.webp'));
  ok('schemeless relative url() kept', sanitizeCustomCss('.a{background:url(fonts/x.woff2)}').includes('fonts/x.woff2'));
  ok('data: url() kept (self-contained)', sanitizeCustomCss('.a{background:url(data:image/png;base64,iVBORw0KG)}').includes('data:image/png'));
  ok('fragment url() kept', sanitizeCustomCss('.a{filter:url(#blur)}').includes('url(#blur)'));
  // isAllowedCssUrl direct contract
  ok('isAllowedCssUrl: /rel true', isAllowedCssUrl('/img/x.png') === true);
  ok('isAllowedCssUrl: //ext false', isAllowedCssUrl('//evil.com/x') === false);
  ok('isAllowedCssUrl: https ext false', isAllowedCssUrl('https://evil.com/x') === false);
  ok('isAllowedCssUrl: data true', isAllowedCssUrl('data:image/svg+xml,PHN2Zz4=') === true);
  ok('isAllowedCssUrl: javascript false', isAllowedCssUrl('javascript:alert(1)') === false);
}

// ═══ 3. <style> breakout prevention ═══
{
  const evil = sanitizeCustomCss('.a{}</style><script>alert(1)</script>');
  ok('removes </style> closing tag (no breakout)', !evil.includes('</style>') && !/<\//.test(evil));
  ok('no real </script> survives', !evil.includes('</script>'));
  ok('strips <!-- and -->', !sanitizeCustomCss('<!-- .a{color:red} -->').includes('<!--') && !sanitizeCustomCss('.a{}-->').includes('-->'));
  // the surviving text is inert CSS text — with the closing tag gone it can never
  // become an element inside the injected <style>.
  ok('child combinator > survives (never uses </)', sanitizeCustomCss('.nav > li { color: red }').includes('.nav > li'));
}

// ═══ 4. Preserves valid CSS (including the syntactically tricky bits) ═══
{
  ok('normal declarations kept', sanitizeCustomCss('.hero{color:#5b3fa0;padding:2rem}').includes('#5b3fa0'));
  ok('child combinator kept', sanitizeCustomCss('.nav>li>a{color:red}').includes('.nav>li>a'));
  ok('media range (<=) kept', sanitizeCustomCss('@media (400px <= width <= 900px){.a{color:red}}').includes('400px <= width <= 900px'));
  ok('media range (<) kept', sanitizeCustomCss('@media (width < 600px){.a{color:red}}').includes('width < 600px'));
  ok('scroll-behavior NOT clipped by behavior: rule', sanitizeCustomCss('html{scroll-behavior:smooth}').includes('scroll-behavior:smooth'));
  ok('a class named .behavior survives', sanitizeCustomCss('.behavior{color:red}').includes('.behavior{color:red}'));
  ok('empty input → empty string', sanitizeCustomCss('') === '' && sanitizeCustomCss(null) === '' && sanitizeCustomCss(undefined) === '');
}

// ═══ 5. Length cap (~40KB) ═══
{
  ok('caps at ~40KB', sanitizeCustomCss('a'.repeat(200000)).length <= 40000);
  ok('short input untouched by cap', sanitizeCustomCss('.a{color:red}').length === '.a{color:red}'.length);
}

// ═══ 6. sanitizeDevCss delegates to the ONE hardened path ═══
{
  // The existing Developer-Mode caller now inherits breakout + external-url hardening.
  ok('sanitizeDevCss kills </style> breakout', !sanitizeDevCss('.a{}</style><script>x</script>').includes('</style>'));
  ok('sanitizeDevCss blocks external url()', !sanitizeDevCss('.a{background:url(https://evil.com/p.png)}').includes('evil.com'));
  ok('sanitizeDevCss keeps valid css', sanitizeDevCss('.hero{color:#5b3fa0}').includes('#5b3fa0'));
}

// ═══ 7. Render injection: scoped <style> AFTER base CSS; hostile payload neutralized ═══
{
  const sampleMap = () => ({
    'index.html': '<!doctype html><html><head><title>x</title><link rel="stylesheet" href="/assets/site.css"></head><body><h1>Hi</h1></body></html>',
  });
  const html = injectDevLayer(sampleMap(), { theme_tokens: {}, custom_css: '.hero{color:var(--accent)}', custom_html: '' })['index.html'];
  ok('injects a scoped <style id> block', /<style id="presence-dev">/.test(html));
  ok('custom CSS lands after the base stylesheet (can override)', html.indexOf('rel="stylesheet"') < html.indexOf('<style id="presence-dev">'));
  ok('scoped style is inside <head>', html.indexOf('<style id="presence-dev">') < html.indexOf('</head>'));

  // A hostile payload stored as custom_css is re-sanitized at render — the </style>
  // can never close the injected block, and no <script> element is created.
  const hostile = injectDevLayer(sampleMap(), { theme_tokens: {}, custom_css: '.a{}</style><script>alert(document.cookie)</script>', custom_html: '' })['index.html'];
  const head = hostile.slice(0, hostile.indexOf('</head>') + 7);
  // exactly one </style> in <head> — the legitimate one the injector wrote (the
  // payload's own </style> was stripped, so it cannot terminate the block early).
  ok('payload cannot break out of the injected <style>', (head.match(/<\/style>/g) || []).length === 1);
  // With the closing tag gone, the literal text "<script>" survives HARMLESSLY as
  // rawtext INSIDE <style> — it can never become a script element. Prove it is
  // trapped between the injected style's open tag and its single </style>.
  const styleOpen = hostile.indexOf('<style id="presence-dev">');
  const styleClose = hostile.indexOf('</style>', styleOpen);
  const scriptAt = hostile.indexOf('<script');
  ok('any <script> text is trapped inside the inert <style> block', scriptAt === -1 || (scriptAt > styleOpen && scriptAt < styleClose));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
