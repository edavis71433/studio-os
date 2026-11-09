// ── Draft-version hash (Presence CMS Phase 1, M3) ────────────────────────────
// The canonical fingerprint of a draft's CONTENT. Reuses the ONE serializer
// (serializeDraft) — no second content model — and hashes exactly what a render
// consumes, EXCEPT the capture timestamp (`created_at`, which changes every
// serialize and is not content). Two drafts render identically ⇔ same hash.
//
// FOUNDATION ONLY (M3): hash generation + a stable, deterministic hash. The
// downstream features it enables — optimistic locking (M9), preview cache (M8),
// "what changed" publish summaries, unpublished-changes detection, version
// comparison, Navigator status — are built ON this later, NOT here.
//
// Design decision: compute-on-read from the serialized draft. No stored column,
// no migration — the hash can never go stale (it is always derived from current
// content), no draft-write path is touched, and publishing behavior is unchanged.
// (A settings-only column would be INCOMPLETE — it would miss identity/offerings/
// faqs/etc. edits — and serializing on every write would be heavier and touch
// every save path. If M9's If-Match ever needs to avoid recompute-on-save, a
// cached column can be added then.)
import { getTemplate } from './render.ts';
import { svc } from './db.ts';
import { readDraftRows, buildSnapshot, DRAFT_TABLES } from './serializer.ts';
import type { DraftRows, MediaManifestEntry } from './serializer.ts';
import type { Snapshot } from './render_types.ts';
import type { SiteRow } from './site.ts';

// Canonical JSON: recursively SORT OBJECT KEYS (key order is not semantic) but
// PRESERVE ARRAY ORDER (blocks / offerings / sections are semantically ordered —
// reordering them IS a real change). This makes the hash independent of key
// insertion order while staying sensitive to meaningful reordering.
export function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = canonicalize((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The material that defines a draft's identity: everything a render consumes,
 *  minus the capture timestamp. Pure. */
export function draftHashMaterial(snapshot: Snapshot): unknown {
  return canonicalize({
    content: snapshot.content,
    dev_customization: snapshot.dev_customization ?? null,
    template_slug: snapshot.template_slug,
    template_version: snapshot.template_version,
    content_contract_version: snapshot.content_contract_version,
  });
}

/** Deterministic SHA-256 of a snapshot's content (timestamp excluded). Pure over
 *  the snapshot — identical content yields an identical hash, forever. */
export async function computeDraftHash(snapshot: Snapshot): Promise<string> {
  return await sha256Hex(JSON.stringify(draftHashMaterial(snapshot)));
}

/** Serialize the site's current draft (the ONE serializer) and hash it. Returns
 *  null only when the site's template is unavailable. */
export async function draftHashForSite(site: SiteRow): Promise<string | null> {
  return (await readDraft(site))?.hash ?? null;
}

// ── Reading the draft again after a write (Nov 2026) ─────────────────────────
// A write that names a version is answered with the version it left (lib/optimistic_lock.ts),
// and the draft was read in full just before it. Most writes change one table, so the
// read after keeps the rows the write can't have touched and reads the rest again.

/** A site's draft as one read found it: the rows, what they build, and its version. */
export interface DraftRead { site: SiteRow; rows: DraftRows; snapshot: Snapshot; mediaManifest: MediaManifestEntry[]; hash: string }

// A write to one table that moves another's part of the draft: deleting a photo row
// clears it from menu items and updates (0016's `on delete set null`).
const ALSO_MOVES: Record<string, string[]> = { presence_media: ['presence_offerings', 'presence_posts'] };

/** The part of a draft that writes to `written` (tables, from lib/db.ts) can have moved:
 *  the draft's tables among them, and `presence_sites` for its template. Null when one
 *  of them can't be placed, a database function, which means all of it. Pure. */
export function draftTablesMoved(written: Iterable<string>): Set<string> | null {
  const out = new Set<string>();
  for (const table of written) {
    if (table.startsWith('rpc/')) return null;
    for (const t of [table, ...(ALSO_MOVES[table] || [])]) if (t === 'presence_sites' || DRAFT_TABLES.includes(t)) out.add(t);
  }
  return out;
}

/** Read the site's draft and hash it; null when its template is unavailable. Given `prev`,
 *  an earlier read of this site, and `written`, the tables written since, only what those
 *  writes can have moved is read again, and nothing at all when they moved none of it.
 *  The `now` handed to the serializer affects only snapshot.created_at, which the hash
 *  excludes — so the result is stable no matter when it is called (a fixed epoch is
 *  passed to make that explicit). */
export async function readDraft(site: SiteRow, prev?: DraftRead | null, written?: Iterable<string>): Promise<DraftRead | null> {
  const moved = prev && written ? draftTablesMoved(written) : null;
  if (prev && moved?.has('presence_sites') !== false) {
    // The site row was written: its template is in the version, so read which one it is now.
    const r = await svc(`presence_sites?id=eq.${site.id}&select=template_slug,template_version&limit=1`);
    const row = Array.isArray(r.json) ? r.json[0] : null;
    if (!row) return null;
    site = { ...site, template_slug: row.template_slug, template_version: row.template_version };
    if (site.template_slug === prev.site.template_slug && site.template_version === prev.site.template_version) moved?.delete('presence_sites');
  }
  if (prev && moved?.size === 0) return prev;
  const t = getTemplate(site.template_slug, site.template_version);
  if (!t) return null;
  const rows = await readDraftRows(site.id, moved ? prev!.rows : undefined, moved ?? undefined);
  const { snapshot, mediaManifest } = buildSnapshot(rows, t.manifest, {
    templateSlug: site.template_slug,
    templateVersion: site.template_version,
    now: '1970-01-01T00:00:00.000Z',
  });
  return { site, rows, snapshot, mediaManifest, hash: await computeDraftHash(snapshot) };
}
