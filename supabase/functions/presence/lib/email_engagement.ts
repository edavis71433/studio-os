// ── "Did they open it?" — the update half (sales review item 69, Nov 2026) ───
// Each emailed update carries a 1×1 transparent image whose link names that
// send's row (presence_broadcast_sends.id) and a signature, never an address.
// When the person's email app shows images, it fetches the image and the row
// gets opened_at (the first time only). The sent update then reads "Opened by
// 3 of 10" with who.
//
// Why our own image and not Resend's open tracking: Resend's switch covers every
// email from the domain (proposals, invoices, receipts), needs a tracking DNS
// record, and Resend itself advises against it for that kind of email because it
// can hurt inbox placement. So only updates carry the image. Proposals,
// agreements and invoices count as opened when the client opens the page the
// email links to (routes/sales.ts firstOpen) — a better signal anyway.
//
// A rough count either way: some email apps open every message on arrival, and
// others block images. Before APPLY-0144 the column doesn't exist: the stamp
// fails quietly and the reads fall back, so nothing else changes.
import { svc } from './db.ts';
import { openToken } from '../../_shared/email_infra.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The classic 43-byte transparent GIF. */
export const OPEN_PIXEL = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
]);

/** The open counter's link for one send row ('' for anything that isn't a row id). */
export async function openPixelUrl(sendId: string): Promise<string> {
  if (!UUID_RE.test(String(sendId || ''))) return '';
  const base = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
  if (!base) return '';
  return `${base}/functions/v1/presence/email/open/${sendId.toLowerCase()}.${await openToken(sendId)}.gif`;
}

/** The image tag that goes at the end of an update's body. Pure. */
export function openPixelTag(url: string): string {
  if (!/^https:\/\/[^"'<>\s]+$/.test(url)) return '';
  return `<img src="${url}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;margin:0;padding:0">`;
}

export const PIXEL_HEADERS: Record<string, string> = {
  'Content-Type': 'image/gif', 'Content-Length': String(OPEN_PIXEL.length),
  'Cache-Control': 'no-store, no-cache, must-revalidate, private', 'X-Robots-Tag': 'noindex',
};

/** GET /email/open/<send id>.<signature>.gif — stamp the first open, always answer
 *  the image (a wrong or old link still shows nothing broken). Public by design:
 *  the signature is the key, and the row is only ever stamped once. (A HEAD — a
 *  link checker, not a person — gets the headers and stamps nothing: index.ts.) */
export async function handleEmailOpen(sendId: string, sig: string): Promise<Response> {
  try {
    if (UUID_RE.test(sendId) && sig === await openToken(sendId)) {
      await svc(`presence_broadcast_sends?id=eq.${sendId.toLowerCase()}&status=eq.sent&opened_at=is.null`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ opened_at: new Date().toISOString() }),
      });
    }
  } catch { /* an open is a nicety: the image still answers */ }
  return new Response(OPEN_PIXEL, { status: 200, headers: PIXEL_HEADERS });
}

export interface Engagement { sent: number; opened: number; opened_by: string[] }
/** Opens for one sent update, from its send rows (newest open first). Pure. */
export function engagementOf(sendRows: Array<{ email?: unknown; opened_at?: unknown }>, max = 25): Engagement {
  const list = Array.isArray(sendRows) ? sendRows : [];
  const opened = list.filter((r) => r && r.opened_at)
    .sort((a, b) => String(b.opened_at).localeCompare(String(a.opened_at)));
  return { sent: list.length, opened: opened.length, opened_by: opened.slice(0, max).map((r) => String(r.email || '')).filter(Boolean) };
}

/** Read one sent update's opens; null before APPLY-0144 (no opened_at column) or on a failed read. */
export async function loadEngagement(siteId: string, broadcastId: string): Promise<Engagement | null> {
  if (!UUID_RE.test(siteId) || !UUID_RE.test(broadcastId)) return null;
  const r = await svc(`presence_broadcast_sends?broadcast_id=eq.${broadcastId}&site_id=eq.${siteId}&status=eq.sent&select=email,opened_at&limit=10000`).catch(() => null);
  if (!r || !r.ok || !Array.isArray(r.json)) return null;
  return engagementOf(r.json);
}
