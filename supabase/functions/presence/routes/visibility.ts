// ── /visibility — the Search tab's one read, and its one action ──────────────
//   GET  /visibility        — score · AI result · Search Console · Google listing
//   POST /visibility/check  — run the studio's Site Review on this website now
//
// Not under /search: that top segment is the 'website' feature, which a watch-only
// plan doesn't have, and search is the one thing that works whoever hosts the site
// (lib/gsc.ts). Every part of the read is tolerant, so a failed part empties its
// own card and never the whole tab.
import { json } from '../../_shared/http.ts';
import { insert, select } from '../../_shared/tools/db.ts';
import { logUsage, spendCapReached } from '../../_shared/tools/guard.ts';
import { RESTING_MESSAGE, TOOLS_BASE_URL } from '../../_shared/tools/config.ts';
import { assertPublicHttpUrl } from '../../_shared/tools/url_guard.ts';
import { ERROR_MESSAGES, runSiteReview, type ScanDeps } from '../../_shared/tools/site_review/scan.ts';
import { svc } from '../lib/db.ts';
import { rateAllow } from '../lib/ratelimit.ts';
import { runAfterResponse } from '../lib/after_response.ts';
import { aiSummary, liveAddress, reportUrlFilter, reviewBusinessType, scoreSummary, visibilityState } from '../lib/search_visibility.ts';
import { readGsc, readSearchPages, readSearchTerms } from './analytics.ts';
import { searchReadinessState } from '../analytics/compose.ts';
import { readProvider } from '../connected/adapters.ts';
import { connectionReason } from '../connected/contract.ts';
import { providerByKey } from '../connected/providers.ts';
import type { SiteRow } from '../lib/site.ts';

// Overridable for tests: the network-facing pieces of a check.
export const checkDeps: Partial<ScanDeps> = {};

const CHECKS_PER_DAY = 6;
const READS_PER_DAY = 4;
const DAY_MS = 86_400_000;
const rows = (r: unknown): any[] => { const j = (r as { json?: unknown } | null)?.json; return Array.isArray(j) ? j : []; };
const safe = async <T>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };

async function externalDomainOf(siteId: string): Promise<string | null> {
  return rows(await safe(svc(`presence_monitor_connections?site_id=eq.${siteId}&select=domain&limit=1`)))[0]?.domain || null;
}

async function latestReport(tool: 'site_review' | 'ai_visibility', domain: string) {
  const filter = reportUrlFilter(domain);
  if (!filter) return null;
  const got = await safe(select(`tool_reports?tool=eq.${tool}&${filter}&select=id,input,scores,findings,created_at&order=created_at.desc&limit=1`));
  return (got && got[0]) || null;
}

/** A card's connection state in the same words the Connections page uses. */
function connectionCard(key: string, conn: any) {
  const label = providerByKey(key)?.customerLabel || 'this service';
  return {
    status: conn?.status || 'disconnected',
    health: conn?.health || 'unknown',
    reason: connectionReason(conn?.last_error, label),
    last_sync_at: conn?.last_sync_at || null,
    connect_href: '/connections.html',
  };
}

/** Keep a connected service current without a new background job: opening the tab
 *  is the "natural read" (L4.1), at most once a day per service once it succeeds,
 *  and bounded when it keeps failing, so a broken connection can't call Google on
 *  every page view. */
async function freshen(siteId: string, key: string, conn: any, fetchedAt: string | null | undefined) {
  if (conn?.status !== 'connected') return;
  const age = fetchedAt ? Date.now() - Date.parse(fetchedAt) : Infinity;
  if (age < DAY_MS) return;
  if (!(await rateAllow(`visibility_read:${siteId}:${key}`, READS_PER_DAY, 86_400))) return;
  runAfterResponse(readProvider(siteId, key, providerByKey(key)?.customerLabel || key).catch(() => null));
}

export async function handleVisibility(site: SiteRow, cors: Record<string, string>) {
  const ext = await externalDomainOf(site.id);
  const address = liveAddress(site, ext);
  const [connQ, dataQ, gsc, review, ai] = await Promise.all([
    safe(svc(`presence_connections?site_id=eq.${site.id}&provider_key=in.(google_search_console,google_business_profile)&select=provider_key,status,health,last_sync_at,last_error,config`)),
    safe(svc(`presence_connected_data?site_id=eq.${site.id}&provider_key=in.(google_search_console,google_business_profile)&select=provider_key,data,fetched_at`)),
    safe(readGsc(site.client_id)),
    address ? latestReport('site_review', address.domain) : Promise.resolve(null),
    address ? latestReport('ai_visibility', address.domain) : Promise.resolve(null),
  ]);
  const conn = new Map(rows(connQ).map((c) => [c.provider_key, c]));
  const data = new Map(rows(dataQ).map((d) => [d.provider_key, d]));
  const gscConn = conn.get('google_search_console'), gbpConn = conn.get('google_business_profile');
  const gscData = data.get('google_search_console'), gbpData = data.get('google_business_profile');

  await Promise.all([
    freshen(site.id, 'google_search_console', gscConn, gscData?.fetched_at),
    freshen(site.id, 'google_business_profile', gbpConn, gbpData?.fetched_at),
  ]);

  const [terms, pages] = gsc?.hasData
    ? await Promise.all([safe(readSearchTerms(site.client_id, gsc.period)), safe(readSearchPages(site.client_id, gsc.period, 5))])
    : [null, null];
  const readiness = searchReadinessState({
    hosted: site.edition !== 'monitor', lastPublishedAt: site.last_published_at, externalDomain: ext,
    gscConnected: gscConn?.status === 'connected', hasData: !!gsc?.hasData,
  });

  return json({ data: {
    state: visibilityState(site, address),
    address,
    score: scoreSummary(review, TOOLS_BASE_URL),
    ai: aiSummary(ai, TOOLS_BASE_URL),
    ai_check_url: `${TOOLS_BASE_URL}/ai-visibility`,
    console: {
      ...connectionCard('google_search_console', gscConn),
      readiness,
      unavailable: !gsc || !gsc.ok,
      has_data: !!gsc?.hasData,
      ...(gsc?.hasData ? {
        clicks: gsc.clicks, impressions: gsc.impressions, prior_clicks: gsc.priorClicks, prior_impressions: gsc.priorImpressions, period: gsc.period,
        monthly: gsc.monthly || [],
        top_terms: (terms?.queries || []).map((q: any) => ({ term: String(q.key || ''), clicks: Number(q.clicks) || 0, impressions: Number(q.impressions) || 0 })),
        top_pages: pages || [],
      } : {}),
    },
    listing: {
      ...connectionCard('google_business_profile', gbpConn),
      property: gbpConn?.config?.location_id
        ? { id: String(gbpConn.config.location_id), name: String(gbpConn.config.location_name || ''), auto_selected: !!gbpConn.config.auto_selected }
        : null,
      data: gbpData ? { ...gbpData.data, as_of: gbpData.fetched_at } : null,
    },
  } }, 200, cors);
}

export async function handleVisibilityCheck(site: SiteRow, cors: Record<string, string>) {
  const address = liveAddress(site, await externalDomainOf(site.id));
  if (!address) {
    return json({ error: 'nothing_to_check', message: site.edition === 'monitor'
      ? 'Add this website’s address first, then it can be checked.'
      : 'There’s nothing live to check yet. Publish the site, and the check can run.' }, 409, cors);
  }
  if (!(await rateAllow(`visibility_check:${site.id}`, CHECKS_PER_DAY, 86_400))) {
    return json({ error: 'too_many', message: 'That’s plenty of checks for today, and your latest result is still here. Try again tomorrow.' }, 429, cors);
  }
  if (await spendCapReached()) return json({ error: 'resting', message: RESTING_MESSAGE }, 503, cors);

  const [identR, locR, setR] = await Promise.all([
    safe(svc(`presence_identity?site_id=eq.${site.id}&select=business_name&limit=1`)),
    safe(svc(`presence_locations?site_id=eq.${site.id}&select=city,region&limit=1`)),
    safe(svc(`presence_settings?site_id=eq.${site.id}&select=industry_key&limit=1`)),
  ]);
  const loc = rows(locR)[0];
  const city = [loc?.city, loc?.region].filter(Boolean).join(', ').slice(0, 80);
  const result = await runSiteReview(
    { url: address.url, businessType: reviewBusinessType(rows(setR)[0]?.industry_key), city },
    { guard: assertPublicHttpUrl, ...checkDeps },
  ).catch(() => null);
  if (!result) return json({ error: 'failed', message: 'The check didn’t finish. Nothing changed. Try again in a minute.' }, 502, cors);
  if (!result.ok) return json({ error: result.error, message: ERROR_MESSAGES[result.error] }, 422, cors);

  // Saved as an ordinary report in the tools' own store, opened for the owner (the
  // public tool's email gate is for strangers), and counted against the same daily
  // spend cap as a scan from the public page.
  const row = await insert('tool_reports', {
    tool: 'site_review', input: { ...result.input, business_name: rows(identR)[0]?.business_name || (result.input as Record<string, unknown>).business_name },
    raw_results: result.raw, findings: result.findings, scores: result.scores, unlocked: true, unlocked_at: new Date().toISOString(),
  });
  await logUsage({ tool: 'site_review', kind: 'scan', report_id: String(row.id), cost_usd: result.costUsd, note: 'builder search tab' });
  return json({ data: { score: scoreSummary(row, TOOLS_BASE_URL) } }, 200, cors);
}
