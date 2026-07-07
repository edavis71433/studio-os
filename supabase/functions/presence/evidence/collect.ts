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
import { collectOptimization } from '../optimization/collect.ts';
import { fetchExternalSite } from '../monitor/external.ts';
import { resolveIndustryKey } from '../industry/registry.ts';
import type { OptInput } from '../optimization/collect.ts';
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
  opt: OptInput | null;             // M10 optimization probes (additive; null = probes unavailable)
  connected: unknown[];             // L4.1 normalized read-only connected data (empty = no connections)
  connectedPrior: unknown[];        // L4.2 the prior normalized snapshot per provider, for change detection
  industry: string;                 // L5.1 resolved Industry Pack key — industry providers self-gate on this
  /** M11: true when pages/liveFetch describe the customer's EXISTING EXTERNAL
   *  website (Monitor edition). Providers whose observations are only true of
   *  Presence-hosted sites (not-live, hosting-missing, hours-not-public) check
   *  this so they never emit false evidence about a site we don't host.
   *  Always false for hosted sites — existing behavior provably unchanged. */
  external: boolean;
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

  // ── M11: Monitor edition — observe the customer's EXISTING website ──
  // Same providers, same contract, same pipeline; only the SOURCE of pages
  // changes. Read-only structurally: monitor/external.ts contains only GET
  // fetches and DNS lookups. Publish-ledger inputs are zeroed because publish
  // concepts don't exist for a site we don't host — providers reading them
  // then observe nothing, honestly.
  let external = false;
  let extDomain: string | null = null;
  let extPages = pages;
  let extLiveFetch = liveFetch;
  if (site.edition === 'monitor') {
    const connQ = await svc(`presence_monitor_connections?site_id=eq.${site.id}&status=eq.verified&select=url,domain&limit=1`);
    const conn = connQ.json?.[0];
    if (conn?.url) {
      const ext = await (async () => { try { return await fetchExternalSite(conn.url); } catch { return null; } })();
      if (ext) {
        external = true;
        extDomain = conn.domain;
        extPages = ext.pages;
        extLiveFetch = ext.liveFetch;
        fileMap = {}; fileMapFrom = 'none';   // we don't know their full file map — link checks stay silent
      }
    }
  }

  // M10: optimization probes (additive; every probe individually fenced —
  // a failed probe yields null fields and providers then observe nothing)
  let opt: OptInput | null = null;
  try { opt = await collectOptimization(site, extLiveFetch?.url || null, extDomain); } catch { opt = null; }

  // L4.1: the read-only connected snapshot (normalized cache). Read-only + fenced;
  // absence is simply no connected evidence. Never writes to a provider.
  // L4.2: also load the PRIOR snapshot per provider so change can be observed.
  let connected: unknown[] = [];
  let connectedPrior: unknown[] = [];
  try {
    const cd = await svc(`presence_connected_data?site_id=eq.${site.id}&select=data,prev`);
    const rows = (cd.ok && Array.isArray(cd.json)) ? cd.json : [];
    connected = rows.map((r: any) => r.data).filter(Boolean);
    connectedPrior = rows.map((r: any) => r.prev).filter(Boolean);
  } catch { connected = []; connectedPrior = []; }

  return {
    site, now,
    connected, connectedPrior,
    industry: resolveIndustryKey(site.template_slug),

    draft: normalizeSnapshotContent(structuredClone(snapshot.content)),
    live: external ? null : live,
    lastLiveAt: external ? null : (lastLive?.created_at ?? null),
    everPublished: external ? false : !!lastLive,
    fileMap, fileMapFrom, pages: extPages,
    mediaRows: (media.json ?? []) as MediaRow[],
    usedMediaIds: [...used],
    lastOfferingChangeAt: offEvQ.json?.[0]?.created_at ?? null,
    lastLocationChangeAt: locEvQ.json?.[0]?.created_at ?? null,
    oldestUnpublishedChangeAt: external ? null : (evs[0]?.created_at ?? null),
    unpublishedChangeEvents: external ? 0 : evs.length,
    liveFetch: extLiveFetch,
    opt,
    external,
  };
}
