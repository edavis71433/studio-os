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
// only the key made from it (presence_page_locks, migration 0158), so a password page can't
// go live without its key: one whose key is missing is kept off the site, like a private one.
//
// Everything here is pure. The password box and the sealing are in lib/page_gate.ts.
import type { FileMap, SnapshotContent } from './render_types.ts';
import { SITE_HEADER_RE, SITE_FOOTER_RE } from './page_gate.ts';
// the box and the sealing live in lib/page_gate.ts; they're here too for one import
export { LOCK_ITERATIONS, PASSWORD_MIN, PASSWORD_MAX, gatePage, lockKeyFromPassword, passwordProblem, newPageLock, sealPage, openSealedPage, lockPages } from './page_gate.ts';

export type PageAccess = 'everyone' | 'password' | 'private';
type Settings = NonNullable<SnapshotContent['settings']>;
export interface PageShow { access?: 'password' | 'private'; lock?: string; noHeader?: true; noFooter?: true }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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


/** One page without the site's header and/or footer. Pure. */
export function stripSiteChrome(html: string, opts: { header?: boolean; footer?: boolean }): string {
  let out = html;
  if (opts.header) out = out.replace(SITE_HEADER_RE, '');
  if (opts.footer) out = out.replace(SITE_FOOTER_RE, '');
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
