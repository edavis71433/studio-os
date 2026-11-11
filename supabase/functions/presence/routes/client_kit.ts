// ── GET /client/kit — the hand-over kit under Help in the portal (builder list item 176) ──
// The client, on their own site, reads what their studio wrote for them
// (lib/handover_kit.ts) once the studio has put it in the portal: who to call,
// the how-tos, the videos, and the files it picked, each with a download link
// that lasts ten minutes. The facts of their website ride along: its address,
// when it first went live, and when its domain renews. A reviewer never gets
// here (the reviewer boundary refuses /client/* routes it doesn't list).
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
    return url ? { name: String(m.alt_text || 'A file'), mime: m.mime, url } : null;
  }))).filter(Boolean);
  return json({ data: {
    contact: kit.contact, guides: kit.guides, videos: kit.videos, files,
    website: { address: siteOrigin(site), live_since: rowsOf<{ created_at: string }>(firstLive)[0]?.created_at || null, domain: site.custom_domain || null, domain_expires_at: rowsOf<{ domain_expires_at?: string | null }>(domQ)[0]?.domain_expires_at || null },
  } }, 200, { ...cors, 'Cache-Control': 'no-store' });
}
