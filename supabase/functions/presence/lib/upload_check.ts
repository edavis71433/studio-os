// ── The stored bytes, checked before a file is recorded (builder item 337) ───
// The upload-url step validates only what the page DECLARED (mime and size); the
// bytes then travel browser → storage directly, so nothing yet proves the stored
// object is what was declared. Before a client's file or a studio's deliverable is
// recorded, read the object back through the storage API (service role): its
// metadata (type, size) and its first bytes (all of them for a text kind), and
// decide the kind from the bytes (lib/client_files.ts), never from the name. A
// mismatch is a clean refusal in plain words plus a best-effort clean-up (object
// and media row: nothing orphaned, nothing recorded). Anything short of a positive
// read (storage unreachable, a non-2xx, missing headers) FAILS OPEN, as the HEAD
// check always did: this must never break an honest upload.
import { svc } from './db.ts';
import { BUCKET, SITE_DOOR, IMAGE_MIME } from './media.ts';
import { isStudioFileMime, studioCap, studioSizeWords, STUDIO_TYPE_WORDS, STUDIO_KINDS, STUDIO_MISMATCH_WORDS, checkStudioBytes, bytesNeeded, byteFamilies } from './client_files.ts';
import { fewAtATime } from './few_at_a_time.ts';

const storageEnv = () => ({
  url: (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, ''),
  key: Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
});
type Fetch = typeof fetch;

/** The stored object against what was declared: type, size, then the bytes themselves. */
export async function verifyStoredUpload(storagePath: string, declaredMime: string, fetchImpl: Fetch = fetch): Promise<{ ok: true } | { ok: false; message: string }> {
  const { url, key } = storageEnv();
  if (!url || !key || !storagePath) return { ok: true };   // nothing to check against — fail open
  const objectPath = storagePath.replace(`${BUCKET}/`, '');
  const headers = { Authorization: `Bearer ${key}`, apikey: key };
  let res: Response;
  try {
    res = await fetchImpl(`${url}/storage/v1/object/authenticated/${BUCKET}/${objectPath}`, { method: 'HEAD', headers });
  } catch { return { ok: true }; }                          // storage unreachable — fail open
  if (!res.ok) return { ok: true };                         // no metadata (404 / older storage builds / HEAD quirks) — fail open
  try { await res.body?.cancel(); } catch { /* HEAD carries no body */ }
  // the declared kind must be one the studio door takes at all
  if (!isStudioFileMime(declaredMime)) return { ok: false, message: `That kind of file can’t be sent here. ${STUDIO_TYPE_WORDS}` };
  // the stored content-type must be the declared one: it is what storage will serve the
  // file back as. An absent or generic octet-stream type carries no information — skipped.
  const ctype = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (ctype && ctype !== 'application/octet-stream' && ctype !== declaredMime) {
    return { ok: false, message: 'That file isn’t what its name says it is, so it wasn’t kept. Open it on your computer to check it, then try again.' };
  }
  // the size storage counted, against the declared kind's cap
  const size = Number(res.headers.get('content-length'));
  if (Number.isFinite(size) && size > 0 && size > studioCap(declaredMime)) {
    return { ok: false, message: `That file is too big. ${studioSizeWords(declaredMime)}` };
  }
  // the bytes: the first 64KB say what a binary kind is; a text kind is read whole
  const need = bytesNeeded(declaredMime);
  let got: Response;
  try {
    got = await fetchImpl(`${url}/storage/v1/object/authenticated/${BUCKET}/${objectPath}`, { method: 'GET', headers: need === 'all' ? headers : { ...headers, Range: `bytes=0-${need - 1}` } });
  } catch { return { ok: true }; }                          // storage unreachable — fail open
  if (got.status !== 200 && got.status !== 206) { try { await got.body?.cancel(); } catch { /* nothing */ } return { ok: true }; }
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await got.arrayBuffer()); } catch { return { ok: true }; }
  if (need !== 'all' && bytes.byteLength > need) bytes = bytes.subarray(0, need);   // a store that ignores Range answers it all
  // nothing came back: an empty object is refused; a store whose HEAD counted bytes it then
  // didn't send is no positive read, so that fails open like the rest
  if (!bytes.byteLength) return Number.isFinite(size) && size > 0 ? { ok: true } : { ok: false, message: 'That file is empty, so it wasn’t kept.' };
  return checkStudioBytes(bytes, declaredMime);
}

/** Best-effort: the object first (frees the real bytes), then the row. */
export async function discardRejectedUpload(siteId: string, mediaId: string, storagePath: string, fetchImpl: Fetch = fetch): Promise<void> {
  try {
    const { url, key } = storageEnv();
    if (url && key && storagePath) {
      const objectPath = storagePath.replace(`${BUCKET}/`, '');
      await fetchImpl(`${url}/storage/v1/object/${BUCKET}/${objectPath}`, { method: 'DELETE', headers: { Authorization: `Bearer ${key}`, apikey: key } });
    }
  } catch { /* best-effort */ }
  await svc(`presence_media?id=eq.${mediaId}&site_id=eq.${siteId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ deleted_at: new Date().toISOString() }) }).catch(() => {});
}


// ── Builder item 395: every upload, checked after it arrives ─────────────────
// The portal and a project's deliverables read the stored file back before recording it
// (above). The media library (the editor, Files, the photo editor's saves, the studio's
// logo) didn't: its upload goes from the browser straight to storage on a signed link, and
// the row keeps what the page claimed. Now the 15-minute scheduled run (runUploadChecks,
// routes/system.ts) reads each new upload back within the 48 hours a never-finished upload
// is kept (lib/media_gc.ts), newest first:
//   - the size storage counted replaces the claimed one, so the site's storage total
//     counts what is really kept;
//   - a file larger than it said, of a kind other than its claim (judged by its first
//     bytes, never its name, and by the type storage will serve it as), or over the most
//     any door takes for its kind is refused: taken out of Files, its bytes deleted, and
//     the site told (an `upload_refused` notice);
//   - a photo whose bytes are another of the three website photo kinds (a PNG named .jpg,
//     common and harmless: the pictures are re-made at publish) is kept;
//   - a file not uploaded yet, or a storage that doesn't answer, is looked at again next
//     time: as above, nothing short of a positive read refuses a file.
// Form files and the content form's files never take this road: the server holds their
// bytes and checks them before they are stored (lib/form_files.ts, routes/intake_public.ts).
export const UPLOAD_CHECK_WINDOW_MS = 48 * 3600_000;
export const UPLOAD_CHECKS_PER_RUN = 40;

export type StoredVerdict =
  | { kind: 'ok'; size: number | null }
  | { kind: 'refuse'; message: string }
  | { kind: 'missing' }
  | { kind: 'unknown' };

/** The most any upload door takes for this kind: the website's door or the studio's. Pure. */
export function largestCap(mime: string): number {
  return Math.max(SITE_DOOR.takes(mime) ? SITE_DOOR.cap(mime) : 0, studioCap(mime));
}

/** The verdict from what storage said about a stored file. Pure. */
export function judgeStored(i: { declaredMime: string; declaredBytes: number; storedType: string | null; storedSize: number | null; bytes: Uint8Array | null }): StoredVerdict {
  const mime = String(i.declaredMime || '').toLowerCase();
  if (!SITE_DOOR.takes(mime) && !STUDIO_KINDS[mime]) return { kind: 'refuse', message: 'It was a kind of file Studio OS doesn’t keep.' };
  const ctype = String(i.storedType || '').split(';')[0].trim().toLowerCase();
  if (ctype && ctype !== 'application/octet-stream' && ctype !== mime) return { kind: 'refuse', message: MISMATCH };
  const size = i.storedSize;
  if (size !== null && Number.isFinite(size)) {
    if (size > largestCap(mime)) return { kind: 'refuse', message: 'It was larger than any file of its kind can be.' };
    if (i.declaredBytes > 0 && size > i.declaredBytes) return { kind: 'refuse', message: 'It was larger than it said it was.' };
  }
  const b = i.bytes;
  if (!b || !b.byteLength) return size !== null && size > 0 ? { kind: 'unknown' } : { kind: 'refuse', message: 'It was empty.' };
  if (IMAGE_MIME.has(mime)) {
    // any of the three website photo kinds will do for a website photo
    return byteFamilies(b).some((f) => f === 'jpeg' || f === 'png' || f === 'webp') ? { kind: 'ok', size } : { kind: 'refuse', message: MISMATCH };
  }
  const v = checkStudioBytes(b, mime);
  return v.ok ? { kind: 'ok', size } : { kind: 'refuse', message: v.message === STUDIO_MISMATCH_WORDS ? MISMATCH : 'It was a drawing with a script or a link in it.' };
}
const MISMATCH = 'It wasn’t the kind of file its name says.';

/** Read a stored file back: its type and size, then its first bytes (all of them for a text kind). */
export async function inspectStoredFile(storagePath: string, declaredMime: string, declaredBytes: number, fetchImpl: Fetch = fetch): Promise<StoredVerdict> {
  const { url, key } = storageEnv();
  if (!url || !key || !storagePath) return { kind: 'unknown' };
  const objectPath = storagePath.replace(`${BUCKET}/`, '');
  const headers = { Authorization: `Bearer ${key}`, apikey: key };
  let head: Response;
  try { head = await fetchImpl(`${url}/storage/v1/object/authenticated/${BUCKET}/${objectPath}`, { method: 'HEAD', headers }); } catch { return { kind: 'unknown' }; }
  try { await head.body?.cancel(); } catch { /* HEAD carries no body */ }
  if (head.status === 404 || head.status === 400) return { kind: 'missing' };   // not uploaded (yet): storage answers 400 "not found" on some builds
  if (!head.ok) return { kind: 'unknown' };
  const len = Number(head.headers.get('content-length'));
  const storedSize = Number.isFinite(len) && head.headers.has('content-length') ? len : null;
  const need = bytesNeeded(declaredMime);
  let got: Response;
  try { got = await fetchImpl(`${url}/storage/v1/object/authenticated/${BUCKET}/${objectPath}`, { method: 'GET', headers: need === 'all' ? headers : { ...headers, Range: `bytes=0-${need - 1}` } }); } catch { return { kind: 'unknown' }; }
  if (got.status !== 200 && got.status !== 206) { try { await got.body?.cancel(); } catch { /* nothing */ } return { kind: 'unknown' }; }
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await got.arrayBuffer()); } catch { return { kind: 'unknown' }; }
  if (need !== 'all' && bytes.byteLength > need) bytes = bytes.subarray(0, need);
  return judgeStored({ declaredMime, declaredBytes, storedType: head.headers.get('content-type'), storedSize, bytes });
}

/** The notice a site gets when one of its files was refused. Pure. */
export function refusedWords(name: string, why: string): { headline: string; body: string } {
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'a file';
  return { headline: `A file was taken out of Files: ${n}`.slice(0, 200), body: `${why} So it wasn’t kept, and it no longer takes up the site’s storage. Open it on your computer to check it, then upload it again.` };
}

/** The outside calls; tests swap them. */
export const uploadCheckDeps = { fetch: (input: string, init?: RequestInit) => fetch(input, init), now: () => Date.now() };

/** The 15-minute run's chore. Counts only: a refused file is the check working, not the run failing. */
export async function runUploadChecks(limit = UPLOAD_CHECKS_PER_RUN): Promise<Record<string, unknown>> {
  const now = uploadCheckDeps.now();
  const since = new Date(now - UPLOAD_CHECK_WINDOW_MS).toISOString();
  const r = await svc(`presence_media?checked_at=is.null&deleted_at=is.null&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=${Math.max(1, Math.min(100, limit))}&select=id,site_id,storage_path,mime,bytes,alt_text,created_at`).catch(() => null);
  if (!r || !r.ok || !Array.isArray(r.json)) return r && r.status === 400 ? { skipped_not_ready: true } : { ok: false };   // 400: before migration 0269 (no checked_at)
  const list = r.json as Array<{ id: string; site_id: string; storage_path: string; mime: string; bytes: number; alt_text: string }>;
  let checked = 0, refused = 0, waiting = 0;
  const f = uploadCheckDeps.fetch as unknown as Fetch;
  await fewAtATime(list, 4, async (m) => {
    const v = await inspectStoredFile(String(m.storage_path || ''), String(m.mime || ''), Number(m.bytes) || 0, f).catch(() => ({ kind: 'unknown' }) as StoredVerdict);
    const at = new Date(uploadCheckDeps.now()).toISOString();
    if (v.kind === 'missing' || v.kind === 'unknown') { waiting++; return; }
    if (v.kind === 'ok') {
      await svc(`presence_media?id=eq.${m.id}&site_id=eq.${m.site_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ checked_at: at, ...(v.size !== null && v.size > 0 ? { bytes: v.size } : {}) }) }).catch(() => {});
      checked++; return;
    }
    await discardRejectedUpload(m.site_id, m.id, String(m.storage_path || ''), f);
    await svc(`presence_media?id=eq.${m.id}&site_id=eq.${m.site_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ checked_at: at }) }).catch(() => {});
    refused++;
    try {
      const s = await svc(`presence_sites?id=eq.${m.site_id}&select=id,client_id&limit=1`);
      const clientId = s.ok && Array.isArray(s.json) ? s.json[0]?.client_id : null;
      if (clientId) {
        const { raiseNotice } = await import('./notice.ts');
        const w = refusedWords(String(m.alt_text || ''), v.message);
        await raiseNotice({ siteId: m.site_id, clientId: String(clientId), kind: 'upload_refused', period: `media:${m.id}`, headline: w.headline, body: w.body });
      }
    } catch { /* the file is still out; only the notice is lost */ }
  });
  return { read: list.length, checked, refused, waiting };
}
