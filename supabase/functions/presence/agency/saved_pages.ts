// ── Pages saved to the studio: the studio's own list (builder list item 216) ──
// GET /agency/pages lists them for Add a page (never their sections or photos);
// POST saves one page of one of the studio's sites, with copies of its photos in the
// studio's own folder (templates/<agency id>/, as a template keeps them, item 145) so it
// outlives the site it came from; PATCH renames or regroups one; DELETE removes one and
// its photo copies. Fenced to the studio like /agency/kits. Adding one to a site is a
// site route (routes/saved_pages.ts), since it writes that site's draft.
//
// Before migration 0217 there is no table: the list answers empty with available: false,
// and a save says saved pages aren't switched on yet, with nothing kept.
import { json } from '../../_shared/http.ts';
import { svc, svcCount } from '../lib/db.ts';
import { can, agencySiteIds } from './auth.ts';
import type { AgencyMember } from './auth.ts';
import { copyObject, removeTemplatePhotos } from '../lib/media.ts';
import { readByIds, inBatches } from './kit_io.ts';
import { MAX_LAYOUT_MEDIA } from '../lib/site_layout.ts';
import type { LayoutMedia, LayoutLibraryItem } from '../lib/site_layout.ts';
import { cleanSavedName, cleanPurpose, pageInSettings, linkedIdsIn, pageMediaIds, buildSavedPayload, savedPageRow, MAX_SAVED_PAGES } from '../lib/saved_pages.ts';
import { PAGE_SLUG_RE } from '../lib/page_ops.ts';
import type { SiteRow } from '../lib/site.ts';
import { UUID_LOWER_RE as UUID_RE } from '../lib/uuid.ts';

const forbid = (cors: Record<string, string>) => json({ error: 'forbidden', message: 'Your role doesn’t include this.' }, 403, cors);
const rows = <T,>(r: { ok?: boolean; json?: unknown }): T[] => (r.ok !== false && Array.isArray(r.json) ? r.json as T[] : []);
export const NOT_SWITCHED_ON = { error: 'not_ready', message: 'Saved pages aren’t switched on yet. Nothing was saved.' };
/** The table isn't there yet (migration 0217 not applied): PostgREST answers 404 for a
 *  table it doesn't know, or the database's "no such table". */
export const tableMissing = (r: { ok?: boolean; status?: number; json?: unknown; text?: string }): boolean =>
  !r.ok && (r.status === 404 || /PGRST205|42P01/.test(String(r.text || '') + JSON.stringify(r.json ?? '')));
const LIST = 'id,name,purpose,created_from_site,created_by,created_at,from_name:payload->from_name,outline:payload->outline,summary:payload->summary';

export async function handleSavedPages(req: Request, route: string, method: string, member: AgencyMember, cors: Record<string, string>,
  deps: { ownSite: () => Promise<SiteRow | null> }): Promise<Response | null> {
  if (route !== '/agency/pages' && !route.startsWith('/agency/pages/')) return null;
  const body = async (): Promise<Record<string, unknown>> => { try { const b = await req.json(); return b && typeof b === 'object' ? b : {}; } catch { return {}; } };

  if (route === '/agency/pages' && method === 'GET') {
    if (!can(member.role, 'read')) return forbid(cors);
    const r = await svc(`presence_saved_pages?agency_id=eq.${member.agency_id}&select=${LIST}&order=created_at.desc&limit=${MAX_SAVED_PAGES}`);
    if (!r.ok) {
      if (tableMissing(r)) return json({ data: [], available: false, can_manage: can(member.role, 'manage_clients') }, 200, cors);
      return json({ error: 'read_failed', message: 'We couldn’t read your saved pages just now.' }, 502, cors);
    }
    return json({ data: rows<Record<string, unknown>>(r).map(savedPageRow), available: true, can_manage: can(member.role, 'manage_clients') }, 200, cors);
  }

  if (route === '/agency/pages' && method === 'POST') {
    if (!can(member.role, 'manage_clients')) return forbid(cors);
    const b = await body();
    const siteId = String(b.site_id || '').toLowerCase(), slug = String(b.slug ?? '');
    const name = cleanSavedName(b.name), purpose = cleanPurpose(b.purpose);
    if (!UUID_RE.test(siteId) || (slug !== '' && !PAGE_SLUG_RE.test(slug))) return json({ error: 'bad_request', message: 'Say which page to save.' }, 400, cors);
    if (!name) return json({ error: 'bad_name', message: 'Give the page a name.' }, 400, cors);
    if (!purpose) return json({ error: 'bad_purpose', message: 'Say what the page is for: introduce, sell, show or a home page.' }, 400, cors);
    // one of the studio's clients, or the studio's own site
    if (!(await agencySiteIds(member.agency_id, true)).includes(siteId)) {
      const own = await deps.ownSite().catch(() => null);
      if (!own || String(own.id).toLowerCase() !== siteId) return json({ error: 'not_found', message: 'Not one of your clients.' }, 404, cors);
    }
    const count = await svcCount(`presence_saved_pages?agency_id=eq.${member.agency_id}`);
    if (count !== null && count >= MAX_SAVED_PAGES) return json({ error: 'full', message: `Your studio keeps up to ${MAX_SAVED_PAGES} saved pages. Remove one first.` }, 422, cors);
    // the page as its draft holds it (the editor saves what is typed first)
    const [setQ, identQ] = await Promise.all([
      svc(`presence_settings?site_id=eq.${siteId}&select=blocks,pages&limit=1`),
      svc(`presence_identity?site_id=eq.${siteId}&select=business_name&limit=1`),
    ]);
    if (!setQ.ok) return json({ error: 'read_failed', message: 'We couldn’t read that page just now. Nothing was saved.' }, 502, cors);
    const page = pageInSettings(rows<Record<string, unknown>>(setQ)[0] || {}, slug);
    if (!page) return json({ error: 'not_found', message: 'We couldn’t find that page.' }, 404, cors);
    if (!page.blocks.length) return json({ error: 'empty_page', message: 'That page has no sections yet. Add some first.' }, 422, cors);
    const linked = linkedIdsIn(page.blocks);
    const library = linked.length ? await readByIds<LayoutLibraryItem>('presence_content_library', siteId, linked, 'id,name,payload') : [];
    const ids = pageMediaIds(page.blocks, library);
    const found = (ids.length ? await readByIds<LayoutMedia>('presence_media', siteId, ids, 'id,storage_path,mime,alt_text,bytes,width,height,focal_x,focal_y', '&deleted_at=is.null') : []).slice(0, MAX_LAYOUT_MEDIA);
    // the photos: the studio's own copies, so the saved page outlives the site
    const folder = `templates/${member.agency_id}`;
    const copies = await inBatches(found, 6, async (m) => { const p = await copyObject(folder, m.storage_path, m.mime || 'image/jpeg'); return p ? { ...m, storage_path: p } : null; });
    const media = copies.filter((m): m is LayoutMedia => !!m);
    const fromName = String(rows<{ business_name?: string }>(identQ)[0]?.business_name || '').trim();
    const payload = buildSavedPayload({ title: page.title, from_name: fromName, blocks: page.blocks, library, media });
    const ins = await svc('presence_saved_pages', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ agency_id: member.agency_id, name, purpose, payload, created_from_site: siteId, created_by: member.email }),
    });
    const row = rows<Record<string, unknown>>(ins)[0];
    if (!ins.ok || !row) {
      if (media.length) await removeTemplatePhotos(member.agency_id, media.map((m) => m.storage_path)).catch(() => 0);   // nothing half-kept
      if (tableMissing(ins)) return json(NOT_SWITCHED_ON, 503, cors);
      return json({ error: 'write_failed', message: 'That didn’t save. Nothing was kept.' }, 502, cors);
    }
    return json({ data: { ...savedPageRow({ ...row, from_name: fromName, outline: payload.outline, summary: payload.summary }), photos_failed: found.length - media.length } }, 201, cors);
  }

  const m = route.match(/^\/agency\/pages\/([0-9a-f-]{36})$/);
  if (!m) return null;
  const id = m[1].toLowerCase();
  if (!UUID_RE.test(id)) return json({ error: 'bad_request', message: 'Which saved page?' }, 400, cors);

  if (method === 'PATCH') {
    if (!can(member.role, 'manage_clients')) return forbid(cors);
    const b = await body();
    const patch: Record<string, unknown> = {};
    if (b.name !== undefined) { const n = cleanSavedName(b.name); if (!n) return json({ error: 'bad_name', message: 'Give the page a name.' }, 400, cors); patch.name = n; }
    if (b.purpose !== undefined) { const p = cleanPurpose(b.purpose); if (!p) return json({ error: 'bad_purpose', message: 'Say what the page is for: introduce, sell, show or a home page.' }, 400, cors); patch.purpose = p; }
    if (!Object.keys(patch).length) return json({ error: 'nothing_to_update', message: 'Nothing to change.' }, 400, cors);
    const w = await svc(`presence_saved_pages?id=eq.${id}&agency_id=eq.${member.agency_id}&select=id,name,purpose`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    });
    const row = rows<{ id: string; name: string; purpose: string }>(w)[0];
    if (!w.ok && tableMissing(w)) return json(NOT_SWITCHED_ON, 503, cors);
    if (!row) return json({ error: 'not_found', message: 'Not one of your saved pages.' }, 404, cors);
    return json({ data: { id: row.id, name: row.name, purpose: cleanPurpose(row.purpose) } }, 200, cors);
  }

  if (method === 'DELETE') {
    if (!can(member.role, 'manage_clients')) return forbid(cors);
    const q = await svc(`presence_saved_pages?id=eq.${id}&agency_id=eq.${member.agency_id}&select=media:payload->media&limit=1`);
    if (!q.ok && tableMissing(q)) return json(NOT_SWITCHED_ON, 503, cors);
    const photos = rows<{ media?: Array<{ storage_path?: string }> }>(q)[0]?.media;
    const w = await svc(`presence_saved_pages?id=eq.${id}&agency_id=eq.${member.agency_id}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
    if (!w.ok || !rows(w).length) return json({ error: 'not_found', message: 'Not one of your saved pages.' }, 404, cors);
    // its own photo copies go with it: only ever from the studio's own folder
    const removed = Array.isArray(photos) && photos.length ? await removeTemplatePhotos(member.agency_id, photos.map((p) => String(p?.storage_path || ''))) : 0;
    return json({ data: { ok: true, photos_removed: removed } }, 200, cors);
  }
  return null;
}
