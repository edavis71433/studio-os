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
  const templateFiles = files.filter((f) => f.kind === 'template');
  ok('files: no editable template CODE surface exists (no in-app runtime editor)', templateFiles.length > 0 && templateFiles.every((f) => !f.editable));
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

// ═══ 190. read the way a browser reads it: nothing unlisted is ever written ═══
// The first four are the Nov 12 review's samples; three of them came through the old
// cleaner unchanged. `shape` reads the RESULT with one strict pattern of its own: text
// with no "<" or ">", and tags that are a listed name plus name="value" pairs in double
// quotes. A result of that shape can only be read one way by a browser.
{
  const TAG = /^<\/?([a-z][a-z0-9]*)((?: [a-z\-]+(?:="[^"<>]*")?)*)>$/;
  const shape = (out) => {
    for (const piece of out.split(/(<[^>]*>)/)) {
      if (!piece) continue;
      if (piece[0] !== '<') { if (/[<>]/.test(piece)) return `loose mark in text: ${piece}`; continue; }
      const m = TAG.exec(piece);
      if (!m) return `not a plain tag: ${piece}`;
      if (!DEV_HTML_ALLOW.has(m[1])) return `tag not on the list: ${m[1]}`;
      for (const a of m[2].matchAll(/ ([a-z\-]+)(?:="([^"]*)")?/g)) {
        if (/^on/.test(a[1]) || a[1] === 'style' || a[1] === 'srcdoc' || a[1] === 'name' || a[1] === 'action' || a[1] === 'formaction') return `attribute not allowed: ${a[1]}`;
        if (['href', 'src', 'cite'].includes(a[1])) {
          const u = String(a[2]).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+/, '');
          const scheme = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/.exec(u);
          if (scheme && !['http', 'https', 'mailto', 'tel'].includes(scheme[1].toLowerCase())) return `address not allowed: ${u}`;
        }
      }
    }
    return '';
  };
  const hostile = [
    ['<img src="x"/onerror="alert(document.cookie)">', 'review: handler after a slash, no space'],
    ['<a href=javascript:alert(1)>x</a>', 'review: javascript: link without quotes'],
    ['<img src=x onerror=alert(1)>', 'review: unquoted handler'],
    ['<svg/onload=alert(1)>', 'review: svg handler after a slash'],
    ['<img src="x"onerror="alert(1)">', 'handler straight after a closing quote'],
    ['<img src="x"\tonerror="alert(1)">', 'handler after a tab'],
    ['<img src="x"\nonerror\n=\n"alert(1)">', 'handler split over lines'],
    ['<img src="x"\fonerror="alert(1)">', 'handler after a form feed'],
    ['<img/src="x"/onerror=alert(1)//>', 'slashes for spaces'],
    ['<p title="a>b" onclick="x()">hi</p>', 'a ">" inside a quoted value does not end the tag'],
    ['<p title=\'>\' onmouseover=x()>hi</p>', 'a ">" inside single quotes'],
    ['<a href="jav&#x61;script:alert(1)">x</a>', 'a hex reference inside the scheme'],
    ['<a href="&#106;avascript:alert(1)">x</a>', 'a decimal reference'],
    ['<a href="&#106avascript:alert(1)">x</a>', 'a reference with no semicolon'],
    ['<a href="javascript&colon;alert(1)">x</a>', 'a named colon'],
    ['<a href="java\tscript:alert(1)">x</a>', 'a tab inside the scheme'],
    ['<a href="java&Tab;script:alert(1)">x</a>', 'a named tab inside the scheme'],
    ['<a href="java&NewLine;script:alert(1)">x</a>', 'a named line end inside the scheme'],
    ['<a href="  javascript:alert(1)">x</a>', 'spaces before the scheme'],
    ['<a href="\u0001javascript:alert(1)">x</a>', 'a control character before the scheme'],
    ['<a href="JaVaScRiPt:alert(1)">x</a>', 'mixed case scheme'],
    ['<a href=\'vbscript:msgbox(1)\'>x</a>', 'vbscript'],
    ['<a href="data:text/html,<script>alert(1)</script>">x</a>', 'data: link'],
    ['<a href=`javascript:alert(1)`>x</a>', 'backticks are not quotes'],
    ['<img src="javascript:alert(1)">', 'javascript: picture'],
    ['<img src="data:image/svg+xml,<svg onload=alert(1)>">', 'data: picture'],
    ['<blockquote cite="javascript:alert(1)">x</blockquote>', 'javascript: cite'],
    ['<div style="background:url(javascript:x)">hi</div>', 'style attribute'],
    ['<div style=background:red>hi</div>', 'unquoted style attribute'],
    ['<scr<script>ipt>alert(1)</scr</script>ipt>', 'a tag hidden inside a tag'],
    ['<<script>script>alert(1)<</script>/script>', 'doubled brackets'],
    ['<SCRIPT\n>alert(1)</SCRIPT\n>', 'script in capitals with line ends'],
    ['<script>alert(1)', 'script never closed'],
    ['<script src=//evil.example></script>', 'script from elsewhere'],
    ['<style>@import url(//evil.example)</style>', 'style block'],
    ['<style><img src="</style><img src=x onerror=alert(1)>">', 'a closing tag inside a style block'],
    ['<title><img src=x onerror=alert(1)></title>', 'title text'],
    ['<textarea></textarea><img src=x onerror=alert(1)>', 'after a textarea'],
    ['<noscript><p title="</noscript><img src=x onerror=alert(1)>">', 'noscript breakout'],
    ['<iframe src="javascript:alert(1)"></iframe>', 'frame'],
    ['<iframe srcdoc="<script>alert(1)</script>"></iframe>', 'frame with its own page'],
    ['<object data="javascript:alert(1)"></object>', 'object'],
    ['<embed src="javascript:alert(1)">', 'embed'],
    ['<math><mi xlink:href="javascript:alert(1)">x</mi></math>', 'math link'],
    ['<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>', 'svg link'],
    ['<svg><style><img src=x onerror=alert(1)></style></svg>', 'svg style breakout'],
    ['<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>', 'nested namespace trick'],
    ['<form action="javascript:alert(1)"><button formaction="javascript:alert(2)">go</button></form>', 'form actions'],
    ['<input autofocus onfocus=alert(1)>', 'input handler'],
    ['<details open ontoggle=alert(1)>x</details>', 'details handler'],
    ['<video><source onerror=alert(1)></video>', 'source handler'],
    ['<base href="//evil.example/">', 'base'],
    ['<meta http-equiv="refresh" content="0;url=javascript:alert(1)">', 'meta refresh'],
    ['<link rel="stylesheet" href="//evil.example/x.css">', 'link'],
    ['<!--><img src=x onerror=alert(1)>-->', 'a comment that closes at once'],
    ['<!-- --!><img src=x onerror=alert(1)>', 'a comment closed the odd way'],
    ['<!--<img src="--><img src=x onerror=alert(1)>">', 'a comment closed inside a value'],
    ['<![CDATA[<img src=x onerror=alert(1)>]]>', 'a CDATA section'],
    ['<?xml version="1.0"?><img src=x onerror=alert(1)>', 'a processing instruction'],
    ['</p title="><img src=x onerror=alert(1)>">', 'attributes on a closing tag'],
    ['<p =onclick="alert(1)">x</p>', 'a name that starts with ='],
    ['<p onclick=alert(1) onclick="x">x</p>', 'a repeated handler'],
    ['<p\u0000 onclick=alert(1)>x</p>', 'a NUL in the tag'],
    ['<a href="https://example.com" target="_blank" onclick=alert(1)>x</a>', 'a good link with a handler'],
    ['<img src="x" id="a" name="cookie">', 'name= can stand in for a page value'],
    ['<p data-action="delete" data-href="javascript:alert(1)">x</p>', 'data- attributes a page script might follow'],
    ['<plaintext><img src=x onerror=alert(1)>', 'plaintext'],
    ['<p>ok</p><img src="x" onerror="alert(1)', 'the text ends inside a tag'],
    ['<a href="x" onclick=', 'the text ends inside a value'],
  ];
  for (const [input, label] of hostile) {
    const out = sanitizeDevHtml(input);
    const why = shape(out) || (/onerror|onload|onclick|onfocus|ontoggle|onmouseover|evil\.example|srcdoc|script:/i.test((out.match(/<[^>]*>/g) || []).filter((t) => !/ href="`/.test(t)).join('')) ? 'hostile words left inside a tag' : '');
    ok(`190: ${label}`, why === '', `${why} ${JSON.stringify(out)}`);
    ok(`190: ${label}, cleaned twice is the same`, sanitizeDevHtml(out) === out, JSON.stringify(sanitizeDevHtml(out)));
  }
  // the two the review named, word for word what comes out
  ok('190: the slash handler leaves only the picture', sanitizeDevHtml('<img src="x"/onerror="alert(1)">') === '<img src="x">', sanitizeDevHtml('<img src="x"/onerror="alert(1)">'));
  ok('190: the unquoted javascript: link loses its address', sanitizeDevHtml('<a href=javascript:alert(1)>x</a>') === '<a>x</a>', sanitizeDevHtml('<a href=javascript:alert(1)>x</a>'));
  // script written as text stays text
  ok('190: a "<" in running text is written as text', sanitizeDevHtml('<p>1 < 2 and a<b</p>') === '<p>1 &lt; 2 and a</p>' || shape(sanitizeDevHtml('<p>1 < 2 and a<b</p>')) === '', sanitizeDevHtml('<p>1 < 2 and a<b</p>'));
  ok('190: escaped markup stays escaped', sanitizeDevHtml('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>') === '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  // what a real block needs still works
  const keep = [
    '<p class="x">Hello <strong>world</strong></p>',
    '<a href="https://example.com/a?b=1&amp;c=2">x</a>',
    '<a href="/menu/#lunch">Lunch</a>',
    '<a href="mailto:hello@example.com">Write</a>',
    '<a href="tel:+15555550100">Call</a>',
    '<img src="/media/a.webp" srcset="/media/a.webp 1x, https://example.com/a@2x.webp 2x" alt="A &amp; B" width="600" height="400" loading="lazy">',
    '<table><thead><tr><th scope="col" colspan="2">Hours</th></tr></thead><tbody><tr><td>Mon</td><td>9 to 5</td></tr></tbody></table>',
    '<ol start="3" reversed><li value="3">Three</li></ol>',
    '<section id="story" aria-label="Our story"><h2>Family-owned</h2><p>Since <time datetime="2019-05-01">2019</time>.</p></section>',
    '<picture><source srcset="/a.avif" type="image/avif"><img src="/a.jpg" alt=""></picture>',
  ];
  for (const k of keep) ok(`190: kept as written: ${k.slice(0, 40)}`, sanitizeDevHtml(k) === k, sanitizeDevHtml(k));
  ok('190: a new-tab link is told not to hand the page over', sanitizeDevHtml('<a href="https://example.com" target="_blank">x</a>') === '<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>', sanitizeDevHtml('<a href="https://example.com" target="_blank">x</a>'));
  ok('190: unquoted values come back quoted', sanitizeDevHtml('<a href=/menu class=btn>x</a>') === '<a href="/menu" class="btn">x</a>', sanitizeDevHtml('<a href=/menu class=btn>x</a>'));
  // the block can't spill out of its slot or swallow the page after it
  ok('190: a stray closing tag is dropped', sanitizeDevHtml('</div></div><p>x</p>') === '<p>x</p>', sanitizeDevHtml('</div></div><p>x</p>'));
  ok('190: tags left open are closed', sanitizeDevHtml('<div><section><p>x') === '<div><section><p>x</p></section></div>', sanitizeDevHtml('<div><section><p>x'));
  ok('190: list items and paragraphs close as a browser closes them', sanitizeDevHtml('<ul><li>a<li>b</ul><p>c<p>d') === '<ul><li>a</li><li>b</li></ul><p>c</p><p>d</p>', sanitizeDevHtml('<ul><li>a<li>b</ul><p>c<p>d'));
  // the cap never leaves half a tag behind
  const long = buildCustomization({ custom_html: '<p>x</p>'.repeat(7000) + '<img src="x" alt="' + 'a'.repeat(200) }).custom_html;
  ok('190: the size cap leaves whole tags', long.length <= 50000 && shape(long) === '' && long.endsWith('</p>'), long.slice(-40));
}

// ── summary ──
const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
