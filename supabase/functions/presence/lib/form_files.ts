// ── Builder list item 147: a visitor's photos and PDFs, sent with a form ─────
// A form's "Photo or file" field takes up to three photos (JPEG, PNG, WebP) or PDFs,
// 10 MB each, 20 MB in all. They arrive with the form (multipart), are checked by their
// first bytes, not their name, and go into the same private bucket the media library
// uses, under forms/<site>/, never on the site and never listed with the owner's
// photos. The enquiry keeps what each one is (fields.__files); the Inbox shows them and
// opens one through a link that lasts ten minutes. A send judged spam keeps nothing.
import { BUCKET, MIME_ALLOW, MAX_BYTES } from './media.ts';

const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SB_SERVICE = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

/** What a "Photo or file" field takes: the media library's own kinds and size. */
export const FILE_LIMITS = { perField: 3, bytes: MAX_BYTES, total: 20 * 1024 * 1024, types: [...MIME_ALLOW] } as const;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

/** The file's real kind, from its first bytes; null for anything but the four kinds. */
export function sniffType(b: Uint8Array): string | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  if (b.length >= 5 && at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf';
  return null;
}

/** A name fit to show and to save under: no path, no control characters, at most 120 characters. */
export function cleanFileName(name: unknown): string {
  const base = String(name ?? '').split(/[\\/]/).pop() || '';
  return base.replace(/[\u0000-\u001f\u007f"<>]/g, '').trim().slice(0, 120) || 'file';
}

export interface StoredFile { key: string; name: string; type: string; size: number; path: string }
type Put = (path: string, bytes: Uint8Array, type: string) => Promise<boolean>;
const putObject: Put = async (path, bytes, type) => {
  const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${SB_SERVICE}`, apikey: SB_SERVICE, 'Content-Type': type, 'x-upsert': 'false' }, body: bytes as unknown as BodyInit,
  }).catch(() => null);
  return !!r?.ok;
};

/** Check and keep the files of one send. All or nothing: a file that isn't what it says,
 *  or a store that refuses one, keeps none (and says which). */
export async function storeFormFiles(siteId: string, entries: Array<{ key: string; file: File }>, put: Put = putObject):
  Promise<{ ok: true; files: StoredFile[] } | { ok: false; error: 'not_allowed' | 'too_large' | 'write_failed'; name: string }> {
  const total = entries.reduce((n, e) => n + (e.file.size || 0), 0);
  if (total > FILE_LIMITS.total) return { ok: false, error: 'too_large', name: '' };
  const files: StoredFile[] = [];
  for (const { key, file } of entries) {
    const name = cleanFileName(file.name);
    if (file.size > FILE_LIMITS.bytes) return { ok: false, error: 'too_large', name };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffType(bytes);
    if (!type) return { ok: false, error: 'not_allowed', name };
    const path = `forms/${siteId}/${crypto.randomUUID()}.${EXT[type]}`;
    if (!(await put(path, bytes, type))) return { ok: false, error: 'write_failed', name };
    files.push({ key, name, type, size: bytes.length, path });
  }
  return { ok: true, files };
}

/** What a stored enquiry says about its files (fields.__files), for the Inbox and the
 *  answers table: name, kind and size, and the number to ask for one by. Never the path. */
export function filesOf(fields: unknown): Array<{ n: number; key: string; name: string; type: string; size: number }> {
  const list = fields && typeof fields === 'object' ? (fields as { __files?: unknown }).__files : null;
  return Array.isArray(list) ? list.filter((f) => f && typeof f.path === 'string').map((f: any, n) => ({ n, key: String(f.key || ''), name: cleanFileName(f.name), type: String(f.type || ''), size: Number(f.size) || 0 })) : [];
}
/** The stored path of file `n` on an enquiry, or null. */
export function filePath(fields: unknown, n: number): string | null {
  const list = fields && typeof fields === 'object' ? (fields as { __files?: unknown }).__files : null;
  const f = Array.isArray(list) ? list[n] : null;
  return f && typeof f.path === 'string' && f.path.startsWith('forms/') ? f.path : null;
}

/** A ten-minute link to one file; a PDF opens as a download, under its own name. */
export const FILE_LINK_TTL = 600;
export async function fileLink(path: string, name: string, type: string): Promise<string | null> {
  try {
    const r = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
      method: 'POST', headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: FILE_LINK_TTL }),
    });
    const j = await r.json().catch(() => null);
    if (!j?.signedURL) return null;
    return `${SB_URL}/storage/v1${j.signedURL}${type === 'application/pdf' ? `&download=${encodeURIComponent(name)}` : ''}`;
  } catch { return null; }
}
