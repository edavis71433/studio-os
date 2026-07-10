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
import { serializeDraft } from './serializer.ts';
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
 *  null only when the site's template is unavailable. The `now` handed to
 *  serializeDraft affects only snapshot.created_at, which the hash excludes — so
 *  the result is stable no matter when it is called (a fixed epoch is passed to
 *  make that explicit). */
export async function draftHashForSite(site: SiteRow): Promise<string | null> {
  const t = getTemplate(site.template_slug, site.template_version);
  if (!t) return null;
  const { snapshot } = await serializeDraft(site.id, t.manifest, {
    templateSlug: site.template_slug,
    templateVersion: site.template_version,
    now: '1970-01-01T00:00:00.000Z',
  });
  return await computeDraftHash(snapshot);
}
