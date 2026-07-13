// -- Markdown sanitizer safety + fidelity (the XSS contract, unit level) -------
// renderMarkdown is what turns owner prose (About story, FAQ answers, update
// bodies) into HTML on PUBLISHED customer sites, driven by the presence.html
// writing toolbar. This suite asserts the two guarantees directly:
//   1. SAFETY  -- no raw HTML / <script> / event handler / javascript:/data: URL
//      can ever survive; everything is escaped-first, links pass safeHref.
//   2. FIDELITY -- the toolbar's markdown (## H2, ### H3, **bold**, *em*, links,
//      - / 1. lists, > quote) renders the intended semantic element, and H1 is
//      demoted to H2 so a published page keeps exactly one <h1> (accessibility).
//
//   deno run --allow-read tests/presence/markdown_test.mjs
import { renderMarkdown, safeHref, esc } from '../../supabase/functions/presence/lib/markdown.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' -- ' + note : ''}`); };

// A markup tag/handler/scheme is "live" only if it survived UN-escaped. Escaped
// forms (&lt;script&gt;, &quot;) are the CORRECT, safe output and must be ignored.
const noLiveMarkup = (html) => {
  const bad = [];
  if (/<script[\s>]/i.test(html)) bad.push('<script>');
  if (/<\/script>/i.test(html)) bad.push('</script>');
  if (/<(img|svg|iframe|object|embed|style|link|meta|base|form)[\s>]/i.test(html)) bad.push('raw element');
  if (/<[a-z][a-z0-9]*\b[^>]*\son\w+\s*=/i.test(html)) bad.push('event handler');
  if (/(?:href|src)\s*=\s*"(?:javascript|data|vbscript):/i.test(html)) bad.push('dangerous-scheme url');
  return bad;
};

// === 1. safeHref allowlist ===
{
  const allow = ['https://example.com', 'https://x.io/a?b=1&c=2', 'mailto:a@b.com', 'tel:+1 (555) 123-4567'];
  const deny = ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<script>', 'vbscript:x',
    'http://example.com', 'file:///etc/passwd', '//evil.example', ' javascript:alert(1)', ''];
  ok('safeHref: keeps https/mailto/tel', allow.every((u) => safeHref(u) === u), allow.filter((u) => safeHref(u) !== u).join(','));
  ok('safeHref: rejects javascript/data/vbscript/file/http/protocol-relative -> null', deny.every((u) => safeHref(u) === null),
    deny.filter((u) => safeHref(u) !== null).map((u) => u.slice(0, 20)).join(' | '));
}

// === 2. escape-first: raw HTML can never form a live tag ===
{
  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg/onload=alert(1)>',
    '<iframe src="https://evil.example"></iframe>',
    '<a href="javascript:alert(1)">x</a>',
    '"><script>alert(1)</script>',
    '<style>*{display:none}</style>',
    '<div onmouseover="alert(1)">hi</div>',
    '<!-- comment --><script>x</script>',
  ];
  let bad = [], everEscaped = false;
  for (const p of payloads) {
    const out = renderMarkdown(p);
    const b = noLiveMarkup(out); if (b.length) bad.push(`${p.slice(0, 24)} -> ${b.join(',')}`);
    if (out.includes('&lt;')) everEscaped = true;
  }
  ok('escape-first: no raw HTML payload yields live markup', bad.length === 0, bad.slice(0, 3).join(' | '));
  ok('escape-first: hostile "<" is entity-encoded (proves escaping ran)', everEscaped);
}

// === 3. links: only safe schemes become anchors, always rel="noopener" ===
{
  const md = '[safe](https://ok.example) [mail](mailto:a@b.com) [js](javascript:alert(1)) [data](data:text/html,x) [rel](/relative) [bare](example.com)';
  const out = renderMarkdown(md);
  ok('link: https/mailto become <a>', out.includes('href="https://ok.example"') && out.includes('href="mailto:a@b.com"'));
  ok('link: every emitted anchor carries rel="noopener"', !/<a (?![^>]*rel="noopener")/.test(out));
  ok('link: javascript:/data:/relative/bare-domain drop to plain text (no anchor)',
    noLiveMarkup(out).length === 0 && !out.includes('href="javascript:') && !out.includes('href="data:') && !out.includes('href="/relative"') && !out.includes('href="example.com"'));
  // a quote-injection URL cannot break out of the href attribute
  const brk = renderMarkdown('[x](https://a.example"onmouseover="alert(1))');
  ok('link: URL cannot break out of the href attribute', noLiveMarkup(brk).length === 0);
}

// === 4. block/inline fidelity -- the toolbar's output renders as intended ===
{
  ok('heading: "## " -> <h2>, "### " -> <h3>', renderMarkdown('## Title').includes('<h2>Title</h2>') && renderMarkdown('### Sub').includes('<h3>Sub</h3>'));
  ok('heading: "# " (H1) demoted to <h2> -- page keeps one true <h1>',
    renderMarkdown('# Top').includes('<h2>Top</h2>') && !renderMarkdown('# Top').includes('<h1'));
  ok('inline: **bold** -> <strong>, *italic* -> <em>', renderMarkdown('**b** and *i*').includes('<strong>b</strong>') && renderMarkdown('**b** and *i*').includes('<em>i</em>'));
  ok('list: "- " -> <ul><li>', /<ul><li>one<\/li><li>two<\/li><\/ul>/.test(renderMarkdown('- one\n- two')));
  ok('list: "1. " -> <ol><li>', /<ol><li>one<\/li><li>two<\/li><\/ol>/.test(renderMarkdown('1. one\n2. two')));
  ok('quote: "> " -> <blockquote>', renderMarkdown('> wisdom').includes('<blockquote><p>wisdom</p></blockquote>'));
  ok('paragraphs: blank line splits <p>, single newline is <br>', renderMarkdown('a\nb\n\nc') === '<p>a<br>b</p>\n<p>c</p>');
}

// === 5. no output element outside the allowlist ===
{
  const rich = renderMarkdown('# h1\n## h2\n### h3\n\npara **b** *i* [l](https://x.example)\n\n- a\n- b\n\n1. c\n\n> q');
  const tags = [...rich.matchAll(/<([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase());
  const allowed = new Set(['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'h2', 'h3', 'blockquote', 'a']);
  const outside = [...new Set(tags)].filter((t) => !allowed.has(t));
  ok('allowlist: output uses only p/br/strong/em/ul/ol/li/h2/h3/blockquote/a', outside.length === 0, outside.join(','));
}

// === 6. control chars stripped, empty input safe ===
{
  ok('empty/whitespace input -> empty output', renderMarkdown('') === '' && renderMarkdown('   ') === '');
  const withCtrl = 'a' + String.fromCharCode(0) + String.fromCharCode(7) + 'bc';
  ok('NUL and control chars are removed', renderMarkdown(withCtrl) === '<p>abc</p>');
  ok('esc encodes the five HTML-significant characters', esc(`<>&"'`) === '&lt;&gt;&amp;&quot;&#39;');
}

const fails = results.filter((r) => !r.p);
console.log(`\n==== MARKDOWN SAFETY SUITE: ${results.length - fails.length}/${results.length} PASSED ====`);
if (fails.length) { for (const f of fails) console.log(' FAIL:', f.n); Deno.exit(1); }
