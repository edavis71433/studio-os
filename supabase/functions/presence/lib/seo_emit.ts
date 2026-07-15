// ── Centralized SEO / document-head emitter (Tier 1 #134) ────────────────────
// Every template's <head> is identical: charset + viewport, title + description,
// canonical, search-engine verification, favicon, Open Graph, the Twitter card, the
// critical (above-the-fold) CSS, the stylesheet link, and the page's JSON-LD. That
// block used to be copy-pasted into each template's shell() — so it could silently
// drift between templates. It now lives HERE once; every template (the current four
// AND any future one) calls seoHead() and inherits the exact same correct, escaped
// head. Pure + deterministic; the only template-specific inputs are its own critical
// CSS and stylesheet URL, which are passed in.
import { esc, attr } from './markdown.ts';
import type { SiteConfig, SnapshotContent } from './render_types.ts';

/** The page-level SEO inputs a template already computes. (A template's own PageOpts
 *  is a structural superset of this, so it can be passed straight through.) */
export interface SeoHeadPage { title: string; description: string; path: string; ogImage?: string; ld: object[] }

/** The full `<!DOCTYPE html> … </head>` for one page — byte-identical to what the
 *  templates emitted inline. `critical` is the template's above-the-fold CSS and
 *  `cssPath` its stylesheet URL (the only template-specific parts); `x.icon` is the
 *  optional favicon (the site logo when present). */
export function seoHead(o: SeoHeadPage, site: SiteConfig, c: SnapshotContent, x: { icon?: string }, critical: string, cssPath: string): string {
  const canonical = `${site.baseUrl}${o.path}`;
  const i = c.identity;
  return `<!DOCTYPE html>
<html lang="${attr(site.locale || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(o.title)}</title>
<meta name="description" content="${attr(o.description)}">
<link rel="canonical" href="${attr(canonical)}">
${c.settings?.verification?.google ? `<meta name="google-site-verification" content="${attr(c.settings.verification.google)}">` : ''}${c.settings?.verification?.bing ? `\n<meta name="msvalidate.01" content="${attr(c.settings.verification.bing)}">` : ''}
<link rel="icon" href="${attr(x.icon || '/favicon.svg')}"${x.icon ? '' : ' type="image/svg+xml"'}>
<meta property="og:type" content="website">
<meta property="og:site_name" content="${attr(i.business_name)}">
<meta property="og:title" content="${attr(o.title)}">
<meta property="og:description" content="${attr(o.description)}">
<meta property="og:url" content="${attr(canonical)}">
${o.ogImage ? `<meta property="og:image" content="${attr(site.baseUrl + o.ogImage)}">` : ''}
<meta name="twitter:card" content="${o.ogImage ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${attr(o.title)}">
<meta name="twitter:description" content="${attr(o.description)}">
<style>${critical}</style>
<link rel="stylesheet" href="${attr(cssPath)}">
${o.ld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replaceAll('<', '\\u003c')}</script>`).join('\n')}
</head>`;
}
