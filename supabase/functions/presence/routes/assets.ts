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
import { deleteMedia, signThumb, signDownload, copyObject } from '../lib/media.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { editionFromPlan, editionFromSite } from '../commerce/editions.ts';
import {
  searchAssets, collectionsOf, tagsOf, assetHealth, detectDuplicates, usageMap,
  canDelete, nextAssetStatus, assetApprovalPolicy, displayName, usageSummary, carryForwardMetadata,
  fileKind, isFavorite, replaceNeedsApproval, fileState, type Asset, type ApprovalPolicy, type UsageRef,
} from '../lib/dam.ts';
import { resolveSiteRole } from '../lib/workspace.ts';

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

async function policyFor(site: SiteRow): Promise<ApprovalPolicy> {
  try {
    const ent = await svc(`presence_entitlements?client_id=eq.${encodeURIComponent(site.client_id)}&product=eq.presence&select=plan&limit=1`);
    const plan = arr(ent)[0]?.plan;
    const ed = plan ? editionFromPlan(String(plan)) : editionFromSite(site.edition, {});
    return assetApprovalPolicy({ isEnterprise: ed === 'enterprise', isAgency: ed === 'agency' });
  } catch { return 'immediate'; }
}

/** Shape one asset for the UI (calm, customer-facing fields). */
function present(a: Asset, opts: { in_use?: boolean; thumb?: string | null } = {}) {
  const meta = (a.metadata || {}) as Record<string, unknown>;
  return {
    ...a,
    name: displayName(a),
    kind: fileKind(a.mime),
    favorite: isFavorite(a),
    in_use: opts.in_use,
    thumb: opts.thumb ?? undefined,
    // DAM-2: approval state + who/when, from reused metadata (no new columns)
    state: fileState(a.asset_status, !!opts.in_use, !!meta.pending_replace),
    approval: { approved_by: meta.approved_by || null, approved_at: meta.approved_at || null, submitted_by: meta.submitted_by || null, submitted_at: meta.submitted_at || null, pending_replace: !!meta.pending_replace },
  };
}

// ── the library ──────────────────────────────────────────────────────────────
export async function handleAssetsList(req: Request, site: SiteRow, cors: Record<string, string>) {
  const url = new URL(req.url);
  const [assets, refMap, live] = await Promise.all([loadAssets(site.id), referencedRefs(site), liveMediaIds(site)]);
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
    assets: page.map((a, i) => present(a, { in_use: used[a.id], thumb: i < LIST_THUMB_CAP ? thumbs[i] : null })),
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
      return json({ data: { ok: true, status: 'approved', applied: true, affects: affected, requires_publish: affected.length > 0 } }, 200, cors);
    }
    // reject: discard the proposed replacement; the old version stays live untouched
    const { pending_replace: _pr, ...rest } = meta;
    await svc(`presence_media?id=eq.${id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ asset_status: 'archived', metadata: { ...rest, rejected_by: who, rejected_at: now } }) });
    await writeChangeEvent({ siteId: site.id, entityType: 'media', entityId: id, action: 'update', summary: `Declined a proposed replacement`, principal, provenance: 'human', fields: ['asset_status'] });
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
