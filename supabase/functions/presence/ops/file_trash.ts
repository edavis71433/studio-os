// ── The Trash for files, emptied (builder list item 218, Nov 12 review) ──────
// Once a file has been in a site's Trash for 30 days (lib/media_trash.ts), the hygiene sweep
// deletes it for good, oldest first: the stored file, then its row. Two kinds of file are
// not deleted, so no site breaks:
//   · one the live site still shows waits in the Trash until a publish takes it off, so
//     Back online and Publish again still find it;
//   · one the draft uses again (a restored version or an undo brought it back) comes out of
//     the Trash instead.
// A site whose uses can't all be read is left as it is, and the next run asks again.
import { svc } from '../lib/db.ts';
import { FILE_TRASH_DAYS, deleteFromTrash, putBackUsed } from '../lib/media_trash.ts';

type Due = { id: string; site_id: string; storage_path: string | null; trashed_at: string };
const rowsOf = <T,>(r: { ok?: boolean; json?: unknown }): T[] => (r.ok !== false && Array.isArray(r.json) ? r.json as T[] : []);

/** Delete for good up to `limit` files that have been in a Trash for 30 days. */
export async function runFileTrashPurge(limit = 100): Promise<{ due: number; deleted: number; kept_live: number; put_back: number; failed: number; skipped_unavailable?: true }> {
  const cutoff = new Date(Date.now() - FILE_TRASH_DAYS * 86_400_000).toISOString();
  const q = await svc(`presence_media?trashed_at=lte.${encodeURIComponent(cutoff)}&select=id,site_id,storage_path,trashed_at&order=trashed_at.asc&limit=${Math.max(1, Math.min(200, limit))}`);
  if (!q.ok) return { due: 0, deleted: 0, kept_live: 0, put_back: 0, failed: 0, skipped_unavailable: true };   // before migration 0225: no Trash yet
  const due = rowsOf<Due>(q);
  if (!due.length) return { due: 0, deleted: 0, kept_live: 0, put_back: 0, failed: 0 };
  // the Files routes' own reads of what a site uses, loaded only when something is due
  const { liveMediaIds, draftUses } = await import('../routes/assets.ts');
  const bySite = new Map<string, Due[]>();
  for (const d of due) bySite.set(d.site_id, [...(bySite.get(d.site_id) || []), d]);
  let deleted = 0, kept_live = 0, put_back = 0, failed = 0;
  for (const [siteId, files] of bySite) {
    try {
      const [live, uses] = await Promise.all([liveMediaIds({ id: siteId }), draftUses({ id: siteId })]);
      if (!uses.complete) { failed++; continue; }   // a use we couldn't see may be one of these: keep them all for now
      const again = files.filter((f) => uses.ids.has(f.id.toLowerCase()));
      if (again.length) put_back += (await putBackUsed(siteId, again.map((f) => f.id), null, 'the draft uses it again')).length;
      for (const f of files) {
        if (again.includes(f)) continue;
        if (live.has(f.id)) { kept_live++; continue; }
        if (await deleteFromTrash(siteId, f)) {
          deleted++;
          console.log(JSON.stringify({ evt: 'file_trash_deleted', site_id: siteId, media_id: f.id, trashed_at: f.trashed_at }));
        } else failed++;
      }
    } catch (e) {
      failed++;
      console.error('file trash purge failed:', siteId, (e as Error)?.message);
    }
  }
  return { due: due.length, deleted, kept_live, put_back, failed };
}
