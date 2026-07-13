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
import { magicMatchesMime, stripJpegExif, mediaQuota, quotaExceeded } from './media_guard.ts';

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

  // M6: per-site media quota — count + storage usage, enforced BEFORE we issue a
  // URL or create a row (never touches existing media). One query over the live
  // rows; array length is the file count, the bytes sum is the storage usage.
  const limits = mediaQuota();
  const usage = await svc(`presence_media?site_id=eq.${siteId}&deleted_at=is.null&select=bytes`);
  if (usage.ok && Array.isArray(usage.json)) {
    const files = usage.json.length;
    const used = usage.json.reduce((s: number, r: any) => s + (Number(r.bytes) || 0), 0);
    const q = quotaExceeded(files, used, req.bytes, limits);
    if (q.exceeded) return {
      error: 'quota_exceeded',
      message: q.reason === 'count'
        ? `This site has reached its media limit of ${limits.maxFiles} files. Remove a few you no longer need, then try again.`
        : `This site is out of media storage. Remove a few files you no longer need to free up space, then try again.`,
    };
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

/** FD-T10: import already-fetched image bytes into this site's library — the SAME
 *  pipeline (createUpload issues the row + signed URL; we PUT the bytes server-side
 *  via the service role). Optionally tag a collection + provenance metadata. Once
 *  here it's an ordinary asset (variants, usage, publish, tagging all unchanged).
 *  Rolls the row back if the byte upload fails, so a failure leaves nothing dangling. */
export async function importImage(siteId: string, bytes: Uint8Array, mime: string, alt: string, extra?: { width?: number; height?: number; collection?: string; metadata?: Record<string, unknown> }) {
  // M6: this is the ONE path where the function holds the raw bytes, so validate
  // + sanitize here. (1) Magic-byte check — the binary signature must match the
  // declared type, rejecting malformed files and polyglots before they enter the
  // store. (2) Strip EXIF/GPS from the stored JPEG original (segment-level, never
  // touches image data). Published/preview output is independently EXIF-free via
  // the render transform, which is also what preserves orientation.
  if (isImageMime(mime) && !magicMatchesMime(bytes, mime)) {
    return { error: 'invalid_image', message: 'That file isn’t a valid image — please try another.' };
  }
  const clean = mime === 'image/jpeg' ? stripJpegExif(bytes) : bytes;
  const res = await createUpload(siteId, { mime, bytes: clean.byteLength, alt_text: alt, width: extra?.width, height: extra?.height });
  if ('error' in res) return res;
  const put = await fetch(res.upload_url, { method: 'PUT', headers: { Authorization: `Bearer ${SB_SERVICE}`, apikey: SB_SERVICE, 'Content-Type': mime, 'x-upsert': 'true' }, body: clean as unknown as BodyInit });
  if (!put.ok) {
    await svc(`presence_media?id=eq.${res.media_id}`, { method: 'PATCH', body: JSON.stringify({ deleted_at: new Date().toISOString() }) });
    return { error: 'upload_failed', message: 'That image couldn’t be imported — please try another.' };
  }
  if (extra?.collection || extra?.metadata) {
    await svc(`presence_media?id=eq.${res.media_id}`, { method: 'PATCH', body: JSON.stringify({ ...(extra.collection ? { collection: extra.collection } : {}), ...(extra.metadata ? { metadata: extra.metadata } : {}) }) });
  }
  return { media_id: res.media_id, storage_path: res.storage_path };
}

/** Delete: refuse while referenced (names the blockers); soft-delete row + remove object. */
export async function deleteMedia(siteId: string, mediaId: string) {
  const [off, posts, deliverables, settingsQ] = await Promise.all([
    svc(`presence_offerings?site_id=eq.${siteId}&media_id=eq.${mediaId}&deleted_at=is.null&select=name`),
    svc(`presence_posts?site_id=eq.${siteId}&hero_media_id=eq.${mediaId}&deleted_at=is.null&select=title`),
    svc(`presence_deliverables?site_id=eq.${siteId}&media_id=eq.${mediaId}&deleted_at=is.null&select=title`), // P2-D: a shared deliverable protects its file
    // FD-AUD1: the site's own presentation media — logo/OG/cover and any image
    // embedded in a content block (gallery/team/before-after/video). Without this,
    // deleting your logo or a gallery photo succeeds silently and the serializer
    // drops it from every page — gone for good after the media_gc window.
    svc(`presence_settings?site_id=eq.${siteId}&select=logo_media_id,og_media_id,cover_media_id,blocks&limit=1`),
  ]);
  const s = Array.isArray(settingsQ.json) ? settingsQ.json[0] : null;
  const siteRefs: string[] = [];
  if (s) {
    if (s.logo_media_id === mediaId) siteRefs.push('your logo');
    if (s.og_media_id === mediaId) siteRefs.push('your social-share image');
    if (s.cover_media_id === mediaId) siteRefs.push('your cover photo');
    // blocks is a JSON column; media ids live inside it as UUID strings (exact,
    // 36-char — no false substring match between distinct UUIDs).
    if (s.blocks && JSON.stringify(s.blocks).includes(mediaId)) siteRefs.push('a section on your website');
  }
  const refs = [
    ...(Array.isArray(off.json) ? off.json.map((o: any) => `menu item “${o.name}”`) : []),
    ...(Array.isArray(posts.json) ? posts.json.map((p: any) => `post “${p.title}”`) : []),
    ...(Array.isArray(deliverables.json) ? deliverables.json.map((d: any) => `deliverable “${d.title || 'file'}”`) : []),
    ...siteRefs,
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
 *  stripped, resized, encoded to the variant's format — webp AND avif) and return
 *  bytes keyed by output path. The manifest now carries a format per variant, so a
 *  single pass generates both the WebP and the AVIF file at each width. */
export async function fetchVariants(manifest: MediaManifestEntry[]): Promise<{ files: Record<string, Uint8Array>; failed: string[] }> {
  const files: Record<string, Uint8Array> = {};
  const failed: string[] = [];
  await Promise.all(manifest.flatMap((m) => m.variants.map(async (v) => {
    const objectPath = m.storage_path.replace(`${BUCKET}/`, '');
    const url = `${SB_URL}/storage/v1/render/image/authenticated/${BUCKET}/${objectPath}?width=${v.width}&format=${v.format}&quality=80`;
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${SB_SERVICE}`, apikey: SB_SERVICE } });
      if (!r.ok) { failed.push(`${m.storage_path} @${v.width}.${v.format}`); return; }
      files[v.output_path.replace(/^\//, '')] = new Uint8Array(await r.arrayBuffer());
    } catch { failed.push(`${m.storage_path} @${v.width}.${v.format}`); }
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

/** DAM (social crops): a short-lived signed URL for one focal/social ratio via the
 *  SAME self-hosted Supabase image transform used for the width variants — here with
 *  width AND height + resize=cover, so it's a real height crop to the target ratio
 *  (not just a width resize). No external origin; documents have no crop → null.
 *  Supabase cover-crops from centre; on-site/preview focal fidelity is driven by the
 *  object-position the social-crops core emits (same technique the templates use). */
export async function signSocialCrop(storagePath: string, mime: string, t: { width: number; height: number; quality?: number }): Promise<string | null> {
  if (!isImageMime(mime)) return null;
  try {
    const objectPath = storagePath.replace(`${BUCKET}/`, '');
    const r = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}/${objectPath}`, {
      method: 'POST', headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 3600, transform: { width: t.width, height: t.height, resize: 'cover', format: 'webp', quality: t.quality ?? 80 } }),
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
      body: JSON.stringify({ transform: { width: v.width, format: v.format, quality: 80 } }),
    });
    const j = await r.json().catch(() => null);
    if (j?.signedURL) map[v.output_path] = `${SB_URL}/storage/v1${j.signedURL}`;
  })));
  return map;
}
