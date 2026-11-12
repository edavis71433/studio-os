// ── Add a page: the ready-made pages, and a page saved to the studio (builder list item 216) ──
// GET /pages/ready: every ready-made page by what it is for (lib/page_layouts.ts), with the
//   home layout this business's kind suits best. Asked for when Add a page opens.
// POST /pages/from-saved {saved_id, title, slug}: one of the studio's saved pages
//   (agency/saved_pages.ts) lands on this site as a page of its own. Only the studio can:
//   its members only, its own saved pages only, onto its clients' sites or its own. The
//   photos become this site's own copies, the saved sections it links to this site's own,
//   the old business's name in the words this one's, and the page joins the menu when the
//   site has a menu of its own. On a client's site the copy is recorded, so Publish lists
//   the sections still exactly as copied until they are changed or kept
//   (lib/copied_record.ts). A draft write: the editor sends it in the draft's line and it
//   answers the new version (lib/optimistic_lock.ts DRAFT_WRITE). It writes with the function's own key,
//   after its own checks (a member's seat can't reach it: lib/site_roles.ts lists it as one that checks
//   the caller itself), as Duplicate site and a template's pages do (agency/kit_io.ts).
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { guardStaleDraft } from '../lib/optimistic_lock.ts';
import { resolveAgencyMember, agencySiteIds } from '../agency/auth.ts';
import { inBatches } from '../agency/kit_io.ts';
import { NOT_SWITCHED_ON, tableMissing } from '../agency/saved_pages.ts';
import { copyObject } from '../lib/media.ts';
import { swapIds, swapName, printPageSections } from '../lib/site_layout.ts';
import { normalizePayload, landSavedPage, cleanSavedName } from '../lib/saved_pages.ts';
import { addCopiedPage } from '../lib/copied_record.ts';
import { serializeDraft } from '../lib/serializer.ts';
import { getTemplate } from '../lib/render.ts';
import { listReadyPages, PAGE_GROUPS } from '../lib/page_layouts.ts';
import { starterKeyFor } from '../lib/starter_layouts.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { UUID_LOWER_RE as UUID_RE } from '../lib/uuid.ts';

const rows = <T,>(r: { ok?: boolean; json?: unknown }): T[] => (r.ok !== false && Array.isArray(r.json) ? r.json as T[] : []);

export async function handleReadyPages(site: SiteRow, cors: Record<string, string>) {
  let industry = 'generic';
  try {
    const r = await svc(`presence_settings?site_id=eq.${site.id}&select=industry_key&limit=1`);
    if (r.ok && Array.isArray(r.json) && r.json[0]?.industry_key) industry = String(r.json[0].industry_key);
  } catch { /* the generic layout leads */ }
  return json({ data: { groups: PAGE_GROUPS, pages: listReadyPages(), recommended: starterKeyFor(industry) } }, 200, cors);
}

export async function handlePageFromSaved(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const stale = await guardStaleDraft(req, site, cors);
  if (stale) return stale;
  let b: Record<string, unknown> = {};
  try { const x = await req.json(); if (x && typeof x === 'object') b = x; } catch { /* answered below */ }
  const savedId = String(b.saved_id || '').toLowerCase();
  if (!UUID_RE.test(savedId)) return json({ error: 'bad_request', message: 'Say which saved page to add.' }, 400, cors);
  const member = await resolveAgencyMember(req.headers.get('x-dds-user-jwt') || '');
  if (!member) return json({ error: 'forbidden', message: 'Only your studio can add its saved pages.' }, 403, cors);
  // a client's site the studio is working in, or the studio's own (opened as itself, with no seat)
  const ownSite = !principal.scope && !principal.member;
  if (!ownSite && !(await agencySiteIds(member.agency_id, true)).includes(site.id)) {
    return json({ error: 'not_found', message: 'This site isn’t one of your studio’s.' }, 404, cors);
  }
  const q = await svc(`presence_saved_pages?id=eq.${savedId}&agency_id=eq.${member.agency_id}&select=name,payload&limit=1`);
  if (!q.ok) return tableMissing(q) ? json({ ...NOT_SWITCHED_ON, message: 'Saved pages aren’t switched on yet. Nothing was added.' }, 503, cors)
    : json({ error: 'read_failed', message: 'We couldn’t read that saved page just now. Nothing was added.' }, 502, cors);
  const saved = rows<{ name?: string; payload?: unknown }>(q)[0];
  if (!saved) return json({ error: 'not_found', message: 'That saved page isn’t one of your studio’s.' }, 404, cors);
  const payload = normalizePayload(saved.payload);
  if (!payload || !payload.blocks.length) return json({ error: 'empty_page', message: 'That saved page has no sections.' }, 422, cors);

  const [cur, identQ] = await Promise.all([
    svc(`presence_settings?site_id=eq.${site.id}&select=blocks,pages,nav&limit=1`),
    svc(`presence_identity?site_id=eq.${site.id}&select=business_name&limit=1`),
  ]);
  if (!cur.ok) return json({ error: 'read_failed', message: 'We couldn’t load your pages just now. Nothing was added.' }, 502, cors);
  const settings = (rows<Record<string, unknown>>(cur)[0] || {}) as { blocks?: unknown; pages?: unknown; nav?: unknown };
  const title = cleanSavedName(b.title).slice(0, 60) || cleanSavedName(saved.name).slice(0, 60) || payload.title;
  // nothing is copied for a page that can't land
  const check = landSavedPage(settings, payload, { title, slug: b.slug, map: {}, toName: '' });
  if ('error' in check) return json({ error: check.error, message: check.message }, 422, cors);

  const toName = String(rows<{ business_name?: string }>(identQ)[0]?.business_name || '').trim();
  const label = `your “${cleanSavedName(saved.name) || payload.title}” page`;
  const by = principal.email || principal.userId || null;
  const map: Record<string, string> = {};
  // the photos and files: this site's own copies, never a file shared with the studio's folder
  const made = await inBatches(payload.media, 6, async (m) => {
    const path = await copyObject(site.id, m.storage_path, m.mime || 'image/jpeg');
    if (!path) return null;
    const ins = await svc('presence_media', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
      site_id: site.id, storage_path: path, alt_text: String(m.alt_text || '').trim().length >= 3 ? m.alt_text : 'Photo', mime: m.mime || '', bytes: m.bytes ?? null,
      width: m.width ?? null, height: m.height ?? null, focal_x: m.focal_x ?? null, focal_y: m.focal_y ?? null,
      metadata: { copied_from: label }, asset_status: 'approved',
    }) });
    const id = rows<{ id: string }>(ins)[0]?.id;
    if (!id) return null;
    map[String(m.id).toLowerCase()] = id;
    return id;
  });
  const photos = made.filter((x): x is string => !!x);
  // the saved sections it links to: this site's own
  const libraryMade: string[] = [];
  for (const it of payload.library) {
    const ins = await svc('presence_content_library', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
      site_id: site.id, name: String(it.name || 'Saved section').slice(0, 80), kind: 'block', payload: swapName(swapIds(it.payload, map), payload.from_name, toName), created_by: by,
    }) });
    const id = rows<{ id: string }>(ins)[0]?.id;
    if (id) { map[String(it.id).toLowerCase()] = id; libraryMade.push(id); }
  }
  const land = landSavedPage(settings, payload, { title, slug: b.slug, map, toName });
  if ('error' in land) return json({ error: land.error, message: land.message }, 422, cors);
  const w = await svc(`presence_settings?on_conflict=site_id&select=site_id,pages,nav`, {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ site_id: site.id, pages: land.pages, ...(land.nav ? { nav: land.nav } : {}) }),
  });
  if (!w.ok || !w.json?.[0]) {
    // nothing half-made lingers: the copies go back out
    if (photos.length) await svc(`presence_media?site_id=eq.${site.id}&id=in.(${photos.join(',')})`, { method: 'PATCH', body: JSON.stringify({ deleted_at: new Date().toISOString() }) }).catch(() => null);
    if (libraryMade.length) await svc(`presence_content_library?site_id=eq.${site.id}&id=in.(${libraryMade.join(',')})`, { method: 'DELETE' }).catch(() => null);
    return json({ error: 'write_failed', message: 'That didn’t save. Nothing was added.' }, 502, cors);
  }
  await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'create', summary: `Added the “${land.page.title}” page from the studio’s saved pages`, principal, provenance: 'human', fields: land.nav ? ['pages', 'nav'] : ['pages'] });
  // On a client's site the copy is recorded: what arrived, so Publish can tell what's untouched.
  let recorded = false;
  if (!ownSite) {
    const t = getTemplate(site.template_slug, site.template_version);
    if (t) {
      try {
        const d = await serializeDraft(site.id, t.manifest, { templateSlug: site.template_slug, templateVersion: site.template_version, now: new Date().toISOString() });
        recorded = await addCopiedPage(site.id, label, printPageSections(d.snapshot.content, land.page.slug), photos, String(by || ''));
      } catch { recorded = false; }
    }
  }
  const row = w.json[0] as { pages?: unknown; nav?: unknown };
  return json({ data: {
    slug: land.page.slug, title: land.page.title, pages: row.pages ?? land.pages, nav: row.nav ?? land.nav ?? null,
    sections: land.page.blocks.length, photos: photos.length, photos_failed: payload.media.length - photos.length, recorded,
  } }, 201, cors);
}
