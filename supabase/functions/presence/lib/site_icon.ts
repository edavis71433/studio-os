// ── The site's own small icon (builder list item 158, Nov 2026) ───────────────
// Every template draws a letter in a coloured square as the browser-tab icon
// (favicon.svg, tinted to the site's accent by lib/render.ts tintFavicon). A wide logo
// shrunk to 16 pixels is a smudge, so the owner can pick a picture of its own (Files or
// the editor's Photos: "Use as site icon"; Styles shows how it looks in a tab). The
// snapshot carries it as settings.icon; with none, pages are drawn exactly as before.
// This file imports nothing.
type FileMap = Record<string, string | Uint8Array>;
interface IconRef { variants?: Record<string, string> | null }

const TEMPLATE_ICON = '<link rel="icon" href="/favicon.svg" type="image/svg+xml">';
const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The picture's smallest width a tab can use well (400 is the smallest variant kept). Pure. */
export function iconPath(icon: IconRef | null | undefined): string | null {
  const v = icon && icon.variants;
  if (!v) return null;
  const p = v.w400 || v.w800 || v.w1600 || Object.values(v)[0];
  return typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') ? p : null;
}

/** Every page's tab icon becomes the chosen picture (and the one a phone keeps on its home
 *  screen). No picture, or a page without the template's icon link, is left as it was. Pure. */
export function applySiteIcon(fileMap: FileMap, icon: IconRef | null | undefined): FileMap {
  const path = iconPath(icon);
  if (!path) return fileMap;
  const links = `<link rel="icon" href="${attr(path)}"><link rel="apple-touch-icon" href="${attr(path)}">`;
  const out: FileMap = {};
  for (const [k, v] of Object.entries(fileMap)) out[k] = typeof v === 'string' && k.endsWith('.html') && v.includes(TEMPLATE_ICON) ? v.split(TEMPLATE_ICON).join(links) : v;
  return out;
}
