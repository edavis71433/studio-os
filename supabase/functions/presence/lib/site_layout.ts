// ── Pages and sections that travel (builder list item 145, Nov 2026 review) ──
// Duplicate site used to start a new site from another one's SETUP only (a
// starter kit: services, FAQs, voice, colors), so "start the next plumber from
// the last plumber" still meant rebuilding every page. Now the pages travel too:
// the sections on Home and on every page, the menu, the section order and the
// header and footer choices, the look's own CSS, saved sections that are linked
// in, and true copies of the photos and files those sections use. A site can
// also be saved as "my template" (a starter kit that carries its pages): new
// sites start from it the same way.
//
// What never travels: business details, hours, reviews, testimonials, posts,
// enquiries, bookings, contacts, the domain, billing, the logo and brand kit, the
// search titles, the announcement bar, and the menu's links to other websites,
// email or phone. The words in the sections come across as they are, with the
// old business's name swapped for the new one.
//
// So nothing from one client reaches another's live site by accident, the copy
// is RECORDED on the new site (a reserved row, lib/reserved_store.ts): a print
// of every section and the photos as they arrived. Until each is changed, or the
// studio presses Keep on the site's card, publishing lists them as one thing to
// finish (routes/room.ts and routes/publish.ts read copiedBlocker below).
//
// This module is pure; agency/kit_io.ts does the reads and writes.
import { mediaIdsIn } from './dam.ts';

/** The settings columns that carry a site's pages, sections and menu. */
export const LAYOUT_COLUMNS = ['blocks', 'pages', 'nav', 'sections_order', 'sections_hidden', 'hero_layout', 'nav_style', 'footer_hours', 'footer_social'] as const;
export type LayoutColumn = typeof LAYOUT_COLUMNS[number];

export interface LayoutMedia { id: string; storage_path: string; mime: string; alt_text: string; bytes: number | null; width: number | null; height: number | null; focal_x: number | null; focal_y: number | null }
export interface LayoutLibraryItem { id: string; name: string; payload: unknown }
/** A site's pages and sections, ready to land on another site. */
export interface SiteLayout {
  v: 1;
  from_name: string;              // the business the words were written for: swapped for the new name
  from_label: string;             // how the copy is named on the new site ("Bistro Nine", "your Florist template")
  template_slug: string | null;   // the look
  settings: Partial<Record<LayoutColumn, unknown>>;
  custom_css: string;
  library: LayoutLibraryItem[];
  media: LayoutMedia[];
}

/** The copy, recorded on the new site. */
export interface CopiedRecord {
  from: string;                    // from_label
  at: string;
  sections: string[];              // a print of each section as it arrived
  media: string[];                 // the new site's own copies of the photos and files
  kept: boolean;                   // the studio said "keep them as they are"
}
export const MAX_LAYOUT_MEDIA = 80;   // photos and files copied with one site's pages

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The menu as it travels: links to the site's own pages only. A link to
 *  another website, an email address or a phone number belongs to the old
 *  business, so it stays behind (and a dropdown keeps only its own pages). Pure. */
export function menuForCopy(nav: unknown): unknown[] {
  const own = (href: unknown) => { const v = String(href ?? '').trim(); return v === '/' || /^\/[a-z0-9][a-z0-9-]*\/$/.test(v); };
  const out: unknown[] = [];
  for (const it of Array.isArray(nav) ? nav : []) {
    if (!isObj(it) || !own(it.href)) continue;
    const kids = Array.isArray(it.children) ? it.children.filter((c) => isObj(c) && own(c.href)) : [];
    const { children: _drop, ...top } = it;
    out.push(kids.length ? { ...top, children: kids } : top);
  }
  return out;
}

/** Every id in `map` (old → new) swapped wherever it sits in a value. Pure. */
export function swapIds<T>(value: T, map: Record<string, string>, depth = 0): T {
  if (depth > 14) return value;
  if (typeof value === 'string') { const hit = map[value.toLowerCase()]; return (hit ?? value) as unknown as T; }
  if (Array.isArray(value)) return value.map((x) => swapIds(x, map, depth + 1)) as unknown as T;
  if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, x]) => [k, swapIds(x, map, depth + 1)])) as T;
  return value;
}

// words only: never an id, a type, a link or a style choice
const NOT_WORDS = new Set(['id', 'ref', 'type', 'href', 'url', 'link', 'directions_url', 'look', 'style', 'variant', 'side', 'aspect', 'kind', 'slug', 'show_from', 'show_until']);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The old business's name swapped for the new one in the words of a value:
 *  whole words, exact case, never inside a link, an id or a style choice. Pure. */
export function swapName<T>(value: T, from: string, to: string): T {
  const f = String(from || '').trim(), t = String(to || '').trim();
  if (f.length < 2 || !t || f === t) return value;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(f)}(?![\\p{L}\\p{N}])`, 'gu');
  const walk = (v: unknown, key: string, depth: number): unknown => {
    if (depth > 14) return v;
    if (typeof v === 'string') return NOT_WORDS.has(key) || /^(https?:|mailto:|tel:|\/)/i.test(v) ? v : v.replace(re, () => t);
    if (Array.isArray(v)) return v.map((x) => walk(x, key, depth + 1));
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k, depth + 1)]));
    return v;
  };
  return walk(value, '', 0) as T;
}

/** The photos and files a layout's sections use: every media id in the home and
 *  page sections and in the saved sections they link to (lib/dam.ts mediaIdsIn). Pure. */
export function layoutMediaIds(settings: Partial<Record<LayoutColumn, unknown>>, library: Array<{ payload: unknown }> = []): string[] {
  const ids = new Set<string>();
  mediaIdsIn(settings.blocks, ids);
  for (const p of Array.isArray(settings.pages) ? settings.pages : []) if (isObj(p)) mediaIdsIn(p.blocks, ids);
  for (const it of library) mediaIdsIn(it.payload, ids);
  return [...ids];
}

/** The saved sections a layout links to (blocks of type "linked"). Pure. */
export function layoutLinkedIds(settings: Partial<Record<LayoutColumn, unknown>>): string[] {
  const ids = new Set<string>();
  const scan = (blocks: unknown) => { for (const b of Array.isArray(blocks) ? blocks : []) if (isObj(b) && b.type === 'linked' && typeof b.ref === 'string') ids.add(b.ref.toLowerCase()); };
  scan(settings.blocks);
  for (const p of Array.isArray(settings.pages) ? settings.pages : []) if (isObj(p)) scan(p.blocks);
  return [...ids];
}

/** How much a layout carries, in the words a dialog uses. Pure. */
export function layoutCounts(settings: Partial<Record<LayoutColumn, unknown>>): { pages: number; sections: number; menu: number } {
  const pages = Array.isArray(settings.pages) ? settings.pages.filter(isObj) : [];
  const home = Array.isArray(settings.blocks) ? settings.blocks.length : 0;
  const sections = home + pages.reduce((n, p) => n + (Array.isArray(p.blocks) ? p.blocks.length : 0), 0);
  return { pages: pages.length, sections, menu: Array.isArray(settings.nav) ? settings.nav.length : 0 };
}

// ── the print of a section (as the publish snapshot draws it) ──
// Taken from the SNAPSHOT (lib/serializer.ts): sections as they would publish,
// photos as their paths, so a section prints the same until its words or photos
// change. Its look, colors and timing don't count: restyling isn't rewriting.
const STYLE_KEYS = new Set(['look', 'style', 'show_from', 'show_until', 'bg', 'theme', 'variant']);
// sections that carry nothing of the old business: no words, no photos of theirs
const NOTHING_OF_THEIRS = new Set(['divider', 'toc', 'reviews_wall']);
// a photo prints as its file and its words, not its sizes: a new look (template)
// asks for other sizes, and that isn't a new photo
const photoKey = (m: Record<string, unknown>): string => {
  const paths = Object.values(isObj(m.variants) ? m.variants : {}).map((p) => String(p).replace(/-\d+\.[a-z0-9]+$/i, '')).sort();
  return JSON.stringify({ alt: m.alt ?? '', file: paths[0] || String(m.original || '') });
};
function canon(v: unknown, depth = 0): string {
  if (depth > 16) return '';
  if (Array.isArray(v)) return `[${v.map((x) => canon(x, depth + 1)).join(',')}]`;
  if (isObj(v) && (isObj(v.variants) || typeof v.original === 'string')) return photoKey(v);
  if (isObj(v)) return `{${Object.keys(v).filter((k) => !STYLE_KEYS.has(k) && v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k], depth + 1)}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
/** cyrb53: a quick 53-bit string hash, as hex. Pure. */
export function print53(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const ch = s.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
export interface PrintedSection { print: string; page: string; title: string }
const SECTION_WORD: Record<string, string> = { richtext: 'Text', image_text: 'Image and text', image: 'Image', gallery: 'Gallery', carousel: 'Slideshow', team: 'Team', cards: 'Cards', columns: 'Columns', features: 'Features', stats: 'Numbers', process: 'Steps', pricing: 'Prices', faq: 'FAQ', accordion: 'Questions', tabs: 'Tabs', cta: 'Call to action', title: 'Title', video: 'Video', map: 'Map', events: 'Events', social: 'Social links', partners: 'Logos', before_after: 'Before and after', spotlight: 'Spotlight', form: 'Form', booking: 'Booking', appointment: 'Appointments', newsletter: 'Newsletter', certifications: 'Credentials', service_areas: 'Service areas', reviews: 'Rating', progress: 'Progress', buttons: 'Buttons', download: 'Download', link_list: 'Links', table: 'Table', freeform: 'Free-form', stack: 'Blocks' };
/** Every section of a snapshot, printed, with its page and a name for it. Pure. */
export function printSections(content: unknown): PrintedSection[] {
  const settings = isObj(content) && isObj(content.settings) ? content.settings : {};
  const out: PrintedSection[] = [];
  const add = (blocks: unknown, page: string) => {
    for (const b of Array.isArray(blocks) ? blocks : []) {
      if (!isObj(b) || NOTHING_OF_THEIRS.has(String(b.type))) continue;
      const title = String(b.title || '').replace(/\s+/g, ' ').trim().slice(0, 40) || SECTION_WORD[String(b.type)] || 'A section';
      out.push({ print: print53(canon(b)), page, title });
    }
  };
  add(settings.blocks, 'Home');
  for (const p of Array.isArray(settings.pages) ? settings.pages : []) if (isObj(p)) add(p.blocks, String(p.title || p.slug || 'A page').slice(0, 40));
  return out;
}

/** The prints of one page's sections ('' = Home), as printSections makes them: what a
 *  saved page brought when it landed (builder list item 216). Pure. */
export function printPageSections(content: unknown, slug: string): string[] {
  const settings = isObj(content) && isObj(content.settings) ? content.settings : {};
  const page: unknown = slug === '' ? null : (Array.isArray(settings.pages) ? settings.pages : []).find((p) => isObj(p) && p.slug === slug);
  const blocks = slug === '' ? settings.blocks : isObj(page) ? page.blocks : undefined;
  return (Array.isArray(blocks) ? blocks : []).filter((b) => isObj(b) && !NOTHING_OF_THEIRS.has(String(b.type))).map((b) => print53(canon(b)));
}

/** What is still exactly as it was copied: the sections whose print hasn't
 *  changed, and the copied photos still in use. Nothing once the studio kept
 *  them. Pure. */
export function copiedLeftovers(record: CopiedRecord | null | undefined, content: unknown, usedMediaIds: Iterable<string>): { sections: PrintedSection[]; photos: number } {
  if (!record || record.kept) return { sections: [], photos: 0 };
  const prints = new Set(record.sections || []);
  const sections = printSections(content).filter((s) => prints.has(s.print));
  const copied = new Set((record.media || []).map((m) => String(m).toLowerCase()));
  let photos = 0;
  for (const id of new Set([...usedMediaIds].map((x) => String(x).toLowerCase()))) if (copied.has(id)) photos++;
  return { sections, photos };
}

/** The one thing to finish before publishing while copied words or photos are
 *  untouched — never naming the other business, since the site's owner may read
 *  it too. Null when nothing is left. Pure. */
export function copiedBlocker(left: { sections: PrintedSection[]; photos: number }): { field: string; message: string } | null {
  const n = left.sections.length, p = left.photos;
  if (!n && !p) return null;
  const byPage = new Map<string, string[]>();
  for (const s of left.sections) byPage.set(s.page, [...(byPage.get(s.page) || []), s.title]);
  const where = [...byPage].slice(0, 4).map(([page, titles]) => `${page}: ${titles.slice(0, 3).join(', ')}${titles.length > 3 ? '…' : ''}`).join('; ');
  const what = [n ? `${n} section${n === 1 ? '' : 's'}${where ? ` (${where}${byPage.size > 4 ? '; …' : ''})` : ''}` : '', p ? `${p} photo${p === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
  return { field: 'copied', message: `Still exactly as copied from another site: ${what}. Change them for this business, or press “Keep them as they are”.` };
}

/** A stored record, read safely: anything malformed is no record. Pure. */
export function normalizeCopied(raw: unknown): CopiedRecord | null {
  if (!isObj(raw)) return null;
  const list = (v: unknown, max: number) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, max) : []);
  return { from: String(raw.from || '').slice(0, 120), at: String(raw.at || ''), sections: list(raw.sections, 400), media: list(raw.media, MAX_LAYOUT_MEDIA * 2), kept: raw.kept === true };
}
