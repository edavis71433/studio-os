// ── Recently deleted pages, kept 30 days (builder list item 154, Nov 2026 review) ──
// Deleting a page in the editor gave a 20-second Undo and a "Before deleting"
// checkpoint, but restoring a checkpoint or a version never brought the page back:
// the draft writer (lib/draft_writer.ts) rewrites business details, hours and the
// lists, never the pages. Now every page that leaves a draft is kept exactly as it
// was stored, for 30 days, by a trigger on presence_settings (migration 0154), and
// Versions lists them here; Put back adds one page to the draft as it was and
// changes nothing else. The live site waits for a publish, as with any edit.
//
//   GET  /pages/deleted                → the list, newest first
//   POST /pages/deleted/:id/restore    → put one back (its own address, or the first free "-2")
import { json } from '../../_shared/http.ts';
import { svc, type SiteDb } from '../lib/db.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { guardStaleDraft } from '../lib/optimistic_lock.ts';
import { PAGE_SLUG_RE } from '../lib/page_ops.ts';
import { deletedPagesList, freeSlug, PAGE_KEEP_DAYS } from '../lib/site_trash.ts';
import type { DeletedPageRow } from '../lib/site_trash.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const rowsOf = <T,>(r: { ok?: boolean; json?: unknown }): T[] => (r.ok !== false && Array.isArray(r.json) ? r.json as T[] : []);
const since = () => new Date(Date.now() - PAGE_KEEP_DAYS * 86_400_000).toISOString();

/** GET /pages/deleted — the pages deleted in the last 30 days. Before migration
 *  0154 there is no table: the list is empty and says why. */
export async function handleDeletedPages(site: SiteRow, cors: Record<string, string>) {
  const r = await svc(`presence_deleted_pages?site_id=eq.${site.id}&deleted_at=gt.${encodeURIComponent(since())}&select=id,slug,title,page,deleted_at&order=deleted_at.desc&limit=40`);
  if (!r.ok) {
    const missing = r.status === 404 || /presence_deleted_pages/.test(String(r.text || ''));
    return json({ data: [], ready: !missing, message: missing ? 'Deleted pages are kept once one database step is done.' : 'Deleted pages couldn’t load just now.' }, missing ? 200 : 502, cors);
  }
  return json({ data: deletedPagesList(rowsOf<DeletedPageRow>(r), new Date().toISOString()), ready: true, keep_days: PAGE_KEEP_DAYS }, 200, cors);
}

/** POST /pages/deleted/:id/restore — one page back into the draft, as it was. */
export async function handleDeletedPageRestore(req: Request, db: SiteDb, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'bad_request', message: 'Which page should come back?' }, 400, cors);
  const stale = await guardStaleDraft(req, site, cors);
  if (stale) return stale;
  const kept = rowsOf<DeletedPageRow>(await svc(`presence_deleted_pages?id=eq.${id}&site_id=eq.${site.id}&deleted_at=gt.${encodeURIComponent(since())}&select=id,slug,title,page,deleted_at&limit=1`))[0];
  const page = kept && kept.page && typeof kept.page === 'object' && !Array.isArray(kept.page) ? kept.page as Record<string, unknown> : null;
  if (!kept || !page) return json({ error: 'not_found', message: 'That page isn’t kept any more.' }, 404, cors);
  const cur = await db(`presence_settings?site_id=eq.${site.id}&select=pages&limit=1`);
  if (!cur.ok) return json({ error: 'read_failed', message: 'We couldn’t load your pages just now.' }, 502, cors);
  const pages: Array<Record<string, unknown>> = Array.isArray(cur.json?.[0]?.pages) ? cur.json[0].pages : [];
  if (pages.length >= 40) return json({ error: 'too_many', message: 'Your site has as many pages as it can hold. Remove one first.' }, 409, cors);
  const want = PAGE_SLUG_RE.test(String(kept.slug)) ? String(kept.slug) : 'page';
  const slug = freeSlug(want, pages.map((p) => String(p?.slug || '')));
  const back = { ...page, slug };
  const w = await db(`presence_settings?on_conflict=site_id&select=site_id,pages`, {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ site_id: site.id, pages: [...pages, back] }),
  });
  if (!w.ok || !w.json?.[0]) return json({ error: 'write_failed', message: 'That didn’t save — nothing was changed. Please try again.' }, 502, cors);
  // it's back in the draft: off the list (the trigger also clears it when the sections match)
  await svc(`presence_deleted_pages?id=eq.${id}&site_id=eq.${site.id}`, { method: 'DELETE' }).catch(() => null);
  const title = String(page.title || kept.title || slug);
  await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'update', summary: `Put back the page “${title}”${slug !== want ? ` as /${slug}/` : ''}`, principal, provenance: 'human', fields: ['pages'] });
  return json({ data: { slug, title, moved: slug !== want, pages: w.json[0].pages ?? [...pages, back] } }, 200, cors);
}
