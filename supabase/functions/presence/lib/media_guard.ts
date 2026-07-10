// ── Media guard (Presence CMS Phase 1, M6) ───────────────────────────────────
// Pure, no-I/O media-hardening decisions: magic-byte signature validation, a
// safe JPEG EXIF/GPS strip, and per-site quota math. The route/lib wire these to
// storage + the DB. Kept pure so the security rules are unit-testable.

// ── magic-byte signatures (validate the BINARY, not the MIME/extension) ──
const SIG: Array<{ mime: string; test: (b: Uint8Array) => boolean }> = [
  { mime: 'image/jpeg', test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a },
  { mime: 'image/webp', test: (b) => b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 }, // RIFF....WEBP
  { mime: 'application/pdf', test: (b) => b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d }, // %PDF-
];

/** Detect a file's true type from its leading bytes, or null if unrecognized. Pure. */
export function sniffType(bytes: Uint8Array): string | null {
  for (const s of SIG) if (s.test(bytes)) return s.mime;
  return null;
}

/** True only when the binary signature MATCHES the declared MIME — rejects
 *  malformed files and polyglots (a declared image whose bytes are something
 *  else, or a valid image with a mismatched declared type). Pure. */
export function magicMatchesMime(bytes: Uint8Array, declaredMime: string): boolean {
  const detected = sniffType(bytes);
  return detected !== null && detected === declaredMime;
}

// ── EXIF strip (JPEG) — remove the APP1 segment(s) that carry EXIF/GPS/XMP and
//    camera metadata. Structural (segment-level) — it NEVER decodes or touches
//    the compressed image data, so it can't corrupt the picture. Non-JPEG bytes
//    pass through unchanged (PNG/WebP output metadata is already stripped by the
//    publish/preview transform, which is also the orientation-safe path). ──
export function stripJpegExif(bytes: Uint8Array): Uint8Array {
  // not a JPEG → nothing to strip here
  if (!(bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8)) return bytes;
  const out: number[] = [0xff, 0xd8]; // SOI
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) { out.push(...bytes.subarray(i)); return new Uint8Array(out); } // desync → bail safely (keep tail)
    const marker = bytes[i + 1];
    // Start Of Scan (0xDA): compressed image data follows to EOI — copy the rest verbatim.
    if (marker === 0xda) { out.push(...bytes.subarray(i)); return new Uint8Array(out); }
    // standalone markers without a length (RSTn / SOI / EOI / TEM) — copy 2 bytes
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { out.push(0xff, marker); i += 2; continue; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3]; // segment length includes these 2 bytes
    if (len < 2 || i + 2 + len > bytes.length) { out.push(...bytes.subarray(i)); return new Uint8Array(out); } // malformed → bail safely
    // DROP APP1 (0xE1): EXIF + GPS + XMP live here. Keep every other segment.
    if (marker !== 0xe1) out.push(...bytes.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  out.push(...bytes.subarray(i));
  return new Uint8Array(out);
}

/** True if the JPEG still carries an APP1/EXIF segment (used by tests). Pure. */
export function hasJpegExif(bytes: Uint8Array): boolean {
  if (!(bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8)) return false;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) return false;
    const marker = bytes[i + 1];
    if (marker === 0xda) return false;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) return false;
    if (marker === 0xe1) return true;
    i += 2 + len;
  }
  return false;
}

// ── per-site quota (configurable; enforced BEFORE accepting an upload) ──
export const DEFAULT_MAX_MEDIA_FILES = 1000;
export const DEFAULT_MAX_MEDIA_BYTES = 1024 * 1024 * 1024; // 1 GB per site
export function mediaQuota(): { maxFiles: number; maxBytes: number } {
  const f = Number(Deno.env.get('MAX_MEDIA_FILES'));
  const b = Number(Deno.env.get('MAX_MEDIA_BYTES'));
  return {
    maxFiles: Number.isFinite(f) && f > 0 ? f : DEFAULT_MAX_MEDIA_FILES,
    maxBytes: Number.isFinite(b) && b > 0 ? b : DEFAULT_MAX_MEDIA_BYTES,
  };
}
/** Would accepting `addBytes` more push this site over a limit? Pure. */
export function quotaExceeded(currentFiles: number, currentBytes: number, addBytes: number, limits: { maxFiles: number; maxBytes: number }): { exceeded: boolean; reason?: 'count' | 'bytes' } {
  if (currentFiles >= limits.maxFiles) return { exceeded: true, reason: 'count' };
  if (currentBytes + Math.max(0, addBytes) > limits.maxBytes) return { exceeded: true, reason: 'bytes' };
  return { exceeded: false };
}
