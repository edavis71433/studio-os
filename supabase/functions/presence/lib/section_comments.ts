// ── Wave-2 G11: per-section annotations & review comments — pure core ─────────
// Adobe parity AC-7/WF-6 (Annotate mode, annotation-driven review), SMB-shaped:
// comment threads pinned to the DRAFT's sections, written by the operator in the
// builder and by the CLIENT on the shared draft (/p/s/:token — the same signed,
// expiring, site-scoped token that authorizes the page itself; no new auth).
//
// Everything here is PURE (unit-testable without a database): body validation,
// page-slug/block-id normalization, the stable section-id scheme, thread
// grouping, and the self-contained feedback panel injected into the shared
// draft page. The impure handlers live in routes/comments.ts.

// ── The stable section-id scheme ──────────────────────────────────────────────
// Blocks mostly carry no stored id (only the multi-instance types — form,
// columns, cards — get one from site_blocks.ts uniqueId). The comment key is:
//   • `type`           — the first instance of a type on the page (e.g. "gallery")
//   • `type#N`         — the Nth instance of a repeated no-id type ("richtext#2")
//   • `type:storedId`  — a multi-instance block with its own id ("columns:cols_a")
//   • ''               — the whole page (block_id null/'' in the table)
// Deterministic over the page's block list. G13: the id computation itself lives
// in site_blocks.sectionSidsFor — the ONE implementation the render stamps
// (data-dds-sid) and the /settings section_meta sidecar also use; the old
// client-side mirror (presence.html cmSectionIds) is retired.
import { sectionSidsFor } from './site_blocks.ts';

/** Plain-word names per block type — client-facing, NEVER content. Mirrors the
 *  builder's BLOCK_DEFS names, shortened to calm nouns. */
export const SECTION_NAME: Record<string, string> = {
  features: 'Features', stats: 'Numbers', team: 'Team', process: 'How it works',
  pricing: 'Pricing', certifications: 'Certifications', service_areas: 'Areas served',
  cta: 'Call-to-action banner', gallery: 'Photo gallery', before_after: 'Before & after',
  video: 'Video', partners: 'Logo strip', reviews: 'Review badge', reviews_wall: 'Reviews',
  appointment: 'Booking button', booking: 'Online booking', newsletter: 'Newsletter sign-up',
  social: 'Social links', events: 'Events', map: 'Map & directions', richtext: 'Text',
  image: 'Image', image_text: 'Image + text', accordion: 'Expandable details', tabs: 'Tabs',
  carousel: 'Slideshow', progress: 'Progress bars', buttons: 'Buttons', divider: 'Divider',
  columns: 'Columns', cards: 'Cards', download: 'Download', toc: 'Table of contents',
  title: 'Heading', link_list: 'Links', table: 'Table', spotlight: 'Spotlight', form: 'Form',
  stack: 'Blocks',   // builder item 57
};

export const COMMENT_BODY_MAX = 2000;
/** Cap of OPEN client-authored comments per site — the abuse backstop behind the
 *  per-IP rate limit (a shared link is public by design once sent). */
export const MAX_OPEN_CLIENT_COMMENTS = 200;

/** Validate + clean a comment body. Strips control chars (keeps newline/tab),
 *  normalizes CRLF, trims. Refuses empty and over-cap (never silently truncates
 *  someone's words). Pure. */
export function cleanCommentBody(raw: unknown):
  { ok: true; body: string } | { ok: false; error: 'empty' | 'too_long' } {
  let s = '';
  for (const ch of String(raw ?? '')) {
    const c = ch.codePointAt(0)!;
    if (c >= 32 || c === 10 || c === 9) s += ch;
  }
  s = s.replace(/\r\n?/g, '\n').trim();
  if (!s) return { ok: false, error: 'empty' };
  if (s.length > COMMENT_BODY_MAX) return { ok: false, error: 'too_long' };
  return { ok: true, body: s };
}

// ── Builder list item 159: a name on shared-draft feedback, and one picture a note ──
export const AUTHOR_NAME_MAX = 60;
/** The name someone typed with their feedback: control characters out, spaces folded,
 *  at most 60 characters. '' when none (the note is still welcome without one). Pure. */
export function cleanAuthorName(raw: unknown): string {
  let s = '';
  for (const ch of String(raw ?? '')) { const c = ch.codePointAt(0)!; if (c >= 32 && c !== 127) s += ch; }
  return s.replace(/\s+/g, ' ').trim().slice(0, AUTHOR_NAME_MAX).trim();
}

/** One picture a note: a JPEG, PNG or WebP the page has already made small, sent as a
 *  data: address. At most 3 MB once decoded; its kind comes from its first bytes. */
export const COMMENT_IMAGE_MAX = 3 * 1024 * 1024;
export function decodeCommentImage(raw: unknown): { ok: true; bytes: Uint8Array; type: string } | { ok: false; error: 'not_image' | 'too_large' } | null {
  if (raw === undefined || raw === null || raw === '') return null;   // no picture: fine
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(raw));
  if (!m) return { ok: false, error: 'not_image' };
  const b64 = m[2].replace(/\s+/g, '');
  if (b64.length > Math.ceil(COMMENT_IMAGE_MAX / 3) * 4 + 4) return { ok: false, error: 'too_large' };
  let bin: string;
  try { bin = atob(b64); } catch { return { ok: false, error: 'not_image' }; }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length > COMMENT_IMAGE_MAX) return { ok: false, error: 'too_large' };
  const at = (i: number, ...v: number[]) => v.every((x, k) => bytes[i + k] === x);
  const type = bytes.length >= 3 && at(0, 0xff, 0xd8, 0xff) ? 'image/jpeg'
    : bytes.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) ? 'image/png'
    : bytes.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50) ? 'image/webp' : null;
  if (!type) return { ok: false, error: 'not_image' };
  return { ok: true, bytes, type };
}
/** A picture's dimensions as the page measured them, kept only when they're sane. */
export function pictureSize(w: unknown, h: unknown): { w: number; h: number } | null {
  const a = Math.round(Number(w)), b = Math.round(Number(h));
  return a > 0 && b > 0 && a <= 10000 && b <= 10000 ? { w: a, h: b } : null;
}

/** Normalize a page reference — accepts a slug ("about") or a public path form
 *  ("/", "/about/"). '' = the home page. Returns null on anything that isn't a
 *  safe slug (fail closed — never a traversal or a raw key). Pure. */
export function normalizePageSlug(raw: unknown): string | null {
  let s = String(raw ?? '').trim().toLowerCase().replace(/^\/+|\/+$/g, '');
  if (s === '') return '';
  if (!/^[a-z0-9-]{1,60}$/.test(s)) return null;
  return s;
}

/** Normalize a block id per the scheme above. '' = whole page. null = invalid. Pure. */
export function normalizeBlockId(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (s === '') return '';
  if (!/^[a-z0-9_]+(#[0-9]{1,3}|:[a-z0-9_-]{1,60})?$/i.test(s) || s.length > 80) return null;
  return s;
}

/** The {id, name} pairs for a list of stored blocks — the ONLY data the public
 *  sections route may serve (no titles, no bodies, no media, no field values).
 *  Deterministic; junk entries are skipped, never guessed at. Pure. */
export function sectionIdsFor(blocks: unknown): Array<{ id: string; name: string }> {
  // Junk entries are skipped BEFORE counting (unchanged behavior); the id
  // computation over the kept list delegates to the canonical sectionSidsFor.
  const kept = (Array.isArray(blocks) ? blocks : []).filter((b) =>
    b && typeof b === 'object' && /^[a-z0-9_]{1,40}$/.test(String((b as Record<string, unknown>).type || '')));
  const ids = sectionSidsFor(kept);
  const counts: Record<string, number> = {};
  return kept.map((b, i) => {
    const type = String((b as Record<string, unknown>).type || '');
    const n = (counts[type] = (counts[type] || 0) + 1);
    const base = SECTION_NAME[type] || type.replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
    return { id: ids[i], name: n === 1 ? base : `${base} (${n})` };
  });
}

/** The section list for one page of a snapshot's content ('' = home →
 *  settings.blocks; a slug → that settings.pages[] entry). Unknown page → []. Pure. */
export function sectionsForContent(content: unknown, pageSlug: string): Array<{ id: string; name: string }> {
  const c = (content && typeof content === 'object' ? content : {}) as Record<string, any>;
  const settings = (c.settings && typeof c.settings === 'object' ? c.settings : {}) as Record<string, any>;
  if (!pageSlug) return sectionIdsFor(settings.blocks);
  const pages = Array.isArray(settings.pages) ? settings.pages : [];
  const page = pages.find((p: any) => p && typeof p === 'object' && p.slug === pageSlug);
  return page ? sectionIdsFor(page.blocks) : [];
}

// ── Thread grouping (the operator's GET /comments view) ───────────────────────
export interface CommentRow {
  id: string; page_slug: string; block_id: string | null; author_kind: string;
  body: string; status: string; created_at: string; resolved_at?: string | null;
  /** item 159: the name typed with shared-draft feedback, and the note's picture (a
   *  ten-minute link, never the stored path) */
  author_name?: string | null; picture?: { url: string; w?: number; h?: number } | null;
}
export interface CommentThread { page_slug: string; block_id: string; open_count: number; comments: CommentRow[] }

/** Group rows into threads by (page_slug, block_id); comments newest-first
 *  within each thread; threads newest-activity-first. Counts only OPEN rows. Pure. */
export function groupThreads(rows: CommentRow[]): CommentThread[] {
  const map = new Map<string, CommentThread>();
  for (const r of (Array.isArray(rows) ? rows : [])) {
    if (!r || typeof r !== 'object') continue;
    const slug = String(r.page_slug || '');
    const bid = String(r.block_id || '');
    const k = `${slug}\u0000${bid}`;
    let t = map.get(k);
    if (!t) { t = { page_slug: slug, block_id: bid, open_count: 0, comments: [] }; map.set(k, t); }
    t.comments.push(r);
    if (r.status === 'open') t.open_count++;
  }
  const threads = [...map.values()];
  for (const t of threads) t.comments.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  threads.sort((a, b) => String(b.comments[0]?.created_at || '').localeCompare(String(a.comments[0]?.created_at || '')));
  return threads;
}

/** Status transitions: open → resolved is the only move (delete is soft, any
 *  state). Resolving a resolved comment is an idempotent no-op. Pure. */
export function canResolve(status: unknown): boolean { return status === 'open'; }

// ── The "Leave feedback" panel on the shared draft (/p/s/:token) ──────────────
// Item 159: it lives in lib/feedback_panel.ts, which imports nothing, so a browser
// spec can draw the real panel (notes-159.spec.ts); re-exported here for its callers.
export { injectFeedbackPanel } from './feedback_panel.ts';
