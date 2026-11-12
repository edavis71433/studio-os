// ── A deeper blog (builder list item 40, Nov 2026) ──────────────────────────
// Categories, authors, a day and time to go live, and photos inside a post.
//
// The site keeps two short lists in presence_settings (migration 0181):
// post_categories [{id, name}] and post_authors [{id, name, bio, photo_media_id}].
// A post names one of each by id (presence_posts.category / .author, '' for none).
// The snapshot's post carries them resolved (category {id, name}, author {id, name,
// bio?, photo?}) so a page draws a post without the lists, and a post published on
// its own (lib/post_publish.ts) brings its category and author with it.
//
// A photo inside a post is a line of its own, `![description](media:<id>)`, the line
// Send an update already uses (lib/update_media.ts), with an optional caption in
// quotes after the id. The description is the photo's alt text.
//
// Everything here is pure: the serializer, the templates and the routes share it.
import { esc, renderMarkdown } from './markdown.ts';
import type { MediaRef } from './render_types.ts';

export const MAX_CATEGORIES = 30;
export const MAX_AUTHORS = 20;
export const CATEGORY_NAME_MAX = 40;
export const AUTHOR_NAME_MAX = 60;
export const AUTHOR_BIO_MAX = 160;
export const SUMMARY_MAX = 160;   // the editor's counter; the column itself takes 300
/** How far ahead a post can be scheduled. */
export const SCHEDULE_MAX_DAYS = 400;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A photo on a line of its own: description, the photo's id, an optional caption. */
export const POST_IMAGE_LINE_RE = /^!\[([^\]\n]{0,200})\]\(media:([0-9a-f-]{36})(?:\s+"([^"\n]{0,200})")?\)$/i;

function plain(s: unknown, max: number): string {
  let out = '';
  for (const ch of String(s ?? '')) { const c = ch.codePointAt(0)!; if (c >= 32 && c !== 127) out += ch; }
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** "Wine & Events!" → "wine-events"; '' when nothing is left. Pure. */
export function slugId(s: unknown, max = 40): string {
  return String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '');
}

export interface PostCategory { id: string; name: string }
export interface PostAuthor { id: string; name: string; bio?: string; photo_media_id?: string | null }

/** The site's categories as they may be stored: each named, ids unique and URL-safe
 *  (a missing or unusable id comes from the name), at most 30. Pure. */
export function normalizeCategories(v: unknown): PostCategory[] {
  const out: PostCategory[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(v) ? v : []) {
    if (out.length >= MAX_CATEGORIES) break;
    const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const name = plain(o.name, CATEGORY_NAME_MAX);
    if (!name) continue;
    const given = String(o.id ?? '');
    const id = ID_RE.test(given) && given.length <= 40 ? given : slugId(name);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name });
  }
  return out;
}

/** The site's authors as they may be stored: each named, ids unique, a one-line bio and
 *  an optional photo from Files, at most 20. Pure. */
export function normalizeAuthors(v: unknown): PostAuthor[] {
  const out: PostAuthor[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(v) ? v : []) {
    if (out.length >= MAX_AUTHORS) break;
    const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const name = plain(o.name, AUTHOR_NAME_MAX);
    if (!name) continue;
    const given = String(o.id ?? '');
    let id = ID_RE.test(given) && given.length <= 40 ? given : slugId(name);
    if (!id) continue;
    for (let n = 2; seen.has(id); n++) id = `${slugId(name, 36) || 'author'}-${n}`;
    seen.add(id);
    const bio = plain(o.bio, AUTHOR_BIO_MAX);
    const photo = UUID.test(String(o.photo_media_id ?? '')) ? String(o.photo_media_id).toLowerCase() : null;
    out.push({ id, name, ...(bio ? { bio } : {}), ...(photo ? { photo_media_id: photo } : {}) });
  }
  return out;
}

/** The photos a post shows inside its text, in order, each once, lower-cased. Pure. */
export function postImageIds(body: unknown): string[] {
  const out: string[] = [];
  for (const line of String(body ?? '').split('\n')) {
    const m = line.trim().match(POST_IMAGE_LINE_RE);
    if (!m || !UUID.test(m[2])) continue;
    const id = m[2].toLowerCase();
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** What a snapshot's post adds to the fields it always had: its category and author
 *  (resolved from the site's lists) and the photos inside it. Each key is present only
 *  when there is something, so a post without them is unchanged. Pure. */
export function postExtras(
  row: { category?: unknown; author?: unknown; body_md?: unknown },
  lists: { categories: PostCategory[]; authors: PostAuthor[] },
  ref: (id: string | null | undefined) => MediaRef | null,
): { category?: PostCategory; author?: { id: string; name: string; bio?: string; photo?: MediaRef }; images?: Record<string, MediaRef> } {
  const out: ReturnType<typeof postExtras> = {};
  const cat = lists.categories.find((c) => c.id === String(row.category ?? ''));
  if (cat) out.category = { id: cat.id, name: cat.name };
  const au = lists.authors.find((a) => a.id === String(row.author ?? ''));
  if (au) {
    const photo = au.photo_media_id ? ref(au.photo_media_id) : null;
    out.author = { id: au.id, name: au.name, ...(au.bio ? { bio: au.bio } : {}), ...(photo ? { photo } : {}) };
  }
  const images: Record<string, MediaRef> = {};
  for (const id of postImageIds(row.body_md)) { const m = ref(id); if (m) images[id] = m; }
  if (Object.keys(images).length) out.images = images;
  return out;
}

/** Why a post can't be scheduled for `when`, in a sentence, or null when it can. Pure. */
export function scheduleProblem(when: unknown, nowIso: string): string | null {
  const t = Date.parse(String(when ?? ''));
  if (!Number.isFinite(t)) return 'Pick a day and time for it to go out.';
  const now = Date.parse(nowIso);
  if (t <= now + 60_000) return 'That time has passed. Pick a time later than now, or publish it now.';
  if (t > now + SCHEDULE_MAX_DAYS * 86_400_000) return 'That’s more than a year away. Pick a sooner day.';
  return null;
}

/** A post's summary: the one written for it, or its first lines as plain words. Pure. */
export function postSummary(p: { excerpt?: unknown; body_md?: unknown }, max = 200): string {
  const own = plain(p.excerpt, 300);
  if (own) return own.length > max ? own.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : own;
  const lines: string[] = [];
  for (const raw of String(p.body_md ?? '').split('\n')) {
    const t = raw.trim();
    if (!t) { if (lines.length) break; continue; }
    if (POST_IMAGE_LINE_RE.test(t) || /^#{1,3}\s/.test(t)) { if (lines.length) break; continue; }
    lines.push(t.replace(/^>\s?/, '').replace(/^[-*]\s+|^\d+[.)]\s+/, ''));
  }
  const text = lines.join(' ')
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : text;
}

/** The email a live post becomes in Send an update (item 160): its title, its cover, its
 *  summary, and a link to the whole post on a line of its own (drawn as a button). Pure. */
export function postEmailDraft(p: { title?: unknown; excerpt?: unknown; body_md?: unknown; hero_media_id?: unknown }, url: string, heroAlt = ''): { subject: string; body: string } {
  const lines: string[] = [];
  const hero = String(p.hero_media_id ?? '').toLowerCase();
  if (UUID.test(hero)) lines.push(`![${plain(heroAlt, 200).replace(/[\[\]]/g, '') || plain(p.title, 200).replace(/[\[\]]/g, '')}](media:${hero})`, '');
  const summary = postSummary(p, 600);
  if (summary) lines.push(summary, '');
  lines.push(`[Read the whole post](${url})`);
  return { subject: plain(p.title, 160), body: lines.join('\n') };
}

/** A post's text as HTML, with each photo line drawn by the template (`figure`), so the
 *  photo carries the template's own sizes. A photo line whose photo isn't in `images`
 *  draws nothing. Every other line goes through the one safe markdown. Pure. */
export function renderPostBody(md: unknown, images: Record<string, MediaRef> | undefined, figure: (m: MediaRef, alt: string, caption: string) => string): string {
  const out: string[] = [];
  let chunk: string[] = [];
  const flush = () => { if (chunk.length) { const h = renderMarkdown(chunk.join('\n')); if (h) out.push(h); chunk = []; } };
  for (const line of String(md ?? '').replaceAll('\r\n', '\n').split('\n')) {
    const m = line.trim().match(POST_IMAGE_LINE_RE);
    if (!m) { chunk.push(line); continue; }
    flush();
    const ref = images?.[m[2].toLowerCase()];
    if (ref) out.push(figure(ref, plain(m[1], 200), plain(m[3], 200)));
  }
  flush();
  return out.join('\n');
}

/** The categories that have posts, in the site's order, each with its posts. Pure. */
export function categoriesWithPosts<P extends { category?: PostCategory }>(posts: P[]): Array<PostCategory & { posts: P[] }> {
  const by = new Map<string, PostCategory & { posts: P[] }>();
  for (const p of posts) {
    const c = p.category;
    if (!c || !c.id) continue;
    if (!by.has(c.id)) by.set(c.id, { id: c.id, name: c.name, posts: [] });
    by.get(c.id)!.posts.push(p);
  }
  return [...by.values()];
}

/** "By Sam Ortiz · November 18, 2026" pieces, escaped, for a template's post line. Pure. */
export function bylineHtml(p: { author?: { name: string } }, dateHtml: string): string {
  return p.author?.name ? `By ${esc(p.author.name)} · ${dateHtml}` : dateHtml;
}
