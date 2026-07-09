// ── /assets/* — the Studio Asset Library (Phase DAM) ─────────────────────────
// A lens + lifecycle over the EXISTING presence_media rows (private bucket, EXIF
// strip, variant pipeline, RLS by site — all reused). Usage is derived from the
// same content references the renderer uses (offerings.media_id, posts.hero_media
// _id, settings logo/og). The lifecycle reuses the platform's approval philosophy,
// policy-based so a solo owner never hits friction.
//   GET   /assets                 — the library (?collection=&tag=&status=&brand=&q=)
//   GET   /assets/collections     — collections + counts
//   GET   /assets/tags            — tags + counts
//   GET   /assets/health          — plain findings (missing alt, unused, oversized, dupes)
//   GET   /assets/duplicates      — duplicate groups
//   GET   /assets/usage           — per-asset in_use map
//   PATCH /assets/:id             — { tags, collection, metadata, brand, alt_text }
//   POST  /assets/:id/status      — { action: submit|approve|reject|publish|archive|restore }
//   DELETE /assets/:id            — safe delete (refused while in use)
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { editionFromPlan, editionFromSite } from '../commerce/editions.ts';
import { deleteMedia } from '../lib/media.ts';
import {
  searchAssets, collectionsOf, tagsOf, assetHealth, detectDuplicates, usageMap,
  canDelete, nextAssetStatus, assetApprovalPolicy, isAssetStatus, type Asset, type ApprovalPolicy,
} from '../lib/dam.ts';

const ASSET_COLS = 'id,storage_path,alt_text,width,height,bytes,mime,tags,collection,metadata,content_hash,brand,asset_status,focal_x,focal_y,created_at';

const arr = (r: { json?: unknown }): any[] => (Array.isArray((r as { json?: unknown[] }).json) ? (r as { json: any[] }).json : []);

async function loadAssets(siteId: string): Promise<Asset[]> {
  const r = await svc(`presence_media?site_id=eq.${siteId}&deleted_at=is.null&select=${ASSET_COLS}&order=created_at.desc&limit=1000`);
  return arr(r) as Asset[];
}

/** The set of media ids actually referenced by content — the renderer's own
 *  references, so "in use" means exactly what publishes to the live site. */
async function referencedIds(site: SiteRow): Promise<Set<string>> {
  const [offs, posts, ident] = await Promise.all([
    svc(`presence_offerings?site_id=eq.${site.id}&select=media_id`),
    svc(`presence_posts?site_id=eq.${site.id}&select=hero_media_id`),
    svc(`presence_identity?site_id=eq.${site.id}&select=settings&limit=1`),
  ]);
  const ids = new Set<string>();
  for (const o of arr(offs)) if (o.media_id) ids.add(o.media_id);
  for (const p of arr(posts)) if (p.hero_media_id) ids.add(p.hero_media_id);
  const s = arr(ident)[0]?.settings || {};
  for (const ref of [s.logo, s.og_image]) if (ref && ref.id) ids.add(ref.id);
  return ids;
}

async function policyFor(site: SiteRow): Promise<ApprovalPolicy> {
  try {
    const ent = await svc(`presence_entitlements?client_id=eq.${encodeURIComponent(site.client_id)}&product=eq.presence&select=plan&limit=1`);
    const plan = arr(ent)[0]?.plan;
    const ed = plan ? editionFromPlan(String(plan)) : editionFromSite(site.edition, {});
    return assetApprovalPolicy({ isEnterprise: ed === 'enterprise', isAgency: ed === 'agency' });
  } catch { return 'immediate'; }
}

// ── the library ──────────────────────────────────────────────────────────────
export async function handleAssetsList(req: Request, site: SiteRow, cors: Record<string, string>) {
  const url = new URL(req.url);
  const [assets, refs] = await Promise.all([loadAssets(site.id), referencedIds(site)]);
  const rows = searchAssets(assets, {
    collection: url.searchParams.get('collection') || undefined,
    tag: url.searchParams.get('tag') || undefined,
    status: url.searchParams.get('status') || undefined,
    brand: url.searchParams.has('brand') ? url.searchParams.get('brand') === 'true' : undefined,
    q: url.searchParams.get('q') || undefined,
  });
  const used = usageMap(rows, refs);
  return json({ data: { assets: rows.map((a) => ({ ...a, in_use: used[a.id] })), total: assets.length, policy: await policyFor(site) } }, 200, cors);
}

export async function handleAssetsCollections(site: SiteRow, cors: Record<string, string>) {
  return json({ data: collectionsOf(await loadAssets(site.id)) }, 200, cors);
}
export async function handleAssetsTags(site: SiteRow, cors: Record<string, string>) {
  return json({ data: tagsOf(await loadAssets(site.id)) }, 200, cors);
}
export async function handleAssetsHealth(site: SiteRow, cors: Record<string, string>) {
  const [assets, refs] = await Promise.all([loadAssets(site.id), referencedIds(site)]);
  return json({ data: { findings: assetHealth(assets, refs) } }, 200, cors);
}
export async function handleAssetsDuplicates(site: SiteRow, cors: Record<string, string>) {
  return json({ data: { groups: detectDuplicates(await loadAssets(site.id)) } }, 200, cors);
}
export async function handleAssetsUsage(site: SiteRow, cors: Record<string, string>) {
  const [assets, refs] = await Promise.all([loadAssets(site.id), referencedIds(site)]);
  return json({ data: { usage: usageMap(assets, refs) } }, 200, cors);
}

// ── metadata / tags / collection / brand / alt (DAM-4/5/10) ──────────────────
export async function handleAssetUpdate(req: Request, site: SiteRow, id: string, cors: Record<string, string>) {
  let b: any = {}; try { b = await req.json(); } catch { /* */ }
  const patch: Record<string, unknown> = {};
  if (Array.isArray(b.tags)) patch.tags = b.tags.map((t: unknown) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 40);
  if (typeof b.collection === 'string') patch.collection = b.collection.trim().slice(0, 80);
  if (b.metadata && typeof b.metadata === 'object') patch.metadata = b.metadata;
  if (typeof b.brand === 'boolean') patch.brand = b.brand;
  if (typeof b.alt_text === 'string' && b.alt_text.trim().length >= 3) patch.alt_text = b.alt_text.trim().slice(0, 500);
  if (!Object.keys(patch).length) return json({ error: 'bad_request', message: 'Nothing to update.' }, 400, cors);
  const r = await svc(`presence_media?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  return (r.ok && arr(r)[0]) ? json({ data: { ok: true, asset: arr(r)[0] } }, 200, cors) : json({ error: 'not_found', message: 'That asset isn’t here.' }, 404, cors);
}

// ── lifecycle (DAM-15) — policy-based, reuses the approval philosophy ─────────
export async function handleAssetStatus(req: Request, site: SiteRow, id: string, cors: Record<string, string>) {
  let b: any = {}; try { b = await req.json(); } catch { /* */ }
  const action = ['submit', 'approve', 'reject', 'publish', 'archive', 'restore'].includes(b.action) ? b.action : null;
  if (!action) return json({ error: 'bad_request', message: 'Choose submit, approve, reject, publish, archive, or restore.' }, 400, cors);
  const cur = await svc(`presence_media?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=asset_status&limit=1`);
  const from = arr(cur)[0]?.asset_status;
  if (!from) return json({ error: 'not_found', message: 'That asset isn’t here.' }, 404, cors);
  const policy = await policyFor(site);
  const to = nextAssetStatus(from, action, policy);
  if (!to) return json({ error: 'not_allowed', message: `Can’t ${action} an asset that’s ${from}.` }, 409, cors);
  const r = await svc(`presence_media?id=eq.${id}&site_id=eq.${site.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ asset_status: to }) });
  return (r.ok && arr(r)[0]) ? json({ data: { ok: true, status: to, policy } }, 200, cors) : json({ error: 'write_failed', message: 'That didn’t save — try again.' }, 502, cors);
}

// ── safe delete (DAM-12) — never remove a live asset ─────────────────────────
export async function handleAssetDelete(site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  const refs = await referencedIds(site);
  const check = canDelete({ id } as Asset, refs.has(id));
  if (!check.ok) return json({ error: 'in_use', message: 'This asset is in use on your site — remove it from the page first, or archive it instead.' }, 409, cors);
  void principal; // (kept for a consistent route signature; media RLS + site scope enforce ownership)
  const r = await deleteMedia(site.id, id);
  return r.ok ? json({ data: { ok: true } }, 200, cors) : json({ error: 'delete_failed', message: 'That didn’t delete — try again.' }, 502, cors);
}
