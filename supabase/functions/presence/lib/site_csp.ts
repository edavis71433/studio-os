// ── Item 144: the content rule each published site actually needs ────────────
// A module of its own so routes/publish.ts can call it from one new import line.
import { PUBLISHED_CSP_RESPONSE } from './security_headers.ts';
import { hostedName } from './site.ts';

// PUBLISHED_CSP lets any script from any secure address run, and any script written
// into the page. Our pages need none of that: every script on a published site is one
// the renderer wrote into the page itself (the opening-hours line, the header, the
// forms, booking, the visit counter, a password page's lock), and they talk only to
// our server. So at publish each of those scripts is named by its fingerprint (a
// SHA-256 hash), and nothing else may run: a script slipped into a page later, by a
// bad embed or an edited file, is refused by the browser. Pictures may still come
// from any secure address (a developer block may show one); styles stay as they are.
//
// The pages keep their <meta> rule (unchanged bytes, unchanged canvas); the browser
// applies both, so the tighter header decides. A site whose pages load code from
// anywhere else (an ad tag the owner added, an outside script) or carry an inline
// event handler keeps PUBLISHED_CSP_RESPONSE as before, so nothing that works breaks.
type FileMap = Record<string, string | Uint8Array>;
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const isJs = (attrs: string) => {
  const t = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase() ?? '';
  return t === '' || t === 'module' || /^(text|application)\/(java|ecma)script$/.test(t);
};
async function sha256(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let s = ''; for (const b of d) s += String.fromCharCode(b);
  return btoa(s);
}

/** The rule for a site, from every page it ships. `maps` holds the drawn pages and, when
 *  some are sealed behind a password, the sealed ones too: a sealed page's scripts run
 *  once it is opened, so they are named from its drawn copy. `server` is our functions'
 *  origin; `homes` the addresses the site answers on (a form's answer sends the visitor
 *  back to one of them). Returns PUBLISHED_CSP_RESPONSE when the pages need more. */
export async function publishedCspFor(maps: FileMap[], server: string, homes: string[] = []): Promise<string> {
  const serverHost = server ? new URL(server).hostname : '';
  const hashes = new Set<string>();
  for (const map of maps) {
    for (const [path, contents] of Object.entries(map)) {
      if (typeof contents !== 'string' || !path.endsWith('.html')) continue;
      // an inline handler (onclick=…) or a javascript: address can't be named by a hash
      if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(contents) || /\b(href|src|action)\s*=\s*["']?\s*javascript:/i.test(contents)) return PUBLISHED_CSP_RESPONSE;
      for (const m of contents.matchAll(SCRIPT_RE)) {
        if (!isJs(m[1])) continue;   // JSON-LD and data blocks never run
        if (/\bsrc\s*=/i.test(m[1])) {
          const src = /\bsrc\s*=\s*["']?([^"'\s>]+)/i.exec(m[1])?.[1] ?? '';
          if (/^(https?:)?\/\//i.test(src)) return PUBLISHED_CSP_RESPONSE;   // a script from elsewhere
          continue;   // the site's own file: 'self'
        }
        const code = m[2].replace(/\r\n?/g, '\n');   // the browser reads line ends as \n
        for (const u of code.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) if (u[1].toLowerCase() !== serverHost) return PUBLISHED_CSP_RESPONSE;
        if (code.trim()) hashes.add(`'sha256-${await sha256(code)}'`);
      }
    }
  }
  const talk = [...new Set([server, ...homes].filter(Boolean))].join(' ');
  return [
    "default-src 'self'",
    `script-src 'self'${hashes.size ? ' ' + [...hashes].sort().join(' ') : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${server ? ' ' + server : ''}`,
    `form-action 'self'${talk ? ' ' + talk : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** The addresses a site answers on, where a form's answer may send the visitor back:
 *  its own domain with and without www, and its Netlify address. */
export function siteHomes(site: { id?: string | null; custom_domain?: string | null; netlify_site_id?: string | null }): string[] {
  const out: string[] = [];
  const d = String(site?.custom_domain || '').toLowerCase();
  if (d) out.push(`https://${d}`, d.startsWith('www.') ? `https://${d.slice(4)}` : `https://www.${d}`);
  if (site?.id && site.netlify_site_id) out.push(`https://${hostedName(site.id)}.netlify.app`);
  return out;
}
