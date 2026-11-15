// ── Builder list item 234 (Nov 2026): the pages and quick links a client's studio made for them ──
// GET /client/portal-pages: the pages this client may see (every client's, and those
// chosen for them) and the studio's quick links, for the top of the portal's Help.
// GET /client/portal-pages/files/<media id>?page=<page id>: a fresh ten-minute link to a
// file on one of those pages; refused unless that page is theirs and lists that file. A
// page chosen for other clients is never sent, so it is not there for anyone else.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { linksForCustomer } from '../lib/service_bridge.ts';
import { readPortalPages, pagesFor, subLine, isId } from '../lib/portal_pages.ts';
import { signDownload } from '../lib/media.ts';
import type { SiteRow } from '../lib/site.ts';

async function studioOf(site: SiteRow): Promise<string> {
  const links = site.client_id ? await linksForCustomer(String(site.client_id)) : [];
  return String(links[0]?.agency_site_id || '');
}

export async function handleClientPortalPages(site: SiteRow, cors: Record<string, string>) {
  const studio = await studioOf(site);
  if (!studio) return json({ data: { pages: [], links: [] } }, 200, cors);
  const all = await readPortalPages(studio);
  const pages = pagesFor(all, site.id).map((p) => ({ id: p.id, title: p.title, sub: subLine(p.words), words: p.words, items: p.items, updated_at: p.updated_at }));
  return json({ data: { pages, links: all.links } }, 200, cors);
}

export async function handleClientPortalPageFile(req: Request, site: SiteRow, mediaId: string, cors: Record<string, string>) {
  const missing = () => json({ error: 'not_found', message: 'That file isn’t there any more.' }, 404, cors);
  const pageId = String(new URL(req.url).searchParams.get('page') || '').toLowerCase();
  const id = String(mediaId || '').toLowerCase();
  if (!isId(id) || !isId(pageId)) return missing();
  const studio = await studioOf(site);
  if (!studio) return missing();
  const page = pagesFor(await readPortalPages(studio), site.id).find((p) => p.id === pageId);
  if (!page || !page.items.some((i) => i.kind === 'file' && i.media_id === id)) return missing();
  const r = await svc(`presence_media?id=eq.${id}&site_id=eq.${studio}&deleted_at=is.null&select=storage_path,alt_text,client_private&limit=1`);
  const m = (Array.isArray(r.json) ? r.json : [])[0] as { storage_path?: string; alt_text?: string | null; client_private?: boolean } | undefined;
  if (!m?.storage_path || m.client_private === true) return missing();   // a file private to one client never goes on a page
  const url = await signDownload(m.storage_path, String(m.alt_text || '').trim() || undefined);
  if (!url) return json({ error: 'sign_failed', message: 'That file couldn’t open just now. Try again in a moment.' }, 502, cors);
  return json({ data: { url } }, 200, cors);
}
