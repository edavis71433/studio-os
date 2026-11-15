// ── Pages saved to the studio (builder list item 216) ──────────────────────────
// A studio saves one page of a client's site (its sections, the saved sections they
// link to, copies of its photos) and adds it to any client's site from Add a page.
// Squarespace's "Save page to account" (Nov 12 review, file 01, finding 2).
//
// What travels is exactly what the page's sections hold. Business details, hours,
// reviews and contact details live elsewhere and never travel, as with a template
// (lib/site_layout.ts). The old business's name in the words becomes the new one's when
// the page lands, and the copy is recorded on the site it lands on, so Publish lists the
// sections still exactly as copied until they are changed or kept (lib/copied_record.ts).
//
// Pure: agency/saved_pages.ts and routes/saved_pages.ts do the reads and writes.
import { mediaIdsIn } from './dam.ts';
import { swapIds, swapName, MAX_LAYOUT_MEDIA } from './site_layout.ts';
import type { LayoutMedia, LayoutLibraryItem, CopiedRecord } from './site_layout.ts';
import { PAGE_SLUG_RE, RESERVED_PAGE_SLUGS, collectBlockIds, regenerateBlockIds } from './page_ops.ts';
import { purposeOf } from './page_layouts.ts';
import type { PagePurpose } from './page_layouts.ts';

export const MAX_SAVED_PAGES = 100;   // per studio, like its templates and starter kits
export const MAX_PAGE_SECTIONS = 32;  // a page holds at most 32 sections
const MAX_PAGES = 20;                 // a site holds at most 20 pages of its own (lib/page_ops.ts)
const SLUG_MAX = 40;

export interface SavedPagePayload {
  v: 1;
  title: string;                  // the page's own name where it was saved
  from_name: string;              // the business its words were written for: swapped when it lands
  blocks: unknown[];              // its sections, as stored
  library: LayoutLibraryItem[];   // the saved sections it links to
  media: LayoutMedia[];           // its photos, copied into the studio's own folder
  outline: string[];              // its section types in order, for the picture in Add a page
  summary: { sections: number; photos: number };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A saved page's name: one line, no control characters, at most 80. Pure. */
export function cleanSavedName(raw: unknown): string {
  let s = '';
  for (const ch of String(raw ?? '')) { const c = ch.codePointAt(0)!; if (c >= 32) s += ch; }
  return s.replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** A purpose as asked for, or null. Pure. */
export function cleanPurpose(raw: unknown): PagePurpose | null { return purposeOf(raw); }

/** One page of a site's settings: '' is Home (settings.blocks), else a page of its own.
 *  Null when there is no such page. Pure. */
export function pageInSettings(settings: { blocks?: unknown; pages?: unknown } | null | undefined, slug: string): { title: string; blocks: unknown[] } | null {
  if (!settings) return null;
  if (slug === '') return { title: 'Home', blocks: Array.isArray(settings.blocks) ? settings.blocks : [] };
  const p = (Array.isArray(settings.pages) ? settings.pages : []).find((x) => isObj(x) && x.slug === slug) as Record<string, unknown> | undefined;
  if (!p) return null;
  return { title: String(p.title || slug).slice(0, 80), blocks: Array.isArray(p.blocks) ? p.blocks : [] };
}

/** The saved sections a page links to (blocks of type "linked"). Pure. */
export function linkedIdsIn(blocks: unknown[]): string[] {
  const ids = new Set<string>();
  for (const b of blocks) if (isObj(b) && b.type === 'linked' && typeof b.ref === 'string') ids.add(b.ref.toLowerCase());
  return [...ids];
}

/** The photos and files a page's sections use, and the saved sections they link to. Pure. */
export function pageMediaIds(blocks: unknown[], library: Array<{ payload: unknown }> = []): string[] {
  const ids = new Set<string>();
  mediaIdsIn(blocks, ids);
  for (const it of library) mediaIdsIn(it.payload, ids);
  return [...ids];
}

/** Each section's kind in order, a linked one by the kind of the saved section it
 *  shows: the picture in Add a page is these sections' own pictures, stacked. Pure. */
export function outlineOf(blocks: unknown[], library: LayoutLibraryItem[] = []): string[] {
  const kind = new Map(library.map((it) => [String(it.id).toLowerCase(), isObj(it.payload) ? String(it.payload.type || '') : '']));
  return blocks.filter(isObj).map((b) => (b.type === 'linked' ? kind.get(String(b.ref || '').toLowerCase()) || 'linked' : String(b.type || '')))
    .filter((t) => /^[a-z_]{2,30}$/.test(t)).slice(0, MAX_PAGE_SECTIONS);
}

/** The payload kept for a saved page. Pure. */
export function buildSavedPayload(input: { title: string; from_name: string; blocks: unknown[]; library: LayoutLibraryItem[]; media: LayoutMedia[] }): SavedPagePayload {
  const blocks = input.blocks.filter(isObj).slice(0, MAX_PAGE_SECTIONS);
  const media = input.media.slice(0, MAX_LAYOUT_MEDIA);
  return {
    v: 1, title: cleanSavedName(input.title) || 'A page', from_name: String(input.from_name || '').trim().slice(0, 120),
    blocks, library: input.library, media, outline: outlineOf(blocks, input.library),
    summary: { sections: blocks.length, photos: media.length },
  };
}

/** A stored payload, read safely: anything malformed is null. Pure. */
export function normalizePayload(raw: unknown): SavedPagePayload | null {
  if (!isObj(raw) || !Array.isArray(raw.blocks)) return null;
  const media = (Array.isArray(raw.media) ? raw.media : []).filter((m) => isObj(m) && typeof m.id === 'string' && typeof m.storage_path === 'string') as unknown as LayoutMedia[];
  const library = (Array.isArray(raw.library) ? raw.library : []).filter((it) => isObj(it) && typeof it.id === 'string') as unknown as LayoutLibraryItem[];
  const blocks = raw.blocks.filter(isObj).slice(0, MAX_PAGE_SECTIONS);
  return {
    v: 1, title: cleanSavedName(raw.title) || 'A page', from_name: String(raw.from_name || '').slice(0, 120),
    blocks, library, media: media.slice(0, MAX_LAYOUT_MEDIA), outline: outlineOf(blocks, library),
    summary: { sections: blocks.length, photos: Math.min(media.length, MAX_LAYOUT_MEDIA) },
  };
}

/** What the list says about one saved page: never its sections or photos. Pure. */
export function savedPageRow(r: Record<string, unknown>) {
  const outline = Array.isArray(r.outline) ? (r.outline as unknown[]).map(String).filter((t) => /^[a-z_]{2,30}$/.test(t)).slice(0, MAX_PAGE_SECTIONS) : [];
  const sum = isObj(r.summary) ? r.summary : {};
  return {
    id: String(r.id || ''), name: String(r.name || ''), purpose: purposeOf(r.purpose) || 'introduce',
    from_name: String(r.from_name || ''), created_at: String(r.created_at || ''), created_by: String(r.created_by || ''),
    outline, summary: { sections: Number(sum.sections) || outline.length, photos: Number(sum.photos) || 0 },
  };
}

/** The new page's address: the one asked for when it is free, else one made from its
 *  name, bumped past the site's own pages and the template's built-in ones. Pure. */
export function newPageSlug(asked: unknown, title: string, taken: Set<string>): string {
  const want = String(asked ?? '').trim().toLowerCase();
  const fromTitle = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SLUG_MAX) || 'page';
  const base = (PAGE_SLUG_RE.test(want) && want.length <= SLUG_MAX ? want : fromTitle).slice(0, SLUG_MAX - 3);
  let slug = base, n = 1;
  while (taken.has(slug) || RESERVED_PAGE_SLUGS.has(slug)) slug = `${base}-${++n}`;
  return slug;
}

export type LandResult =
  | { pages: unknown[]; nav: unknown[] | null; page: { slug: string; title: string; blocks: unknown[] } }
  | { error: 'page_limit'; message: string };

/** The site's pages with the saved page added at the end, its stable ids made new so it
 *  never shares a form's or a section's id with the site, its photos and saved sections
 *  swapped for the site's own copies (`map`, old id → new id), and the old business's
 *  name in the words swapped for this one's. The menu gains the page when the site has a
 *  menu of its own and room in it, as Add a page does. Pure. */
export function landSavedPage(settings: { blocks?: unknown; pages?: unknown; nav?: unknown }, payload: SavedPagePayload, opts: { title: string; slug: unknown; map: Record<string, string>; toName: string }): LandResult {
  const pages = (Array.isArray(settings.pages) ? settings.pages : []).filter(isObj) as Array<Record<string, unknown>>;
  if (pages.length >= MAX_PAGES) return { error: 'page_limit', message: `This site holds up to ${MAX_PAGES} pages of its own. Remove one first.` };
  const title = cleanSavedName(opts.title).slice(0, 60) || payload.title.slice(0, 60);
  const slug = newPageSlug(opts.slug, title, new Set(pages.map((p) => String(p.slug || ''))));
  const taken = collectBlockIds(settings.blocks, ...pages.map((p) => p.blocks));
  const blocks = regenerateBlockIds(swapName(swapIds(payload.blocks, opts.map), payload.from_name, opts.toName), taken);
  const page = { slug, title, blocks };
  const navIn = Array.isArray(settings.nav) ? settings.nav : [];
  const nav = navIn.length > 0 && navIn.length < 12 ? [...navIn, { label: title.slice(0, 40), href: `/${slug}/` }] : null;
  return { pages: [...pages, page], nav, page };
}

/** The copy record after a saved page lands: its sections and photos join what is still
 *  waiting to be changed or kept. A record the studio already kept starts again with only
 *  the new page, so what was kept stays kept. Pure. */
export function addToCopied(existing: CopiedRecord | null, from: string, at: string, prints: string[], media: string[]): CopiedRecord {
  if (!existing || existing.kept) return { from: from.slice(0, 120), at, sections: [...new Set(prints)].slice(0, 400), media: [...new Set(media)].slice(0, MAX_LAYOUT_MEDIA * 2), kept: false };
  return {
    from: existing.from || from.slice(0, 120), at,
    sections: [...new Set([...existing.sections, ...prints])].slice(0, 400),
    media: [...new Set([...existing.media, ...media])].slice(0, MAX_LAYOUT_MEDIA * 2),
    kept: false,
  };
}
