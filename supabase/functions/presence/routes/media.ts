// POST /media/upload-url · DELETE /media/:id — the media surface (G1 §8).
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { createUpload, deleteMedia } from '../lib/media.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { getTemplate } from '../lib/render.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

export async function handleMediaUpload(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let body: any = null;
  try { body = await req.json(); } catch { return json({ error: 'bad_json', message: 'The request body wasn’t valid JSON.' }, 400, cors); }

  // per-site count cap from the manifest
  const t = getTemplate(site.template_slug, site.template_version);
  const cap = t?.manifest.entities.media?.max ?? 100;
  const cnt = await svc(`presence_media?site_id=eq.${site.id}&deleted_at=is.null&select=id`);
  if (Array.isArray(cnt.json) && cnt.json.length >= cap) {
    return json({ error: 'media_cap', message: `This site supports up to ${cap} images — delete some you’re not using first.` }, 422, cors);
  }

  const res = await createUpload(site.id, { mime: String(body?.mime || ''), bytes: Number(body?.bytes || 0), alt_text: String(body?.alt_text || ''), width: body?.width, height: body?.height });
  if ('error' in res) return json(res, 422, cors);

  await writeChangeEvent({ siteId: site.id, entityType: 'media', entityId: res.media_id, action: 'create', summary: 'Added a photo', principal, provenance: 'human', fields: ['storage_path', 'alt_text'] });
  return json({ data: res }, 200, cors);
}

export async function handleMediaDelete(site: SiteRow, principal: Principal, mediaId: string, cors: Record<string, string>) {
  if (!/^[0-9a-f-]{36}$/.test(mediaId)) return json({ error: 'bad_request', message: 'Invalid image reference.' }, 400, cors);
  const res = await deleteMedia(site.id, mediaId);
  if ('error' in res) return json(res, 409, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'media', entityId: mediaId, action: 'delete', summary: 'Removed a photo', principal, provenance: 'human' });
  return json({ data: { ok: true } }, 200, cors);
}
