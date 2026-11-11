// ── Who can see a page, and whether it shows the header and footer (builder list items 48 and 120, Nov 2026) ──
// An owner's own page is open to everyone (the default), needs a password, or is private:
// kept in the draft and left off the live site. It can also leave out the site's header or
// footer, which a landing page wants. The template's own pages (Home, About, the menu and the
// rest) are built from the business details and stay open with both.
//
// The header and footer go at render time, so the canvas, Preview, a shared draft and the
// live site all show the page the same way. Every template draws them as
// <header class="site"> and <footer class="site">, so one pass covers all eight.
//
// Who can see it only changes the live site. A private page leaves the site before it is
// drawn: no file, no menu link, no sitemap or search entry. A password page is drawn as
// usual, then sealed: the published file holds the page encrypted (AES-GCM, with a key made
// from the password by PBKDF2) and a small box in the site's own look that asks for the
// password and opens the page in the visitor's browser. The server never keeps the password,
// only the key made from it (presence_page_locks, migration 0151), so a password page can't
// go live without its key: one whose key is missing is kept off the site, like a private one.
//
// Everything above encrypt/derive is pure.
import type { FileMap, SnapshotContent } from './render_types.ts';

export type PageAccess = 'everyone' | 'password' | 'private';
type Settings = NonNullable<SnapshotContent['settings']>;
export interface PageShow { access?: 'password' | 'private'; lock?: string; noHeader?: true; noFooter?: true }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** PBKDF2 rounds for a page key: slow enough to make guessing a password from the published
 *  file expensive, quick enough for an older phone to open the page in about a second. */
export const LOCK_ITERATIONS = 310_000;
export const PASSWORD_MIN = 4, PASSWORD_MAX = 100;

/** The display settings a stored page carries, cleaned for the snapshot. Absent fields stay
 *  absent, so a page that never used them is byte-identical to before. Pure. */
export function pageShowFields(p: unknown): PageShow {
  const x = (p && typeof p === 'object') ? p as Record<string, unknown> : {};
  const out: PageShow = {};
  if (x.access === 'password' || x.access === 'private') out.access = x.access;
  if (typeof x.lock === 'string' && UUID.test(x.lock)) out.lock = x.lock.toLowerCase();
  if (x.noHeader === true) out.noHeader = true;
  if (x.noFooter === true) out.noFooter = true;
  return out;
}

const HEADER_RE = /<header class="site"[^>]*>[\s\S]*?<\/header>\n?/;
const FOOTER_RE = /<footer class="site"[^>]*>[\s\S]*?<\/footer>\n?/;

/** One page without the site's header and/or footer. Pure. */
export function stripSiteChrome(html: string, opts: { header?: boolean; footer?: boolean }): string {
  let out = html;
  if (opts.header) out = out.replace(HEADER_RE, '');
  if (opts.footer) out = out.replace(FOOTER_RE, '');
  return out;
}

/** The same over a rendered site: each own page that asked. Pure. */
export function applyPageChrome(fileMap: FileMap, pages: Array<{ slug: string; noHeader?: boolean; noFooter?: boolean }> | undefined): FileMap {
  const asked = (pages || []).filter((p) => p && p.slug && (p.noHeader || p.noFooter));
  if (!asked.length) return fileMap;
  const out: FileMap = { ...fileMap };
  for (const p of asked) {
    const key = `${p.slug}/index.html`;
    const html = out[key];
    if (typeof html === 'string') out[key] = stripSiteChrome(html, { header: !!p.noHeader, footer: !!p.noFooter });
  }
  return out;
}

/** The lock ids a draft's password pages name. Pure. */
export function lockIdsIn(c: SnapshotContent | null | undefined): string[] {
  const ids = new Set<string>();
  for (const p of c?.settings?.pages || []) if (p && p.access === 'password' && p.lock) ids.add(p.lock);
  return [...ids];
}

/** What the live site is drawn from. Private pages leave it, and so does a password page whose
 *  key can't be found: their files, menu links, sitemap and search entries. A menu item that
 *  led to a page that left and held a dropdown leaves its dropdown in its place. Password pages
 *  stay in the menu and are kept off Google and the site's search. The draft is not changed:
 *  this is a copy. Pure. */
export function liveContent(c: SnapshotContent, usableLocks: ReadonlySet<string>): { content: SnapshotContent; sealed: Array<{ slug: string; title: string; lock: string }> } {
  const was: Settings = c.settings || {};
  const pages = was.pages || [];
  const opens = (p: { access?: string; lock?: string }) => p.access !== 'private' && !(p.access === 'password' && !(p.lock && usableLocks.has(p.lock)));
  const gone = new Set(pages.filter((p) => !opens(p)).map((p) => `/${p.slug}/`));
  const sealed = pages.filter((p) => opens(p) && p.access === 'password').map((p) => ({ slug: p.slug, title: p.title, lock: p.lock as string }));
  if (!gone.size && !sealed.length) return { content: c, sealed };
  const settings: Settings = { ...was, pages: pages.filter(opens) };
  if (Array.isArray(was.nav)) {
    const nav: NonNullable<Settings['nav']> = [];
    for (const it of was.nav) {
      const kids = (it.children || []).filter((k) => !gone.has(k.href));
      if (gone.has(it.href)) { nav.push(...kids.map((k) => ({ label: k.label, href: k.href }))); continue; }
      if ((it as { folder?: boolean }).folder && !kids.length) continue;   // a menu folder left with nothing in it isn't drawn
      nav.push(kids.length ? { ...it, children: kids } : { label: it.label, href: it.href });
    }
    settings.nav = nav;
  }
  if (sealed.length) settings.pages_noindex = [...new Set([...(was.pages_noindex || []), ...sealed.map((p) => `page:${p.slug}`)])];
  return { content: { ...c, settings }, sealed };
}

// ── the password box a visitor sees ──────────────────────────────────────────

const escHtml = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// In the site's own colours and fonts (every template names them --ink, --soft, --card,
// --accent and --line); the fallbacks only matter for a stylesheet that didn't load.
const GATE_CSS = `.dds-lock{max-width:440px;margin:clamp(40px,10vh,104px) auto;padding:clamp(24px,5vw,40px);box-sizing:border-box;text-align:center;background:var(--card,#fff);color:var(--ink,#1c1b18);border:1px solid var(--line,#e2ded8);border-radius:18px;box-shadow:0 12px 32px rgba(0,0,0,.08)}
.dds-lock-wrap{padding:0 16px}
.dds-lock-ic{display:inline-grid;place-items:center;width:56px;height:56px;border-radius:999px;background:var(--wash,#f2efe9);color:var(--accent,#333)}
.dds-lock-ic svg{width:26px;height:26px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.dds-lock h1{margin:16px 0 8px;font-size:clamp(1.6rem,4vw,2rem);line-height:1.2}
.dds-lock p{margin:0 0 20px;color:var(--soft,#5b564c)}
.dds-lock label{position:absolute;left:-9999px}
.dds-lock input{display:block;width:100%;box-sizing:border-box;margin:0 0 12px;padding:13px 14px;font:inherit;font-size:16px;color:var(--ink,#1c1b18);background:var(--card,#fff);border:1px solid var(--line,#d6d0c6);border-radius:10px}
.dds-lock input[aria-invalid=true]{border-color:#b42318;outline-color:#b42318}
.dds-lock button{display:block;width:100%;padding:14px;font:inherit;font-weight:600;color:#fff;background:var(--accent,#333);border:0;border-radius:10px;cursor:pointer}
.dds-lock button:focus-visible,.dds-lock input:focus-visible,.dds-lock a:focus-visible{outline:2px solid var(--accent,#333);outline-offset:2px}
.dds-lock .dds-lock-msg{min-height:1.4em;margin:0 0 12px;color:#b42318;font-weight:500}
.dds-lock .dds-lock-msg:empty{margin:0}
.dds-lock .dds-lock-back{display:inline-block;margin-top:16px;color:var(--ink,#1c1b18)}`;

// The visitor's side: make the key from what they typed the way the server did, open the
// page with it, and put it on screen in place of this one. The key (never the password) is
// kept for the visit, so going back to the page doesn't ask again.
const GATE_JS = `(function(){var d=document,cfg=JSON.parse(d.getElementById("dds-lock-data").textContent),f=d.getElementById("dds-lock-form"),i=d.getElementById("dds-lock-pw"),m=d.getElementById("dds-lock-msg"),b=f.querySelector("button"),c=window.crypto&&window.crypto.subtle,k="dds-lock:"+cfg.salt;
function bytes(s){var r=atob(s),u=new Uint8Array(r.length);for(var j=0;j<r.length;j++)u[j]=r.charCodeAt(j);return u}
function b64(u){var s="";u=new Uint8Array(u);for(var j=0;j<u.length;j++)s+=String.fromCharCode(u[j]);return btoa(s)}
function open(raw){return c.importKey("raw",raw,"AES-GCM",false,["decrypt"]).then(function(key){return c.decrypt({name:"AES-GCM",iv:bytes(cfg.iv)},key,bytes(cfg.data))}).then(function(buf){var html=new TextDecoder().decode(buf);try{sessionStorage.setItem(k,b64(raw))}catch(e){}d.open();d.write(html);d.close()})}
if(!c){m.textContent="This page can only be opened over a secure (https) connection.";b.disabled=true;return}
try{var kept=sessionStorage.getItem(k);if(kept)open(bytes(kept)).catch(function(){try{sessionStorage.removeItem(k)}catch(e){}})}catch(e){}
f.addEventListener("submit",function(e){e.preventDefault();var pw=i.value.trim();if(!pw){i.focus();return}b.disabled=true;m.textContent="";i.removeAttribute("aria-invalid");
c.importKey("raw",new TextEncoder().encode(pw),"PBKDF2",false,["deriveBits"]).then(function(base){return c.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:bytes(cfg.salt),iterations:cfg.iterations},base,256)}).then(open).catch(function(){b.disabled=false;m.textContent="That password isn\\u2019t right. Try again.";i.setAttribute("aria-invalid","true");i.select()})})})();`;

const LOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

/** The page a visitor gets instead of a password page: the rendered page's own head (its
 *  title, stylesheet and fonts, without its description, share tags or structured data),
 *  the site's header and footer as the page drew them, the password box in the middle, and
 *  the sealed page. Pure. */
export function gatePage(html: string, sealed: { iv: string; data: string }, lock: { salt: string; iterations: number }, opts: { title: string }): string {
  const headM = html.match(/^[\s\S]*?<\/head>/);
  let head = headM ? headM[0] : '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>';
  head = head
    .replace(/<meta name="description"[^>]*>\n?/g, '')
    .replace(/<meta (?:property="og:|name="twitter:)[^>]*>\n?/g, '')
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\n?/g, '')
    .replace(/<link rel="preload"[^>]*>\n?/g, '');
  if (!/<meta name="robots"/.test(head)) head = head.replace('</head>', '<meta name="robots" content="noindex">\n</head>');
  head = head.replace('</head>', `<style id="dds-lock-css">${GATE_CSS}</style>\n</head>`);
  const bodyTag = (html.match(/<body[^>]*>/) || ['<body>'])[0];
  const before = html.slice(html.indexOf(bodyTag) + bodyTag.length, Math.max(html.indexOf('<main'), 0));
  const header = (before.match(HEADER_RE) || [''])[0];
  const skip = (before.match(/<a class="skip"[^>]*>[\s\S]*?<\/a>/) || [''])[0];
  // the announcement bar and a closed notice are the site's, not the page's: they stay
  const notices = before.replace(HEADER_RE, '').replace(/<a class="skip"[^>]*>[\s\S]*?<\/a>/, '').trim();
  const footer = (html.match(FOOTER_RE) || [''])[0];
  const name = escHtml(opts.title || 'This page');
  const data = JSON.stringify({ salt: lock.salt, iterations: lock.iterations, iv: sealed.iv, data: sealed.data }).replaceAll('<', '\\u003c');
  return `${head}
${bodyTag}
${skip}
${notices}
${header}<main id="main" class="dds-lock-wrap">
<form class="dds-lock" id="dds-lock-form" autocomplete="off">
<span class="dds-lock-ic">${LOCK_SVG}</span>
<h1>This page needs a password</h1>
<p>Type the password you were given to see ${name}.</p>
<label for="dds-lock-pw">Password</label>
<input id="dds-lock-pw" name="password" type="password" autocomplete="current-password" placeholder="Password" required>
<div class="dds-lock-msg" id="dds-lock-msg" role="alert" aria-live="polite"></div>
<button type="submit">Open the page</button>
<a class="dds-lock-back" href="/">Back to the home page</a>
</form>
</main>
${footer}<script type="application/json" id="dds-lock-data">${data}</script>
<script>${GATE_JS}</script>
</body>
</html>
`;
}

// ── keys and sealing (Web Crypto, the same in Deno and the visitor's browser) ──

const toB64 = (u: Uint8Array) => { let s = ''; for (const b of u) s += String.fromCharCode(b); return btoa(s); };
const fromB64 = (s: string): Uint8Array<ArrayBuffer> => { const r = atob(s); const u = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) u[i] = r.charCodeAt(i); return u; };

/** The 256-bit key a password makes with this salt. Both ends trim the password. */
export async function lockKeyFromPassword(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password).trim()), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256));
}

/** Why a password can't be used, in a sentence, or null when it can. Pure. */
export function passwordProblem(password: unknown): string | null {
  const pw = String(password ?? '').trim();
  if (pw.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} letters or numbers.`;
  if (pw.length > PASSWORD_MAX) return `Keep it under ${PASSWORD_MAX} characters.`;
  return null;
}

/** A new lock for a password: a random salt and the key made from it. The password itself
 *  is not kept. */
export async function newPageLock(password: string, iterations = LOCK_ITERATIONS): Promise<{ salt: string; iterations: number; key: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toB64(salt), iterations, key: toB64(await lockKeyFromPassword(password, salt, iterations)) };
}

/** One page's HTML, encrypted with a lock's key (AES-GCM, a fresh 12-byte nonce). */
export async function sealPage(html: string, keyB64: string): Promise<{ iv: string; data: string }> {
  const key = await crypto.subtle.importKey('raw', fromB64(keyB64), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(html)));
  return { iv: toB64(iv), data: toB64(data) };
}

/** Opens a sealed page with a key: what the visitor's browser does, for the tests. */
export async function openSealedPage(sealed: { iv: string; data: string }, keyB64: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', fromB64(keyB64), 'AES-GCM', false, ['decrypt']);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv) }, key, fromB64(sealed.data)));
}

/** Every password page of a rendered site, sealed behind its box. A page whose file isn't
 *  there is left alone (nothing to protect). */
export async function lockPages(fileMap: FileMap, pages: Array<{ slug: string; title: string; salt: string; iterations: number; key: string }>): Promise<FileMap> {
  if (!pages.length) return fileMap;
  const out: FileMap = { ...fileMap };
  for (const p of pages) {
    const file = `${p.slug}/index.html`;
    const html = out[file];
    if (typeof html !== 'string') continue;
    out[file] = gatePage(html, await sealPage(html, p.key), { salt: p.salt, iterations: p.iterations }, { title: p.title });
  }
  return out;
}
