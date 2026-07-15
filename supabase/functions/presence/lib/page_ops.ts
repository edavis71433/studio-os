// ── Wave-1 G7 · Page operations — pure helpers ───────────────────────────────
// Duplicate / rename / delete-awareness logic for the owner's custom pages
// (settings.pages). All PURE: the impure reads/writes live in routes/content.ts,
// mirroring how linked_sections.ts keeps resolution pure while the serializer
// does the one DB read. Nothing here invents a second content model — a page is
// exactly the { slug, title, blocks, hideNav? } shape the serializer validates.

/** The ONE page-slug shape (matches routes/content.ts SLUG_RE + the serializer's
 *  pageSlug sanitizer): lowercase segments joined by single dashes. */
export const PAGE_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Slugs a custom page may never take — the templates' built-in pages plus
 *  deploy-reserved paths. Single source for the server (the serializer imports
 *  this; presence.html mirrors it as DC_PAGE_RESERVED). */
export const RESERVED_PAGE_SLUGS = new Set(['', 'index', 'home', '404', 'about', 'contact', 'faq', 'faqs', 'services', 'service', 'menu', 'products', 'classes', 'updates', 'blog', 'news', 'post', 'posts', 'thanks', 'thank-you', 'privacy', 'accessibility', 'search', 'sitemap', 'robots', 'assets', 'img']);

const MAX_PAGES = 20;          // serializer caps custom pages at 20
const SLUG_MAX = 40;

interface RawPage { slug?: unknown; title?: unknown; blocks?: unknown; hideNav?: unknown; [k: string]: unknown }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** All stable block ids present in the given block lists (columns/cards/form
 *  carry one). Used so regenerated ids stay unique SITE-WIDE, not just per page. */
export function collectBlockIds(...blockLists: unknown[]): Set<string> {
  const out = new Set<string>();
  for (const list of blockLists) {
    if (!Array.isArray(list)) continue;
    for (const b of list) if (isObj(b) && typeof b.id === 'string' && b.id) out.add(b.id);
  }
  return out;
}

/** Deep-copy a block list, REGENERATING every stable id (`<old>_2`, `_3`, … —
 *  the same bump idiom the client's uniqueBlockId and site_blocks' uniqueId use)
 *  so a duplicated page never shares a render key / form-storage id with its
 *  source. `taken` accumulates the minted ids. Pure (input untouched). */
export function regenerateBlockIds(blocks: unknown, taken: Set<string>): unknown[] {
  if (!Array.isArray(blocks)) return [];
  return blocks.map((b) => {
    const copy = JSON.parse(JSON.stringify(b ?? null));
    if (isObj(copy) && typeof copy.id === 'string' && copy.id) {
      const base = copy.id;
      let n = 2, id = `${base}_${n}`;
      while (taken.has(id)) id = `${base}_${++n}`;
      taken.add(id);
      copy.id = id;
    }
    return copy;
  });
}

/** "<slug>-copy", bumped ("-copy-2", …) past collisions/reserved words, capped. */
export function copySlug(source: string, taken: Set<string>): string {
  const base = (source || 'page').slice(0, SLUG_MAX - 8);   // room for "-copy-99"
  let slug = `${base}-copy`, n = 1;
  while (taken.has(slug) || RESERVED_PAGE_SLUGS.has(slug)) slug = `${base}-copy-${++n}`;
  return slug.slice(0, SLUG_MAX);
}

export type DuplicateResult =
  | { pages: RawPage[]; slug: string; title: string; sourceTitle: string }
  | { error: 'not_found' | 'page_limit'; message: string };

/** Duplicate one page (slug '' = the Home canvas, settings.blocks) into a NEW
 *  custom page appended after its source: deep-copied block list with regenerated
 *  stable ids, title "<Title> copy", slug "<slug>-copy" collision-bumped. Pure —
 *  returns the whole new pages array for the ONE settings.pages write. */
export function duplicatePageInSettings(settings: { blocks?: unknown; pages?: unknown }, slug: string): DuplicateResult {
  const pages: RawPage[] = Array.isArray(settings.pages) ? settings.pages.filter(isObj) as RawPage[] : [];
  if (pages.length >= MAX_PAGES) return { error: 'page_limit', message: `Your site holds up to ${MAX_PAGES} extra pages — remove one first.` };
  const isHome = slug === '';
  const at = isHome ? -1 : pages.findIndex((p) => p.slug === slug);
  if (!isHome && at < 0) return { error: 'not_found', message: 'We couldn’t find that page.' };
  const source = isHome
    ? { slug: 'home', title: 'Home', blocks: Array.isArray(settings.blocks) ? settings.blocks : [] }
    : pages[at];
  const sourceTitle = String(source.title || source.slug || 'Page');
  const taken = collectBlockIds(settings.blocks, ...pages.map((p) => p.blocks));
  const newSlug = copySlug(String(source.slug || 'page'), new Set(pages.map((p) => String(p.slug || ''))));
  const title = `${sourceTitle} copy`.slice(0, 60);
  const copy: RawPage = { slug: newSlug, title, blocks: regenerateBlockIds(source.blocks, taken) };
  if (source.hideNav === true) copy.hideNav = true;
  const out = pages.slice();
  out.splice(isHome ? 0 : at + 1, 0, copy);
  return { pages: out, slug: newSlug, title, sourceTitle };
}

export interface PageRename { from: string; to: string }

/** Pull the client's explicit rename markers (`prev_slug` on a page whose slug
 *  changed) out of a raw pages payload: returns the payload with EVERY marker
 *  stripped (the stored draft never carries it) plus the valid renames. Pure. */
export function detectPageRenames(rawPages: unknown): { pages: unknown; renames: PageRename[] } {
  if (!Array.isArray(rawPages)) return { pages: rawPages, renames: [] };
  const renames: PageRename[] = [];
  const pages = rawPages.map((p) => {
    if (!isObj(p) || !('prev_slug' in p)) return p;
    const { prev_slug, ...rest } = p;
    const from = String(prev_slug ?? ''), to = String(rest.slug ?? '');
    if (PAGE_SLUG_RE.test(from) && PAGE_SLUG_RE.test(to) && from !== to) renames.push({ from, to });
    return rest;
  });
  return { pages, renames };
}

export interface PageRefs {
  nav: string[];                                 // menu labels that point at this page
  redirects: string[];                           // from_paths of forwards that land on it
  pages: Array<{ slug: string; title: string }>; // other pages whose sections link to it
  library: string[];                             // saved-section names that link to it
}

/** Delete-awareness: everything that points AT /slug/ — the owner's menu, the
 *  redirects manager, other pages' sections, and saved library sections. One
 *  pass over data the caller already fetched (settings row + two small lists);
 *  no per-page queries. Pure. */
export function pageRefs(
  slug: string,
  settings: { blocks?: unknown; pages?: unknown; nav?: unknown },
  redirects: Array<{ from_path?: unknown; to_path?: unknown }>,
  library: Array<{ name?: unknown; payload?: unknown }>,
): PageRefs {
  const href = `/${slug}/`;
  const needle = JSON.stringify(href);           // matches the href inside any serialized block field
  const out: PageRefs = { nav: [], redirects: [], pages: [], library: [] };

  const rawNav = Array.isArray(settings.nav) ? settings.nav : [];
  for (const it of rawNav) {
    if (!isObj(it)) continue;
    if (it.href === href) out.nav.push(String(it.label || href));
    for (const kid of (Array.isArray(it.children) ? it.children : [])) {
      if (isObj(kid) && kid.href === href) out.nav.push(String(kid.label || href));
    }
  }
  for (const r of redirects) if (String(r?.to_path || '') === href) out.redirects.push(String(r?.from_path || ''));

  const mentions = (blocks: unknown): boolean => Array.isArray(blocks) && JSON.stringify(blocks).includes(needle);
  if (mentions(settings.blocks)) out.pages.push({ slug: '', title: 'Home' });
  for (const p of (Array.isArray(settings.pages) ? settings.pages : [])) {
    if (!isObj(p) || p.slug === slug) continue;
    if (mentions(p.blocks)) out.pages.push({ slug: String(p.slug || ''), title: String(p.title || p.slug || '') });
  }
  for (const item of library) {
    if (item?.payload && JSON.stringify(item.payload).includes(needle)) out.library.push(String(item?.name || 'Saved section'));
  }
  return out;
}
