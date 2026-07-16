// ── CL-LINK · Linked sections (update-once-reflects-everywhere) ──────────────
// A saved Content-Library section can be inserted as a LINK instead of a copy:
// the page stores only a REFERENCE to the library item's id, and at serialize
// time the reference resolves to the library item's CURRENT content — so editing
// the saved section updates every linked placement (the update-once pattern),
// while copies stay independent exactly as before.
//
// This mirrors reviews_wall / media resolution (lib/site_blocks.ts): the IMPURE
// DB read (fetching the referenced library items) happens once in the serializer;
// THIS module is pure. It runs BEFORE validateBlocks, so a resolved link becomes
// an ordinary stored block — validateBlocks + the renderer are untouched, and a
// copy-inserted block renders byte-identically to the same block reached via a
// link. A site with no links does zero extra work and is byte-identical to before.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The stored block type that marks a placement as a LINK to a library item.
 *  Deliberately NOT a REALIZED_BLOCK_TYPE — validateBlocks drops it, so an
 *  unresolved link never leaks into the render; resolution replaces it first. */
export const LINKED_BLOCK_TYPE = 'linked';

export interface LinkedBlock {
  type: 'linked';
  ref: string;                 // a presence_content_library item id (UUID)
  look?: unknown;              // optional per-placement overrides (parsed downstream
  show_from?: unknown;         // by validateBlocks' parseLook / parseWindow — same
  show_until?: unknown;        // enumerated-only gates as any other block)
  style?: unknown;             // G27: per-placement style override (parsed downstream by parseStyle)
}

/** Is this raw block a link to a library item? (type 'linked' + a UUID ref). */
export function isLinkedBlock(b: unknown): b is LinkedBlock {
  return !!b && typeof b === 'object'
    && (b as { type?: unknown }).type === LINKED_BLOCK_TYPE
    && typeof (b as { ref?: unknown }).ref === 'string'
    && UUID_RE.test((b as { ref: string }).ref);
}

/** The de-duplicated library-item ids referenced by links in a raw block list.
 *  The serializer uses this to fetch EXACTLY the referenced items — and nothing
 *  when there are none (so the no-links case adds no query and no drift). */
export function linkedRefIds(rawBlocks: unknown): string[] {
  const out = new Set<string>();
  if (Array.isArray(rawBlocks)) for (const b of rawBlocks) if (isLinkedBlock(b)) out.add(b.ref);
  return [...out];
}

/** Wave-1 G8 · Where-used: which pages LIVE-LINK each library item. One pass over
 *  the draft's block lists (home + every custom page — the same lists the
 *  serializer resolves), so usage derives from exactly what publish would resolve;
 *  no per-item queries. Returns item id → the pages it appears on, in page order.
 *  Pure. */
export function linkedUsageMap(homeBlocks: unknown, pages: unknown): Record<string, Array<{ slug: string; title: string }>> {
  const out: Record<string, Array<{ slug: string; title: string }>> = {};
  const add = (blocks: unknown, slug: string, title: string) => {
    for (const id of linkedRefIds(blocks)) (out[id] ??= []).push({ slug, title });
  };
  add(homeBlocks, '', 'Home');
  if (Array.isArray(pages)) {
    for (const p of pages) {
      if (!p || typeof p !== 'object') continue;
      const pg = p as { slug?: unknown; title?: unknown; blocks?: unknown };
      add(pg.blocks, String(pg.slug ?? ''), String(pg.title || pg.slug || ''));
    }
  }
  return out;
}

/** Resolve linked blocks to their library item's CURRENT content, in order.
 *  `lookup(id)` returns the stored library payload (one block) or null/undefined.
 *  A link whose item is missing/deleted is DROPPED — graceful, never an error:
 *  the placement simply doesn't appear. Non-linked blocks pass through untouched.
 *  A per-placement `look`/`show_from`/`show_until` set on the LINK overrides the
 *  payload's (so one placement can be styled/scheduled independently while its
 *  CONTENT stays single-source); otherwise the payload's own values ride through.
 *  Returns a raw block list to hand straight to validateBlocks. Pure. */
export function resolveLinkedBlocks(rawBlocks: unknown, lookup: (id: string) => unknown): unknown[] {
  if (!Array.isArray(rawBlocks)) return [];
  const out: unknown[] = [];
  for (const b of rawBlocks) {
    if (!isLinkedBlock(b)) { out.push(b); continue; }
    const payload = lookup(b.ref);
    if (!payload || typeof payload !== 'object') continue;   // deleted/missing → drop (graceful)
    const resolved: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
    if (b.look !== undefined) resolved.look = b.look;
    if (b.style !== undefined) resolved.style = b.style;   // G27: per-placement style override overrides the payload's (content stays single-source)
    if (b.show_from !== undefined) resolved.show_from = b.show_from;
    if (b.show_until !== undefined) resolved.show_until = b.show_until;
    if ((b as { variant?: unknown }).variant !== undefined) resolved.variant = (b as { variant?: unknown }).variant;   // Wave-1 G4: per-placement style variant overrides the payload's
    out.push(resolved);
  }
  return out;
}
