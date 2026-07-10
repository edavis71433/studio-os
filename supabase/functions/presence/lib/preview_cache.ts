// ── Preview render cache (Presence CMS Phase 1, M8) ──────────────────────────
// A bounded in-memory LRU that memoizes the EXPENSIVE, deterministic step of a
// preview — renderSnapshot's output — keyed by content identity so it can never
// serve stale content:
//   • draft previews  → key on the M3 canonical draft hash (any edit changes the
//     hash → a different key → automatic invalidation; the old entry just ages
//     out). The draft is still serialized every request (that's how the exact
//     content hash — and thus correctness — is derived); what's deduplicated is
//     the render.
//   • immutable snapshots (live / a specific publish / launch / the pinned
//     preview snapshot) → key on the snapshot id. Snapshots are write-once, so
//     the render is valid forever; this also lets a shared preview link viewed by
//     many people render once.
//
// It caches ONLY the render (fileMap HTML/CSS + the media manifest + validation
// counts). The per-request bits — freshly-signed image URLs, the watermark, link
// rewriting — are always re-applied downstream, so a cached entry never carries
// an expired signed URL. Published rendering is untouched (publish never reads
// this cache). Process-local + best-effort: a cold instance simply re-renders.

export type FileMap = Record<string, string | Uint8Array>;
export interface PreviewCacheEntry {
  fileMap: FileMap;
  mediaManifest: unknown[];
  blockers: number;
  warnings: number;
  businessName?: string; // for the watermark on a cache hit (no content reload)
}

/** Content-addressed key. `disc` is the draft hash (kind 'draft') or the snapshot
 *  id (kind 'snap'). Site-scoped so one tenant's key can never collide with
 *  another's. Pure. */
export function previewCacheKey(siteId: string, kind: 'draft' | 'snap', disc: string): string {
  return `${siteId}:${kind}:${disc}`;
}

function envInt(name: string, dflt: number): number {
  const n = Number(Deno.env.get(name));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
}
export const PREVIEW_CACHE_MAX = envInt('PREVIEW_CACHE_MAX', 64);
export const PREVIEW_CACHE_TTL_MS = envInt('PREVIEW_CACHE_TTL_MS', 5 * 60_000);

/** Small bounded LRU with a TTL safety valve. Insertion-order Map = recency
 *  order; a get refreshes recency; over capacity evicts the oldest. `nowMs` is
 *  injectable so TTL/eviction are deterministically testable. */
export class PreviewCache {
  private map = new Map<string, { entry: PreviewCacheEntry; at: number }>();
  constructor(private max = PREVIEW_CACHE_MAX, private ttlMs = PREVIEW_CACHE_TTL_MS) {}

  get(key: string, nowMs: number = Date.now()): PreviewCacheEntry | null {
    const hit = this.map.get(key);
    if (!hit) return null;
    if (nowMs - hit.at >= this.ttlMs) { this.map.delete(key); return null; } // expired
    this.map.delete(key); this.map.set(key, hit); // refresh recency (LRU)
    return hit.entry;
  }

  set(key: string, entry: PreviewCacheEntry, nowMs: number = Date.now()): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { entry, at: nowMs });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  /** Drop every entry for a site (defensive invalidation hook). */
  invalidateSite(siteId: string): void {
    for (const k of [...this.map.keys()]) if (k.startsWith(`${siteId}:`)) this.map.delete(k);
  }

  get size(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
}

/** The process-wide preview render cache. */
export const previewCache = new PreviewCache();
