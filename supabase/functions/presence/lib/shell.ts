// ── Unified Workspace Shell — pure nav helpers (Phase C1) ────────────────────
// The shell is ONE application frame injected on every signed-in page. It does
// NOT define a navigation model — it consumes buildNav() (the one source of
// truth, via /portal/context.nav). These pure helpers are the shell's matching
// + search logic, tested in isolation and mirrored by shell.js at runtime (no
// build step ships TS to the browser, so the runtime copy stays trivially
// aligned; this file is the spec + guard).

export interface NavItem { key: string; label: string; href: string }
export interface NavSection { key: string; label: string; items: NavItem[] }

/** Normalize a path for comparison: drop origin, query, hash, trailing slash,
 *  and an implicit "/index.html" / ".html". So "/crm.html", "/crm", "/crm/"
 *  all compare equal. Pure. */
export function normalizePath(p: string): string {
  let s = String(p || '').split('#')[0].split('?')[0].trim();
  s = s.replace(/^https?:\/\/[^/]+/, '');
  if (!s.startsWith('/')) s = '/' + s;
  s = s.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
  if (s.length > 1) s = s.replace(/\/$/, '');
  return s || '/';
}

/** The nav item that best matches the current path (exact normalized match wins;
 *  otherwise the longest href that is a path-prefix). Returns the item key or
 *  null. Pure — this is what drives the "current workspace" indicator. */
export function activeItemKey(pathname: string, nav: NavSection[]): string | null {
  const here = normalizePath(pathname);
  let best: { key: string; len: number } | null = null;
  for (const sec of nav || []) {
    for (const it of sec.items || []) {
      const href = normalizePath(it.href);
      if (href === here) return it.key;                 // exact wins immediately
      if (href !== '/' && (here === href || here.startsWith(href + '/'))) {
        if (!best || href.length > best.len) best = { key: it.key, len: href.length };
      }
    }
  }
  return best?.key ?? null;
}

/** Flatten nav into search destinations (label + href + section label). Pure. */
export function flattenDestinations(nav: NavSection[]): Array<{ label: string; href: string; section: string }> {
  const out: Array<{ label: string; href: string; section: string }> = [];
  for (const sec of nav || []) for (const it of sec.items || []) out.push({ label: it.label, href: it.href, section: sec.label });
  return out;
}

/** Search destinations by a query (case-insensitive substring on label or
 *  section). Empty query returns all. Pure — powers the command palette. */
export function searchDestinations(dests: Array<{ label: string; href: string; section: string }>, query: string): Array<{ label: string; href: string; section: string }> {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return dests;
  return dests.filter((d) => d.label.toLowerCase().includes(q) || d.section.toLowerCase().includes(q));
}
