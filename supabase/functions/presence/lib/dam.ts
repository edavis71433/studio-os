// ── Phase DAM: Studio Asset Library — pure cores ─────────────────────────────
// Organization + lifecycle + health over the EXISTING presence_media asset rows.
// No I/O here: routes feed already-loaded rows + the set of referenced media ids
// (from offerings/posts/settings). Reuses the platform's approval philosophy for
// the lifecycle; nothing here duplicates storage, permissions, or the pipeline.

export interface Asset {
  id: string;
  storage_path: string;
  alt_text: string;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  mime?: string;
  tags?: string[] | null;
  collection?: string | null;
  metadata?: Record<string, unknown> | null;
  content_hash?: string | null;
  brand?: boolean | null;
  asset_status?: string | null;   // draft | pending | approved | published | archived
  created_at?: string;
}

export const ASSET_STATUSES = ['draft', 'pending', 'approved', 'published', 'archived'] as const;
export type AssetStatus = typeof ASSET_STATUSES[number];
export function isAssetStatus(s: unknown): s is AssetStatus { return typeof s === 'string' && (ASSET_STATUSES as readonly string[]).includes(s); }

// ── DAM-15: policy-based approval (never friction where it isn't needed) ──────
export type ApprovalPolicy = 'immediate' | 'optional' | 'required';
export function assetApprovalPolicy(ctx: { isEnterprise?: boolean; isAgency?: boolean }): ApprovalPolicy {
  if (ctx.isEnterprise) return 'required';   // team/enterprise: approval before publish/replace-live
  if (ctx.isAgency) return 'optional';       // agency: approval available, not forced
  return 'immediate';                        // solo owner: immediate availability
}

/** An asset is USABLE in content when the policy allows it at its current status.
 *  immediate → anything not archived; optional → same, but 'pending' is held back;
 *  required → only 'approved'/'published'. Pure. */
export function assetAvailable(status: string | null | undefined, policy: ApprovalPolicy): boolean {
  const s = status || 'approved';
  if (s === 'archived') return false;
  if (policy === 'required') return s === 'approved' || s === 'published';
  if (policy === 'optional') return s !== 'pending';
  return true; // immediate
}

/** Allowed lifecycle transitions (draft→pending→approved→published, ↔ archived).
 *  Under 'immediate' policy, an owner may jump draft→approved directly. Pure. */
export function nextAssetStatus(from: string, action: 'submit' | 'approve' | 'publish' | 'archive' | 'restore' | 'reject', policy: ApprovalPolicy): AssetStatus | null {
  const f = (isAssetStatus(from) ? from : 'approved') as AssetStatus;
  switch (action) {
    case 'submit': return f === 'draft' ? 'pending' : null;
    case 'approve': return (f === 'pending' || (policy === 'immediate' && f === 'draft')) ? 'approved' : null;
    case 'reject': return f === 'pending' ? 'draft' : null;
    case 'publish': return (f === 'approved') ? 'published' : null;
    case 'archive': return f === 'archived' ? null : 'archived';
    case 'restore': return f === 'archived' ? 'approved' : null;
    default: return null;
  }
}

// ── DAM-8: duplicate detection — content hash when present, else a size/dim
//    heuristic (server never sees bytes on signed-URL uploads). Pure. ──────────
export function dupKey(a: Asset): string {
  if (a.content_hash) return `h:${a.content_hash}`;
  if (a.bytes && a.width && a.height) return `s:${a.bytes}x${a.width}x${a.height}`;
  return '';
}
export function detectDuplicates(assets: Asset[]): Array<{ key: string; ids: string[] }> {
  const groups = new Map<string, string[]>();
  for (const a of assets) {
    const k = dupKey(a);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) || []), a.id]);
  }
  return [...groups.entries()].filter(([, ids]) => ids.length > 1).map(([key, ids]) => ({ key, ids }));
}

// ── DAM-1 (Files): file kind + human display name ────────────────────────────
export type FileKind = 'image' | 'document' | 'other';
export function fileKind(mime: string | null | undefined): FileKind {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf') return 'document';
  return 'other';
}
/** A customer-friendly name. Prefers the human title they set (metadata.title),
 *  else a cleaned filename from the storage path, else a kind label. Pure. */
export function displayName(a: Asset): string {
  const title = String((a.metadata as Record<string, unknown> | null | undefined)?.title || '').trim();
  if (title) return title.slice(0, 200);
  const base = (a.storage_path || '').split('/').pop() || '';
  const cleaned = base.replace(/\.[a-z0-9]+$/i, '').replace(/^[0-9a-f-]{20,}$/i, '');
  if (cleaned) return cleaned.slice(0, 200);
  return fileKind(a.mime) === 'document' ? 'Document' : fileKind(a.mime) === 'image' ? 'Photo' : 'File';
}
export function isFavorite(a: Asset): boolean {
  return !!(a.metadata as Record<string, unknown> | null | undefined)?.favorite;
}

// ── DAM-1 (Files): "where used" — the website-awareness value-add ─────────────
// A single, complete usage model mirroring exactly what the renderer serializes:
// settings.logo_media_id, settings.og_media_id, offerings.media_id, posts.hero_
// media_id. `live` = the asset is in the CURRENT live site (its id is in the live
// snapshot's media_manifest). The route supplies the labelled refs + the live set.
export interface UsageRef { surface: string; label: string; live: boolean }
export interface UsageSummary { total: number; live: number; sensitive: boolean; headline: string }

/** Summarize a file's usage into a calm, plain-English headline + a replace-risk
 *  flag (brand logo / anything currently live is replace-sensitive). Pure. */
export function usageSummary(refs: UsageRef[]): UsageSummary {
  const total = refs.length;
  const live = refs.filter((r) => r.live).length;
  const sensitive = refs.some((r) => r.live || r.surface === 'brand');
  let headline: string;
  if (total === 0) headline = 'Not used anywhere yet.';
  else if (total === 1) headline = `Used as ${refs[0].label}.`;
  else headline = `Used in ${total} places${live ? ` — ${live} live on your site` : ''}.`;
  return { total, live, sensitive, headline };
}

// ── DAM-1 (Files): replace carry-forward — a new version inherits the old file's
//    organization so nothing is lost in a swap. Pure (returns a patch). ─────────
export function carryForwardMetadata(oldAsset: Asset, newAsset: Asset): {
  collection?: string; tags?: string[]; brand?: boolean; metadata?: Record<string, unknown>;
} {
  const patch: { collection?: string; tags?: string[]; brand?: boolean; metadata?: Record<string, unknown> } = {};
  if (!(newAsset.collection || '').trim() && (oldAsset.collection || '').trim()) patch.collection = oldAsset.collection!;
  const oldTags = (oldAsset.tags || []).map((t) => String(t).toLowerCase());
  const newTags = (newAsset.tags || []).map((t) => String(t).toLowerCase());
  const merged = [...new Set([...newTags, ...oldTags])].slice(0, 40);
  if (merged.length > newTags.length) patch.tags = merged;
  if (oldAsset.brand && !newAsset.brand) patch.brand = true;
  const oldTitle = String((oldAsset.metadata as Record<string, unknown> | null)?.title || '').trim();
  const newTitle = String((newAsset.metadata as Record<string, unknown> | null)?.title || '').trim();
  if (oldTitle && !newTitle) patch.metadata = { ...(newAsset.metadata || {}), title: oldTitle };
  return patch;
}

// ── DAM-11: usage — which assets are referenced by content (ids from the route) ─
export function usageMap(assets: Asset[], referencedIds: Iterable<string>): Record<string, boolean> {
  const used = new Set(referencedIds);
  const out: Record<string, boolean> = {};
  for (const a of assets) out[a.id] = used.has(a.id);
  return out;
}

// ── DAM-12: safe delete — never remove an asset that's live in content ────────
export function canDelete(asset: Asset, inUse: boolean): { ok: boolean; reason?: string } {
  if (inUse) return { ok: false, reason: 'in_use' };
  return { ok: true };
}

// ── DAM-13: asset health — plain findings, no scores ──────────────────────────
export interface HealthFinding { kind: string; asset_id: string; detail: string }
export function assetHealth(assets: Asset[], referencedIds: Iterable<string>): HealthFinding[] {
  const used = new Set(referencedIds);
  const findings: HealthFinding[] = [];
  const dups = detectDuplicates(assets);
  const dupIds = new Set(dups.flatMap((d) => d.ids.slice(1))); // flag all but the first of each group
  for (const a of assets) {
    const alt = (a.alt_text || '').trim();
    if (alt.length < 3) findings.push({ kind: 'missing_alt', asset_id: a.id, detail: 'No description — needed for accessibility and search.' });
    if (!used.has(a.id) && a.asset_status !== 'archived') findings.push({ kind: 'unused', asset_id: a.id, detail: 'Not used on the site yet.' });
    if ((a.bytes || 0) > 3_000_000) findings.push({ kind: 'oversized', asset_id: a.id, detail: 'Large file — could slow the page; a smaller version would help.' });
    if (dupIds.has(a.id)) findings.push({ kind: 'duplicate', asset_id: a.id, detail: 'Looks like a duplicate of another asset.' });
    if (used.has(a.id) && a.asset_status === 'pending') findings.push({ kind: 'used_unapproved', asset_id: a.id, detail: 'In use but still awaiting approval.' });
  }
  return findings;
}

// ── DAM-3/4: collections + tags rollups ───────────────────────────────────────
export function collectionsOf(assets: Asset[]): Array<{ name: string; count: number }> {
  const m = new Map<string, number>();
  for (const a of assets) { const c = (a.collection || '').trim(); if (c) m.set(c, (m.get(c) || 0) + 1); }
  return [...m.entries()].map(([name, count]) => ({ name, count })).sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
}
export function tagsOf(assets: Asset[]): Array<{ tag: string; count: number }> {
  const m = new Map<string, number>();
  for (const a of assets) for (const t of (a.tags || [])) { const k = String(t).trim().toLowerCase(); if (k) m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].map(([tag, count]) => ({ tag, count })).sort((x, y) => y.count - x.count || x.tag.localeCompare(y.tag));
}

// ── DAM-1/2/6: the library query + on-demand keyword search (no index; ranked) ─
export interface AssetQuery { collection?: string; tag?: string; status?: string; brand?: boolean; q?: string }
export function searchAssets(assets: Asset[], query: AssetQuery): Asset[] {
  let rows = assets.filter((a) => a.asset_status !== 'archived' || query.status === 'archived');
  if (query.collection) rows = rows.filter((a) => (a.collection || '') === query.collection);
  if (query.status) rows = rows.filter((a) => (a.asset_status || 'approved') === query.status);
  if (typeof query.brand === 'boolean') rows = rows.filter((a) => !!a.brand === query.brand);
  if (query.tag) { const t = query.tag.toLowerCase(); rows = rows.filter((a) => (a.tags || []).some((x) => String(x).toLowerCase() === t)); }
  if (query.q && query.q.trim()) {
    const terms = query.q.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = rows.map((a) => ({ a, s: assetScore(a, terms) })).filter((x) => x.s > 0);
    scored.sort((x, y) => y.s - x.s);
    return scored.map((x) => x.a);
  }
  return rows;
}
/** On-demand relevance: alt text + tags + metadata + filename. Pure, no index. */
function assetScore(a: Asset, terms: string[]): number {
  const hay = [
    a.alt_text || '',
    (a.tags || []).join(' '),
    (a.collection || ''),
    Object.values(a.metadata || {}).map((v) => String(v)).join(' '),
    (a.storage_path || '').split('/').pop() || '',
  ].join(' ').toLowerCase();
  let s = 0;
  for (const t of terms) {
    if ((a.tags || []).some((x) => String(x).toLowerCase() === t)) s += 3; // exact tag = strong
    else if (hay.includes(t)) s += 1;
  }
  return s;
}
