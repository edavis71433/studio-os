// ── Media garbage collection (Presence CMS Phase 1, M6) ───────────────────────
// Deterministic, bounded cleanup of media the site no longer needs. TWO safe
// classes only — no destructive heuristics:
//
//  1. Soft-deleted rows past a retention window. These already passed
//     deleteMedia's reference check when the user removed them, and live sites
//     ship BAKED variants inside the Netlify deploy (they never read storage),
//     so removing the stored original can't break a published site.
//  2. Orphaned never-uploaded rows: createUpload issued a row + signed URL but
//     the object was never PUT (client abandoned). A storage HEAD proves the
//     object is absent (404) — a row pointing at nothing, safe to drop.
//
// Referenced media (deleted_at IS NULL with a real object) is NEVER a candidate
// in either class. Reaping is idempotent, per-row isolated, and bounded per tick.

import { svc } from './db.ts';
import { BUCKET } from './media.ts';

const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SB_SERVICE = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

export const DEFAULT_GC_RETENTION_MS = 7 * 24 * 60 * 60_000; // soft-deleted grace: 7 days (undo window)
export const DEFAULT_GC_ORPHAN_MS = 48 * 60 * 60_000;        // never-uploaded grace: 48h
export function gcRetentionMs(): number { const n = Number(Deno.env.get('MEDIA_GC_RETENTION_MS')); return Number.isFinite(n) && n > 0 ? n : DEFAULT_GC_RETENTION_MS; }
export function gcOrphanMs(): number { const n = Number(Deno.env.get('MEDIA_GC_ORPHAN_MS')); return Number.isFinite(n) && n > 0 ? n : DEFAULT_GC_ORPHAN_MS; }

/** Pure eligibility: is a timestamp older than `graceMs` before now? Absent/unparseable → not eligible (fail-safe: keep). */
export function agedPast(ts: string | null | undefined, nowMs: number, graceMs: number): boolean {
  if (!ts) return false;
  const t = Date.parse(ts);
  return Number.isFinite(t) && nowMs - t >= graceMs;
}

export interface MediaRow { id: string; site_id: string; storage_path: string; deleted_at: string | null; created_at: string; }

function objectPathOf(storagePath: string): string { return storagePath.replace(`${BUCKET}/`, ''); }

/** HEAD the object — true if it exists in storage, false on 404/any-non-2xx.
 *  Errs toward "exists" (return true) only on network error, so GC never reaps
 *  an orphan candidate it couldn't actually verify as absent. */
async function objectMissing(storagePath: string): Promise<boolean> {
  try {
    const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${objectPathOf(storagePath)}`, {
      method: 'HEAD', headers: { Authorization: `Bearer ${SB_SERVICE}`, apikey: SB_SERVICE },
    });
    return r.status === 404 || r.status === 400; // storage 400s on an absent key
  } catch { return false; } // couldn't verify → treat as present (do not reap)
}

async function deleteObject(storagePath: string): Promise<void> {
  await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${objectPathOf(storagePath)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${SB_SERVICE}`, apikey: SB_SERVICE },
  }).catch(() => {});
}

export interface MediaGcResult {
  ok: true; run_type: 'media_gc';
  soft_scanned: number; soft_reaped: number;
  orphan_scanned: number; orphan_reaped: number;
}

/** Run one bounded GC pass across BOTH classes. Global (all sites), oldest-first,
 *  per-row isolated (one failure never stops the rest). */
export async function reapMedia(limit = 100): Promise<MediaGcResult> {
  const now = Date.now();
  const lim = Math.max(1, Math.min(500, limit));
  const res: MediaGcResult = { ok: true, run_type: 'media_gc', soft_scanned: 0, soft_reaped: 0, orphan_scanned: 0, orphan_reaped: 0 };

  // ── Class 1: soft-deleted past the retention window ──
  const softBefore = new Date(now - gcRetentionMs()).toISOString();
  const soft = await svc(`presence_media?deleted_at=not.is.null&deleted_at=lte.${encodeURIComponent(softBefore)}&select=id,site_id,storage_path,deleted_at,created_at&order=deleted_at.asc&limit=${lim}`);
  const softRows: MediaRow[] = Array.isArray(soft.json) ? soft.json : [];
  res.soft_scanned = softRows.length;
  for (const m of softRows) {
    if (!agedPast(m.deleted_at, now, gcRetentionMs())) continue; // belt-and-suspenders vs the SQL filter
    try {
      if (m.storage_path) await deleteObject(m.storage_path); // best-effort (often already gone)
      const del = await svc(`presence_media?id=eq.${m.id}&deleted_at=not.is.null`, { method: 'DELETE' });
      if (del.ok) res.soft_reaped += 1;
    } catch { /* isolated: skip this row */ }
  }

  // ── Class 2: never-uploaded orphans (row present, object absent, aged out) ──
  const orphanBefore = new Date(now - gcOrphanMs()).toISOString();
  const cand = await svc(`presence_media?deleted_at=is.null&created_at=lte.${encodeURIComponent(orphanBefore)}&select=id,site_id,storage_path,deleted_at,created_at&order=created_at.asc&limit=${lim}`);
  const candRows: MediaRow[] = Array.isArray(cand.json) ? cand.json : [];
  for (const m of candRows) {
    if (!agedPast(m.created_at, now, gcOrphanMs())) continue;
    if (!(await objectMissing(m.storage_path))) continue; // object EXISTS → a real, uploaded asset → keep
    res.orphan_scanned += 1;
    try {
      // guard the DELETE with deleted_at IS NULL so we never race a concurrent soft-delete
      const del = await svc(`presence_media?id=eq.${m.id}&deleted_at=is.null`, { method: 'DELETE' });
      if (del.ok) res.orphan_reaped += 1;
    } catch { /* isolated */ }
  }

  return res;
}
