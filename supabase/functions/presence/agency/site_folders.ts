// ── Folders, tags and saved views on Sites (builder list item 176, Nov 2026) ──────
//   GET  /agency/sites/organize       { folders, views, can_change }
//   PUT  /agency/sites/folders        { folders: [{ id?, name, color }] }  the list as it should be:
//                                     add, rename, recolour, reorder; a folder left out is removed
//                                     and its sites go back to No folder (no site is touched)
//   POST /agency/sites/folders/move   { site_ids, folder: id | null }  one site or several into a
//                                     folder, or out of every folder
//   PUT  /agency/sites/views          { views: [...] }  the studio's saved views on Sites
//   POST /agency/sites/tags           { site_ids, add?, remove? }  one tag onto, or off, several sites
// Borrowed from Wix Studio's Sites list (folders, tags, saved views, tick boxes). One folder a
// site; tags cross folders and stay where they always were (presence_agency_clients.tags, set
// for one site by PATCH /agency/clients/:id). Folders and views are two reserved rows on the
// studio's own site, shared by the team like the sales lists' saved views; each write is a
// compare-and-swap, so two people moving sites at once don't undo each other.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { can, agencySiteIds } from './auth.ts';
import type { AgencyMember } from './auth.ts';
import type { SiteRow } from '../lib/site.ts';
import { readReservedJsonOrThrow, updateReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import { UUID_LOWER_RE as UUID_RE } from '../lib/uuid.ts';

export const MAX_FOLDERS = 30;
export const MAX_SITE_VIEWS = 20;
export const MAX_TAGS = 10;
export const MAX_BULK = 100;
export const FOLDER_COLORS = ['violet', 'amber', 'teal', 'green', 'rose', 'blue', 'slate'] as const;
export type FolderColor = typeof FOLDER_COLORS[number];
export interface Folder { id: string; name: string; color: FolderColor; sites: string[] }
/** A saved view: the folder ('' for every site, 'none' for No folder), a tag, the filter
 *  pill, the search, the sort and Cards or Table, as the page had them. */
export interface SiteView { id: string; name: string; folder: string; tag: string; filter: string; q: string; sort: { key: string; dir: 1 | -1 } | null; display: 'cards' | 'table' }
export const SITE_FILTERS = ['all', 'needs', 'live', 'notlive', 'elsewhere', 'changes', 'domains', 'drops'];

const FOLDER_ID = /^f-[a-z0-9]{8}$/;
const VIEW_ID = /^v-[a-z0-9]{8}$/;
const str = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const rid = (p: string) => p + '-' + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');

/** A tag as the studio's tags are kept: lower case, single spaces, no commas, 40 at most. Pure. */
export function cleanTag(raw: unknown): string { return str(raw, 40).toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim(); }

/** The stored folders: valid ones, each name once, each site in one folder at most
 *  (the first that has it), thirty at most. Pure. */
export function normalizeFolders(raw: unknown): Folder[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { folders?: unknown }).folders) ? (raw as { folders: unknown[] }).folders : [];
  const out: Folder[] = [];
  const placed = new Set<string>();
  for (const f of list) {
    if (!f || typeof f !== 'object') continue;
    const r = f as Record<string, unknown>;
    const id = typeof r.id === 'string' && FOLDER_ID.test(r.id) ? r.id : null;
    const name = str(r.name, 40);
    if (!id || !name || out.some((x) => x.id === id || x.name.toLowerCase() === name.toLowerCase())) continue;
    const color = (FOLDER_COLORS as readonly string[]).includes(String(r.color)) ? r.color as FolderColor : 'violet';
    const sites: string[] = [];
    for (const s of Array.isArray(r.sites) ? r.sites : []) { const v = String(s); if (UUID_RE.test(v) && !placed.has(v)) { placed.add(v); sites.push(v); } }
    out.push({ id, name, color, sites });
    if (out.length >= MAX_FOLDERS) break;
  }
  return out;
}

/** The folder list as the studio wants it: each kept folder keeps its sites; a new one starts
 *  empty with the next colour; one left out is gone (its sites are in no folder). Answers the
 *  words for the page when it can't be kept. Pure. */
export function applyFolderList(cur: Folder[], incoming: unknown): Folder[] | { error: string } {
  if (!Array.isArray(incoming)) return { error: 'Send the folders as a list.' };
  if (incoming.length > MAX_FOLDERS) return { error: `Up to ${MAX_FOLDERS} folders.` };
  const out: Folder[] = [];
  for (const f of incoming) {
    const r = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
    const name = str(r.name, 40);
    if (!name) return { error: 'Give each folder a name.' };
    if (out.some((x) => x.name.toLowerCase() === name.toLowerCase())) return { error: `There’s already a folder called “${name}”.` };
    const was = typeof r.id === 'string' ? cur.find((x) => x.id === r.id) : undefined;
    const used = new Set(out.map((x) => x.color).concat(cur.map((x) => x.color)));
    const color = (FOLDER_COLORS as readonly string[]).includes(String(r.color)) ? r.color as FolderColor : was?.color || FOLDER_COLORS.find((c) => !used.has(c)) || 'violet';
    out.push({ id: was?.id || rid('f'), name, color, sites: was ? was.sites : [] });
  }
  return out;
}

/** Sites into one folder (out of any other), or out of every folder (null). Pure. */
export function moveSites(cur: Folder[], siteIds: string[], folderId: string | null): Folder[] | { error: string } {
  if (folderId !== null && !cur.some((f) => f.id === folderId)) return { error: 'That folder isn’t there any more. Refresh and try again.' };
  const moving = new Set(siteIds);
  return cur.map((f) => {
    const kept = f.sites.filter((s) => !moving.has(s));
    return f.id === folderId ? { ...f, sites: [...kept, ...siteIds.filter((s) => !kept.includes(s))] } : { ...f, sites: kept };
  });
}

/** The saved views: valid ones, each name once (a later one of the same name wins), twenty at most. Pure. */
export function normalizeSiteViews(raw: unknown): SiteView[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { views?: unknown }).views) ? (raw as { views: unknown[] }).views : Array.isArray(raw) ? raw as unknown[] : [];
  const out: SiteView[] = [];
  for (const v of list) {
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    const name = str(r.name, 60);
    if (!name) continue;
    const id = typeof r.id === 'string' && VIEW_ID.test(r.id) ? r.id : rid('v');
    const folder = r.folder === 'none' || (typeof r.folder === 'string' && FOLDER_ID.test(r.folder)) ? String(r.folder) : '';
    const s = r.sort as Record<string, unknown> | null | undefined;
    const sort = s && /^[a-z_]{1,20}$/.test(String(s.key || '')) ? { key: String(s.key), dir: (Number(s.dir) < 0 || String(s.dir) === 'desc' ? -1 : 1) as 1 | -1 } : null;
    const view: SiteView = { id, name, folder, tag: cleanTag(r.tag), filter: SITE_FILTERS.includes(String(r.filter)) ? String(r.filter) : 'all', q: str(r.q, 80), sort, display: r.display === 'table' ? 'table' : 'cards' };
    const at = out.findIndex((x) => x.id === view.id || x.name.toLowerCase() === view.name.toLowerCase());
    if (at >= 0) out.splice(at, 1);
    out.push(view);
  }
  return out.slice(-MAX_SITE_VIEWS);
}

/** A site's tags after adding or taking off one: cleaned, each once, ten at most. Pure. */
export function retag(tags: unknown, add: string, remove: string): string[] {
  const cur = [...new Set((Array.isArray(tags) ? tags : []).map(cleanTag).filter(Boolean))];
  const next = remove ? cur.filter((t) => t !== remove) : cur;
  if (add && !next.includes(add)) next.push(add);
  return next.slice(0, MAX_TAGS);
}

export interface SiteFoldersDeps { ownSite: () => Promise<SiteRow | null> }
const forbid = (cors: Record<string, string>) => json({ error: 'forbidden', message: 'Your role doesn’t include this.' }, 403, cors);

/** The routes above, or null when the route is someone else's. */
export async function handleSiteFolders(req: Request, route: string, method: string, member: AgencyMember, cors: Record<string, string>, deps: SiteFoldersDeps): Promise<Response | null> {
  const ROUTES: Record<string, string> = { '/agency/sites/organize': 'GET', '/agency/sites/folders': 'PUT', '/agency/sites/folders/move': 'POST', '/agency/sites/views': 'PUT', '/agency/sites/tags': 'POST' };
  if (ROUTES[route] !== method) return null;
  const canChange = can(member.role, 'manage_clients');
  if (method === 'GET' ? !can(member.role, 'read') : !canChange) return forbid(cors);
  let b: Record<string, unknown> = {};
  if (method !== 'GET') { try { b = await req.json(); } catch { return json({ error: 'bad_request', message: 'That request didn’t come through whole.' }, 400, cors); } }

  // ── tags live on each client row, not the studio's site ──
  if (route === '/agency/sites/tags') {
    const ids = Array.isArray(b.site_ids) ? [...new Set(b.site_ids.map(String))] : [];
    const add = cleanTag(b.add), remove = cleanTag(b.remove);
    if (!ids.length || ids.length > MAX_BULK || !ids.every((id) => UUID_RE.test(id))) return json({ error: 'bad_request', message: `Pick between 1 and ${MAX_BULK} sites.` }, 400, cors);
    if (!add && !remove) return json({ error: 'bad_request', message: 'Say which tag to add or take off.' }, 400, cors);
    const mine = new Set(await agencySiteIds(member.agency_id));
    if (!ids.every((id) => mine.has(id))) return json({ error: 'not_found', message: 'One of those sites isn’t one of yours.' }, 404, cors);
    const cur = await svc(`presence_agency_clients?agency_id=eq.${member.agency_id}&site_id=in.(${ids.join(',')})&select=site_id,tags&limit=${MAX_BULK}`);
    if (!cur.ok) return json({ error: 'read_failed', message: 'Their tags couldn’t be read just now. Nothing changed.' }, 502, cors);
    const rows = (Array.isArray(cur.json) ? cur.json : []) as Array<{ site_id: string; tags?: unknown }>;
    const changed: Array<{ site_id: string; tags: string[] }> = [];
    let failed = 0;
    for (const r of rows) {
      const tags = retag(r.tags, add, remove);
      if (JSON.stringify(tags) === JSON.stringify(r.tags)) { changed.push({ site_id: r.site_id, tags }); continue; }   // already so
      const w = await svc(`presence_agency_clients?agency_id=eq.${member.agency_id}&site_id=eq.${r.site_id}`, { method: 'PATCH', body: JSON.stringify({ tags }) }).catch(() => ({ ok: false }));
      if (w.ok) changed.push({ site_id: r.site_id, tags }); else failed++;
    }
    if (failed) return json({ error: 'write_failed', message: `${failed} of them didn’t save. Try again.`, data: { sites: changed } }, 502, cors);
    return json({ data: { sites: changed } }, 200, cors);
  }

  const own = await deps.ownSite();
  if (!own) return json({ error: 'no_studio_site', message: 'Folders and views are kept on your studio’s own site, and this sign-in doesn’t have one.' }, 409, cors);

  if (route === '/agency/sites/organize') {
    // a failed read is not "no folders": the page then saved over the real list (the sales views learned this)
    try {
      const [f, v] = await Promise.all([readReservedJsonOrThrow(own.id, RESERVED_NAMES.siteFolders), readReservedJsonOrThrow(own.id, RESERVED_NAMES.siteViews)]);
      return json({ data: { folders: normalizeFolders(f), views: normalizeSiteViews(v), colors: FOLDER_COLORS, can_change: canChange } }, 200, cors);
    } catch {
      return json({ error: 'read_failed', message: 'Your folders and views couldn’t load just now.' }, 502, cors);
    }
  }

  if (route === '/agency/sites/views') {
    if (!Array.isArray(b.views)) return json({ error: 'bad_request', message: 'Send the views as a list.' }, 400, cors);
    const views = normalizeSiteViews(b.views);
    const saved = await updateReservedJson(own.id, RESERVED_NAMES.siteViews, () => ({ views }), member.email);
    return saved ? json({ data: { views: normalizeSiteViews(saved) } }, 200, cors) : json({ error: 'write_failed', message: 'Your view didn’t save. Try again.' }, 502, cors);
  }

  // the folders: the list itself, or sites moved between them
  let refused = '';
  let ids: string[] = [];
  if (route === '/agency/sites/folders/move') {
    ids = Array.isArray(b.site_ids) ? [...new Set(b.site_ids.map(String))] : [];
    if (!ids.length || ids.length > MAX_BULK || !ids.every((id) => UUID_RE.test(id))) return json({ error: 'bad_request', message: `Pick between 1 and ${MAX_BULK} sites.` }, 400, cors);
    if (!(b.folder === null || (typeof b.folder === 'string' && FOLDER_ID.test(b.folder)))) return json({ error: 'bad_request', message: 'Say which folder, or none.' }, 400, cors);
    const mine = new Set(await agencySiteIds(member.agency_id));
    if (!ids.every((id) => mine.has(id))) return json({ error: 'not_found', message: 'One of those sites isn’t one of yours.' }, 404, cors);
  }
  const saved = await updateReservedJson(own.id, RESERVED_NAMES.siteFolders, (cur) => {
    const folders = normalizeFolders(cur);
    const next = route === '/agency/sites/folders' ? applyFolderList(folders, b.folders) : moveSites(folders, ids, (b.folder as string | null) ?? null);
    if ('error' in next) { refused = next.error; throw new Error('refused'); }
    return { folders: next };
  }, member.email).catch(() => null);
  if (refused) return json({ error: 'bad_request', message: refused }, 400, cors);
  if (!saved) return json({ error: 'write_failed', message: 'That didn’t save. Nothing changed; try again.' }, 502, cors);
  return json({ data: { folders: normalizeFolders(saved) } }, 200, cors);
}
