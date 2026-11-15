// ── The Trash for files (builder list item 218, Nov 12 review, file 01, finding 8) ──
// Delete in Files (and the editor's photo list) used to remove the stored file at once:
// "Delete this file permanently? This cannot be undone." Squarespace keeps a Trash. Now a
// deleted file is moved to the Trash: its row leaves every list, the photo picker and the
// site's space (deleted_at, which every read already filters on), `trashed_at` says it is
// in the Trash rather than replaced or cleaned up, and the stored file stays. For
// FILE_TRASH_DAYS it can be put back; then the hygiene sweep deletes it for good
// (ops/file_trash.ts), or Delete for good does it sooner.
//
// What a published page that uses a file in the Trash does (decided Nov 15):
//   · A page that's already live keeps showing it until the site is next published. The
//     live site carries its own copy of every photo (lib/media.ts), so moving a file to the
//     Trash never makes a hole in a live page; the next publish follows the draft, which
//     can't be using it (a file in use can't be moved to the Trash).
//   · While the live site still shows it, it isn't deleted for good: Delete for good says
//     to publish first, and the sweep keeps it past its 30 days. So Back online and Publish
//     again, which send the live version up once more, still find every photo.
//   · A version that uses a file in the Trash brings it back: restoring a version (live or
//     to the draft) or publishing a draft that names one takes it out of the Trash first
//     (putBackUsed), so nothing goes up with a gap.
// Pure helpers first; the reads and writes after.
import { svc } from './db.ts';
import { goesAt, daysLeft } from './site_trash.ts';
import { writeChangeEvent } from './provenance.ts';
import type { Principal } from '../../_shared/auth.ts';

export const FILE_TRASH_DAYS = 30;
const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SB_SERVICE = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const BUCKET = 'presence-media';
const ID_RE = /^[0-9a-f-]{36}$/;
const IDS_PER_READ = 100;   // the serializer's own chunk (an in.() list stays inside the request-line limit)

/** When a file put in the Trash at `trashedAt` goes for good. Null for no date. Pure. */
export function trashGoesAt(trashedAt: string | null | undefined): string | null { return goesAt(trashedAt, FILE_TRASH_DAYS); }
/** Whole days before it goes, never below 0. Pure. */
export function trashDaysLeft(nowIso: string, trashedAt: string | null | undefined): number | null { return daysLeft(nowIso, trashedAt, FILE_TRASH_DAYS); }
/** Past its 30 days? Pure. */
export function trashDue(nowIso: string, trashedAt: string | null | undefined): boolean {
  const end = trashGoesAt(trashedAt);
  return !!end && Date.parse(end) <= Date.parse(nowIso);
}

/** The row's change when a file goes in the Trash: out of every list (deleted_at), marked
 *  as in the Trash, with who did it kept beside its other notes. Pure. */
export function trashPatch(nowIso: string, by: string, metadata: Record<string, unknown> | null | undefined) {
  return { deleted_at: nowIso, trashed_at: nowIso, metadata: { ...(metadata || {}), trashed_by: by.slice(0, 80) } };
}
/** ...and when it comes back. The note of who put it in the Trash goes with it. Pure. */
export function putBackPatch(metadata: Record<string, unknown> | null | undefined) {
  const { trashed_by: _gone, ...rest } = (metadata || {}) as Record<string, unknown>;
  return { deleted_at: null, trashed_at: null, metadata: rest };
}

/** Who to name for a move to the Trash: the person's name, else the first part of their
 *  email, capitalised, else "Someone". Pure. */
export function trashedBy(p: Pick<Principal, 'email'> & { name?: string | null }): string {
  const name = String(p.name || '').trim();
  if (name) return name;
  const first = String(p.email || '').trim().split('@')[0].split(/[._+-]/)[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : 'Someone';
}

/** One file as the Trash lists it. `live`: the live site still shows it. Pure. */
export function trashRow(a: { id: string; mime?: string | null; bytes?: number | null; collection?: string | null; trashed_at?: string | null; metadata?: Record<string, unknown> | null }, nowIso: string, live: boolean) {
  const left = trashDaysLeft(nowIso, a.trashed_at);
  return {
    id: a.id,
    kind: String(a.mime || '').startsWith('image/') ? 'image' : 'document',
    bytes: Number(a.bytes) || 0,
    folder: a.collection || '',
    trashed_at: a.trashed_at || null,
    goes_at: trashGoesAt(a.trashed_at),
    days_left: left,
    by: typeof a.metadata?.trashed_by === 'string' ? a.metadata.trashed_by : null,
    live,
    // past its days but still on the live site: kept, not deleted, until a publish takes it off
    kept_live: live && left === 0,
  };
}

/** Would putting `bytes` back break the site's limits? The same two the upload door
 *  refuses on: the file cap and the storage quota. Null when it fits or when the usage
 *  couldn't be read (as the upload door does). Pure. */
export function putBackRefusal(usage: { files: number; bytes: number } | null, bytes: number, limits: { maxFiles: number; maxBytes: number }): 'files' | 'space' | null {
  if (!usage) return null;
  if (usage.files + 1 > limits.maxFiles) return 'files';
  if (usage.bytes + (Number(bytes) || 0) > limits.maxBytes) return 'space';
  return null;
}

const rowsOf = <T,>(r: { ok?: boolean; json?: unknown }): T[] => (r.ok !== false && Array.isArray(r.json) ? r.json as T[] : []);
const chunks = (ids: string[]) => { const out: string[][] = []; for (let i = 0; i < ids.length; i += IDS_PER_READ) out.push(ids.slice(i, i + IDS_PER_READ)); return out; };
const SWEEPER: Principal = { kind: 'system', userId: null, tenantId: null, role: null, email: null, jwt: null, requestId: 'file-trash' };

/** The ids among `ids` that are this site's files in the Trash. A read that fails counts
 *  as none (nothing is put back on a guess). */
export async function trashedAmong(siteId: string, ids: string[]): Promise<string[]> {
  const clean = [...new Set(ids.map((x) => String(x || '').toLowerCase()).filter((x) => ID_RE.test(x)))];
  if (!clean.length) return [];
  const read = await Promise.all(chunks(clean).map((p) => svc(`presence_media?site_id=eq.${siteId}&trashed_at=not.is.null&id=in.(${p.join(',')})&select=id`).catch(() => ({ ok: false, json: null }))));
  return read.flatMap((r) => rowsOf<{ id: string }>(r).map((x) => x.id));
}

/** Every file of this site in the Trash, newest first (a few hundred at most in practice). */
export async function trashedOf(siteId: string): Promise<string[]> {
  const r = await svc(`presence_media?site_id=eq.${siteId}&trashed_at=not.is.null&select=id&order=trashed_at.desc&limit=1000`).catch(() => ({ ok: false, json: null }));
  return rowsOf<{ id: string }>(r).map((x) => x.id);
}

/** Take these files out of the Trash, each only while it is still in it. Returns the ids
 *  that came back. */
export async function putBack(siteId: string, ids: string[]): Promise<string[]> {
  const back: string[] = [];
  for (const id of ids) {
    if (!ID_RE.test(String(id))) continue;
    const cur = rowsOf<{ metadata?: Record<string, unknown> | null }>(await svc(`presence_media?id=eq.${id}&site_id=eq.${siteId}&trashed_at=not.is.null&select=metadata&limit=1`).catch(() => ({ ok: false, json: null })))[0];
    if (!cur) continue;
    const r = await svc(`presence_media?id=eq.${id}&site_id=eq.${siteId}&trashed_at=not.is.null`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(putBackPatch(cur.metadata)) }).catch(() => ({ ok: false, json: null }));
    if (rowsOf(r).length) back.push(id);
  }
  return back;
}

/** A version or a draft that names files in the Trash takes them out of it first, so the
 *  page never goes up with a gap. Says so in the site's history. Never throws. */
export async function putBackUsed(siteId: string, ids: string[], principal: Principal | null, why: string): Promise<string[]> {
  try {
    const inTrash = await trashedAmong(siteId, ids);
    if (!inTrash.length) return [];
    const back = await putBack(siteId, inTrash);
    for (const id of back) await writeChangeEvent({ siteId, entityType: 'media', entityId: id, action: 'restore', summary: `Put a file back from the Trash: ${why}`, principal: principal || SWEEPER, provenance: 'human' }).catch(() => false);
    return back;
  } catch { return []; }
}

/** Publish (item 218): before the draft is read for publishing, any file in the Trash that
 *  the draft names comes out of the Trash, so the publish carries it. One small read when
 *  the site has nothing in the Trash, which is nearly always. Never throws. */
export async function putBackWhatTheDraftUses(siteId: string, principal: Principal | null): Promise<string[]> {
  try {
    const inTrash = await trashedOf(siteId);
    if (!inTrash.length) return [];
    const { readDraftRows, mediaIdsIn } = await import('./serializer.ts');
    const named = new Set(mediaIdsIn(await readDraftRows(siteId), siteId));
    const used = inTrash.filter((id) => named.has(id.toLowerCase()));
    return used.length ? await putBackUsed(siteId, used, principal, 'the draft being published uses it') : [];
  } catch { return []; }
}

/** Remove the stored file. True when it's gone (already gone counts); false when the store
 *  couldn't say, so the row is kept and the next run tries again. */
export async function deleteStoredFile(storagePath: string): Promise<boolean> {
  if (!storagePath) return true;
  try {
    const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${storagePath.replace(`${BUCKET}/`, '')}`, { method: 'DELETE', headers: { Authorization: `Bearer ${SB_SERVICE}`, apikey: SB_SERVICE } });
    await r.body?.cancel();
    return r.ok || r.status === 404 || r.status === 400;   // storage answers 400 for a key it doesn't have
  } catch { return false; }
}

/** Delete one file in the Trash for good: the stored file, then the row (only while it is
 *  still in the Trash, so a Put back at the same moment wins). */
export async function deleteFromTrash(siteId: string, row: { id: string; storage_path?: string | null }): Promise<boolean> {
  if (!(await deleteStoredFile(String(row.storage_path || '')))) return false;
  const r = await svc(`presence_media?id=eq.${row.id}&site_id=eq.${siteId}&trashed_at=not.is.null`, { method: 'DELETE' }).catch(() => ({ ok: false }));
  return r.ok !== false;
}
