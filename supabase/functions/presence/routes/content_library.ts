// ── CL-1 · Content Library & Reusable Content — routes ───────────────────────
// Save a crafted structured block to a reusable library, list it, remove it. The
// UI inserts a saved block back into the EXISTING block editor (no second editor);
// it then publishes through the ONE settings/render/publish pipeline. Reuses the
// block validator (site_blocks) — no duplicate block definitions or content model.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { cleanLibraryName, validateLibraryBlock } from '../lib/content_library.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const MAX_ITEMS = 100;

export async function handleContentLibraryList(site: SiteRow, cors: Record<string, string>) {
  const r = await svc(`presence_content_library?site_id=eq.${site.id}&select=id,name,kind,payload,created_at&order=created_at.desc&limit=${MAX_ITEMS}`);
  const rows = Array.isArray(r.json) ? r.json : [];
  return json({ data: rows.map((x: any) => ({ id: x.id, name: x.name, kind: x.kind, block: x.payload, created_at: x.created_at })) }, 200, cors);
}

export async function handleContentLibrarySave(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const name = cleanLibraryName(body?.name);
  const block = validateLibraryBlock(body?.block);
  if (!name) return json({ error: 'bad_name', message: 'Give this saved section a name.' }, 422, cors);
  if (!block) return json({ error: 'bad_block', message: 'That isn’t a saveable content block yet — fill it in first.' }, 422, cors);
  const cnt = await svc(`presence_content_library?site_id=eq.${site.id}&select=id`);
  if (Array.isArray(cnt.json) && cnt.json.length >= MAX_ITEMS) return json({ error: 'library_full', message: `Your content library holds up to ${MAX_ITEMS} items — remove one first.` }, 422, cors);
  const ins = await svc('presence_content_library', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, name, kind: 'block', payload: block, created_by: principal.userId }),
  });
  if (!ins.ok || !ins.json?.[0]?.id) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'content_library', entityId: ins.json[0].id, action: 'create', summary: `Saved “${name}” to the content library`, principal, provenance: 'human' });
  return json({ data: { id: ins.json[0].id, name, kind: 'block', block } }, 201, cors);
}

// CL-LINK: edit a saved section in place — this is the "single source" for every
// LINKED placement, so an update here flows to every linked spot at next publish
// (copies are untouched). Reuses the ONE name cleaner + block validator; no new
// content model, no migration (payload is the existing jsonb column).
export async function handleContentLibraryUpdate(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'bad_request', message: 'Invalid reference.' }, 400, cors);
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const patch: Record<string, unknown> = {};
  if (body?.name !== undefined) {
    const name = cleanLibraryName(body.name);
    if (!name) return json({ error: 'bad_name', message: 'Give this saved section a name.' }, 422, cors);
    patch.name = name;
  }
  if (body?.block !== undefined) {
    const block = validateLibraryBlock(body.block);
    if (!block) return json({ error: 'bad_block', message: 'That isn’t a saveable content block yet — fill it in first.' }, 422, cors);
    patch.payload = block;
  }
  if (!Object.keys(patch).length) return json({ error: 'nothing_to_update', message: 'Nothing to change.' }, 422, cors);
  const r = await svc(`presence_content_library?id=eq.${id}&site_id=eq.${site.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch),
  });
  if (!r.ok || !Array.isArray(r.json) || !r.json.length) return json({ error: 'not_found', message: 'That item isn’t in your library.' }, 404, cors);
  const row = r.json[0];
  await writeChangeEvent({ siteId: site.id, entityType: 'content_library', entityId: id, action: 'update', summary: `Updated “${row.name}” — every linked placement will show this`, principal, provenance: 'human' });
  return json({ data: { id: row.id, name: row.name, kind: row.kind, block: row.payload } }, 200, cors);
}

export async function handleContentLibraryDelete(site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'bad_request', message: 'Invalid reference.' }, 400, cors);
  const r = await svc(`presence_content_library?id=eq.${id}&site_id=eq.${site.id}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  if (!r.ok || !Array.isArray(r.json) || !r.json.length) return json({ error: 'not_found', message: 'That item isn’t in your library.' }, 404, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'content_library', entityId: id, action: 'delete', summary: 'Removed a content library item', principal, provenance: 'human' });
  return json({ data: { ok: true } }, 200, cors);
}
