// ── GET /client/kit — the hand-over kit under Help in the portal (builder list item 176) ──
// The client, on their own site, reads what their studio wrote for them
// (lib/handover_kit.ts) once the studio has put it in the portal: who to call,
// the how-tos, the videos, and the files it picked. The facts of their website ride
// along: its address, when it first went live, and when its domain renews. A reviewer
// never gets here (the reviewer boundary refuses /client/* routes it doesn't list).
//
// Builder list item 200 (review file 06, finding 61): a file's link lasts ten minutes,
// and it used to be made when Help opened, so a client who read first and tapped a file
// later got a raw storage error. Each file now carries its id, and a tap asks
// GET /client/kit/files/:id for a fresh link, as the portal's other files do. The list
// still carries a link for each file, for a page loaded before this change.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { readReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import { normalizeKit } from '../lib/handover_kit.ts';
import { signDownload } from '../lib/media.ts';
import { siteOrigin } from '../lib/site.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const rowsOf = <T,>(q: unknown): T[] => (q && (q as { ok?: boolean }).ok && Array.isArray((q as { json?: unknown }).json) ? (q as { json: T[] }).json : []);

export async function handleClientKit(_req: Request, site: SiteRow, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  const kit = normalizeKit(await readReservedJson(site.id, RESERVED_NAMES.handoverKit));
  if (!kit || !kit.shown) return json({ data: null }, 200, cors);
  const [firstLive, domQ, mediaQ] = await Promise.all([
    svc(`presence_publishes?site_id=eq.${site.id}&status=eq.live&select=created_at&order=created_at.asc&limit=1`).catch(() => null),
    svc(`presence_sites?id=eq.${site.id}&select=domain_expires_at&limit=1`).catch(() => null),
    kit.files.length ? svc(`presence_media?id=in.(${kit.files.join(',')})&site_id=eq.${site.id}&deleted_at=is.null&select=id,alt_text,mime,storage_path`).catch(() => null) : Promise.resolve(null),
  ]);
  const media = new Map(rowsOf<{ id: string; alt_text: string; mime: string; storage_path: string }>(mediaQ).map((m) => [m.id, m]));
  // the kit's order; a file removed from Files since simply drops out
  const files = (await Promise.all(kit.files.map(async (id) => {
    const m = media.get(id);
    if (!m) return null;
    const url = await signDownload(m.storage_path, String(m.alt_text || 'file')).catch(() => null);
    return url ? { id: m.id, name: String(m.alt_text || 'A file'), mime: m.mime, url } : null;
  }))).filter(Boolean);
  return json({ data: {
    contact: kit.contact, guides: kit.guides, videos: kit.videos, files,
    website: { address: siteOrigin(site), live_since: rowsOf<{ created_at: string }>(firstLive)[0]?.created_at || null, domain: site.custom_domain || null, domain_expires_at: rowsOf<{ domain_expires_at?: string | null }>(domQ)[0]?.domain_expires_at || null },
  } }, 200, { ...cors, 'Cache-Control': 'no-store' });
}

/** GET /client/kit/files/:id (item 200): a fresh ten-minute link to one file of the kit,
 *  made when the client taps it. Only a file the kit lists, on the caller's own site,
 *  while the studio has the kit in the portal: never a way to open any file of the site. */
export async function handleClientKitFile(site: SiteRow, mediaId: string, cors: Record<string, string>): Promise<Response> {
  const gone = () => json({ error: 'not_in_kit', message: 'That file isn’t in your kit any more.' }, 404, cors);
  const kit = normalizeKit(await readReservedJson(site.id, RESERVED_NAMES.handoverKit));
  const id = String(mediaId || '').toLowerCase();
  if (!kit || !kit.shown || !kit.files.includes(id)) return gone();
  const q = await svc(`presence_media?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id,alt_text,mime,storage_path&limit=1`).catch(() => null);
  if (!q || !(q as { ok?: boolean }).ok) return json({ error: 'unavailable', message: 'That file couldn’t open just now. Try again in a moment.' }, 502, cors);
  const m = rowsOf<{ id: string; alt_text: string; mime: string; storage_path: string }>(q)[0];
  if (!m) return gone();
  const url = await signDownload(m.storage_path, String(m.alt_text || 'file')).catch(() => null);
  if (!url) return json({ error: 'unavailable', message: 'That file couldn’t open just now. Try again in a moment.' }, 502, cors);
  return json({ data: { url, name: String(m.alt_text || 'A file'), mime: m.mime } }, 200, { ...cors, 'Cache-Control': 'no-store' });
}
