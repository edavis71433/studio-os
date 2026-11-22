// ── Files for the studio (builder item 337) ──────────────────────────────────
// The portal's "Send your studio a file" and a project's deliverables take more
// than the website's own kinds: Word, plain text, SVG, Illustrator and EPS, iPhone
// HEIC photos, zips and short videos. They are stored in the ONE media store and
// downloaded, never placed on a site as they are: the editor's picker never
// lists them, no variant is ever made of them, and whatever serves one back goes
// out as an attachment under its own name, so an SVG never runs anywhere.
//
// Pure: lists, caps, the kind a file's first bytes say it is, the SVG rule and the
// words. lib/upload_check.ts reads the stored bytes and calls in here. lib/media.ts
// imports this file (the door and the attachment rule), so nothing here imports it.

const MB = 1024 * 1024;
/** What the studio door takes, by declared type: extension, size cap, byte family, words. */
export interface StudioKind { ext: string; cap: number; family: Family; label: string }
export type Family = 'jpeg' | 'png' | 'webp' | 'pdf' | 'word' | 'text' | 'svg' | 'postscript' | 'heic' | 'zip' | 'video';

export const CLIENT_PHOTO_BYTES = 25 * MB;      // the three website photo kinds, at this door
export const CLIENT_BIG_BYTES = 100 * MB;       // video and zip
const DOC = 25 * MB;                            // documents: the same as lib/media.ts MAX_DOC_BYTES

/** Every kind the studio door accepts, the website's own kinds first. */
export const STUDIO_KINDS: Record<string, StudioKind> = {
  'image/jpeg': { ext: 'jpg', cap: CLIENT_PHOTO_BYTES, family: 'jpeg', label: 'JPEG photo' },
  'image/png': { ext: 'png', cap: CLIENT_PHOTO_BYTES, family: 'png', label: 'PNG image' },
  'image/webp': { ext: 'webp', cap: CLIENT_PHOTO_BYTES, family: 'webp', label: 'WebP image' },
  'application/pdf': { ext: 'pdf', cap: DOC, family: 'pdf', label: 'PDF' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: 'docx', cap: DOC, family: 'word', label: 'Word document' },
  'application/msword': { ext: 'doc', cap: DOC, family: 'word', label: 'Word document' },
  'text/plain': { ext: 'txt', cap: DOC, family: 'text', label: 'text file' },
  'image/svg+xml': { ext: 'svg', cap: DOC, family: 'svg', label: 'SVG drawing' },
  'application/postscript': { ext: 'eps', cap: DOC, family: 'postscript', label: 'EPS or Illustrator file' },
  'application/illustrator': { ext: 'ai', cap: DOC, family: 'postscript', label: 'Illustrator file' },
  'image/heic': { ext: 'heic', cap: CLIENT_PHOTO_BYTES, family: 'heic', label: 'iPhone photo' },
  'image/heif': { ext: 'heif', cap: CLIENT_PHOTO_BYTES, family: 'heic', label: 'iPhone photo' },
  'application/zip': { ext: 'zip', cap: CLIENT_BIG_BYTES, family: 'zip', label: 'zip' },
  'video/mp4': { ext: 'mp4', cap: CLIENT_BIG_BYTES, family: 'video', label: 'video' },
  'video/quicktime': { ext: 'mov', cap: CLIENT_BIG_BYTES, family: 'video', label: 'video' },
};
export const STUDIO_FILE_MIME = new Set(Object.keys(STUDIO_KINDS));
/** The kinds only this door takes: stored and downloaded, never on a site. */
const SITE_FAMILIES: Family[] = ['jpeg', 'png', 'webp', 'pdf'];   // lib/media.ts IMAGE_MIME + DOC_MIME
export const STUDIO_ONLY_MIME = new Set([...STUDIO_FILE_MIME].filter((m) => !SITE_FAMILIES.includes(STUDIO_KINDS[m].family)));
/** The file extensions those kinds are stored under (a storage path's tail). */
export const STUDIO_ONLY_EXT = new Set([...STUDIO_ONLY_MIME].map((m) => STUDIO_KINDS[m].ext));
/** What the page may offer in its file box (the `accept` list), in this order. The
 *  extensions sit on their own line: the walls check reads a quoted string on an
 *  `export` line as a path to follow (tests/workflows/isolation_scope_test.mjs). */
const STUDIO_ACCEPT_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.docx', '.doc', '.txt', '.svg', '.ai', '.eps', '.heic', '.heif', '.zip', '.mp4', '.mov'];
export const STUDIO_ACCEPT = [...STUDIO_FILE_MIME, ...STUDIO_ACCEPT_EXT].join(',');

export const isStudioFileMime = (m: string) => STUDIO_FILE_MIME.has(m);
/** A kind the website editor's picker must never list (derived from the mime; no new column). */
export const hiddenFromPicker = (m: string | null | undefined) => STUDIO_ONLY_MIME.has(String(m || '').toLowerCase());
export const studioCap = (m: string) => STUDIO_KINDS[m]?.cap ?? 0;
export const studioExt = (m: string) => STUDIO_KINDS[m]?.ext ?? 'bin';

/** The words the upload box and the refusal say. */
export const STUDIO_TYPE_WORDS = 'Photos (JPEG, PNG, WebP or iPhone HEIC), PDFs, Word documents, text files, SVG, Illustrator and EPS files, zips, and short videos (MP4 or MOV).';
export const STUDIO_SIZE_WORDS = 'Photos and documents up to 25MB; videos and zips up to 100MB.';
export const STUDIO_BOX_WORDS = `${STUDIO_TYPE_WORDS} ${STUDIO_SIZE_WORDS} It lands in your project’s files right away.`;
export function studioSizeWords(mime: string): string {
  const k = STUDIO_KINDS[mime];
  if (!k) return STUDIO_SIZE_WORDS;
  const mb = Math.round(k.cap / MB);
  return k.family === 'video' ? `Videos can be up to ${mb}MB.` : k.family === 'zip' ? `Zips can be up to ${mb}MB.` : /photo|image/.test(k.label) ? `Photos can be up to ${mb}MB.` : `Documents can be up to ${mb}MB.`;
}
export const STUDIO_MISMATCH_WORDS = 'That file isn’t what its name says it is, so it wasn’t kept. Open it on your computer to check it, then try again.';

// ── what the bytes say ────────────────────────────────────────────────────────
const at = (b: Uint8Array, i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);
const AUDIO_BRANDS = new Set(['M4A ', 'M4B ', 'M4P ']);   // an audio file in the same box: not a video
const VIDEO_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'av01', 'M4V ', 'M4VP', 'qt  ', '3gp4', '3gp5', '3gp6', 'mmp4', 'dash', 'MSNV', 'f4v ']);

/** The brands an ISO media file names in its ftyp box (the major one and every compatible one). */
export function ftypBrands(b: Uint8Array): string[] {
  if (b.length < 12 || ascii(b, 4, 4) !== 'ftyp') return [];
  const size = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  const end = Math.min(b.length, size >= 16 && size < 4096 ? size : 32);
  const out = [ascii(b, 8, 4)];
  for (let i = 16; i + 4 <= end; i += 4) out.push(ascii(b, i, 4));
  return out;
}

/** True when the bytes decode as UTF-8 with no NUL byte in them. */
export function isPlainText(b: Uint8Array): boolean {
  if (!b.length) return false;
  for (let i = 0; i < b.length; i++) if (b[i] === 0) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(b); return true; } catch { return false; }
}

/** True when the text is an SVG document (an <svg element, after any prolog). */
export function looksLikeSvg(text: string): boolean {
  return /<svg[\s>\/]/i.test(text.slice(0, 64 * 1024));
}

/** Nothing that can run: no script, no on* handler, no javascript: address, no foreignObject.
 *  Also nothing that reaches out (a <use>, <image> or @import of a remote file, or an entity
 *  declaration) — a drawing for the studio needs none of them. Pure. */
export function svgSafe(text: string): boolean {
  const t = String(text || '');
  if (!looksLikeSvg(t)) return false;
  // comments can't hide anything: the rules below look through them too
  if (/<\s*script\b/i.test(t)) return false;
  if (/<\s*foreignObject\b/i.test(t)) return false;
  if (/\son[a-z]+\s*=/i.test(t)) return false;
  // a javascript: address, however it is spelled: numeric entities decoded, spaces and
  // control characters taken out (a browser tolerates both inside the scheme)
  const plain = t.replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(Number(d))).replace(/[\s\u0000-\u001f]/g, '');
  if (/javascript:/i.test(plain)) return false;
  if (/<!ENTITY\b/i.test(t)) return false;
  if (/<\s*(?:iframe|embed|object|meta|link|base|form|input)\b/i.test(t)) return false;
  if (/\b(?:href|src|xlink:href)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(t)) return false;   // a remote fetch, from a <use>, <image> or <a>
  if (/@import\b|url\s*\(\s*["']?\s*(?:https?:)?\/\//i.test(t)) return false;                 // a stylesheet that reaches out
  return true;
}

/** The byte families a file could be, from its first bytes (and, for text, all of it).
 *  A PDF could also be a newer .ai file; a zip holding word/ could be a .docx. Empty: unknown. */
export function byteFamilies(b: Uint8Array): Family[] {
  if (b.length >= 3 && at(b, 0, 0xff, 0xd8, 0xff)) return ['jpeg'];
  if (b.length >= 8 && at(b, 0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return ['png'];
  if (b.length >= 12 && at(b, 0, 0x52, 0x49, 0x46, 0x46) && at(b, 8, 0x57, 0x45, 0x42, 0x50)) return ['webp'];
  if (b.length >= 5 && at(b, 0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return ['pdf', 'postscript'];          // %PDF-  (a newer .ai is one)
  if (b.length >= 4 && at(b, 0, 0x25, 0x21, 0x50, 0x53)) return ['postscript'];                        // %!PS
  if (b.length >= 4 && at(b, 0, 0x50, 0x4b, 0x03, 0x04)) {                                             // PK..  a zip
    const head = ascii(b, 0, Math.min(b.length, 64 * 1024));
    return head.includes('word/') ? ['zip', 'word'] : ['zip'];
  }
  if (b.length >= 8 && at(b, 0, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return ['word'];     // an OLE file: a .doc
  const brands = ftypBrands(b);
  if (brands.length) {
    if (brands.some((x) => HEIC_BRANDS.has(x))) return ['heic'];
    if (AUDIO_BRANDS.has(brands[0])) return [];
    if (brands.some((x) => VIDEO_BRANDS.has(x))) return ['video'];
    return [];
  }
  if (isPlainText(b)) {
    const text = new TextDecoder().decode(b);
    return looksLikeSvg(text) ? ['svg'] : ['text'];
  }
  return [];
}

/** The declared type against the bytes: the kind is decided by the bytes, never the name.
 *  An SVG must also pass svgSafe. Plain words when it is refused. Pure. */
export function checkStudioBytes(bytes: Uint8Array, declaredMime: string): { ok: true } | { ok: false; message: string } {
  const k = STUDIO_KINDS[declaredMime];
  if (!k) return { ok: false, message: `That kind of file can’t be sent here. ${STUDIO_TYPE_WORDS}` };
  const fams = byteFamilies(bytes);
  if (!fams.includes(k.family)) return { ok: false, message: STUDIO_MISMATCH_WORDS };
  if (k.family === 'svg' && !svgSafe(new TextDecoder().decode(bytes))) {
    return { ok: false, message: 'That SVG has a script or a link in it, so it wasn’t kept. Export it again as a plain drawing (no scripts or interactivity), then try again.' };
  }
  return { ok: true };
}

/** How many leading bytes the check needs for a declared kind: a text kind needs all of them. */
export function bytesNeeded(declaredMime: string): number | 'all' {
  const f = STUDIO_KINDS[declaredMime]?.family;
  return f === 'svg' || f === 'text' ? 'all' : 64 * 1024;
}

/** The name a file downloads as: the title, with the kind's extension when it lacks one. */
export function downloadName(title: string | null | undefined, mime: string | null | undefined): string {
  const base = String(title || '').replace(/[\u0000-\u001f\u007f"\\/<>]/g, '').trim().slice(0, 80) || 'download';
  const ext = STUDIO_KINDS[String(mime || '')]?.ext;
  if (!ext) return base;
  return new RegExp(`\\.${ext}$`, 'i').test(base) || (ext === 'jpg' && /\.jpeg$/i.test(base)) ? base : `${base}.${ext}`;
}

/** What a signed link's `download=` must be for a stored file (by its path's extension): a
 *  studio-only kind ALWAYS goes out as an attachment, under the given name or the stored
 *  one, with its extension; any other kind keeps the name it was given (none means inline). */
export function attachmentName(filename: string | undefined, storagePath: string): string | undefined {
  const tail = (String(storagePath || '').split('/').pop() || '');
  const ext = tail.includes('.') ? tail.slice(tail.lastIndexOf('.') + 1).toLowerCase() : '';
  if (!STUDIO_ONLY_EXT.has(ext)) return filename;
  const base = String(filename || '').trim() || tail.slice(0, tail.lastIndexOf('.')) || 'download';
  return new RegExp(`\\.${ext}$`, 'i').test(base) ? base : `${base}.${ext}`;
}
