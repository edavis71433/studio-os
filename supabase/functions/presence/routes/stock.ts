// ── Phase T · Stock Library (FD-T10) — routes ────────────────────────────────
// Browse a curated royalty-free source and IMPORT into the customer's own Files.
// Reuses: importImage (the media pipeline) → presence_media (storage/variants/
// usage/tagging/search/approvals/publish all unchanged). The published site never
// references the provider (Part 4: the image is self-hosted the moment it's
// imported). Provider is swappable behind the registry; owner-gated on the API key.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { importImage } from '../lib/media.ts';
import { stockProvider } from '../lib/stock/registry.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { getTemplate } from '../lib/render.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

export async function handleStockSearch(req: Request, cors: Record<string, string>) {
  const provider = stockProvider();
  if (!provider.available()) {
    return json({ error: 'not_available', message: 'The stock library isn’t turned on yet — your studio can enable it.', provider: provider.name }, 503, cors);
  }
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').slice(0, 100);
  const page = Math.max(1, Math.min(50, parseInt(url.searchParams.get('page') || '1', 10) || 1));
  const images = await provider.search(q, page);
  return json({ data: { provider: provider.name, license: provider.license, images } }, 200, cors);
}

export async function handleStockImport(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const provider = stockProvider();
  if (!provider.available()) return json({ error: 'not_available', message: 'The stock library isn’t turned on yet.' }, 503, cors);
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const id = String(body?.stock_id || '');
  if (!id) return json({ error: 'bad_request', message: 'Which image would you like to add?' }, 400, cors);

  // reuse the same per-site media cap as ordinary uploads
  const t = getTemplate(site.template_slug, site.template_version);
  const cap = t?.manifest.entities.media?.max ?? 100;
  const cnt = await svc(`presence_media?site_id=eq.${site.id}&deleted_at=is.null&select=id`);
  if (Array.isArray(cnt.json) && cnt.json.length >= cap) {
    return json({ error: 'media_cap', message: `Your library holds up to ${cap} images — remove some you’re not using first.` }, 422, cors);
  }

  const dl = await provider.download(id);
  if (!dl) return json({ error: 'import_failed', message: 'That image couldn’t be fetched — please try another.' }, 502, cors);
  const altRaw = String(body?.alt_text || '').trim();
  const alt = (altRaw.length >= 3 ? altRaw : 'Stock photo').slice(0, 300);
  const res = await importImage(site.id, dl.bytes, dl.mime, alt, {
    width: dl.width, height: dl.height, collection: 'stock',
    metadata: { source: provider.key, source_name: provider.name, stock_id: id, license: provider.license.name, license_url: provider.license.url, ...(body?.credit ? { attribution: String(body.credit).slice(0, 120) } : {}) },
  });
  if ('error' in res) return json(res, 502, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'media', entityId: (res as any).media_id, action: 'create', summary: `Imported a photo from ${provider.name}`, principal, provenance: 'human', fields: ['storage_path', 'alt_text'] });
  return json({ data: { media_id: (res as any).media_id, collection: 'stock', message: `Added to your Files from ${provider.name}. Use it anywhere on your site.` } }, 201, cors);
}
