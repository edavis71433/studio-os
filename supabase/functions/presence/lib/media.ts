// ── Media pipeline ───────────────────────────────────────────────────────────
// Private bucket `presence-media`, function-issued signed upload URLs only,
// mime/size/count caps from the contract, alt required at row creation (DB
// CHECK backs it). Variants are produced by Supabase Storage image transform
// at PUBLISH time (EXIF/GPS stripped by transformation) and shipped inside the
// deploy — live sites never touch Supabase. Preview substitutes short-lived
// signed transform URLs into the rendered HTML (the one preview-specific
// wrapper the contract allows).
import { svc } from './db.ts';
import type { MediaManifestEntry } from './serializer.ts';

const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SB_SERVICE = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
export const BUCKET = 'presence-media';
// DAM-1 (Files): the ONE store now also holds documents. Images ride the transform
// pipeline; documents (PDF) are stored + versioned + served as signed downloads,
// never image-transformed or auto-embedded on the site.
export const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const DOC_MIME = new Set(['application/pdf']);
export const MIME_ALLOW = new Set([...IMAGE_MIME, ...DOC_MIME]);
export const MAX_BYTES = 10 * 1024 * 1024;            // images: 10MB
export const MAX_DOC_BYTES = 25 * 1024 * 1024;        // documents: 25MB
export const isImageMime = (m: string) => IMAGE_MIME.has(m);
export const isDocMime = (m: string) => DOC_MIME.has(m);

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

/** Issue a signed upload URL + create the media row in one call (G1 §8).
 *  Format-aware: images require alt text; documents require a name (stored in the
 *  same alt_text column, which satisfies the a11y CHECK and doubles as the title). */
export async function createUpload(siteId: string, req: { mime: string; bytes: number; alt_text: string; width?: number; height?: number }) {
  const isDoc = isDocMime(req.mime);
  if (!MIME_ALLOW.has(req.mime)) return { error: 'unsupported_type', message: 'Files must be an image (JPEG, PNG, WebP) or a PDF document.' };
  const cap = isDoc ? MAX_DOC_BYTES : MAX_BYTES;
  if (!req.bytes || req.bytes > cap) return { error: 'too_large', message: isDoc ? 'Documents must be under 25MB.' : 'Images must be under 10MB.' };
  if (!req.alt_text || req.alt_text.trim().length < 3) {
    return isDoc
      ? { error: 'name_required', message: 'Please give this document a name.' }
      : { error: 'alt_required', message: 'Please describe the image (alt text) — it helps customers and search engines.' };
  }

  const path = `${siteId}/${crypto.randomUUID()}.${EXT[req.mime]}`;
  const storagePath = `${BUCKET}/${path}`;

  // signed upload URL (storage API, service role)
  const r = await fetch(`${SB_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SB_SERVICE}`, apikey: SB_SERVICE, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.url) return { error: 'upload_url_failed', message: 'We couldn’t start that upload — please try again.' };

  const row = await svc('presence_media', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: siteId, storage_path: storagePath, alt_text: req.alt_text.trim(), mime: req.mime, bytes: req.bytes, width: req.width ?? null, height: req.height ?? null }),
  });
  if (!row.ok || !row.json?.[0]?.id) return { error: 'row_failed', message: 'We couldn’t register that upload — please try again.' };

  return { media_id: row.json[0].id, upload_url: `${SB_URL}/storage/v1${j.url}`, storage_path: storagePath };
}

/** Delete: refuse while referenced (names the blockers); soft-delete row + remove object. */
export async function deleteMedia(siteId: string, mediaId: string) {
  const [off, posts] = await Promise.all([
    svc(`presence_offerings?site_id=eq.${siteId}&media_id=eq.${mediaId}&deleted_at=is.null&select=name`),
    svc(`presence_posts?site_id=eq.${siteId}&hero_media_id=eq.${mediaId}&deleted_at=is.null&select=title`),
  ]);
  const refs = [
    ...(Array.isArray(off.json) ? off.json.map((o: any) => `menu item “${o.name}”`) : []),
    ...(Array.isArray(posts.json) ? posts.json.map((p: any) => `post “${p.title}”`) : []),
  ];
  if (refs.length) return { error: 'in_use', message: `That image is used by ${refs.join(' and ')} — remove it there first.` };

  const row = await svc(`presence_media?id=eq.${mediaId}&site_id=eq.${siteId}&select=storage_path`, {});
  const sp = row.json?.[0]?.storage_path as string | undefined;
  await svc(`presence_media?id=eq.${mediaId}&site_id=eq.${siteId}`, { method: 'PATCH', body: JSON.stringify({ deleted_at: new Date().toISOString() }) });
  if (sp) {
    const objectPath = sp.replace(`${BUCKET}/`, '');
    await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${objectPath}`, { method: 'DELETE', headers: { Authorization: `Bearer ${SB_SERVICE}`, apikey: SB_SERVICE } });
  }
  return { ok: true };
}

/** PUBLISH: fetch every required variant via the transform endpoint (EXIF
 *  stripped, resized, webp) and return bytes keyed by output path. */
export async function fetchVariants(manifest: MediaManifestEntry[]): Promise<{ files: Record<string, Uint8Array>; failed: string[] }> {
  const files: Record<string, Uint8Array> = {};
  const failed: string[] = [];
  await Promise.all(manifest.flatMap((m) => m.variants.map(async (v) => {
    const objectPath = m.storage_path.replace(`${BUCKET}/`, '');
    const url = `${SB_URL}/storage/v1/render/image/authenticated/${BUCKET}/${objectPath}?width=${v.width}&format=webp&quality=80`;
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${SB_SERVICE}`, apikey: SB_SERVICE } });
      if (!r.ok) { failed.push(`${m.storage_path} @${v.width}`); return; }
      files[v.output_path.replace(/^\//, '')] = new Uint8Array(await r.arrayBuffer());
    } catch { failed.push(`${m.storage_path} @${v.width}`); }
  })));
  return { files, failed };
}

/** DAM-1 (Files): a short-lived signed THUMBNAIL for one image (private bucket).
 *  Reused by the Files grid + detail. Documents have no image thumbnail → null. */
export async function signThumb(storagePath: string, mime: string, width = 320): Promise<string | null> {
  if (!isImageMime(mime)) return null;
  try {
    const objectPath = storagePath.replace(`${BUCKET}/`, '');
    // expiresIn MUST be in the body (the sign endpoint 400s on a query-string expiresIn)
    const r = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}/${objectPath}`, {
      method: 'POST', headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 3600, transform: { width, format: 'webp', quality: 72 } }),
    });
    const j = await r.json().catch(() => null);
    return j?.signedURL ? `${SB_URL}/storage/v1${j.signedURL}` : null;
  } catch { return null; }
}

/** DAM-1 (Files): a short-lived signed DOWNLOAD URL for the ORIGINAL object (no
 *  transform) — used for "Download" and for previewing documents. Optionally sets
 *  a friendly download filename. */
export async function signDownload(storagePath: string, filename?: string): Promise<string | null> {
  try {
    const objectPath = storagePath.replace(`${BUCKET}/`, '');
    // expiresIn MUST be in the body; the friendly download filename rides the signed URL.
    const r = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}/${objectPath}`, {
      method: 'POST', headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 600 }),
    });
    const j = await r.json().catch(() => null);
    if (!j?.signedURL) return null;
    let url = `${SB_URL}/storage/v1${j.signedURL}`;
    if (filename) url += (url.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(filename);
    return url;
  } catch { return null; }
}

/** DAM-1 (Files): server-side COPY of a storage object (for "Duplicate"). Returns
 *  the new storage_path or null. Reuses the same bucket + path convention. */
export async function copyObject(siteId: string, fromStoragePath: string, mime: string): Promise<string | null> {
  const ext = EXT[mime] || (fromStoragePath.split('.').pop() || 'bin');
  const toObject = `${siteId}/${crypto.randomUUID()}.${ext}`;
  const fromObject = fromStoragePath.replace(`${BUCKET}/`, '');
  try {
    const r = await fetch(`${SB_URL}/storage/v1/object/copy`, {
      method: 'POST', headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucketId: BUCKET, sourceKey: fromObject, destinationKey: toObject }),
    });
    if (!r.ok) return null;
    return `${BUCKET}/${toObject}`;
  } catch { return null; }
}

/** PREVIEW: map each deterministic output path to a short-lived signed
 *  transform URL, for substitution into rendered HTML. */
export async function previewUrlMap(manifest: MediaManifestEntry[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  await Promise.all(manifest.flatMap((m) => m.variants.map(async (v) => {
    const objectPath = m.storage_path.replace(`${BUCKET}/`, '');
    const r = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}/${objectPath}?expiresIn=600`, {
      method: 'POST', headers: { Authorization: `Bearer ${SB_SERVICE}`, apikey: SB_SERVICE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ transform: { width: v.width, format: 'webp', quality: 80 } }),
    });
    const j = await r.json().catch(() => null);
    if (j?.signedURL) map[v.output_path] = `${SB_URL}/storage/v1${j.signedURL}`;
  })));
  return map;
}
