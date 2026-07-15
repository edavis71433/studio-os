// ── G10 · Take offline — the "temporarily offline" holding page (pure) ───────
// Unpublishing NEVER deletes anything: it deploys this minimal, on-brand,
// noindex holding page OVER the live deploy through the same Netlify deploy
// machinery every publish uses. Every kept version survives; publishing again
// (or restoring a version) brings the real site back. Pure + deterministic so
// it is unit-testable without a database, mirroring lib/preview_env.ts.
import { mergeSecurityHeaders } from './security_headers.ts';

export interface OfflinePageInput {
  businessName?: string | null;
  accent?: string | null;      // contrast-safe brand accent (from the Brand Kit shell)
  email?: string | null;       // the business's own public contact — already on the live site
  phone?: string | null;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const HEX_RE = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

/** The complete holding-page HTML. On-brand (business name + accent), honest
 *  ("temporarily offline", not an error), noindex, self-contained (no external
 *  assets — nothing else is deployed alongside it). Pure. */
export function renderOfflinePage(input: OfflinePageInput = {}): string {
  const name = String(input.businessName || '').trim() || 'This website';
  const accent = HEX_RE.test(String(input.accent || '')) ? String(input.accent) : '#5b3fa0';
  const email = String(input.email || '').trim();
  const phone = String(input.phone || '').trim();
  const contact = [
    email ? `<a href="mailto:${esc(email)}" style="color:${accent};text-decoration:none;font-weight:600">${esc(email)}</a>` : '',
    phone ? `<a href="tel:${esc(phone.replace(/[^+\d]/g, ''))}" style="color:${accent};text-decoration:none;font-weight:600">${esc(phone)}</a>` : '',
  ].filter(Boolean).join(' · ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(name)} — temporarily offline</title></head>
<body style="margin:0;background:#faf9f7;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1b1525">
<!-- presence-offline-holding -->
<main style="max-width:480px;margin:18vh auto 0;padding:0 24px;text-align:center">
<div style="width:44px;height:5px;border-radius:999px;background:${accent};margin:0 auto 26px" aria-hidden="true"></div>
<h1 style="font-family:Palatino,Georgia,serif;font-size:26px;font-weight:600;letter-spacing:-.01em;margin:0 0 12px">${esc(name)} is temporarily offline</h1>
<p style="font-size:15px;line-height:1.7;color:#57506a;margin:0">We&rsquo;re not gone &mdash; the site is just resting for a moment. Please check back soon.</p>
${contact ? `<p style="font-size:14px;line-height:1.7;margin:18px 0 0">In the meantime you can reach us at<br>${contact}</p>` : ''}
</main>
</body></html>`;
}

/** The exact file set an offline deploy ships: the holding page at every path
 *  (root + 404 fallback), a full-disallow robots.txt, and the SAME response-level
 *  security headers every tenant deploy carries, plus X-Robots-Tag noindex
 *  (defense-in-depth with the <meta>). Pure + deterministic. */
export function offlineFileMap(html: string): Record<string, string> {
  return {
    'index.html': html,
    '404.html': html,                                     // any deep link shows the same honest page
    'robots.txt': 'User-agent: *\nDisallow: /\n',
    '_headers': mergeSecurityHeaders('/*\n  X-Robots-Tag: noindex, nofollow\n'),
  };
}
