// ── Snapshot retention & GC (Presence CMS Phase 1, M7) ────────────────────────
// The CANONICAL retention algorithm. presence_snapshots is immutable + write-once
// and accrues a tail (mostly the safety snapshots draft_writer takes before every
// restore). This bounds that growth WITHOUT ever dropping a snapshot needed for
// recovery, publishing, or history.
//
// The decision is a PURE function (classifySnapshots) — no DB writes inside it —
// so every retention rule is unit-testable. reapSnapshots gathers the inputs and
// applies the decision. It errs toward RETENTION at every ambiguous point.
//
// A snapshot is KEPT when it is any of:
//   • the current live snapshot (latest live publish)
//   • among the most-recent N per site (recency floor; default 20 — covers the
//     working draft's safety snapshots + recent published versions)
//   • referenced by publish/rollback history (presence_publishes.snapshot_id)
//   • referenced by a scheduled publish (presence_scheduled_publishes.snapshot_id)
//   • referenced by a launch (presence_launches.snapshot_id / prev_snapshot_id)
//   • referenced by a preview share (presence_site_preview.snapshot_id)
//   • carrying an unparseable/absent created_at (can't classify → keep)
// Everything else — an OLD, wholly-unreferenced safety snapshot — is deletable.
//
// Defense in depth: the launch + preview FKs are RESTRICT and would refuse a
// referenced-snapshot delete even if the selector erred; publishes is set-null;
// scheduled has no FK and is protected solely here.

import { svc } from './db.ts';

export const DEFAULT_SNAPSHOT_KEEP = 20;
export function snapshotKeepRecent(): number {
  const n = Number(Deno.env.get('SNAPSHOT_KEEP_RECENT'));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_SNAPSHOT_KEEP;
}

export interface SnapshotRow { id: string; site_id: string; created_at: string; }
export interface RetentionContext { liveIds: Set<string>; referencedIds: Set<string>; keepRecent: number; }
export interface RetentionDecision { keep: string[]; deletable: string[]; }

const stamp = (r: SnapshotRow): number => { const v = Date.parse(r.created_at); return Number.isFinite(v) ? v : -Infinity; };

/** PURE canonical retention decision. Accepts snapshots (may span sites — the
 *  recency floor is computed PER SITE) + the protected id sets. Returns which
 *  ids to keep vs. delete. Never reads or writes the DB. */
export function classifySnapshots(snapshots: SnapshotRow[], ctx: RetentionContext): RetentionDecision {
  const bySite = new Map<string, SnapshotRow[]>();
  for (const s of snapshots) {
    const arr = bySite.get(s.site_id); if (arr) arr.push(s); else bySite.set(s.site_id, [s]);
  }
  const keep: string[] = [];
  const deletable: string[] = [];
  for (const rows of bySite.values()) {
    // recency floor: the most-recent keepRecent by created_at (unparseable sink to
    // the bottom so they never steal a recent slot — they're kept anyway below).
    const recent = new Set([...rows].sort((a, b) => stamp(b) - stamp(a)).slice(0, Math.max(0, ctx.keepRecent)).map((r) => r.id));
    for (const r of rows) {
      const classifiable = Number.isFinite(Date.parse(r.created_at));
      if (!classifiable || ctx.liveIds.has(r.id) || ctx.referencedIds.has(r.id) || recent.has(r.id)) keep.push(r.id);
      else deletable.push(r.id);
    }
  }
  return { keep, deletable };
}

export interface SnapshotGcResult {
  ok: true; run_type: 'snapshot_gc';
  sites_scanned: number; considered: number; kept: number; deleted: number;
}

const DELETE_CHUNK = 100;      // ids per DELETE request
const MAX_SITES_PER_TICK = 25; // bound a single cron tick
const MAX_SNAPSHOTS_PER_SITE = 5000;

/** One bounded GC pass. Surfaces sites with OLD snapshots (recent ones are always
 *  kept), and for each runs the canonical selector over that site's full snapshot
 *  list + gathered references. Per-site isolated; oldest-first; converges across
 *  cron ticks. */
export async function reapSnapshots(limit = 200): Promise<SnapshotGcResult> {
  const keepRecent = snapshotKeepRecent();
  const lim = Math.max(1, Math.min(1000, limit));
  const res: SnapshotGcResult = { ok: true, run_type: 'snapshot_gc', sites_scanned: 0, considered: 0, kept: 0, deleted: 0 };

  // Deletion candidates only ever come from the OLDEST snapshots → use them to
  // surface which sites are worth examining this tick.
  const oldest = await svc(`presence_snapshots?select=site_id&order=created_at.asc&limit=${lim}`);
  const oldestRows: Array<{ site_id: string }> = Array.isArray(oldest.json) ? oldest.json : [];
  const sites: string[] = [];
  for (const r of oldestRows) { if (!sites.includes(r.site_id)) sites.push(r.site_id); if (sites.length >= MAX_SITES_PER_TICK) break; }
  res.sites_scanned = sites.length;

  for (const siteId of sites) {
    try {
      const [pubs, sched, launch, preview, snaps] = await Promise.all([
        svc(`presence_publishes?site_id=eq.${siteId}&snapshot_id=not.is.null&select=snapshot_id,status`),
        svc(`presence_scheduled_publishes?site_id=eq.${siteId}&snapshot_id=not.is.null&select=snapshot_id`),
        svc(`presence_launches?site_id=eq.${siteId}&select=snapshot_id,prev_snapshot_id`),
        svc(`presence_site_preview?site_id=eq.${siteId}&snapshot_id=not.is.null&select=snapshot_id`),
        svc(`presence_snapshots?site_id=eq.${siteId}&select=id,site_id,created_at&order=created_at.desc&limit=${MAX_SNAPSHOTS_PER_SITE}`),
      ]);
      const arr = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];

      const liveIds = new Set<string>(arr(pubs).filter((p) => p.status === 'live').map((p) => String(p.snapshot_id)));
      const referencedIds = new Set<string>();
      for (const p of arr(pubs)) if (p.snapshot_id) referencedIds.add(String(p.snapshot_id));          // all publish/rollback history
      for (const s of arr(sched)) if (s.snapshot_id) referencedIds.add(String(s.snapshot_id));         // scheduled publishes
      for (const l of arr(launch)) { if (l.snapshot_id) referencedIds.add(String(l.snapshot_id)); if (l.prev_snapshot_id) referencedIds.add(String(l.prev_snapshot_id)); } // launches + rollback targets
      for (const v of arr(preview)) if (v.snapshot_id) referencedIds.add(String(v.snapshot_id));       // preview share

      const rows = arr(snaps) as SnapshotRow[];
      res.considered += rows.length;
      const { keep, deletable } = classifySnapshots(rows, { liveIds, referencedIds, keepRecent });
      res.kept += keep.length;

      for (let i = 0; i < deletable.length; i += DELETE_CHUNK) {
        const chunk = deletable.slice(i, i + DELETE_CHUNK);
        // site-scoped DELETE (tenant guard); id-list bounded per request
        const del = await svc(`presence_snapshots?site_id=eq.${siteId}&id=in.(${chunk.join(',')})`, { method: 'DELETE' });
        if (del.ok) res.deleted += chunk.length;
      }
    } catch { /* per-site isolated: one site's failure never stops the rest */ }
  }

  return res;
}
