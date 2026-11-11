// ── List item 143: pages draw sooner and fetch less (Nov 11 2026) ─────────────
// File 06 of the Nov 10 review, findings 4, 5 and 14:
//   • no page waits for a script in its head before it can draw. The sign-in library
//     sat in the head of Deals, Projects, sign-up and set-password; it now loads just
//     before the page script that uses it, as on every other app page.
//   • no page asks Google for fonts: the marketing pages and the free tools load the
//     same files from our own /fonts (brand.css), the app pages already did.
//   • the brand font files are kept for a year (their names never change).
//   • /favicon.ico exists, so a page that names no icon stops getting a not-found.
//   deno run --allow-read tests/presence/page_speed_test.mjs
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const exists = (p) => { try { Deno.statSync(new URL(p, ROOT)); return true; } catch { return false; } };

const results = [];
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${!p && d ? `\n      ${d}` : ''}`); };

// the pages the site serves (build-public.sh copies every root .html, then takes these out)
const INTERNAL = new Set(['email-signature.html', 'styleguide.html', 'a11y.html', 'provision.html']);
const pages = [...Deno.readDirSync(ROOT)].filter((e) => e.isFile && e.name.endsWith('.html')).map((e) => e.name).sort();
const served = pages.filter((f) => !INTERNAL.has(f));
ok('there are pages to check', served.length > 80, String(served.length));

// ── 1. nothing in a page's head holds up its first paint ─────────────────────
{
  const blocking = [];
  for (const f of served) {
    const html = read(f);
    const body = html.search(/<body[\s>]/i);
    const head = body >= 0 ? html.slice(0, body) : html;
    for (const tag of head.match(/<script\b[^>]*\bsrc=[^>]*>/gi) || []) {
      if (!/\b(defer|async)\b|type=["']?module/i.test(tag)) blocking.push(`${f}: ${tag}`);
    }
  }
  ok('no page loads a script in its head that stops it drawing', blocking.length === 0, blocking.join(' | '));
}
{
  // the four pages that had it there: the library now comes right before the script that uses it
  const LIB = '<script src="/vendor/supabase-js-2.45.4.js"></script>';
  for (const f of ['pipeline.html', 'projects.html', 'set-password.html', 'signup.html']) {
    const html = read(f);
    const at = html.indexOf(LIB), body = html.search(/<body[\s>]/i);
    const next = html.slice(at + LIB.length).match(/^\s*<script>([\s\S]*?)<\/script>/);
    ok(`${f}: the sign-in library is in the body, just before the script that uses it`,
      at > body && body > 0 && html.indexOf(LIB, at + 1) === -1 && !!next && /\bsupabase\b/.test(next[1]));
  }
}

// ── 2. fonts come from our own server ────────────────────────────────────────
const rootFiles = [...Deno.readDirSync(ROOT)].filter((e) => e.isFile && /\.(html|js|css)$/.test(e.name)).map((e) => e.name);
{
  const google = rootFiles.filter((f) => /fonts\.(googleapis|gstatic)\.com/.test(read(f)));
  ok('no page, script or style sheet asks Google for fonts', google.length === 0, google.join(', '));
  ok('so the privacy page no longer lists Google Fonts among our providers', !/Google Fonts/.test(read('privacy.html')));
}
const brand = read('fonts/brand.css');
{
  const urls = [...brand.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/^['"]|['"]$/g, ''));
  const missing = urls.filter((u) => !u.startsWith('/fonts/') || !exists(u.slice(1)));
  ok('every font file brand.css names is one of ours, and exists', urls.length > 40 && missing.length === 0, missing.join(', '));
  for (const [family, weight] of [['Fraunces', '300 600'], ['Inter', '400'], ['Inter', '700'], ['Geist Mono', '400'], ['Playfair Display', '400'], ['Playfair Display', '700']]) {
    const re = new RegExp(`font-family: '${family}';\\s*font-style: normal;\\s*font-weight: ${weight};`);
    ok(`brand.css declares ${family} ${weight}`, re.test(brand));
  }
}
{
  // a page whose own styles (inline, or a same-origin sheet it links) name a brand face
  // must load the faces, or it would quietly draw in the fallback font
  const FACE = /font-family:[^;}{]*['"]?(Fraunces|Playfair Display|Geist Mono)\b|(?:--serif|--mono|--font-[\w-]+)\s*:\s*['"]?(Fraunces|Playfair Display|Geist Mono)\b/;
  const sheetsOf = (html) => [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="\/([^"?]+\.css)[^"]*"[^>]*>/g)].map((m) => m[1]);
  const without = [];
  for (const f of served) {
    const html = read(f);
    if (/RETIRED/.test(html) && /location\.replace\(/.test(html)) continue;   // a retired page that forwards at once
    const sheets = sheetsOf(html);
    const own = [html, ...sheets.filter((s) => s !== 'fonts/brand.css' && exists(s)).map(read)].join('\n');
    if (FACE.test(own) && !sheets.includes('fonts/brand.css')) without.push(f);
  }
  ok('every page that draws in a brand face loads /fonts/brand.css', without.length === 0, without.join(', '));
}

{
  // the free tools' host serves only the files its pages load (_redirects, list item 139), so it
  // must serve brand.css and every font file brand.css names, or the tools draw in fallback fonts
  const TOOLS = 'https://tools.davisdigitalstudio.com';
  const lines = read('_redirects').split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
  const served = new Map(lines.map((l) => l.split(/\s+/)).filter(([from, , code]) => from.startsWith(TOOLS + '/') && code === '200!').map(([from, to]) => [from.slice(TOOLS.length), to]));
  const catchAll = lines.findIndex((l) => l.startsWith(`${TOOLS}/* `));
  const files = ['/fonts/brand.css', ...new Set([...brand.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/^['"]|['"]$/g, '')))];
  const missing = files.filter((f) => served.get(f) !== f);
  ok('the tools host serves brand.css and every font file it names', missing.length === 0, missing.join(', '));
  ok('…above its catch-all forward', files.every((f) => { const i = lines.findIndex((l) => l.startsWith(`${TOOLS}${f} `)); return i > -1 && i < catchAll; }));
}

// ── 3. how long the browser keeps them ───────────────────────────────────────
const headers = read('_headers');
const rule = (path) => { const m = new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n\\s*Cache-Control: ([^\\n]+)`, 'm').exec(headers); return m ? m[1] : null; };
ok('the brand font files are kept for a year, and never asked about again', rule('/fonts/*.woff2') === 'public, max-age=31536000, immutable');
ok('the font library keeps its month (its names stay put when a file is updated)', rule('/fonts/library/*') === 'public, max-age=2592000');
ok('the brand rule sits above the library rule, so a library file keeps the month', headers.indexOf('\n/fonts/*.woff2\n') > 0 && headers.indexOf('\n/fonts/*.woff2\n') < headers.indexOf('\n/fonts/library/*\n'));
{
  const names = [...Deno.readDirSync(new URL('fonts/', ROOT))].filter((e) => e.isFile && e.name.endsWith('.woff2')).map((e) => e.name);
  // the year is only safe while a changed file gets a new name: Google's hashed names, never a plain one
  ok('every brand font file has a content-made name', names.length > 10 && names.every((n) => /^[A-Za-z0-9_-]{20,}\.woff2$/.test(n)), names.filter((n) => !/^[A-Za-z0-9_-]{20,}\.woff2$/.test(n)).join(', '));
}

// ── 4. the icon a browser asks for by itself ─────────────────────────────────
{
  const ico = Deno.readFileSync(new URL('favicon.ico', ROOT));
  const dv = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
  const isIco = ico.length > 22 && dv.getUint16(0, true) === 0 && dv.getUint16(2, true) === 1;
  const count = isIco ? dv.getUint16(4, true) : 0;
  const sizes = [], pngs = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16, w = ico[at] || 256, len = dv.getUint32(at + 8, true), off = dv.getUint32(at + 12, true);
    sizes.push(w);
    pngs.push(off + len <= ico.length && ico[off] === 0x89 && ico[off + 1] === 0x50 && ico[off + 2] === 0x4e && ico[off + 3] === 0x47);
  }
  ok('/favicon.ico is a real icon file holding 16, 32 and 48 pixel pictures', isIco && sizes.join(',') === '16,32,48' && pngs.every(Boolean), `sizes ${sizes}`);
  ok('the build publishes it (root .ico files are copied)', /\.\/\*\.ico/.test(read('scripts/build-public.sh')));
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) Deno.exit(1);
