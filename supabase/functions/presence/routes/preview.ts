// GET /preview?page=/menu/&version=draft|live — render through the exact same
// serializer + renderer that publish uses; return one page's HTML. No files
// written, no deploy. M7 (reconciliation R4): preview renders ANY retained
// snapshot — the draft (default), the live version, or a specific publish
// (?publish_id=…) — always through the ONE renderer, never by iframing the
// live site. The ONLY preview-specific behavior (contract-permitted wrapper):
// image paths are substituted with short-lived signed transform URLs, internal
// links are rewritten to stay inside the preview, and the hashed stylesheet is
// inlined so a lone HTML response is self-contained.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { getTemplate, renderSnapshot, latestTemplateVersion } from '../lib/render.ts';
import { serializeDraft } from '../lib/serializer.ts';
import { validateSnapshot } from '../lib/manifest_validate.ts';
import { previewUrlMap } from '../lib/media.ts';
import { snapshotContentUsable } from '../lib/render_types.ts';
import { computeDraftHash } from '../lib/draft_hash.ts';
import { previewCache, previewCacheKey } from '../lib/preview_cache.ts';
import { injectPreviewBadge } from '../lib/preview_env.ts';
import type { Snapshot } from '../lib/render_types.ts';
import type { SiteRow } from '../lib/site.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function loadSnapshotFor(site: SiteRow, version: string, publishId: string | null, launchId: string | null):
  Promise<{ snapshot: Snapshot; mediaManifest: any[] } | { error: string; message: string; status: number } | null> {
  let snapId: string | null = null;
  if (launchId && UUID_RE.test(launchId)) {
    // FD-T7: preview a staged Launch through the SAME renderer (no new path)
    const l = await svc(`presence_launches?id=eq.${launchId}&site_id=eq.${site.id}&select=snapshot_id&limit=1`);
    snapId = l.json?.[0]?.snapshot_id ?? null;
    if (!snapId) return { error: 'not_restorable', message: 'That launch is no longer available to view.', status: 410 };
  } else if (publishId && UUID_RE.test(publishId)) {
    const p = await svc(`presence_publishes?id=eq.${publishId}&site_id=eq.${site.id}&select=snapshot_id&limit=1`);
    snapId = p.json?.[0]?.snapshot_id ?? null;
    if (!snapId) return { error: 'not_restorable', message: 'That version is no longer available to view.', status: 410 };
  } else if (version === 'preview') {
    // FD-T20: the pinned Preview snapshot (Draft → Preview → Live)
    const pv = await svc(`presence_site_preview?site_id=eq.${site.id}&select=snapshot_id&limit=1`);
    snapId = pv.json?.[0]?.snapshot_id ?? null;
    if (!snapId) return { error: 'no_preview', message: 'No preview yet — update your preview first.', status: 404 };
  } else if (version === 'live') {
    const p = await svc(`presence_publishes?site_id=eq.${site.id}&status=eq.live&select=snapshot_id&order=created_at.desc&limit=1`);
    snapId = p.json?.[0]?.snapshot_id ?? null;
    if (!snapId) return { error: 'not_published', message: 'Nothing is live yet — publish first, then compare.', status: 404 };
  } else {
    return null; // caller serializes the draft
  }
  const s = await svc(`presence_snapshots?id=eq.${snapId}&site_id=eq.${site.id}&select=content,media_manifest,content_contract_version,template_slug,template_version,created_at,dev_customization`);
  const row = s.json?.[0];
  if (!row) return { error: 'not_restorable', message: 'That version is no longer available to view.', status: 410 };
  // degenerate pre-contract snapshots are retained in history but can't be shown
  if (!snapshotContentUsable(row.content)) return { error: 'not_restorable', message: 'That version predates the current site format and can’t be shown.', status: 410 };
  return {
    snapshot: { content: row.content, content_contract_version: row.content_contract_version, template_slug: row.template_slug, template_version: row.template_version, created_at: row.created_at, dev_customization: row.dev_customization ?? null },
    mediaManifest: row.media_manifest || [],
  };
}

export async function handlePreview(req: Request, site: SiteRow, cors: Record<string, string>) {
  const url = new URL(req.url);
  const page = url.searchParams.get('page') || '/';
  const version = url.searchParams.get('version') || 'draft';
  const publishId = url.searchParams.get('publish_id');
  const launchId = url.searchParams.get('launch_id');

  const t = getTemplate(site.template_slug, site.template_version);
  if (!t) return json({ error: 'template_missing', message: 'This site’s template isn’t available.' }, 500, cors);

  let snapshot: Snapshot, mediaManifest: any[];
  let blockers = 0, warnings = 0;

  const loaded = await loadSnapshotFor(site, version, publishId, launchId);
  if (loaded && 'error' in loaded) return json({ error: loaded.error, message: loaded.message }, loaded.status, cors);
  if (loaded) {
    ({ snapshot, mediaManifest } = loaded);
  } else {
    const now = new Date().toISOString(); // preview timestamp = "as of right now" (never persisted)
    ({ snapshot, mediaManifest } = await serializeDraft(site.id, t.manifest, { templateSlug: site.template_slug, templateVersion: site.template_version, now }));
    // preview is allowed while INVALID — clients need to see drafts — but blockers ride along in headers
    const v = validateSnapshot(snapshot, t.manifest);
    blockers = v.blockers.length; warnings = v.warnings.length;
  }

  // Phase CP-1 (FD-T8): try-another-look — render THIS snapshot with a different
  // template, preview-only (nothing persisted; content untouched by architecture).
  const tryTemplate = url.searchParams.get('template') || '';
  if (tryTemplate && tryTemplate !== snapshot.template_slug) {
    const v = latestTemplateVersion(tryTemplate);
    const cand = v ? getTemplate(tryTemplate, v) : null;
    if (!cand) return json({ error: 'bad_template', message: 'That look isn’t available.' }, 400, cors);
    if (cand.manifest.content_contract_version !== snapshot.content_contract_version) {
      return json({ error: 'incompatible_template', message: 'That look can’t show this content yet.' }, 400, cors);
    }
    snapshot = { ...snapshot, template_slug: tryTemplate, template_version: v! };
  }

  // M8: cache the deterministic render keyed by the M3 content hash of the FINAL
  // snapshot (captures content + template override + dev layer). Any draft edit
  // changes the hash → a different key → automatic invalidation (never stale).
  // The render is the only cached step; signed image URLs are re-applied per
  // request below, so a cache hit never carries an expired URL. Publish never
  // reads this cache. A cache MISS on a served draft also records blockers/warnings.
  let fileMap: Record<string, string | Uint8Array>;
  let cacheHit = false;
  try {
    const hash = await computeDraftHash(snapshot);
    const key = previewCacheKey(site.id, 'draft', hash);
    const cached = previewCache.get(key);
    if (cached) {
      fileMap = cached.fileMap;
      if (loaded === null) { blockers = cached.blockers; warnings = cached.warnings; }
      cacheHit = true;
    } else {
      // Phase B1: same renderSnapshot as publish/restore — preview is pixel-identical
      // to production for the same snapshot (incl. the Developer-Mode layer).
      fileMap = renderSnapshot(snapshot, { baseUrl: 'https://preview.invalid' });
      previewCache.set(key, { fileMap, mediaManifest, blockers, warnings });
    }
  } catch (e) {
    console.error('preview render failed:', (e as Error)?.message);
    return json({ error: 'render_failed', message: 'We couldn’t draw this preview. Your content is safe — your concierge has been notified.' }, 500, cors);
  }
  const filePath = page === '/' ? 'index.html' : `${page.replace(/^\/|\/$/g, '')}/index.html`;
  let html = fileMap[filePath] as string | undefined;
  if (!html) return json({ error: 'page_not_found', message: `No page at ${page}.` }, 404, cors);

  // the contract-permitted wrapper: signed-image substitution + internal link rewrite
  const urls = await previewUrlMap(mediaManifest);
  for (const [outPath, signed] of Object.entries(urls)) html = html!.replaceAll(`"${outPath}"`, `"${signed}"`);
  html = html!.replaceAll('https://preview.invalid', '');
  // inline the hashed stylesheet (a lone HTML response can't fetch deploy assets)
  const cssKey = Object.keys(fileMap).find((k) => k.startsWith('assets/') && k.endsWith('.css'));
  if (cssKey) html = html.replace(/<link rel="stylesheet" href="[^"]*">/, `<style>${fileMap[cssKey]}</style>`);

  // M8: draft watermark — visible "this is a preview, not the live site" badge on
  // DRAFT/PREVIEW content only. Injected here in the preview wrapper, NEVER inside
  // renderSnapshot → it can never reach a published deploy. (Explicit live/publish
  // comparison views stay clean so the operator sees the true published look.)
  if (version === 'draft' || version === 'preview') {
    const bizName = (snapshot.content as any)?.identity?.business_name || '';
    html = injectPreviewBadge(html!, bizName);
  }

  return new Response(html, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Presence-Draft-Blockers': String(blockers),
      'X-Presence-Draft-Warnings': String(warnings),
      'X-Presence-Preview-Version': loaded ? (publishId ? 'publish' : 'live') : 'draft',
      'X-Presence-Preview-Cache': cacheHit ? 'hit' : 'miss',
    },
  });
}
