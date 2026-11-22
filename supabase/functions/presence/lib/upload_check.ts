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
import { BUCKET } from './media.ts';
import { isStudioFileMime, studioCap, studioSizeWords, STUDIO_TYPE_WORDS, checkStudioBytes, bytesNeeded } from './client_files.ts';

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

