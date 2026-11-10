// ── A booking link and photos in an emailed update (bold redesign, Nov 2026) ──
// "+ Booking link" puts {{booking_link}} in the message. On a line of its own it
// becomes a "Book a time" button in the studio's colour; inside a sentence it reads
// "book a time" as a link. Its address is the booking link saved in Business details
// (presence_identity.booking_url), https only; with none saved it renders nothing.
//
// "+ Image" puts ![description](media:<id>) on a line of its own: a photo from the
// studio's own Files. The library stays private (lib/media.ts): the email's image
// link is this function's own address naming the photo and a signature
// (_shared/email_infra.ts imageToken, the open counter's idiom), and GET
// /email/img/<id>.<signature> answers with a short-lived signed link to a 1200px
// copy. Only the site's own shared photos render (not deleted, not archived, not a
// client's private file); anything else renders nothing, and a photo deleted later
// shows a blank pixel rather than a broken image.
import { svc } from './db.ts';
import { attr, safeHref } from './markdown.ts';
import { imageToken } from '../../_shared/email_infra.ts';
import { signThumb, isImageMime } from './media.ts';
import { missingColumnSignal } from './inbound_email.ts';
import { OPEN_PIXEL } from './email_engagement.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const BOOKING_TOKEN_RE = /\{\{\s*booking_link\s*\}\}/gi;
export const BOOKING_LINE_RE = /^\{\{\s*booking_link\s*\}\}$/i;
export const IMAGE_LINE_RE = /^!\[([^\]\n]{0,200})\]\(media:([0-9a-f-]{36})\)$/i;
export const EMAIL_IMAGE_WIDTH = 1200;

/** The booking link when it's a usable https address, '' otherwise. Pure. */
export function bookingHref(url: unknown): string {
  const u = String(url ?? '').trim();
  return /^https:\/\//i.test(u) && safeHref(u) ? u : '';
}

/** The photos a message names on lines of their own: in order, distinct, lower-cased. Pure. */
export function mediaIdsIn(body: unknown): string[] {
  const out: string[] = [];
  for (const line of String(body ?? '').split('\n')) {
    const m = line.trim().match(IMAGE_LINE_RE);
    if (!m || !UUID_RE.test(m[2])) continue;
    const id = m[2].toLowerCase();
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** "Book a time": the platform's email button (inline styles; the shell's .cta rule
 *  keeps the words white in clients that recolour links). Pure. */
export function bookingButton(href: string, accent: string): string {
  const bg = /^#[0-9a-f]{6}$/i.test(String(accent || '')) ? accent : '#5b3fa0';
  return `<p class="cta"><a href="${attr(href)}" rel="noopener" style="display:inline-block;margin-top:6px;background:${bg};color:#ffffff;padding:11px 20px;border-radius:999px;text-decoration:none;font-weight:600">Book a time</a></p>`;
}

/** One photo, full width up to the email's column. '' unless the link is https. Pure. */
export function imageBlock(src: string, alt: unknown): string {
  if (!/^https:\/\/[^"'<>\s]+$/.test(String(src || ''))) return '';
  let a = '';
  for (const ch of String(alt ?? '')) { const c = ch.codePointAt(0)!; if (c >= 32 && c !== 127) a += ch; }
  return `<p style="margin:16px 0"><img src="${attr(src)}" alt="${attr(a.trim().slice(0, 200))}" width="540" style="display:block;width:100%;max-width:540px;height:auto;border:0;border-radius:12px"></p>`;
}

/** The email's link for one library photo ('' for anything that isn't an id). */
export async function emailImageUrl(mediaId: string): Promise<string> {
  if (!UUID_RE.test(String(mediaId || ''))) return '';
  const base = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
  if (!base) return '';
  const id = mediaId.toLowerCase();
  return `${base}/functions/v1/presence/email/img/${id}.${await imageToken(id)}`;
}

/** A photo row an update may show: the site's own image, live, shared. Pure. */
export function mayShowInUpdate(row: { mime?: unknown; asset_status?: unknown; client_private?: unknown } | null | undefined): boolean {
  return !!row && isImageMime(String(row.mime || '')) && row.asset_status !== 'archived' && row.client_private !== true;
}

export interface UpdateExtras { bookingUrl: string; images: Record<string, string> }
export interface ExtrasDeps { read?: (path: string) => Promise<{ ok: boolean; json?: unknown; text?: string }>; imageUrl?: (id: string) => Promise<string> }

/** What a message needs beyond the name fill-ins: the booking link (read only when
 *  the message asks for it) and a link for each photo it names that is still the
 *  site's own shared photo. A failed read renders nothing for that part; it never
 *  fails a send. */
export async function loadUpdateExtras(siteId: string, body: unknown, deps: ExtrasDeps = {}): Promise<UpdateExtras> {
  const read = deps.read || ((p: string) => svc(p));
  const imageUrl = deps.imageUrl || emailImageUrl;
  const out: UpdateExtras = { bookingUrl: '', images: {} };
  if (!UUID_RE.test(String(siteId || ''))) return out;
  const text = String(body ?? '');
  const ids = mediaIdsIn(text);
  const wantsBooking = /\{\{\s*booking_link\s*\}\}/i.test(text);
  const photos = async () => {
    const path = (cols: string) => `presence_media?site_id=eq.${siteId}&id=in.(${ids.join(',')})&deleted_at=is.null&select=${cols}`;
    let r = await read(path('id,mime,asset_status,client_private'));
    // 0131 adds client_private: before it, nothing is private (routes/assets.ts readMedia)
    if (!r.ok && missingColumnSignal(r.json, r.text, 'client_private')) r = await read(path('id,mime,asset_status'));
    return r;
  };
  const [ident, media] = await Promise.all([
    wantsBooking ? read(`presence_identity?site_id=eq.${siteId}&select=booking_url&limit=1`).catch(() => null) : Promise.resolve(null),
    ids.length ? photos().catch(() => null) : Promise.resolve(null),
  ]);
  if (ident && ident.ok && Array.isArray(ident.json)) out.bookingUrl = bookingHref((ident.json[0] as any)?.booking_url);
  if (media && media.ok && Array.isArray(media.json)) {
    for (const row of media.json as any[]) {
      const id = String(row?.id || '').toLowerCase();
      if (!ids.includes(id) || !mayShowInUpdate(row)) continue;
      const u = await imageUrl(id);
      if (u) out.images[id] = u;
    }
  }
  return out;
}

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
const BLANK = () => new Response(OPEN_PIXEL, { status: 200, headers: { 'Content-Type': 'image/gif', 'Content-Length': String(OPEN_PIXEL.length), ...NO_STORE } });

export interface ImageRouteDeps { token?: (id: string) => Promise<string>; read?: (path: string) => Promise<{ ok: boolean; json?: unknown }>; sign?: (storagePath: string, mime: string, width: number) => Promise<string | null> }

/** GET /email/img/<id>.<signature> — public by design: the signature is the key.
 *  A good link answers with a short-lived signed link to the photo (sent on, not
 *  streamed); a wrong, old or deleted one answers a blank pixel, never an error page. */
export async function handleEmailImage(mediaId: string, sig: string, deps: ImageRouteDeps = {}): Promise<Response> {
  const token = deps.token || imageToken;
  const read = deps.read || ((p: string) => svc(p));
  const sign = deps.sign || signThumb;
  try {
    if (!UUID_RE.test(mediaId) || sig !== await token(mediaId.toLowerCase())) return BLANK();
    const r = await read(`presence_media?id=eq.${mediaId.toLowerCase()}&deleted_at=is.null&select=storage_path,mime,asset_status&limit=1`);
    const row = r.ok && Array.isArray(r.json) ? (r.json[0] as any) : null;
    if (!row || !isImageMime(String(row.mime || '')) || row.asset_status === 'archived') return BLANK();
    const url = await sign(String(row.storage_path || ''), String(row.mime || ''), EMAIL_IMAGE_WIDTH);
    if (!url || !/^https:\/\//.test(url)) return BLANK();
    // the signed link lives an hour (lib/media.ts THUMB_TTL): a cached hop stays well inside it
    return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'private, max-age=600', 'X-Robots-Tag': 'noindex' } });
  } catch { return BLANK(); }
}
