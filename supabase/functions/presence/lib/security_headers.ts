// ── Published-tenant response-level security headers (ONE source of truth) ───
// Parity gap closed: our own marketing site (repo-root `_headers` /*) ships
// response-level HSTS, clickjacking, MIME-sniff, referrer, permissions + CSP,
// but tenant sites we publish for customers only carried a <meta> CSP. This
// module supplies a constant, byte-stable Netlify `_headers` `/*` block that
// routes/publish.ts merges into EVERY tenant deploy — additive, so static
// assets and the custom-domain/SSL flow are unaffected.
//
// Directives mirrored verbatim from the proven marketing-site `_headers` (/*):
//   Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
//   X-Frame-Options: DENY
//   X-Content-Type-Options: nosniff
//   Referrer-Policy: strict-origin-when-cross-origin
//   Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(self "https://buy.stripe.com")
// The CSP is NOT the marketing site's (stricter, would break tenant inline
// analytics/JSON-LD). It mirrors lib/render.ts PUBLISHED_CSP — the exact policy
// tenant sites already carry as a <meta> tag — plus `frame-ancestors 'none'`,
// the response-header equivalent of X-Frame-Options: DENY (a <meta> CSP cannot
// express frame-ancestors). Both clickjacking controls are shipped consistently.
import { PUBLISHED_CSP } from './render.ts';

/** The published-site CSP as a REAL response header: the same policy tenant
 *  sites already ship via <meta>, hardened with frame-ancestors 'none'. */
export const PUBLISHED_CSP_RESPONSE = `${PUBLISHED_CSP}; frame-ancestors 'none'`;

/** Ordered, byte-stable response headers applied to `/*` on every tenant deploy.
 *  Order is fixed so publishing stays reproducible (same input → same bytes). */
export const SECURITY_RESPONSE_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload'],
  ['X-Frame-Options', 'DENY'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self "https://buy.stripe.com")'],
  ['Content-Security-Policy', PUBLISHED_CSP_RESPONSE],
];

interface HeaderBlock { path: string; headers: Array<[string, string]>; }

/** Parse a Netlify `_headers` file into ordered path blocks. A non-indented,
 *  non-empty line is a path; the indented lines beneath it are its headers. */
function parseHeaders(text: string): HeaderBlock[] {
  const blocks: HeaderBlock[] = [];
  let cur: HeaderBlock | null = null;
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    if (/^\s/.test(raw)) {
      const m = raw.trim().match(/^([^:]+):\s?(.*)$/);
      if (m && cur) cur.headers.push([m[1].trim(), m[2]]);
    } else {
      cur = { path: raw.trim(), headers: [] };
      blocks.push(cur);
    }
  }
  return blocks;
}

/** Merge the security headers into a tenant deploy's `_headers` file.
 *  - Preserves every existing block (e.g. the template's /assets/* and /img/*
 *    immutable cache blocks) in order.
 *  - Ensures a `/*` block exists and makes OUR security headers authoritative
 *    there: any pre-existing occurrence of a header we own (e.g. the template's
 *    nosniff) is dropped and replaced, so nothing is duplicated or weakened.
 *  - Deterministic: identical input → identical output bytes. */
export function mergeSecurityHeaders(existing?: string): string {
  const owned = new Set(SECURITY_RESPONSE_HEADERS.map(([k]) => k.toLowerCase()));
  const blocks = parseHeaders(existing ?? '');
  let star = blocks.find((b) => b.path === '/*');
  if (!star) { star = { path: '/*', headers: [] }; blocks.push(star); }
  star.headers = star.headers.filter(([k]) => !owned.has(k.toLowerCase()));
  for (const [k, v] of SECURITY_RESPONSE_HEADERS) star.headers.push([k, v]);
  return blocks.map((b) => `${b.path}\n${b.headers.map(([k, v]) => `  ${k}: ${v}`).join('\n')}`).join('\n') + '\n';
}
