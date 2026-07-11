// ── Phase B Developer Mode suite ─────────────────────────────────────────────
// Proves the SAFE core: no script/handler/dangerous-URL survives sanitization
// (the "no runtime code execution" Product-Law guarantee, enforced as data);
// theme tokens are allow-listed (deny by default); CSS fetch/execute constructs
// are stripped; the file explorer marks render code read-only; and the access
// rule admits only the operator or the developer capability (role model
// unchanged).
//
//   deno run --allow-read --allow-env tests/presence/devmode_test.mjs
import { sanitizeDevHtml, sanitizeDevCss, validateThemeTokens, buildCustomization, projectFiles, ALLOWED_TOKENS, DEV_HTML_ALLOW } from '../../supabase/functions/presence/lib/devmode.ts';
import { devModeAllowed } from '../../supabase/functions/presence/routes/dev.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ═══ 1. sanitizeDevHtml — no runtime code execution can survive ═══
{
  const cases = [
    ['<script>alert(1)</script><p>ok</p>', 'script tag + body'],
    ['<p onclick="steal()">hi</p>', 'onclick handler'],
    ['<p ONERROR=x onmouseover=y>hi</p>', 'unquoted handlers, mixed case'],
    ['<a href="javascript:alert(1)">x</a>', 'javascript: href'],
    ['<img src="data:text/html;base64,PHNjcmlwdD4=">', 'data: src'],
    ['<iframe src="//evil"></iframe>', 'iframe'],
    ['<object data="x"></object>', 'object'],
    ['<embed src="x">', 'embed'],
    ['<link rel=stylesheet href=x>', 'link'],
    ['<style>body{}</style>', 'inline style tag'],
    ['<base href="//evil">', 'base tag'],
    ['<svg><script>x</script></svg>', 'svg script'],
    ['<div style="background:url(javascript:x)">hi</div>', 'inline style attr'],
  ];
  for (const [input, label] of cases) {
    const out = sanitizeDevHtml(input).toLowerCase();
    const clean = !out.includes('<script') && !out.includes('onclick') && !out.includes('onerror') && !out.includes('onmouseover')
      && !out.includes('javascript:') && !out.includes('<iframe') && !out.includes('<object') && !out.includes('<embed')
      && !out.includes('<link') && !out.includes('<style') && !out.includes('<base') && !out.includes('data:text/html')
      && !out.includes('style=');
    ok(`html sanitize: ${label}`, clean, JSON.stringify(sanitizeDevHtml(input)));
  }
  ok('html sanitize: keeps benign markup', sanitizeDevHtml('<p class="x">Hello <strong>world</strong></p>') === '<p class="x">Hello <strong>world</strong></p>');
  ok('html sanitize: keeps safe links', sanitizeDevHtml('<a href="https://example.com">x</a>').includes('https://example.com'));
}

// ═══ 2. sanitizeDevCss — fetch/execute constructs stripped, inert CSS kept ═══
{
  ok('css: strips @import', !sanitizeDevCss('@import url(//evil); .a{color:red}').includes('@import'));
  ok('css: strips expression()', !sanitizeDevCss('.a{width:expression(alert(1))}').toLowerCase().includes('expression('));
  ok('css: neutralizes url(javascript:)', !sanitizeDevCss('.a{background:url(javascript:alert(1))}').toLowerCase().includes('javascript:'));
  ok('css: strips behavior:', !sanitizeDevCss('.a{behavior:url(x.htc)}').toLowerCase().includes('behavior:'));
  ok('css: keeps normal declarations', sanitizeDevCss('.hero{color:#5b3fa0;padding:2rem}').includes('#5b3fa0'));
  ok('css: hard size cap', sanitizeDevCss('a'.repeat(200000)).length <= 100000);
}

// ═══ 3. validateThemeTokens — allow-list, deny by default ═══
{
  const { tokens, rejected } = validateThemeTokens({ accent: '#5b3fa0', ink: '#111', radius: '8px', font_scale: '1.1', evil: 'x', accent_bad: 'red' });
  ok('tokens: keeps valid accent/ink/radius/font_scale', tokens.accent === '#5b3fa0' && tokens.ink === '#111' && tokens.radius === '8px' && tokens.font_scale === '1.1');
  ok('tokens: rejects unknown key', rejected.includes('evil') && !('evil' in tokens));
  ok('tokens: rejects bad value shape', validateThemeTokens({ accent: 'red; }' }).rejected.includes('accent'));
  ok('tokens: rejects url()/js in a color value', validateThemeTokens({ bg: 'url(javascript:x)' }).rejected.includes('bg'));
  ok('tokens: non-object input is safe', validateThemeTokens(null).rejected.length === 0 && Object.keys(validateThemeTokens('x').tokens).length === 0);
  ok('tokens: ALLOWED_TOKENS is the published contract', ALLOWED_TOKENS.includes('accent') && ALLOWED_TOKENS.includes('font_scale') && !ALLOWED_TOKENS.includes('evil'));
}

// ═══ 4. buildCustomization — end to end, everything sanitized + capped ═══
{
  const c = buildCustomization({
    theme_tokens: { accent: '#5b3fa0', evil: 'x' },
    custom_css: '.a{color:red} @import url(//e);',
    custom_html: '<p>hi</p><script>x</script>',
  });
  ok('build: only allowed tokens', Object.keys(c.theme_tokens).length === 1 && c.theme_tokens.accent === '#5b3fa0');
  ok('build: css sanitized', !c.custom_css.includes('@import') && c.custom_css.includes('color:red'));
  ok('build: html sanitized', !c.custom_html.toLowerCase().includes('<script') && c.custom_html.includes('<p>hi</p>'));
  ok('build: html hard cap', buildCustomization({ custom_html: '<p>' + 'x'.repeat(60000) + '</p>' }).custom_html.length <= 50000);
}

// ═══ 5. projectFiles — render code is READ-ONLY, customization is editable ═══
{
  const files = projectFiles('restaurant-classic', '1.0.0');
  const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
  ok('files: theme/css/html editable', byPath['theme/tokens.json'].editable && byPath['styles/custom.css'].editable && byPath['blocks/custom.html'].editable);
  ok('files: render.ts is read-only', byPath['templates/restaurant-classic/1.0.0/render.ts'].editable === false);
  ok('files: manifest is read-only', byPath['templates/restaurant-classic/1.0.0/manifest.json'].editable === false);
  ok('files: no editable template CODE surface exists (no in-app runtime editor)', files.filter((f) => f.kind === 'template').every((f) => !f.editable));
}

// ═══ 6. devModeAllowed — operator OR developer capability, no one else ═══
{
  ok('access: operator (staff) allowed', devModeAllowed('business_owner', 'staff') === true);
  ok('access: system allowed', devModeAllowed('client_reviewer', 'system') === true);
  ok('access: developer role allowed', devModeAllowed('developer', 'user') === true);
  ok('access: plain business_owner denied (not entitled)', devModeAllowed('business_owner', 'user') === false);
  ok('access: business_staff denied', devModeAllowed('business_staff', 'user') === false);
  ok('access: client_reviewer denied', devModeAllowed('client_reviewer', 'user') === false);
}

// ═══ N. allow-list pass — only safe content tags survive (defense-in-depth) ═══
{
  // allow-listed content tags are kept
  for (const t of ['div', 'p', 'a', 'img', 'h2', 'ul', 'li', 'strong', 'figure', 'table', 'section']) {
    ok(`allow-list keeps <${t}>`, sanitizeDevHtml(`<${t}>x</${t}>`).includes(`<${t}`));
  }
  // non-allow-listed tags are stripped (their inner text is preserved)
  const marquee = sanitizeDevHtml('<marquee>scroll</marquee>');
  ok('allow-list strips <marquee> wrapper', !/<\/?marquee/i.test(marquee) && marquee.includes('scroll'));
  ok('allow-list strips <button>', !/<\/?button/i.test(sanitizeDevHtml('<button>go</button>')));
  ok('allow-list strips <input>', !/<input/i.test(sanitizeDevHtml('<input value="x">')));
  ok('allow-list strips <details>/<dialog>', !/<\/?(details|dialog)/i.test(sanitizeDevHtml('<details><dialog>hi</dialog></details>')));
  // denylist still wins on the truly dangerous ones
  ok('denylist still strips <script>', !/<script/i.test(sanitizeDevHtml('<script>alert(1)</script><p>ok</p>')));
  ok('denylist still strips <iframe>', !/<iframe/i.test(sanitizeDevHtml('<iframe src="x"></iframe>')));
  // a realistic developer block survives intact
  const real = sanitizeDevHtml('<section><h2>Family-owned</h2><p>Since <strong>2019</strong>.</p><a href="/menu">See our menu</a></section>');
  ok('real content block survives', real.includes('<section') && real.includes('<h2') && real.includes('<strong') && real.includes('href="/menu"'));
  ok('DEV_HTML_ALLOW is a non-empty set', DEV_HTML_ALLOW.size > 20 && DEV_HTML_ALLOW.has('div') && !DEV_HTML_ALLOW.has('script'));
}

// ── summary ──
const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
