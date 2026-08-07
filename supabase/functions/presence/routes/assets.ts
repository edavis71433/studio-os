// ── /assets/* — the Files experience (internally the DAM) ────────────────────
// A lens + lifecycle + usage-awareness over the EXISTING presence_media rows
// (private bucket, EXIF strip, variant pipeline, RLS by site — all reused). This
// is NOT a second store, approval engine, or publisher. Usage is derived from the
// SAME content references the renderer serializes, so "where used" is exactly what
// publishes to the live site. Replace/rollback reuse the media rows + change events
// + the publish/snapshot pipeline; nothing here is duplicated.
//   GET   /assets                 — the library (?collection=&tag=&status=&brand=&q=&limit=)
//   GET   /assets/collections     — collections + counts
//   GET   /assets/tags            — tags + counts
//   GET   /assets/health          — plain findings (missing alt, unused, oversized, dupes)
//   GET   /assets/duplicates      — duplicate groups
//   GET   /assets/usage           — per-asset in_use map
//   GET   /assets/:id             — one file: metadata + complete where-used + versions
//   GET   /assets/:id/download    — signed original download URL
//   PATCH /assets/:id             — { tags, collection, metadata, brand, alt_text }  (rename/move/favorite)
//   POST  /assets/:id/status      — { action: submit|approve|reject|publish|archive|restore }
//   POST  /assets/:id/replace     — { with } swap a file for a new version, repoint every use
//   POST  /assets/:id/rollback    — undo the last replace (restore the prior version)
//   POST  /assets/:id/duplicate   — copy a file
//   DELETE /assets/:id            — safe delete (refused while in use)
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { deleteMedia, signThumb, signDownload, copyObject, isImageMime, signSocialCrop } from '../lib/media.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { editionFromPlan, editionFromSite } from '../commerce/editions.ts';
import { anthropicVisionModel } from '../writer/vision.ts';
import { suggestFromImage } from '../lib/media_suggest.ts';
import { checkAiCeiling, ceilingDenial, recordUsage, recordImageUsage } from '../commerce/metering.ts';
import { loadPlan, draftingDenial } from '../commerce/enforce.ts';
import { imageEditModel, editSizeFor } from '../visual/model.ts';
import type { VisualPlan } from '../visual/contract.ts';
import { saveVisualPlan, attachVariations, getVisualPlan, withPreviews } from '../visual/store.ts';
import {
  searchAssets, collectionsOf, tagsOf, assetHealth, detectDuplicates, usageMap,
  canDelete, nextAssetStatus, assetApprovalPolicy, displayName, usageSummary, carryForwardMetadata,
  fileKind, isFavorite, isClientUpload, replaceNeedsApproval, fileState, clientsByMedia,
  normalizeBulkRequest, mergeTag, partitionOwned, type Asset, type ApprovalPolicy, type UsageRef, type MediaClient,
} from '../lib/dam.ts';
import { socialCropList } from '../lib/social_crops.ts';
import { composeSocialCards, HEADLINE_MAX } from '../lib/social_card.ts';
import { brandFromKit } from '../lib/email_brand.ts';
import { resolveSiteRole } from '../lib/workspace.ts';
import { notifyOwnerOfReviewerDecision } from '../lib/notice.ts';

const ASSET_COLS = 'id,storage_path,alt_text,width,height,bytes,mime,tags,collection,metadata,content_hash,brand,asset_status,focal_x,focal_y,created_at';
const LIST_THUMB_CAP = 160;   // sign at most this many thumbnails per list call (bounded latency)

const arr = (r: { json?: unknown }): any[] => (Array.isArray((r as { json?: unknown[] }).json) ? (r as { json: any[] }).json : []);

async function loadAssets(siteId: string): Promise<Asset[]> {
  const r = await svc(`presence_media?site_id=eq.${siteId}&deleted_at=is.null&select=${ASSET_COLS}&order=created_at.desc&limit=1000`);
  return arr(r) as Asset[];
}
async function loadAsset(siteId: string, id: string, includeDeleted = false): Promise<Asset | null> {
  const del = includeDeleted ? '' : '&deleted_at=is.null';
  const r = await svc(`presence_media?id=eq.${id}&site_id=eq.${siteId}${del}&select=${ASSET_COLS}&limit=1`);
  return (arr(r)[0] as Asset) || null;
}

// ── the complete, authoritative usage graph — mirrors serializer.ts exactly ───
// Every place the RENDERER resolves a media id: settings.logo_media_id,
// settings.og_media_id, offerings.media_id (visible), posts.hero_media_id
// (published). Returns labelled refs per media id — the "where used" value-add.
async function referencedRefs(site: SiteRow): Promise<Map<string, UsageRef[]>> {
  const [settingsR, offs, posts] = await Promise.all([
    svc(`presence_settings?site_id=eq.${site.id}&select=logo_media_id,og_media_id&limit=1`),
    svc(`presence_offerings?site_id=eq.${site.id}&deleted_at=is.null&media_id=not.is.null&select=media_id,name,is_visible`),
    svc(`presence_posts?site_id=eq.${site.id}&deleted_at=is.null&hero_media_id=not.is.null&select=hero_media_id,title,status`),
  ]);
  const map = new Map<string, UsageRef[]>();
  const add = (id: string | null | undefined, ref: UsageRef) => { if (!id) return; map.set(id, [...(map.get(id) || []), ref]); };
  const s = arr(settingsR)[0] || {};
  add(s.logo_media_id, { surface: 'brand', label: 'your logo (site-wide)', live: false });
  add(s.og_media_id, { surface: 'seo', label: 'your social share image', live: false });
  for (const o of arr(offs)) add(o.media_id, { surface: 'services', label: `“${o.name}”${o.is_visible === false ? ' (hidden)' : ''}`, live: false });
  for (const p of arr(posts)) add(p.hero_media_id, { surface: 'blog', label: `the update “${p.title}”${p.status !== 'published' ? ' (draft)' : ''}`, live: false });
  return map;
}
function refsSet(map: Map<string, UsageRef[]>): Set<string> { return new Set(map.keys()); }

/** The media ids actually on the CURRENT live site — the live snapshot's manifest.
 *  Lets "where used" distinguish live vs pending-next-publish. */
async function liveMediaIds(site: SiteRow): Promise<Set<string>> {
  try {
    const pub = await svc(`presence_publishes?site_id=eq.${site.id}&status=eq.live&select=snapshot_id&order=created_at.desc&limit=1`);
    const snapId = arr(pub)[0]?.snapshot_id;
    if (!snapId) return new Set();
    const snap = await svc(`presence_snapshots?id=eq.${snapId}&select=media_manifest&limit=1`);
    const mm = arr(snap)[0]?.media_manifest;
    return new Set(Array.isArray(mm) ? mm.map((m: any) => m.media_id).filter(Boolean) : []);
  } catch { return new Set(); }
}

// ── the CLIENT dimension: which of my clients does this file belong to? ──────
// "Files should be able to be organized and filtered by client — not all just
// there at once." No migration: the linkage already exists as three indexed
// reads, ALL on this same site — a project file is recorded as a deliverable
// (presence_deliverables: media_id, project_id, title; 0076), and the
// agency↔customer bridge (presence_service_links, UNIQUE per project; 0079)
// names the customer that project is delivered for.
//
// This is deliberately NOT the ?client= / x-dds-scope-site path. That switches
// TENANT to the client's own presence_sites row, whose media is their WEBSITE's
// — a different, unrelated set of files. The files a client sent this studio
// live here, on the agency site (client_delivery.ts uploads to agency_site_id).
//
// OPERATOR-ONLY. GET /assets is not in reviewerAllowed (routes/workspace.ts), so a
// client_reviewer gets 403 before reaching this; and this map is built HERE, in
// the operator handler, so no /client/* response can ever carry it.
async function clientByMedia(site: SiteRow): Promise<Map<string, MediaClient>> {
  try {
    const dl = arr(await svc(`presence_deliverables?site_id=eq.${site.id}&deleted_at=is.null&select=media_id,project_id,title,created_at&order=created_at.asc&limit=2000`));
    if (!dl.length) return new Map();
    const projectIds = [...new Set(dl.map((d) => String(d.project_id || '')).filter(Boolean))];
    if (!projectIds.length) return new Map();
    const links = arr(await svc(`presence_service_links?agency_site_id=eq.${site.id}&project_id=in.(${projectIds.join(',')})&select=project_id,customer_client_id&limit=2000`));
    const clientIds = [...new Set(links.map((l) => String(l.customer_client_id || '')).filter(Boolean))];
    const clients = clientIds.length ? arr(await svc(`clients?id=in.(${clientIds.join(',')})&select=id,name&limit=500`)) : [];
    return clientsByMedia(dl, links, clients);
  } catch { return new Map(); }   // the client dimension is an ORGANIZER — its failure must never cost the owner their file list
}

async function policyFor(site: SiteRow): Promise<ApprovalPolicy> {
  try {
    const ent = await svc(`presence_entitlements?client_id=eq.${encodeURIComponent(site.client_id)}&product=eq.presence&select=plan&limit=1`);
    const plan = arr(ent)[0]?.plan;
    const ed = plan ? editionFromPlan(String(plan)) : editionFromSite(site.edition, {});
    return assetApprovalPolicy({ isEnterprise: ed === 'enterprise', isAgency: ed === 'agency' });
  } catch { return 'immediate'; }
}

/** Shape one asset for the UI (calm, customer-facing fields). */
function present(a: Asset, opts: { in_use?: boolean; thumb?: string | null; client?: MediaClient | null } = {}) {
  const meta = (a.metadata || {}) as Record<string, unknown>;
  const c = opts.client || null;
  return {
    ...a,
    // the deliverable's title is the LAST name rung — it only speaks for a file
    // that has no title, no alt text and no readable storage basename of its own
    name: displayName(a, c?.title),
    kind: fileKind(a.mime),
    favorite: isFavorite(a),
    in_use: opts.in_use,
    thumb: opts.thumb ?? undefined,
    // client-upload provenance (the "by client" chip): the client door stamps the
    // media row's metadata; surface the explicit boolean here so the UI contract
    // never depends on string-matching the note. Additive; omitted when false.
    client_upload: isClientUpload(a) ? true : undefined,
    // WHICH client's work this file belongs to, from the delivery graph. Additive
    // and optional in exactly the same way — omitted entirely when the file was
    // never delivered on a linked project (the studio's own brand marks and site
    // photography), which the roster groups under "Studio". Operator-only: only
    // handleAssetsList passes `client`, and /assets is never reviewer-reachable.
    client_id: c?.client_id || undefined,
    client_name: c?.client_name || undefined,
    project_id: c?.project_id || undefined,
    // DAM-2: approval state + who/when, from reused metadata (no new columns)
    state: fileState(a.asset_status, !!opts.in_use, !!meta.pending_replace),
    approval: { approved_by: meta.approved_by || null, approved_at: meta.approved_at || null, submitted_by: meta.submitted_by || null, submitted_at: meta.submitted_at || null, pending_replace: !!meta.pending_replace },
  };
}

// ── the library ──────────────────────────────────────────────────────────────
export async function handleAssetsList(req: Request, site: SiteRow, cors: Record<string, string>) {
  const url = new URL(req.url);
  const [assets, refMap, live, byClient] = await Promise.all([loadAssets(site.id), referencedRefs(site), liveMediaIds(site), clientByMedia(site)]);
  const refs = refsSet(refMap);
  const rows = searchAssets(assets, {
    collection: url.searchParams.get('collection') || undefined,
    tag: url.searchParams.get('tag') || undefined,
    status: url.searchParams.get('status') || undefined,
    brand: url.searchParams.has('brand') ? url.searchParams.get('brand') === 'true' : undefined,
    q: url.searchParams.get('q') || undefined,
  });
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '160', 10) || 160, 1), 500);
  const page = rows.slice(0, limit);
  // sign thumbnails for the visible page only (bounded), in parallel
  const thumbs = await Promise.all(page.slice(0, LIST_THUMB_CAP).map((a) => signThumb(a.storage_path, a.mime || '')));
  const used = usageMap(page, refs);
  return json({ data: {
    assets: page.map((a, i) => present(a, { in_use: used[a.id], thumb: i < LIST_THUMB_CAP ? thumbs[i] : null, client: byClient.get(a.id) })),
    total: assets.length, shown: page.length,
    live_count: [...live].length,
    policy: await policyFor(site),
  } }, 200, cors);
}

export async function handleAssetsCollections(site: SiteRow, cors: Record<string, string>) {
  return json({ data: collectionsOf(await loadAssets(site.id)) }, 200, cors);
}
export async function handleAssetsTags(site: SiteRow, cors: Record<string, string>) {
  return json({ data: tagsOf(await loadAssets(site.id)) }, 200, cors);
}
export async function handleAssetsHealth(site: SiteRow, cors: Record<string, string>) {
  const [assets, refMap] = await Promise.all([loadAssets(site.id), referencedRefs(site)]);
  return json({ data: { findings: assetHealth(assets, refsSet(refMap)) } }, 200, cors);
}
export async function handleAssetsDuplicates(site: SiteRow, cors: Record<string, string>) {
  return json({ data: { groups: detectDuplicates(await loadAssets(site.id)) } }, 200, cors);
}
export async function handleAssetsUsage(site: SiteRow, cors: Record<string, string>) {
  const [assets, refMap] = await Promise.all([loadAssets(site.id), referencedRefs(site)]);
  return json({ data: { usage: usageMap(assets, refsSet(refMap)) } }, 200, cors);
}

// ── bulk actions — one move applied to a SELECTION (add a tag / move to a
//    collection / archive / approve) ─────────────────────────────────────────
// As the library grows the owner needs to act on many files at once. This is a
// BATCH of the existing per-asset moves, not a parallel system: tag/collection use
// the same normalization as the PATCH; archive/approve use the same nextAssetStatus
// lifecycle + policy + approve stamp. Bounded (≤ MAX_BULK_IDS), site-scoped (a single
// site-scoped load — any id the site doesn't own lands in `missing`, never touched),
// and returns a per-id result summary. One summary change event, not N.
export async function handleAssetsBulk(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let body: unknown = {}; try { body = await req.json(); } catch { /* */ }
  const norm = normalizeBulkRequest(body);
  if (!norm.ok) return json({ error: norm.error, message: norm.message }, 400, cors);
  const { action, ids } = norm;

  // A client reviewer may only approve; anything else is an owner/editor move.
  const role = await resolveSiteRole(principal.jwt || '', site.id, principal.kind);
  if (role === 'client_reviewer' && action !== 'approve') {
    return json({ error: 'forbidden', message: 'A reviewer can approve — nothing else.' }, 403, cors);
  }

  // Site-scoped load: the ONLY rows we can touch are this site's, live (not deleted).
  const loaded = await svc(`presence_media?id=in.(${ids.join(',')})&site_id=eq.${site.id}&deleted_at=is.null&select=id,tags,collection,asset_status,metadata`);
  const rows = arr(loaded) as Array<{ id: string; tags?: string[] | null; collection?: string | null; asset_status?: string | null; metadata?: Record<string, unknown> | null }>;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const { missing } = partitionOwned(ids, byId.keys());

  const policy = action === 'approve' ? await policyFor(site) : 'immediate';
  const now = new Date().toISOString();
  const who = principal.email || principal.userId || '';
  const results: Array<{ id: string; ok: boolean; status?: string; reason?: string }> = [];
  let applied = 0;

  for (const id of ids) {
    const row = byId.get(id);
    if (!row) { results.push({ id, ok: false, reason: 'not_found' }); continue; }
    try {
      if (action === 'tag') {
        const next = mergeTag(row.tags, norm.tag!);
        if (!next) { results.push({ id, ok: true, reason: 'unchanged' }); continue; }
        const r = await svc(`presence_media?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null`, { method: 'PATCH', body: JSON.stringify({ tags: next }) });
        if (r.ok) { applied++; results.push({ id, ok: true }); } else results.push({ id, ok: false, reason: 'write_failed' });
      } else if (action === 'collection') {
        if ((row.collection || '') === norm.collection) { results.push({ id, ok: true, reason: 'unchanged' }); continue; }
        const r = await svc(`presence_media?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null`, { method: 'PATCH', body: JSON.stringify({ collection: norm.collection }) });
        if (r.ok) { applied++; results.push({ id, ok: true }); } else results.push({ id, ok: false, reason: 'write_failed' });
      } else {
        // archive | approve — the SAME lifecycle transition + policy as the per-asset route
        const to = nextAssetStatus(row.asset_status || 'approved', action, policy);
        if (!to) { results.push({ id, ok: true, reason: 'not_applicable' }); continue; }   // e.g. already approved/archived
        const stamp: Record<string, unknown> = { asset_status: to };
        if (action === 'approve') stamp.metadata = { ...((row.metadata as Record<string, unknown>) || {}), approved_by: who, approved_at: now };
        const r = await svc(`presence_media?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null`, { method: 'PATCH', body: JSON.stringify(stamp) });
        if (r.ok) { applied++; results.push({ id, ok: true, status: to }); } else results.push({ id, ok: false, reason: 'write_failed' });
      }
    } catch { results.push({ id, ok: false, reason: 'write_failed' }); }
  }

  if (applied > 0) {
    const label = action === 'tag' ? `Tagged ${applied} file${applied === 1 ? '' : 's'} “${norm.tag}”`
      : action === 'collection' ? `Moved ${applied} file${applied === 1 ? '' : 's'} to “${norm.collection}”`
      : action === 'archive' ? `Archived ${applied} file${applied === 1 ? '' : 's'}`
      : `Approved ${applied} file${applied === 1 ? '' : 's'}`;
    await writeChangeEvent({ siteId: site.id, entityType: 'media', entityId: rows[0]?.id || site.id, action: 'update', summary: label, principal, provenance: 'human', fields: ['bulk', action] });
  }
  return json({ data: { ok: true, action, applied, requested: ids.length, missing, results } }, 200, cors);
}

// ── social sizes: focal-aware crops for one image (square / portrait / story / OG)
// The DIMENSIONS come from visual/contract.ts (Visual Studio's specs). Each URL is a
// short-lived signed transform from the SAME self-hosted Supabase image pipeline used
// for the width variants — width + height + cover (a real height crop), never an
// external origin. object_position gives a faithful focal preview; the focal geometry
// is exposed for any consumer that crops by rect. To USE one as the share image, point
// settings.og_media_id at this asset (the existing assignment) — the published site
// then serves it as the link-preview image. */
export async function handleAssetSocial(site: SiteRow, id: string, cors: Record<string, string>) {
  const asset = await loadAsset(site.id, id);
  if (!asset) return json({ error: 'not_found', message: 'That file isn’t here.' }, 404, cors);
  if (!isImageMime(asset.mime || '')) {
    return json({ error: 'not_an_image', message: 'Social sizes are for photos — this file isn’t an image.' }, 400, cors);
  }
  const focal = { x: Number((asset as any).focal_x), y: Number((asset as any).focal_y) };
  const list = socialCropList(focal, { width: asset.width, height: asset.height });
  // Sign each crop from the private bucket, in parallel (bounded: 4 ratios).
  const urls = await Promise.all(list.map((c) => signSocialCrop(asset.storage_path, asset.mime || '', { width: c.width, height: c.height })));
  const crops = list.map((c, i) => ({ ...c, url: urls[i] }));
  const isShareImage = await isCurrentOg(site, id);
  return json({ data: { crops, focal: list[0]?.object_position || '50% 50%', is_share_image: isShareImage } }, 200, cors);
}
async function isCurrentOg(site: SiteRow, id: string): Promise<boolean> {
  try { const s = await svc(`presence_settings?site_id=eq.${site.id}&select=og_media_id&limit=1`); return arr(s)[0]?.og_media_id === id; } catch { return false; }
}

// ── G31: branded social cards — one photo → many platform formats, COMPOSED ──
// A step beyond /assets/:id/social (bare crops): each card re-lays out the photo
// PLUS the owner's brand — accent bar (Brand Kit, contrast-derived exactly like
// the email shell), logo, business name, optional headline — per platform preset
// (Instagram / story / Facebook / X / Pinterest). The composer is pure SVG
// (lib/social_card.ts): the photo and logo ride short-lived signed variant URLs
// from the SAME self-hosted pipeline as everything else — never an external
// origin, nothing rasterized server-side, everything entity-escaped. Drafting-
// class plan gate (same boundary as the other drafting quick actions): Monitor
// watches, it doesn't produce collateral.
const CARD_SOURCE_WIDTH = 1600;   // one uncropped variant feeds every preset
const CARD_LOGO_WIDTH = 320;      // the logo rides small in the brand bar

export async function handleAssetCards(req: Request, site: SiteRow, id: string, cors: Record<string, string>) {
  const asset = await loadAsset(site.id, id);
  if (!asset) return json({ error: 'not_found', message: 'That file isn’t here.' }, 404, cors);
  if (!isImageMime(asset.mime || '')) {
    return json({ error: 'not_an_image', message: 'Branded cards are for photos — this file isn’t an image.' }, 400, cors);
  }
  const denied = draftingDenial(await loadPlan(site.client_id), cors);
  if (denied) return denied;

  const url = new URL(req.url);
  const headline = String(url.searchParams.get('headline') || '').replace(/\s+/g, ' ').trim().slice(0, HEADLINE_MAX);

  // The brand: Brand Kit + business name (the same two reads the email shell
  // makes) + the logo the kit/site points at. All existing rows — nothing new.
  const [settingsR, identityR] = await Promise.all([
    svc(`presence_settings?site_id=eq.${site.id}&select=brand_kit,logo_media_id&limit=1`),
    svc(`presence_identity?site_id=eq.${site.id}&select=business_name&limit=1`),
  ]);
  const settings = arr(settingsR)[0] || {};
  const kit = (settings.brand_kit && typeof settings.brand_kit === 'object' ? settings.brand_kit : null) as { primary?: string; logo_media_id?: string } | null;
  const businessName = String(arr(identityR)[0]?.business_name || '').trim();
  const brand = brandFromKit(kit, null);   // accent + accentDark only — the card shows the OWNER's name, never a default
  const logoId = String(kit?.logo_media_id || settings.logo_media_id || '');

  // Sign the uncropped photo variant + (when set and an image) the logo — the
  // same private-bucket transform pipeline as thumbnails and crops.
  const logoAsset = /^[0-9a-f-]{36}$/.test(logoId) ? await loadAsset(site.id, logoId) : null;
  const [photoUrl, logoUrl] = await Promise.all([
    signThumb(asset.storage_path, asset.mime || '', CARD_SOURCE_WIDTH),
    logoAsset && isImageMime(logoAsset.mime || '') ? signThumb(logoAsset.storage_path, logoAsset.mime || '', CARD_LOGO_WIDTH) : Promise.resolve(null),
  ]);
  if (!photoUrl) return json({ error: 'image_unreadable', message: 'We couldn’t prepare that photo just now — try again in a moment.' }, 502, cors);

  const cards = composeSocialCards({
    media: {
      url: photoUrl, width: asset.width, height: asset.height,
      focal: { x: Number((asset as any).focal_x), y: Number((asset as any).focal_y) },
      alt: asset.alt_text || '',
    },
    brand: { accent: brand.accent, accent_dark: brand.accentDark, logo_url: logoUrl },
    business_name: businessName,
    headline,
  });
  return json({ data: { cards, business_name: businessName, headline } }, 200, cors);
}

// ── one file: the detail panel (metadata + complete where-used + versions) ────
export async function handleAssetDetail(site: SiteRow, id: string, cors: Record<string, string>) {
  const asset = await loadAsset(site.id, id);
  if (!asset) return json({ error: 'not_found', message: 'That file isn’t here.' }, 404, cors);
  const [refMap, live, thumb, download] = await Promise.all([
    referencedRefs(site), liveMediaIds(site),
    signThumb(asset.storage_path, asset.mime || ''),
    signDownload(asset.storage_path, `${displayName(asset)}`),
  ]);
  const usage = (refMap.get(id) || []).map((r) => ({ ...r, live: live.has(id) }));
  // versions: the immediate prior (what this replaced) + whether a newer exists
  const meta = (asset.metadata || {}) as Record<string, unknown>;
  let prior: { id: string; name: string; created_at?: string } | null = null;
  if (typeof meta.replaces === 'string') {
    const p = await loadAsset(site.id, meta.replaces, true);
    if (p) prior = { id: p.id, name: displayName(p), created_at: p.created_at };
  }
  const supersededBy = typeof meta.replaced_by === 'string' ? String(meta.replaced_by) : null;
  return json({ data: {
    asset: present(asset, { in_use: usage.length > 0, thumb }),
    usage, summary: usageSummary(usage),
    versions: { prior, superseded_by: supersededBy, has_history: !!prior },
    download_url: download,
    policy: await policyFor(site),
  } }, 200, cors);
}

// ── AI suggestion: PROPOSE alt text + tags + caption for a photo (never applied) ──
// Turns the required-alt chore into one tap: the vision model looks at the image
// and proposes alt + a few tags + a caption; the owner accepts or edits before
// anything saves. This handler NEVER writes to the media row — it returns a
// proposal only; the UI applies it (PATCH /assets/:id, PUT /media/:id) on accept.
// Gated on ANTHROPIC_KEY (honest 503 without it), cost-ceiling enforced BEFORE the
// call, and metered afterward. We send a bounded, EXIF-stripped thumbnail (not the
// full original) so latency + token cost stay small and predictable.
const SUGGEST_THUMB_WIDTH = 512;          // enough detail to describe; cheap tokens
const SUGGEST_MAX_BYTES = 2 * 1024 * 1024; // defensive cap on the image we forward

async function fetchImageBytes(url: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    return buf.byteLength > 0 && buf.byteLength <= SUGGEST_MAX_BYTES ? buf : null;
  } catch { return null; }
}

export async function handleAssetSuggest(site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  const asset = await loadAsset(site.id, id);
  if (!asset) return json({ error: 'not_found', message: 'That file isn’t here.' }, 404, cors);
  if (!isImageMime(asset.mime || '')) {
    return json({ error: 'not_an_image', message: 'AI descriptions are for photos — this file isn’t an image.' }, 400, cors);
  }
  // Gate: no key → the feature is honestly dark; the manual description always works.
  const vision = anthropicVisionModel();
  if (!vision) {
    return json({ error: 'suggest_unavailable', message: 'AI descriptions aren’t switched on right now — you can still write the description yourself, which always works.' }, 503, cors);
  }
  // HARD cost ceiling — enforced BEFORE the provider call (a dismissed notice can't bypass it).
  const ceil = await checkAiCeiling(site.client_id);
  if (!ceil.allowed) { const d = ceilingDenial(cors); return json(d.body, d.status, d.cors); }
  // Send a small, EXIF-stripped webp thumbnail (bounded cost/latency), not the original.
  const thumb = await signThumb(asset.storage_path, asset.mime || '', SUGGEST_THUMB_WIDTH);
  const bytes = thumb ? await fetchImageBytes(thumb) : null;
  if (!bytes) return json({ error: 'image_unreadable', message: 'We couldn’t open that photo to describe it — try again in a moment.' }, 502, cors);

  const res = await suggestFromImage(vision, bytes, 'image/webp');
  // Meter the successful generative op (fire-and-forget; never blocks the reply).
  if (res.usage) recordUsage({ siteId: site.id, clientId: site.client_id, agent: 'media_suggest' }, res.usage.model, res.usage.input_tokens ?? null, res.usage.output_tokens ?? null).catch(() => {});
  void principal; // media RLS + site scope enforce ownership; the router already authed
  if (!res.ok || !res.suggestion) {
    return json({ error: 'suggest_failed', message: 'The description didn’t come through — nothing was changed. Try again, or write it yourself.' }, 502, cors);
  }
  // A PROPOSAL only — the owner accepts or edits before anything is saved.
  return json({ data: { proposal: res.suggestion, note: 'A suggestion — look it over, edit anything, and it only saves when you accept.' } }, 200, cors);
}

// ── G32: background removal quick action — instruction-guided edit of ONE photo ──
// Uses the SAME metered image machinery as AI Visual Studio, and the SAME
// approval-gated plan lifecycle: the result is a PROPOSED visual plan the owner
// decides on (POST /visual/plans/:id/decide). Approving promotes it into the
// library as a NEW file beside the original — the original is never touched.
// Honest gate (no provider key → 503), HARD cost ceiling BEFORE the call,
// metered after it, drafting-class plan gate like /visual/generate.
const REMOVE_BG_PROMPT =
  'Remove the background completely. Keep the subject exactly as it is — same colors, same details, same edges; add nothing and change nothing else. Place the subject on a fully transparent background.';
const REMOVE_BG_MAX_BYTES = 12 * 1024 * 1024;   // originals are capped at 10MB on upload; defensive headroom

async function fetchOriginalBytes(url: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    return buf.byteLength > 0 && buf.byteLength <= REMOVE_BG_MAX_BYTES ? buf : null;
  } catch { return null; }
}

export async function handleAssetRemoveBackground(site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  const asset = await loadAsset(site.id, id);
  if (!asset) return json({ error: 'not_found', message: 'That file isn’t here.' }, 404, cors);
  if (!isImageMime(asset.mime || '')) {
    return json({ error: 'not_an_image', message: 'Background removal is for photos — this file isn’t an image.' }, 400, cors);
  }
  // Honest gate: no provider key → the quick action is dark, never faked.
  const edit = imageEditModel();
  if (!edit) return json({ error: 'not_available', message: 'Background removal isn’t switched on for your studio yet. Your photo is untouched — everything else here works exactly as always.' }, 503, cors);
  // Drafting-class gate (same boundary /visual/generate honors) + HARD cost
  // ceiling — both enforced BEFORE the expensive provider call.
  const denied = draftingDenial(await loadPlan(site.client_id), cors);
  if (denied) return denied;
  const ceil = await checkAiCeiling(site.client_id);
  if (!ceil.allowed) { const d = ceilingDenial(cors); return json(d.body, d.status, d.cors); }

  const dl = await signDownload(asset.storage_path);
  const bytes = dl ? await fetchOriginalBytes(dl) : null;
  if (!bytes) return json({ error: 'image_unreadable', message: 'We couldn’t open that photo just now — nothing was changed. Try again in a moment.' }, 502, cors);

  const dims = editSizeFor(asset.width, asset.height);
  const name = displayName(asset);
  const plan: VisualPlan = {
    kind: 'general',
    title: `Background removed: ${name.slice(0, 60)}`,
    summary: `We’ll prepare a copy of “${name}” with the background removed (transparent). Nothing is saved to your library until you approve it — the original stays exactly as it is either way.`,
    risk: 'Low. This is a draft — it doesn’t touch the original photo, your library, or your website until you approve it.',
    reversible: true,
    rollback: 'Discard the draft, or remove the stored copy from your library any time. The original photo is never changed.',
    requires_approval: true,
    brief: `Remove the background from “${name}”`,
    prompt: REMOVE_BG_PROMPT,
    brand_snapshot: { palette: [], personality: '', vocabulary: [], avoid: [], industry: '' },
    width: dims.width,
    height: dims.height,
    variations: [],
    provenance: 'ai',
  };
  const row = await saveVisualPlan(site.id, plan);
  if (!row) return json({ error: 'save_failed', message: 'We couldn’t start that — nothing was made. Please try again.' }, 502, cors);

  const run = await edit({ image: bytes, mime: asset.mime || 'image/png', prompt: REMOVE_BG_PROMPT, size: dims.size, count: 1, transparent: true });
  if (!run.ok || !run.images.length) {
    await svc(`presence_visual_plans?id=eq.${row.id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed' }) });
    return json({ error: 'edit_failed', message: 'That didn’t come through — your photo is untouched. Please try again in a moment.' }, 502, cors);
  }
  await attachVariations(site.id, row.id, run.images, run.model, dims.width, dims.height);
  recordImageUsage({ siteId: site.id, clientId: site.client_id, agent: 'visual' }, run.model, run.images.length).catch(() => {});   // meter cost
  void principal;   // site scope + RLS enforce ownership; the router already authed
  return json({ data: {
    plan: await withPreviews(await getVisualPlan(site.id, row.id)),
    source_asset_id: id,
    note: 'A draft — approve it to save a new file beside the original, or discard it. The original photo is never changed.',
  } }, 200, cors);
}

export async function handleAssetDownload(site: SiteRow, id: string, cors: Record<string, string>) {
  const asset = await loadAsset(site.id, id);
  if (!asset) return json({ error: 'not_found', message: 'That file isn’t here.' }, 404, cors);
  const url = await signDownload(asset.storage_path, displayName(asset));
  return url ? json({ data: { url } }, 200, cors) : json({ error: 'download_failed', message: 'Could not prepare that download — try again.' }, 502, cors);
}

// ── metadata / tags / collection / brand / alt / rename / favorite (PATCH) ────
export async function handleAssetUpdate(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  let b: any = {}; try { b = await req.json(); } catch { /* */ }
  const cur = await loadAsset(site.id, id);
  if (!cur) return json({ error: 'not_found', message: 'That file isn’t here.' }, 404, cors);
  const patch: Record<string, unknown> = {};
  const meta: Record<string, unknown> = { ...(cur.metadata || {}) };
  let metaTouched = false;
  if (Array.isArray(b.tags)) patch.tags = b.tags.map((t: unknown) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 40);
  if (typeof b.collection === 'string') patch.collection = b.collection.trim().slice(0, 80);
  if (typeof b.brand === 'boolean') patch.brand = b.brand;
  if (typeof b.alt_text === 'string' && b.alt_text.trim().length >= 3) patch.alt_text = b.alt_text.trim().slice(0, 500);
  // rename → metadata.title; favorite → metadata.favorite; caption/description → metadata
  if (typeof b.name === 'string' && b.name.trim()) { meta.title = b.name.trim().slice(0, 200); metaTouched = true; }
  if (typeof b.favorite === 'boolean') { meta.favorite = b.favorite; metaTouched = true; }
  if (typeof b.caption === 'string') { meta.caption = b.caption.slice(0, 500); metaTouched = true; }
  if (typeof b.description === 'string') { meta.description = b.description.slice(0, 2000); metaTouched = true; }
  if (b.metadata && typeof b.metadata === 'object') { Object.assign(meta, b.metadata); metaTouched = true; }
  if (metaTouched) patch.metadata = meta;
  if (!Object.keys(patch).length) return json({ error: 'bad_request', message: 'Nothing to update.' }, 400, cors);
  const r = await svc(`presence_media?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!(r.ok && arr(r)[0])) return json({ error: 'not_found', message: 'That file isn’t here.' }, 404, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'media', entityId: id, action: 'update', summary: 'Updated file details', principal, provenance: 'human', fields: Object.keys(patch) });
  return json({ data: { ok: true, asset: present(arr(r)[0]) } }, 200, cors);
}

// ── lifecycle (policy-based, reuses the approval philosophy) ──────────────────
export async function handleAssetStatus(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  let b: any = {}; try { b = await req.json(); } catch { /* */ }
  // Accept the reviewer/plan decide shape ({decision}) as well as {action}, so the
  // ONE reviewer surface (client.html) approves a file exactly like any other plan.
  const raw = b.action || (b.decision === 'approve' ? 'approve' : ['abandon', 'decline', 'reject'].includes(b.decision) ? 'reject' : '');
  const action = ['submit', 'approve', 'reject', 'publish', 'archive', 'restore'].includes(raw) ? raw : null;
  if (!action) return json({ error: 'bad_request', message: 'Choose submit, approve, reject, publish, archive, or restore.' }, 400, cors);
  // DAM-2: a client reviewer may ONLY approve or reject (never submit/publish/archive)
  const role = await resolveSiteRole(principal.jwt || '', site.id, principal.kind);
  if (role === 'client_reviewer' && !['approve', 'reject'].includes(action)) {
    return json({ error: 'forbidden', message: 'A reviewer can approve or ask for changes — nothing else.' }, 403, cors);
  }
  const cur = await svc(`presence_media?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=asset_status,metadata&limit=1`);
  const row = arr(cur)[0];
  if (!row) return json({ error: 'not_found', message: 'That file isn’t here.' }, 404, cors);
  const from = row.asset_status;
  const meta = (row.metadata || {}) as Record<string, unknown>;
  const policy = await policyFor(site);
  const now = new Date().toISOString();
  const who = principal.email || principal.userId || '';

  // ── DAM-2: approving/rejecting a STAGED replacement completes or discards it ──
  if (meta.pending_replace && (action === 'approve' || action === 'reject')) {
    const oldId = String(meta.replaces || '');
    if (action === 'approve') {
      // now the approved version goes live: repoint references, retire the old one
      const affected = oldId ? await repointReferences(site, oldId, id) : [];
      if (oldId) { const oldA = await loadAsset(site.id, oldId, true); await svc(`presence_media?id=eq.${oldId}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ deleted_at: now, metadata: { ...((oldA?.metadata as any) || {}), replaced_by: id, replaced_at: now } }) }); }
      const { pending_replace: _pr, ...rest } = meta;
      await svc(`presence_media?id=eq.${id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ asset_status: 'approved', metadata: { ...rest, approved_by: who, approved_at: now } }) });
      await writeChangeEvent({ siteId: site.id, entityType: 'media', entityId: id, action: 'update', summary: `Approved and applied a replacement`, principal, provenance: 'human', fields: ['asset_status', 'storage_path'] });
      await notifyOwnerOfReviewerDecision(site, principal, 'File replacement approved', `file:${id}:approve`);   // staged replacements are the ONE file shape reviewers see
      return json({ data: { ok: true, status: 'approved', applied: true, affects: affected, requires_publish: affected.length > 0 } }, 200, cors);
    }
    // reject: discard the proposed replacement; the old version stays live untouched
    const { pending_replace: _pr, ...rest } = meta;
    await svc(`presence_media?id=eq.${id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ asset_status: 'archived', metadata: { ...rest, rejected_by: who, rejected_at: now } }) });
    await writeChangeEvent({ siteId: site.id, entityType: 'media', entityId: id, action: 'update', summary: `Declined a proposed replacement`, principal, provenance: 'human', fields: ['asset_status'] });
    await notifyOwnerOfReviewerDecision(site, principal, 'File replacement declined', `file:${id}:reject`);
    return json({ data: { ok: true, status: 'archived', applied: false } }, 200, cors);
  }

  // ── ordinary lifecycle (DAM-1) ──
  const to = nextAssetStatus(from, action, policy);
  if (!to) return json({ error: 'not_allowed', message: `Can’t ${action} a file that’s ${from}.` }, 409, cors);
  const stamp: Record<string, unknown> = { asset_status: to };
  if (action === 'approve') stamp.metadata = { ...meta, approved_by: who, approved_at: now };
  const r = await svc(`presence_media?id=eq.${id}&site_id=eq.${site.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(stamp) });
  if (!(r.ok && arr(r)[0])) return json({ error: 'write_failed', message: 'That didn’t save — try again.' }, 502, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'media', entityId: id, action: 'update', summary: `File ${action} → ${to}`, principal, provenance: 'human', fields: ['asset_status'] });
  if (action === 'approve' || action === 'reject') await notifyOwnerOfReviewerDecision(site, principal, `File ${action === 'approve' ? 'approved' : 'declined'}`, `file:${id}:${action}`);
  return json({ data: { ok: true, status: to, policy } }, 200, cors);
}

// ── replace safely — swap a file for a new version, repoint EVERY use ─────────
// Reuses: the new file was already uploaded via /media/upload-url. We repoint the
// same reference columns the renderer reads, carry forward organization, link the
// version chain (in metadata — no new table), retain the old file as the prior
// version (soft-deleted, not purged), and record one change event. Going live is
// the existing publish action (the approval-gated pipeline for team/enterprise).
async function repointReferences(site: SiteRow, fromId: string, toId: string): Promise<string[]> {
  const affected: string[] = [];
  const st = await svc(`presence_settings?site_id=eq.${site.id}&select=logo_media_id,og_media_id&limit=1`);
  const s = arr(st)[0] || {};
  const setPatch: Record<string, unknown> = {};
  if (s.logo_media_id === fromId) { setPatch.logo_media_id = toId; affected.push('your logo'); }
  if (s.og_media_id === fromId) { setPatch.og_media_id = toId; affected.push('your social share image'); }
  if (Object.keys(setPatch).length) await svc(`presence_settings?site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify(setPatch) });
  const offs = await svc(`presence_offerings?site_id=eq.${site.id}&media_id=eq.${fromId}&deleted_at=is.null&select=name`);
  for (const o of arr(offs)) affected.push(`“${o.name}”`);
  if (arr(offs).length) await svc(`presence_offerings?site_id=eq.${site.id}&media_id=eq.${fromId}`, { method: 'PATCH', body: JSON.stringify({ media_id: toId }) });
  const posts = await svc(`presence_posts?site_id=eq.${site.id}&hero_media_id=eq.${fromId}&deleted_at=is.null&select=title`);
  for (const p of arr(posts)) affected.push(`the update “${p.title}”`);
  if (arr(posts).length) await svc(`presence_posts?site_id=eq.${site.id}&hero_media_id=eq.${fromId}`, { method: 'PATCH', body: JSON.stringify({ hero_media_id: toId }) });
  return affected;
}

export async function handleAssetReplace(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  let b: any = {}; try { b = await req.json(); } catch { /* */ }
  const withId = String(b.with || '');
  if (!/^[0-9a-f-]{36}$/.test(withId)) return json({ error: 'bad_request', message: 'Upload the replacement first, then confirm.' }, 400, cors);
  if (withId === id) return json({ error: 'bad_request', message: 'A file can’t replace itself.' }, 400, cors);
  const [oldA, newA] = await Promise.all([loadAsset(site.id, id), loadAsset(site.id, withId)]);
  if (!oldA || !newA) return json({ error: 'not_found', message: 'One of those files isn’t here.' }, 404, cors);
  const now = new Date().toISOString();
  // carry the old file's organization forward onto the new version
  const cf = carryForwardMetadata(oldA, newA);
  const newMeta: Record<string, unknown> = { ...(newA.metadata || {}), ...(cf.metadata || {}), replaces: id };
  const newPatch: Record<string, unknown> = {};
  if (cf.collection) newPatch.collection = cf.collection;
  if (cf.tags) newPatch.tags = cf.tags;
  if (cf.brand) newPatch.brand = cf.brand;

  // ── DAM-2: does this replacement need approval before it can go live? ──
  const refMap = await referencedRefs(site);
  const inUse = refsSet(refMap).has(id);
  const policy = await policyFor(site);
  if (replaceNeedsApproval(policy, inUse, b.submit_for_approval === true)) {
    // STAGED: the old (approved) version stays live; the new one waits as pending.
    // References are NOT repointed until an approver says yes — so the live site
    // never shows an unapproved file, and the publish pipeline is untouched.
    newMeta.pending_replace = true;
    newMeta.submitted_at = now;
    newMeta.submitted_by = principal.email || principal.userId || '';
    await svc(`presence_media?id=eq.${withId}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ ...newPatch, metadata: newMeta, asset_status: 'pending' }) });
    await writeChangeEvent({ siteId: site.id, entityType: 'media', entityId: withId, action: 'update', summary: `Submitted a replacement for ${displayName(oldA)} — awaiting approval`, principal, provenance: 'human', fields: ['asset_status'] });
    return json({ data: { ok: true, pending: true, status: 'pending_approval', replaces: displayName(oldA), message: 'Sent for approval — it goes live once someone approves it.' } }, 200, cors);
  }

  // IMMEDIATE: repoint now (solo owner, or an unused file, or optional-not-submitted)
  await svc(`presence_media?id=eq.${withId}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ ...newPatch, metadata: newMeta }) });
  const affected = await repointReferences(site, id, withId);
  await svc(`presence_media?id=eq.${id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ deleted_at: now, metadata: { ...(oldA.metadata || {}), replaced_by: withId, replaced_at: now } }) });
  await writeChangeEvent({ siteId: site.id, entityType: 'media', entityId: withId, action: 'update', summary: `Replaced ${displayName(oldA)}`, principal, provenance: 'human', fields: ['storage_path'] });
  return json({ data: { ok: true, pending: false, replaced: displayName(oldA), affects: affected, requires_publish: affected.length > 0 } }, 200, cors);
}

export async function handleAssetRollback(site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  const cur = await loadAsset(site.id, id);
  if (!cur) return json({ error: 'not_found', message: 'That file isn’t here.' }, 404, cors);
  const priorId = String((cur.metadata as Record<string, unknown> | null)?.replaces || '');
  if (!/^[0-9a-f-]{36}$/.test(priorId)) return json({ error: 'no_history', message: 'This file has no previous version to restore.' }, 409, cors);
  const prior = await loadAsset(site.id, priorId, true);
  if (!prior) return json({ error: 'no_history', message: 'The previous version is no longer retained.' }, 410, cors);
  const now = new Date().toISOString();
  // bring the prior version back BEFORE repointing (so references resolve)
  await svc(`presence_media?id=eq.${priorId}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ deleted_at: null, metadata: { ...(prior.metadata || {}), replaced_by: null } }) });
  const affected = await repointReferences(site, id, priorId);
  await svc(`presence_media?id=eq.${id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ deleted_at: now, metadata: { ...(cur.metadata || {}), rolled_back_to: priorId, rolled_back_at: now } }) });
  await writeChangeEvent({ siteId: site.id, entityType: 'media', entityId: priorId, action: 'restore', summary: `Restored previous version of ${displayName(prior)}`, principal, provenance: 'human', fields: ['storage_path'] });
  return json({ data: { ok: true, restored: displayName(prior), affects: affected, requires_publish: affected.length > 0 } }, 200, cors);
}

export async function handleAssetDuplicate(site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  const src = await loadAsset(site.id, id);
  if (!src) return json({ error: 'not_found', message: 'That file isn’t here.' }, 404, cors);
  const newPath = await copyObject(site.id, src.storage_path, src.mime || 'image/jpeg');
  if (!newPath) return json({ error: 'copy_failed', message: 'Could not duplicate that file — try again.' }, 502, cors);
  const meta = { ...(src.metadata || {}), title: `${displayName(src)} (copy)` };
  delete (meta as Record<string, unknown>).replaces; delete (meta as Record<string, unknown>).replaced_by;
  const ins = await svc('presence_media', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      site_id: site.id, storage_path: newPath, alt_text: src.alt_text, mime: src.mime, bytes: src.bytes,
      width: src.width ?? null, height: src.height ?? null, tags: src.tags || [], collection: src.collection || '',
      metadata: meta, brand: false, asset_status: 'approved',
    }),
  });
  if (!(ins.ok && arr(ins)[0])) return json({ error: 'copy_failed', message: 'Could not save the duplicate — try again.' }, 502, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'media', entityId: arr(ins)[0].id, action: 'create', summary: `Duplicated ${displayName(src)}`, principal, provenance: 'human', fields: ['storage_path'] });
  return json({ data: { ok: true, asset: present(arr(ins)[0]) } }, 201, cors);
}

// ── safe delete — never remove a live file ────────────────────────────────────
export async function handleAssetDelete(site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  const refMap = await referencedRefs(site);
  const check = canDelete({ id } as Asset, refsSet(refMap).has(id));
  if (!check.ok) return json({ error: 'in_use', message: 'This file is in use on your site — remove it from the page first, or archive it instead.' }, 409, cors);
  void principal; // media RLS + site scope enforce ownership; kept for a consistent signature
  const r = await deleteMedia(site.id, id);
  return r.ok ? json({ data: { ok: true } }, 200, cors) : json({ error: 'delete_failed', message: 'That didn’t delete — try again.' }, 502, cors);
}
