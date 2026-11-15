// ── Link names on sections, and the links that jump to them (builder list item 225, Nov 2026) ──
// Squarespace lets a section carry an anchor link name (review file 01, finding 16). Here a
// section's `anchor` ("hours") becomes its id on the page, so a menu item or a button can jump
// straight to it: "#hours" on the same page, "/#hours" to Home's, "/menu/#specials" to another
// page's. A section without one keeps the id it always had, made from its heading.
// A name is short: small letters, numbers and dashes. Names the page already gives its own parts
// (main, the contact form's fields, the pop-up, the gallery's zoom, the editor's own marks…) are
// refused, so a jump can never land on the wrong thing.
// Section buttons and menu items may also go to the site's own pages ("/", "/menu/"); emails and
// written text keep lib/markdown.ts safeHref (https, mailto, tel and "#form-<id>" only).
// This file imports nothing, so a browser spec can use it.

export const ANCHOR_MAX = 40;
const RESERVED = new Set(['main', 'top', 'content', 'open-now', 'hours-data', 'signatures', 'dlpdf']);
const RESERVED_START = /^(?:f|form|lb|nl|ps|pfb|ns|dds|presence|search|tab|tabs|consent)-/;

/** A link name as someone typed it, made tidy: small letters, numbers and single dashes, at most
 *  40; null when nothing usable is left or the page already uses that name. Pure. */
export function anchorOf(raw: unknown): string | null {
  const s = String(raw ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/^#+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, ANCHOR_MAX).replace(/-+$/, '');
  if (!s || RESERVED.has(s) || RESERVED_START.test(s)) return null;
  return s;
}
/** A stored name that is already tidy; the server keeps only these. Pure. */
export function isAnchor(v: unknown): v is string { return typeof v === 'string' && v !== '' && anchorOf(v) === v; }

/** Where a jump link goes: "#hours" (page null: the page it is on), "/#hours" (page '': Home),
 *  "/menu/#specials" (page 'menu'). Null for anything else. Pure. */
export function jumpTarget(href: unknown): { page: string | null; anchor: string } | null {
  const m = /^(\/(?:([a-z0-9][a-z0-9-]*)\/)?)?#([a-z0-9][a-z0-9-]*)$/.exec(String(href ?? '').trim());
  if (!m || !isAnchor(m[3])) return null;
  return { page: m[1] === undefined ? null : (m[2] || ''), anchor: m[3] };
}
/** One of the site's own pages: "/" or "/menu/". Pure. */
export function ownPage(href: unknown): boolean { return /^\/(?:[a-z0-9][a-z0-9-]*\/)?$/.test(String(href ?? '').trim()); }
/** A link a section's button may carry beyond safeHref's: an own page, or a jump to a named part
 *  of a page. The link as given, or null. Pure. */
export function siteLink(href: unknown): string | null {
  const u = String(href ?? '').trim();
  return ownPage(u) || jumpTarget(u) ? u : null;
}

/** Every link inside a section that could go somewhere: the values of its url, link and href
 *  fields at any depth (buttons, cards, links, photos, the Blocks section's blocks). Pure. */
export function sectionLinks(block: unknown, depth = 0): string[] {
  const out: string[] = [];
  if (depth > 8 || !block || typeof block !== 'object') return out;
  for (const [k, v] of Object.entries(block as Record<string, unknown>)) {
    if (typeof v === 'string' && (k === 'url' || k === 'link' || k === 'href')) out.push(v);
    else if (v && typeof v === 'object') out.push(...sectionLinks(v, depth + 1));
  }
  return out;
}
