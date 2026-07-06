// ── Evidence collection (M9.0) — ALL I/O lives here ─────────────────────────
// The collector assembles one immutable ObservationInput: snapshots, the
// rendered FileMap (through the ONE renderer, in memory — nothing deployed),
// table aggregates, and a single live-site probe. Providers are pure functions
// of this input; they never fetch, never query, never read the clock.
import { svc } from '../lib/db.ts';
import { getTemplate } from '../lib/render.ts';
import { serializeDraft } from '../lib/serializer.ts';
import { normalizeSnapshotContent } from '../lib/render_types.ts';
import { getSite as netlifyGetSite, netlifyConfigured } from '../lib/netlify.ts';
import type { SnapshotContent } from '../lib/render_types.ts';
import type { SiteRow } from '../lib/site.ts';

export interface LiveFetch {
  attempted: boolean;
  url: string;
  ok: boolean;
  status: number;
  https: boolean;
  headers: Record<string, string>;
  error: string;
}

export interface MediaRow {
  id: string; alt_text: string; bytes: number | null; width: number | null;
  height: number | null; mime: string; created_at: string;
}

export interface ObservationInput {
  site: SiteRow;
  now: string;                      // the run's clock — the only time providers ever see
  draft: SnapshotContent;
  live: SnapshotContent | null;
  lastLiveAt: string | null;
  everPublished: boolean;
  fileMap: Record<string, string>;  // rendered from live content when it exists, else draft
  fileMapFrom: 'live' | 'draft' | 'none';
  pages: Array<{ path: string; html: string }>;
  mediaRows: MediaRow[];
  usedMediaIds: string[];
  lastOfferingChangeAt: string | null;
  lastLocationChangeAt: string | null;
  oldestUnpublishedChangeAt: string | null;
  unpublishedChangeEvents: number;
  liveFetch: LiveFetch | null;      // null = no hosting to probe
}

const pagePath = (key: string) =>
  key === 'index.html' ? '/' : '/' + key.replace(/\/index\.html$/, '/').replace(/index\.html$/, '');

export async function collect(site: SiteRow): Promise<ObservationInput> {
  const now = new Date().toISOString();
  const t = getTemplate(site.template_slug, site.template_version);
  if (!t) throw new Error(`template_missing: ${site.template_slug}@${site.template_version}`);

  const [{ snapshot }, lastLiveQ, offEvQ, locEvQ, media, offUse, postUse, setUse] = await Promise.all([
    serializeDraft(site.id, t.manifest, { templateSlug: site.template_slug, templateVersion: site.template_version, now }),
    svc(`presence_publishes?site_id=eq.${site.id}&status=eq.live&select=snapshot_id,created_at&order=created_at.desc&limit=1`),
    svc(`presence_change_events?site_id=eq.${site.id}&entity_type=eq.offering&select=created_at&order=created_at.desc&limit=1`),
    svc(`presence_change_events?site_id=eq.${site.id}&entity_type=eq.location&select=created_at&order=created_at.desc&limit=1`),
    svc(`presence_media?site_id=eq.${site.id}&deleted_at=is.null&select=id,alt_text,bytes,width,height,mime,created_at`),
    svc(`presence_offerings?site_id=eq.${site.id}&deleted_at=is.null&media_id=not.is.null&select=media_id`),
    svc(`presence_posts?site_id=eq.${site.id}&deleted_at=is.null&hero_media_id=not.is.null&select=hero_media_id`),
    svc(`presence_settings?site_id=eq.${site.id}&select=cover_media_id&limit=1`),
  ]);

  const lastLive = lastLiveQ.json?.[0] ?? null;
  let live: SnapshotContent | null = null;
  if (lastLive?.snapshot_id) {
    const sQ = await svc(`presence_snapshots?id=eq.${lastLive.snapshot_id}&select=content&limit=1`);
    live = sQ.json?.[0]?.content ? normalizeSnapshotContent(sQ.json[0].content) : null;
  }

  // unpublished change events since the last live publish (names-only provenance; counts + oldest only)
  const since = lastLive?.created_at ? `&created_at=gt.${encodeURIComponent(lastLive.created_at)}` : '';
  const evQ = await svc(`presence_change_events?site_id=eq.${site.id}${since}&entity_type=not.in.(publish,restore)&select=created_at&order=created_at.asc&limit=500`);
  const evs: Array<{ created_at: string }> = Array.isArray(evQ.json) ? evQ.json : [];

  // render in memory through the one renderer — observation of the real projection
  let fileMap: Record<string, string> = {};
  let fileMapFrom: ObservationInput['fileMapFrom'] = 'none';
  const contentToRender = live ?? snapshot.content;
  try {
    const fm = t.render(
      { content: structuredClone(contentToRender), content_contract_version: snapshot.content_contract_version, template_slug: site.template_slug, template_version: site.template_version, created_at: now },
      t.manifest,
      { baseUrl: 'https://observe.invalid' },
    );
    for (const [k, v] of Object.entries(fm)) if (typeof v === 'string') fileMap[k] = v;
    fileMapFrom = live ? 'live' : 'draft';
  } catch { fileMap = {}; fileMapFrom = 'none'; }

  const pages = Object.keys(fileMap)
    .filter((k) => k.endsWith('.html'))
    .map((k) => ({ path: pagePath(k), html: fileMap[k] }));

  // one live probe — the only external I/O
  let liveFetch: LiveFetch | null = null;
  if (site.netlify_site_id) {
    let url = site.custom_domain ? `https://${site.custom_domain}` : '';
    if (!url && netlifyConfigured()) {
      const nf = await netlifyGetSite(site.netlify_site_id);
      if (nf.ok && nf.site?.default_domain) url = `https://${nf.site.default_domain}`;
    }
    if (url) {
      liveFetch = { attempted: true, url, ok: false, status: 0, https: false, headers: {}, error: '' };
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(url, { redirect: 'follow', signal: ctrl.signal });
        clearTimeout(timer);
        await r.body?.cancel();
        liveFetch.ok = r.ok; liveFetch.status = r.status; liveFetch.https = r.url.startsWith('https://');
        for (const h of ['strict-transport-security', 'x-content-type-options', 'referrer-policy', 'x-frame-options', 'content-type']) {
          const v = r.headers.get(h); if (v) liveFetch.headers[h] = v;
        }
      } catch (e) {
        liveFetch.error = (e as Error)?.message?.slice(0, 120) || 'fetch failed';
      }
    }
  }

  const used = new Set<string>();
  for (const o of offUse.json ?? []) used.add(o.media_id);
  for (const p of postUse.json ?? []) used.add(p.hero_media_id);
  if (setUse.json?.[0]?.cover_media_id) used.add(setUse.json[0].cover_media_id);

  return {
    site, now,
    draft: normalizeSnapshotContent(structuredClone(snapshot.content)),
    live, lastLiveAt: lastLive?.created_at ?? null, everPublished: !!lastLive,
    fileMap, fileMapFrom, pages,
    mediaRows: (media.json ?? []) as MediaRow[],
    usedMediaIds: [...used],
    lastOfferingChangeAt: offEvQ.json?.[0]?.created_at ?? null,
    lastLocationChangeAt: locEvQ.json?.[0]?.created_at ?? null,
    oldestUnpublishedChangeAt: evs[0]?.created_at ?? null,
    unpublishedChangeEvents: evs.length,
    liveFetch,
  };
}
