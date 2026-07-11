// ── /snapshot-history (CMS-UX-8) — Snapshot History ──────────────────────────
// "What versions of my website exist?" — a customer-friendly history of saved
// website versions, projected from the EXISTING publish/version history. No new
// snapshot system, no forked restore/preview logic:
//   • publishHistoryRows (routes/publish.ts) — the SAME rows GET /publishes uses
//     (customer-facing summary fallback + version label + restorable flag)
//   • buildSnapshotHistory re-frames them as Current / Previous / Restored
//   • preview & restore link to the existing editor version-history surface
import { json } from '../../_shared/http.ts';
import type { SiteRow } from '../lib/site.ts';
import { publishHistoryRows } from './publish.ts';
import { buildSnapshotHistory } from '../lib/snapshot_history.ts';

export async function handleSnapshotHistory(site: SiteRow, cors: Record<string, string>) {
  const now = new Date().toISOString();
  const rows = await publishHistoryRows(site);
  const versions = rows.map((r) => ({
    kind: r.kind, status: r.status, summary: r.summary, label: r.label,
    at: r.at, completed_at: r.completed_at, restorable: r.restorable,
  }));
  return json({ data: buildSnapshotHistory({ now, versions }) }, 200, cors);
}
