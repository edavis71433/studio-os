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
import { fewAtATime } from './few_at_a_time.ts';
import type { KnownFile } from './netlify.ts';

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

/** Item 144: a site's live files and the bytes they take, counted and summed by the
 *  database (0165, presence_media_usage) instead of fetched row by row. The old read
 *  came back in PostgREST's pages of 1,000 rows, so past 1,000 files the total was
 *  short. Null when the database can't say. */
export async function mediaUsage(siteId: string): Promise<{ files: number; bytes: number } | null> {
  const r = await svc('rpc/presence_media_usage', { method: 'POST', body: JSON.stringify({ p_site: siteId }) });
  const row = r.ok && Array.isArray(r.json) ? r.json[0] : null;
  const files = Number(row?.files), bytes = Number(row?.bytes);
  return row && Number.isFinite(files) && Number.isFinite(bytes) ? { files, bytes } : null;
}

/** Issue a signed upload URL + create the media row in one call (G1 §8).
 *  Format-aware: images require alt text; documents require a name (stored in the
 *  same alt_text column, which satisfies the a11y CHECK and doubles as the title). */
export async function createUpload(siteId: string, req: { mime: string; bytes: number; alt_text: string; width?: number; height?: number; content_hash?: string }) {
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
  // URL or create a row (never touches existing media). The database counts and
  // sums the live rows (item 144); when it can't say, the check is skipped, as before.
  const limits = mediaQuota();
  const usage = await mediaUsage(siteId);
  if (usage) {
    const q = quotaExceeded(usage.files, usage.bytes, req.bytes, limits);
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

  // Item 115: the file's SHA-256, worked out by the page that holds the bytes, so a
  // later upload of the same file is caught exactly (0063's column; nothing wrote it
  // before). Only a well-formed hash is kept; a wrong one only blinds that check.
  const hash = /^[0-9a-f]{64}$/.test(String(req.content_hash || '')) ? String(req.content_hash) : undefined;
  const row = await svc('presence_media', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: siteId, storage_path: storagePath, alt_text: req.alt_text.trim(), mime: req.mime, bytes: req.bytes, width: req.width ?? null, height: req.height ?? null, ...(hash ? { content_hash: hash } : {}) }),
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
  const [off, posts, deliverables, settingsQ, libraryQ] = await Promise.all([
    svc(`presence_offerings?site_id=eq.${siteId}&media_id=eq.${mediaId}&deleted_at=is.null&select=name`),
    svc(`presence_posts?site_id=eq.${siteId}&hero_media_id=eq.${mediaId}&deleted_at=is.null&select=title`),
    svc(`presence_deliverables?site_id=eq.${siteId}&media_id=eq.${mediaId}&deleted_at=is.null&select=title`), // P2-D: a shared deliverable protects its file
    // FD-AUD1: the site's own presentation media — logo/OG/cover and any image
    // embedded in a content block (gallery/team/before-after/video). Without this,
    // deleting your logo or a gallery photo succeeds silently and the serializer
    // drops it from every page — gone for good after the media_gc window.
    // Item 115: and the owner's own pages, each page's share image, the Brand Kit
    // logo, and the saved sections a page can link to.
    // item 158 (0184): with the site icon; a database without it reads the rest
    svc(`presence_settings?site_id=eq.${siteId}&select=logo_media_id,og_media_id,cover_media_id,icon_media_id,blocks,pages,page_seo,brand_kit&limit=1`)
      .then((r) => (r.ok ? r : svc(`presence_settings?site_id=eq.${siteId}&select=logo_media_id,og_media_id,cover_media_id,blocks,pages,page_seo,brand_kit&limit=1`))),
    svc(`presence_content_library?site_id=eq.${siteId}&select=name,payload&limit=500`),
  ]);
  // Builder list item 40: a photo inside a post's text, and an author's photo. Read on their
  // own, so a database without migration 0181 still checks everything above.
  const [inPosts, blogQ] = await Promise.all([
    svc(`presence_posts?site_id=eq.${siteId}&body_md=like.*${mediaId}*&deleted_at=is.null&select=title`).catch(() => ({ ok: false, json: null } as any)),
    svc(`presence_settings?site_id=eq.${siteId}&select=post_authors&limit=1`).catch(() => ({ ok: false, json: null } as any)),
  ]);
  const s = Array.isArray(settingsQ.json) ? settingsQ.json[0] : null;
  const siteRefs: string[] = [];
  if (s) {
    if (s.logo_media_id === mediaId) siteRefs.push('your logo');
    if (s.og_media_id === mediaId) siteRefs.push('your social-share image');
    if (s.cover_media_id === mediaId) siteRefs.push('your cover photo');
    if (s.icon_media_id === mediaId) siteRefs.push('your site icon');   // item 158
    // blocks is a JSON column; media ids live inside it as UUID strings (exact,
    // 36-char — no false substring match between distinct UUIDs).
    if (s.blocks && JSON.stringify(s.blocks).includes(mediaId)) siteRefs.push('a section on your website');
    if (s.pages && JSON.stringify(s.pages).includes(mediaId)) siteRefs.push('a section on one of your pages');
    if (s.page_seo && JSON.stringify(s.page_seo).includes(mediaId)) siteRefs.push('a page’s share image');
    if (s.brand_kit && JSON.stringify(s.brand_kit).includes(mediaId) && s.logo_media_id !== mediaId) siteRefs.push('your Brand Kit logo');
  }
  for (const it of Array.isArray(libraryQ.json) ? libraryQ.json : []) {
    if (it?.payload && JSON.stringify(it.payload).includes(mediaId)) siteRefs.push(`the saved section “${it.name || 'Untitled'}”`);
  }
  const refs = [
    ...(Array.isArray(off.json) ? off.json.map((o: any) => `menu item “${o.name}”`) : []),
    ...(Array.isArray(posts.json) ? posts.json.map((p: any) => `post “${p.title}”`) : []),
    ...(Array.isArray(inPosts.json) ? inPosts.json.map((p: any) => `the post “${p.title}”`) : []),
    ...(Array.isArray(blogQ.json) && blogQ.json[0]?.post_authors && JSON.stringify(blogQ.json[0].post_authors).includes(mediaId) ? ['an author’s photo on your blog'] : []),
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

/** How a transform that names only a width must resize — see the transform
 *  contract below. */
export const WIDTH_ONLY_RESIZE = 'contain';

/** How many photo sizes a publish makes at once. */
export const VARIANTS_AT_ONCE = 8;

/** PUBLISH: fetch every required variant via the transform endpoint (EXIF
 *  stripped, resized, encoded to the variant's format — webp AND avif) and return
 *  bytes keyed by output path. The manifest now carries a format per variant, so a
 *  single pass generates both the WebP and the AVIF file at each width.
 *
 *  Item 208: `known` is the files the live site went up with (path → SHA-1). A variant's
 *  path is fixed by its stored file, and a stored file never changes (every upload and
 *  every edit makes a new one), so a path the live site has is named by that digest and
 *  made again only if the host asks for it. A few are made at a time. */
export async function fetchVariants(manifest: MediaManifestEntry[], known: Record<string, string> | null = null): Promise<{ files: Record<string, Uint8Array | KnownFile>; failed: string[]; reused: number }> {
  const files: Record<string, Uint8Array | KnownFile> = {};
  const failed: string[] = [];
  let reused = 0;
  const fetchOne = async (m: MediaManifestEntry, v: MediaManifestEntry['variants'][number]): Promise<Uint8Array | null> => {
    const objectPath = m.storage_path.replace(`${BUCKET}/`, '');
    // DL-FILES: a NON-image original (e.g. a PDF Download) is fetched VERBATIM from
    // storage — never through the image transform (which can't process a document
    // and would fail the whole publish). Images use the transform path as before.
    const url = v.format === 'original'
      ? `${SB_URL}/storage/v1/object/authenticated/${BUCKET}/${objectPath}`
      : `${SB_URL}/storage/v1/render/image/authenticated/${BUCKET}/${objectPath}?width=${v.width}&resize=${WIDTH_ONLY_RESIZE}&format=${v.format}&quality=80`;
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${SB_SERVICE}`, apikey: SB_SERVICE } });
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
    } catch { return null; }
  };
  const todo: Array<[MediaManifestEntry, MediaManifestEntry['variants'][number]]> = [];
  for (const m of manifest) for (const v of m.variants) {
    const sha = known ? known['/' + v.output_path.replace(/^\//, '')] : undefined;
    if (sha) { files[v.output_path.replace(/^\//, '')] = { sha, load: () => fetchOne(m, v) }; reused++; } else todo.push([m, v]);
  }
  await fewAtATime(todo, VARIANTS_AT_ONCE, async ([m, v]) => {
    const bytes = await fetchOne(m, v);
    if (bytes) files[v.output_path.replace(/^\//, '')] = bytes;
    else failed.push(v.format === 'original' ? `${m.storage_path} (original)` : `${m.storage_path} @${v.width}.${v.format}`);
  });
  return { files, failed, reused };
}

// ── The transform contract ───────────────────────────────────────────────────
// Every width-only transform carries resize=contain (WIDTH_ONLY_RESIZE, above).
// Storage's default, cover, does not scale when only a width is given: on
// production a 3000x2000 JPEG at width=400 came back 400x2000, the middle 13% of
// the photo at full height. contain scales to the width and keeps the proportions.
//
// `format`: the render route (fetchVariants) validates it against origin, avif and
// webp and encodes to what it names. The signers below leave it out, so the
// transformer picks the format from the request's Accept header.
// Signed at DISPLAY time everywhere (never persisted), so expiry is not in play.
const THUMB_TTL = 3600;

/** DAM-1 (Files): a short-lived signed THUMBNAIL for one image (private bucket).
 *  Reused by the Files grid + detail. Documents have no image thumbnail → null. */
export async function signThumb(storagePath: string, mime: string, width = 320): Promise<string | null> {
  if (!isImageMime(mime)) return null;
  try {
    const objectPath = storagePath.replace(`${BUCKET}/`, '');
    // expiresIn MUST be in the body (the sign endpoint 400s on a query-string expiresIn)
    const r = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}/${objectPath}`, {
      method: 'POST', headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: THUMB_TTL, transform: { width, resize: WIDTH_ONLY_RESIZE, quality: 72 } }),
    });
    const j = await r.json().catch(() => null);
    return j?.signedURL ? `${SB_URL}/storage/v1${j.signedURL}` : null;
  } catch { return null; }
}

/** The honest fallback behind every transformed preview: the ORIGINAL object,
 *  signed with NO transform at all. A transform has failure modes the plain
 *  object does not (the store may not perform transforms, and a source past the
 *  transformer's limits is refused), and an owner would far rather see their
 *  full-size photo than a broken image. Same bucket, same private object, same
 *  short life — only the transform is dropped. */
export async function signOriginal(storagePath: string, expiresIn = THUMB_TTL): Promise<string | null> {
  try {
    const objectPath = storagePath.replace(`${BUCKET}/`, '');
    // expiresIn MUST be in the body (the sign endpoint 400s on a query-string expiresIn)
    const r = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}/${objectPath}`, {
      method: 'POST', headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn }),
    });
    const j = await r.json().catch(() => null);
    return j?.signedURL ? `${SB_URL}/storage/v1${j.signedURL}` : null;
  } catch { return null; }
}

/** The same fallback, but only for images — a document has no image preview to
 *  fall back TO, and handing one to an <img> would just fail differently. */
export async function signOriginalImage(storagePath: string, mime: string): Promise<string | null> {
  return isImageMime(mime) ? await signOriginal(storagePath) : null;
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
      body: JSON.stringify({ expiresIn: THUMB_TTL, transform: { width: t.width, height: t.height, resize: 'cover', quality: t.quality ?? 80 } }),
    });
    const j = await r.json().catch(() => null);
    return j?.signedURL ? `${SB_URL}/storage/v1${j.signedURL}` : null;
  } catch { return null; }
}

/** Items 39 + 117: the photo the cut-out model fetches. The original itself when
 *  it is already within `side` on its long side; otherwise a contain transform to
 *  that size (shape kept). Signed for 15 minutes: long enough for a model that is
 *  still starting, dead soon after. Documents have no cut-out → null. */
export async function signCutoutSource(storagePath: string, mime: string, width: number | null | undefined, height: number | null | undefined, side = 3000): Promise<string | null> {
  if (!isImageMime(mime)) return null;
  const small = Number(width) > 0 && Number(height) > 0 && Math.max(Number(width), Number(height)) <= side;
  if (!small) {
    try {
      const objectPath = storagePath.replace(`${BUCKET}/`, '');
      const r = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}/${objectPath}`, {
        method: 'POST', headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: 900, transform: { width: side, height: side, resize: 'contain', quality: 90 } }),
      });
      const j = await r.json().catch(() => null);
      return j?.signedURL ? `${SB_URL}/storage/v1${j.signedURL}` : null;
    } catch { return null; }
  }
  return await signOriginal(storagePath, 900);   // already small enough: the file itself, never re-encoded
}

/** DAM-1 (Files): a short-lived signed DOWNLOAD URL for the ORIGINAL object (no
 *  transform) — used for "Download" and for previewing documents. Optionally sets
 *  a friendly download filename. */
export async function signDownload(storagePath: string, filename?: string): Promise<string | null> {
  // the SAME untransformed signer as signOriginal — a download is that URL plus
  // the friendly filename. One signer, so the two can never drift apart.
  const url = await signOriginal(storagePath, 600);
  if (!url) return null;
  return filename ? url + (url.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(filename) : url;
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

/** Builder list item 166: when a studio removes a template, its own photo copies go
 *  too (item 145 keeps them in templates/<agency id>/). Only that agency's template
 *  folder is ever touched, so a template can never take a site's photo with it.
 *  Best-effort; answers how many are gone. */
export async function removeTemplatePhotos(agencyId: string, storagePaths: string[]): Promise<number> {
  const folder = `templates/${String(agencyId).toLowerCase()}/`;
  let gone = 0;
  for (const p of storagePaths) {
    const obj = String(p || '').replace(`${BUCKET}/`, '');
    if (!obj.startsWith(folder) || !/^templates\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/.test(obj)) continue;
    const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${obj}`, { method: 'DELETE', headers: { Authorization: `Bearer ${SB_SERVICE}`, apikey: SB_SERVICE } }).catch(() => null);
    if (r && (r.ok || r.status === 404 || r.status === 400)) gone++;
  }
  return gone;
}

/** PREVIEW: map each deterministic output path to a short-lived signed
 *  transform URL, for substitution into rendered HTML. */
export async function previewUrlMap(manifest: MediaManifestEntry[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  await Promise.all(manifest.flatMap((m) => m.variants.map(async (v) => {
    const objectPath = m.storage_path.replace(`${BUCKET}/`, '');
    // DL-FILES: a NON-image original (a PDF Download) is signed WITHOUT a transform,
    // so the preview's Download link resolves to the real file — matching how it will
    // serve once published. Images are signed with their width transform as before.
    // Two fixes here, both the same fixes signThumb carries: expiresIn belongs in the
    // BODY (a query-string expiresIn 400s, so every preview URL came back null), and
    // `format` is left to the request's Accept header — see THUMB_TTL's note above.
    const transform = v.format === 'original' ? {} : { transform: { width: v.width, resize: WIDTH_ONLY_RESIZE, quality: 80 } };
    const r = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}/${objectPath}`, {
      method: 'POST', headers: { Authorization: `Bearer ${SB_SERVICE}`, apikey: SB_SERVICE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 600, ...transform }),
    });
    const j = await r.json().catch(() => null);
    if (j?.signedURL) map[v.output_path] = `${SB_URL}/storage/v1${j.signedURL}`;
  })));
  return map;
}
