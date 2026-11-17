#!/usr/bin/env node
// ── A stand-in for the app host, for measuring how the editor loads (builder items 37, 38, 142) ──
// The test server (http-server -c-1) sends files raw and says "never keep this", so neither the
// bytes nor the second visit it shows are what a person gets. This one serves a built folder
// (dist/, from scripts/build-public.sh) the way Netlify does:
//   · brotli at quality 4, which matches the live app host's sizes to within 1%
//     (presence.html: 420,143 bytes live, 417,652 here, measured Nov 16 2026)
//   · the folder's own _headers, a later rule replacing an earlier one's same header, as the live
//     host does (/shell.js answers no-cache although /*.js above it says a day)
//   · clean addresses (/presence answers presence.html), and ETag + 304 for a re-check
// Usage: node scripts/measure/serve-like-netlify.mjs <folder> <port>
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { createHash } from 'node:crypto';

const ROOT = resolve(process.argv[2] || 'dist');
const PORT = Number(process.argv[3] || 4729);

const TYPES = {
  '.html': 'text/html; charset=UTF-8', '.js': 'application/javascript; charset=UTF-8', '.mjs': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=UTF-8',
  '.xml': 'application/xml',
};
const TEXT = /^(text\/|application\/(javascript|json|xml)|image\/svg)/;

// _headers: blocks of "path" then indented "Name: value" lines.
function readRules() {
  const f = join(ROOT, '_headers');
  if (!existsSync(f)) return [];
  const rules = [];
  let cur = null;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { cur = { re: new RegExp('^' + line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'), headers: {} }; rules.push(cur); continue; }
    const m = line.trim().match(/^([^:]+):\s*(.*)$/);
    if (m && cur) cur.headers[m[1].toLowerCase()] = m[2];
  }
  return rules;
}
const RULES = readRules();
const headersFor = (path) => {
  const out = {};
  for (const r of RULES) if (r.re.test(path)) Object.assign(out, r.headers);   // a later rule wins
  return out;
};

function fileFor(path) {
  const clean = decodeURIComponent(path).replace(/\/+$/, '') || '/';
  const tries = clean === '/' ? ['index.html'] : [clean.slice(1), clean.slice(1) + '.html', clean.slice(1) + '/index.html'];
  for (const t of tries) {
    const f = join(ROOT, t);
    if (f.startsWith(ROOT) && existsSync(f) && statSync(f).isFile()) return f;
  }
  return null;
}

const packed = new Map();   // file → { body, br, etag, mtime }
function load(f) {
  const mtime = statSync(f).mtimeMs;
  const had = packed.get(f);
  if (had && had.mtime === mtime) return had;
  const body = readFileSync(f);
  const type = TYPES[extname(f)] || 'application/octet-stream';
  const br = TEXT.test(type) ? brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }) : null;
  const one = { body, br, type, etag: 'W/"' + createHash('md5').update(body).digest('hex') + '"', mtime };
  packed.set(f, one);
  return one;
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const f = fileFor(url.pathname);
  const rule = headersFor(url.pathname);
  // the editor's Preview frame asks for fonts from no origin (builder item 190)
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!f) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
  const one = load(f);
  const head = { ...rule, 'content-type': one.type, etag: one.etag, vary: 'Accept-Encoding' };
  delete head['content-security-policy'];   // the test pages call a made-up API host; the rule is checked elsewhere
  if (req.headers['if-none-match'] === one.etag) { res.writeHead(304, head); return res.end(); }
  const br = one.br && /\bbr\b/.test(String(req.headers['accept-encoding'] || ''));
  if (br) head['content-encoding'] = 'br';
  const body = br ? one.br : one.body;
  head['content-length'] = String(body.length);
  res.writeHead(200, head);
  res.end(req.method === 'HEAD' ? undefined : body);
}).listen(PORT, '127.0.0.1', () => console.log(`serving ${ROOT} like Netlify on http://127.0.0.1:${PORT}`));
