// ── A password page's box, and the sealing behind it (builder list items 48 and 120, Nov 2026) ──
// What a visitor gets instead of a password page: the page encrypted inside the file (AES-GCM,
// with a key PBKDF2 makes from the password) and a box in the site's own look that makes the
// same key from what they type and opens the page in their browser. lib/page_access.ts decides
// which pages are sealed; this file only draws the box and seals. It imports nothing, so the
// browser spec that opens a sealed page for real (tests/e2e/builder-page-settings.spec.ts)
// reaches only this file, and a change here runs that spec (.github/workflows/e2e.yml).
type FileMap = Record<string, string | Uint8Array>;

/** PBKDF2 rounds for a page key: slow enough to make guessing a password from the published
 *  file expensive, quick enough for an older phone to open the page in about a second. */
export const LOCK_ITERATIONS = 310_000;
export const PASSWORD_MIN = 4, PASSWORD_MAX = 100;

/** Every template draws the site's header and footer as these. */
export const SITE_HEADER_RE = /<header class="site"[^>]*>[\s\S]*?<\/header>\n?/;
export const SITE_FOOTER_RE = /<footer class="site"[^>]*>[\s\S]*?<\/footer>\n?/;

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
export function gatePage(html: string, sealed: { iv: string; data: string }, lock: { salt: string; iterations: number }, opts: { title: string; heading?: string; note?: string }): string {
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
  const header = (before.match(SITE_HEADER_RE) || [''])[0];
  const skip = (before.match(/<a class="skip"[^>]*>[\s\S]*?<\/a>/) || [''])[0];
  // the announcement bar and a closed notice are the site's, not the page's: they stay
  const notices = before.replace(SITE_HEADER_RE, '').replace(/<a class="skip"[^>]*>[\s\S]*?<\/a>/, '').trim();
  const footer = (html.match(SITE_FOOTER_RE) || [''])[0];
  const name = escHtml(opts.title || 'This page');
  const data = JSON.stringify({ salt: lock.salt, iterations: lock.iterations, iv: sealed.iv, data: sealed.data }).replaceAll('<', '\\u003c');
  return `${head}
${bodyTag}
${skip}
${notices}
${header}<main id="main" class="dds-lock-wrap">
<form class="dds-lock" id="dds-lock-form" autocomplete="off">
<span class="dds-lock-ic">${LOCK_SVG}</span>
<h1>${opts.heading ? escHtml(opts.heading) : 'This page needs a password'}</h1>
<p>${opts.note ? escHtml(opts.note) : `Type the password you were given to see ${name}.`}</p>
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
export async function lockPages(fileMap: FileMap, pages: Array<{ slug: string; title: string; salt: string; iterations: number; key: string; heading?: string; note?: string }>): Promise<FileMap> {
  if (!pages.length) return fileMap;
  const out: FileMap = { ...fileMap };
  for (const p of pages) {
    const file = `${p.slug}/index.html`;
    const html = out[file];
    if (typeof html !== 'string') continue;
    out[file] = gatePage(html, await sealPage(html, p.key), { salt: p.salt, iterations: p.iterations }, { title: p.title, heading: p.heading, note: p.note });
  }
  return out;
}
