// ── Builder list item 234 (Nov 2026): pages and quick links the studio makes for its clients ──
// Drawn in Figma first (page "Client portal — from the Agiled check", section 234).
//
// A studio writes pages for its clients (a welcome guide, brand files, "how we work"):
// words, plus links, videos and files, each page shown to every client or to chosen ones.
// Up to six quick links (a web address, or a place in the portal). They sit at the top of
// the client's Help. A page shown to chosen clients is simply not there for anyone else,
// and the server never sends it to them. Kept once per studio, on its own site, as
// reserved JSON (no migration):
//   { pages: [{ id, title, words, items: [{ kind, label, url? , media_id? }], who: 'all' | siteId[], home, updated_at }],
//   home (builder item 280, Nov 22): one page at a time is also shown on the client's Home.
//     links: [{ id, label, to }] }        to: an https address, or 'book' | 'messages' | 'documents'
import { readReservedJson, RESERVED_NAMES } from './reserved_store.ts';

export const MAX_PAGES = 20;
export const MAX_LINKS = 6;
export const MAX_ITEMS = 12;
export const TITLE_MAX = 80;
export const WORDS_MAX = 5000;
export const LABEL_MAX = 80;
export const PLACES = ['book', 'messages', 'documents'] as const;
export type Place = typeof PLACES[number];
export type ItemKind = 'link' | 'video' | 'file';
export interface PageItem { kind: ItemKind; label: string; url?: string; media_id?: string }
export interface PortalPage { id: string; title: string; words: string; items: PageItem[]; who: 'all' | string[]; home: boolean; updated_at: string | null }
export interface PortalLink { id: string; label: string; to: string }
export interface PortalPages { pages: PortalPage[]; links: PortalLink[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const line = (v: unknown, max: number) => String(typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** The page's words: plain text, line breaks kept (at most one blank line in a row). Pure. */
export function cleanWords(v: unknown): string {
  return String(typeof v === 'string' ? v : '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, WORDS_MAX);
}
/** An address a client may open: https only, no spaces, nothing that runs. Pure. */
export function cleanUrl(v: unknown): string {
  const s = String(typeof v === 'string' ? v : '').trim();
  if (!/^https:\/\/[^\s/?#]+\.[^\s/?#]+[^\s]*$/i.test(s) || s.length > 2000) return '';
  try { const u = new URL(s); return u.protocol === 'https:' ? u.toString() : ''; } catch { return ''; }
}
function cleanItem(v: unknown): PageItem | null {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const kind = r.kind === 'link' || r.kind === 'video' || r.kind === 'file' ? r.kind : null;
  if (!kind) return null;
  if (kind === 'file') {
    if (!isId(r.media_id)) return null;
    return { kind, label: line(r.label, LABEL_MAX) || 'A file', media_id: String(r.media_id).toLowerCase() };
  }
  const url = cleanUrl(r.url);
  if (!url) return null;
  return { kind, label: line(r.label, LABEL_MAX) || (kind === 'video' ? 'Watch the video' : url.replace(/^https:\/\//, '').replace(/\/$/, '')), url };
}
function cleanWho(v: unknown): 'all' | string[] {
  if (!Array.isArray(v)) return 'all';
  return [...new Set(v.filter(isId).map((s) => s.toLowerCase()))].slice(0, 500);
}
/** One page as kept, or null when it has no title or no id. Pure. */
export function cleanPage(v: unknown, id: string, nowIso: string | null = new Date().toISOString()): PortalPage | null {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const title = line(r.title, TITLE_MAX);
  if (!isId(id) || !title) return null;
  const items = (Array.isArray(r.items) ? r.items : []).map(cleanItem).filter((x): x is PageItem => !!x).slice(0, MAX_ITEMS);
  return { id: id.toLowerCase(), title, words: cleanWords(r.words), items, who: cleanWho(r.who), home: r.home === true, updated_at: nowIso };
}
/** One quick link as kept, or null. Pure. */
export function cleanLink(v: unknown, id: string): PortalLink | null {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const label = line(r.label, LABEL_MAX);
  const to = (PLACES as readonly string[]).includes(String(r.to)) ? String(r.to) : cleanUrl(r.to);
  if (!isId(id) || !label || !to) return null;
  return { id: id.toLowerCase(), label, to };
}
/** The stored pages and links, cleaned: anything unreadable is none. Pure. */
export function normalizePages(raw: unknown): PortalPages {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pages = (Array.isArray(r.pages) ? r.pages : []).map((p) => cleanPage(p, String((p as Record<string, unknown>)?.id || ''), typeof (p as Record<string, unknown>)?.updated_at === 'string' ? String((p as Record<string, unknown>).updated_at) : null)).filter((x): x is PortalPage => !!x);
  const links = (Array.isArray(r.links) ? r.links : []).map((l) => cleanLink(l, String((l as Record<string, unknown>)?.id || ''))).filter((x): x is PortalLink => !!x);
  const seen = new Set<string>();
  return {
    pages: pages.filter((p) => !seen.has(p.id) && seen.add(p.id)).slice(0, MAX_PAGES),
    links: links.filter((l) => !seen.has(l.id) && seen.add(l.id)).slice(0, MAX_LINKS),
  };
}
/** A page saved: replaced where it was, else added at the end; refused (null) past twenty.
 *  Item 280: a page pinned to Home takes the pin from whichever page had it. Pure. */
export function putPage(cur: PortalPages, page: PortalPage): PortalPages | null {
  const i = cur.pages.findIndex((p) => p.id === page.id);
  if (i < 0 && cur.pages.length >= MAX_PAGES) return null;
  const others = cur.pages.map((p) => (page.home && p.home ? { ...p, home: false } : p));
  const pages = i < 0 ? [...others, page] : others.map((p, k) => (k === i ? page : p));
  return { ...cur, pages };
}
export function dropPage(cur: PortalPages, id: string): PortalPages { return { ...cur, pages: cur.pages.filter((p) => p.id !== String(id).toLowerCase()) }; }
/** A quick link saved: replaced where it was, else added; refused (null) past six. Pure. */
export function putLink(cur: PortalPages, link: PortalLink): PortalPages | null {
  const i = cur.links.findIndex((l) => l.id === link.id);
  if (i < 0 && cur.links.length >= MAX_LINKS) return null;
  const links = i < 0 ? [...cur.links, link] : cur.links.map((l, k) => (k === i ? link : l));
  return { ...cur, links };
}
export function dropLink(cur: PortalPages, id: string): PortalPages { return { ...cur, links: cur.links.filter((l) => l.id !== String(id).toLowerCase()) }; }

/** The pages this client may see: every client's, and those chosen for them. Pure. */
export function pagesFor(cur: PortalPages, clientSiteId: string): PortalPage[] {
  const id = String(clientSiteId || '').toLowerCase();
  return cur.pages.filter((p) => p.who === 'all' || p.who.includes(id));
}
/** The short line under a page's title on Help: its first line, cut at a word. Pure. */
export function subLine(words: string, max = 70): string {
  const first = String(words || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).replace(/[\s,.;:–—-]+$/, '') + '…';
}

export async function readPortalPages(studioSiteId: string): Promise<PortalPages> {
  return normalizePages(await readReservedJson(studioSiteId, RESERVED_NAMES.portalPages));
}
