#!/usr/bin/env node
// ── Pack the published site, and name the app's files by their contents (builder item 142) ──
// Review file 06, finding 3 (Nov 10 2026): none of the app's code was packed down, and every
// page view asked the server again whether shell.js and shell.css had changed. build-public.sh
// runs this on dist/ after copying, so the repo's files stay as people write them and the tests
// read those; only what Netlify publishes changes.
//
//  1. Packs every root-level script and style sheet, and the scripts and styles written into
//     each page: spaces and comments go, and a function's own inner names shorten. Names at the
//     top of a script are kept, since pages and other scripts call them by name.
//  2. Copies each root-level script and style sheet to /v/<fingerprint>/<name>, the fingerprint
//     taken from its packed contents, and points every page and script at that copy. The copy's
//     address changes whenever the file does, so _headers keeps /v/* for a year and a page view
//     asks for nothing it already has. The plain /shell.js stays too, with its own rule, for
//     anything that names it directly (the tools host's pages, a site's embed, an old page).
//
// A file is pointed at only where its address is written whole, in quotes: src="/shell.js",
// '/create.js', "/qr.js?v=1". An address built from pieces keeps the plain file.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { transformSync } from 'esbuild';

const DIST = process.argv[2] || 'dist';
// The service worker keeps its address (its scope is where it sits), and the tools host's
// pages keep the plain names: that host serves only the files _redirects lists (list item 139).
const KEEP_NAME = new Set(['sw.js']);
const PLAIN_PAGES = new Set(['site-review.html', 'ai-visibility.html', 'report.html']);

const js = (code, where) => {
  try {
    return transformSync(code, { loader: 'js', minify: true, charset: 'utf8', legalComments: 'none' }).code.trim();
  } catch (e) { throw new Error(`pack-public: ${where} would not pack: ${e.message}`); }
};
const css = (code, where) => {
  try {
    return transformSync(code, { loader: 'css', minify: true, charset: 'utf8', legalComments: 'none' }).code.trim();
  } catch (e) { throw new Error(`pack-public: ${where} would not pack: ${e.message}`); }
};

// ── 1. pack ──────────────────────────────────────────────────────────────────
const root = readdirSync(DIST).filter((f) => statSync(join(DIST, f)).isFile());
const assets = root.filter((f) => /\.(js|css)$/.test(f));
const pages = root.filter((f) => f.endsWith('.html'));
let before = 0, after = 0;
for (const f of assets) {
  const src = readFileSync(join(DIST, f), 'utf8');
  const out = f.endsWith('.js') ? js(src, f) : css(src, f);
  before += Buffer.byteLength(src); after += Buffer.byteLength(out);
  writeFileSync(join(DIST, f), out);
}
// A script written into a page: no src, and plain script (no type, or a script type). Data
// blocks (application/ld+json, templates) are left as they are.
const SCRIPT = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
const STYLE = /<style(\s[^>]*)?>([\s\S]*?)<\/style>/gi;
const isCode = (attrs = '') => !/\bsrc\s*=/i.test(attrs) && (!/\btype\s*=/i.test(attrs) || /\btype\s*=\s*["']?(text\/javascript|module|application\/javascript)["']?/i.test(attrs));
for (const f of pages) {
  const src = readFileSync(join(DIST, f), 'utf8');
  let n = 0;
  const out = src
    .replace(SCRIPT, (all, attrs, body) => (isCode(attrs) && body.trim() ? (n++, `<script${attrs || ''}>${js(body, `${f}, script ${n}`)}</script>`) : all))
    .replace(STYLE, (all, attrs, body) => (body.trim() ? `<style${attrs || ''}>${css(body, `${f}, style`)}</style>` : all));
  before += Buffer.byteLength(src); after += Buffer.byteLength(out);
  writeFileSync(join(DIST, f), out);
}

// ── 2. fingerprinted copies ──────────────────────────────────────────────────
const named = assets.filter((f) => !KEEP_NAME.has(f));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const refTo = (f) => new RegExp(`(["'])/${esc(f)}(\\?v=[\\w.-]*)?\\1`, 'g');
const mentions = (text, f) => refTo(f).test(text);
const content = new Map(named.map((f) => [f, readFileSync(join(DIST, f), 'utf8')]));
const where = new Map();   // file → /v/<fingerprint>/<file>
const point = (text) => { for (const [f, to] of where) text = text.replace(refTo(f), (_m, q) => `${q}${to}${q}`); return text; };
// a file is fingerprinted after the files it names, so its fingerprint covers theirs
const left = new Set(named);
while (left.size) {
  const ready = [...left].filter((f) => [...left].every((g) => g === f || !mentions(content.get(f), g)));
  if (!ready.length) throw new Error(`pack-public: these files name each other in a circle: ${[...left].join(', ')}`);
  for (const f of ready) {
    const text = point(content.get(f));
    const fp = createHash('sha256').update(text).digest('hex').slice(0, 12);
    mkdirSync(join(DIST, 'v', fp), { recursive: true });
    writeFileSync(join(DIST, 'v', fp, f), text);
    writeFileSync(join(DIST, f), text);   // the plain copy points at the fingerprinted ones too
    where.set(f, `/v/${fp}/${f}`);
    left.delete(f);
  }
}
let pointed = 0;
for (const f of pages) {
  if (PLAIN_PAGES.has(f)) continue;
  const src = readFileSync(join(DIST, f), 'utf8');
  const out = point(src);
  if (out !== src) { pointed++; writeFileSync(join(DIST, f), out); }
}
// the rule that keeps them must be there, or a fingerprinted file would be kept an hour
const headers = readFileSync(join(DIST, '_headers'), 'utf8');
if (!/^\/v\/\*\n\s+Cache-Control:\s*public,\s*max-age=31536000,\s*immutable\s*$/m.test(headers)) {
  throw new Error('pack-public: _headers has no year-long rule for /v/*');
}
console.log(`pack-public: ${assets.length} files and ${pages.length} pages packed, ${Math.round(before / 1024)} kB to ${Math.round(after / 1024)} kB; ${where.size} fingerprinted, ${pointed} pages point at them`);
