// ── /analytics/* — Analytics Excellence (AN-1) ───────────────────────────────
// Plain-English understanding, composed from data the platform ALREADY stores.
// NO new engine, NO new AI (reads stored rows + pure composition only — AN-9),
// NO fabricated numbers (traffic/search are honestly marked "not measured yet"
// until a provider is connected — AN-4). Reuses Health Coach, Customer Journey,
// Business Moments, leads, publishing, and the agency portfolio rollup.
//   GET /analytics            — the home (inquiries · website · journey · health · watching · not-measured)
//   GET /analytics/customers  — inquiries detail (AN-3)
//   GET /analytics/search     — getting-found readiness, honest about GSC (AN-4)
//   GET /analytics/portfolio  — agency scope: who's growing / needs attention (AN-7)
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { coachRead } from '../lib/health_coach.ts';
import { buildTimeline } from '../lib/customer_timeline.ts';
import { resolveAgencyMember, agencySiteIds, can } from '../agency/auth.ts';
import { gather } from '../agency/routes.ts';
import { buildPortfolio } from '../agency/portfolio.ts';
import {
  inquiriesInsight, publishingInsight, notMeasured, searchReadinessInsight, portfolioInsights,
  trafficInsights, trafficNotice, periodWord, type Period,
} from '../analytics/compose.ts';
import { aggregateVisits, type VisitRow } from '../lib/visits.ts';
import { searchInsights, searchNotice, searchHealth, searchMilestones, searchDetailInsights, agencySearchState, type GscMetrics } from '../analytics/search_perf.ts';

/** AN-3.1: top queries + pages for a period (from presence_search_terms). */
async function readSearchTerms(clientId: string, period: string): Promise<{ queries: any[]; pages: any[] }> {
  if (!clientId || !period) return { queries: [], pages: [] };
  const r = await svc(`presence_search_terms?client_id=eq.${encodeURIComponent(clientId)}&period=eq.${encodeURIComponent(period)}&select=dimension,key,clicks,impressions,position&order=clicks.desc&limit=20`);
  const rows = Array.isArray((r as any).json) ? (r as any).json : [];
  return { queries: rows.filter((x: any) => x.dimension === 'query').slice(0, 5), pages: rows.filter((x: any) => x.dimension === 'page').slice(0, 5) };
}
import type { SiteRow } from '../lib/site.ts';

/** Read the Google Search Console metrics that already live in the shared `signals`
 *  table (source='gsc', keyed by client_id). No new store, no ingestion — reuse.
 *  Returns hasData:false honestly when there's none (the state everywhere today). */
export async function readGsc(clientId: string | null | undefined): Promise<GscMetrics> {
  const empty: GscMetrics = { impressions: 0, clicks: 0, priorImpressions: null, priorClicks: null, ctr: null, position: null, period: '', hasData: false, totalImpressions: 0, totalClicks: 0, firstImpressionAt: null, firstSearchClickAt: null };
  if (!clientId) return empty;
  const r = await svc(`signals?client_id=eq.${encodeURIComponent(clientId)}&source=eq.gsc&select=metric,value,period&order=period.desc&limit=48`);
  const rows = Array.isArray((r as any).json) ? (r as any).json : [];
  if (!rows.length) return empty;
  const periodsAsc = ([...new Set(rows.map((x: any) => String(x.period)))] as string[]).sort();
  const cur = periodsAsc[periodsAsc.length - 1], prior = periodsAsc[periodsAsc.length - 2];
  const val = (period: string, metric: string): number | null => { const m = rows.find((x: any) => x.period === period && x.metric === metric); return m ? Number(m.value) : null; };
  const sum = (metric: string) => rows.filter((x: any) => x.metric === metric).reduce((a: number, x: any) => a + Number(x.value || 0), 0);
  const firstWith = (metric: string) => { const p = periodsAsc.find((per) => (val(per, metric) || 0) > 0); return p ? `${p}-01T00:00:00.000Z` : null; };
  return {
    impressions: val(cur, 'search_impressions') || 0,
    clicks: val(cur, 'search_clicks') || 0,
    priorImpressions: prior ? val(prior, 'search_impressions') : null,
    priorClicks: prior ? val(prior, 'search_clicks') : null,
    ctr: val(cur, 'search_ctr'),
    position: val(cur, 'avg_position'),
    period: cur, hasData: true,
    totalImpressions: sum('search_impressions'), totalClicks: sum('search_clicks'),
    firstImpressionAt: firstWith('search_impressions'), firstSearchClickAt: firstWith('search_clicks'),
  };
}

const periodDays = (p: Period) => (p === 'week' ? 7 : 30);
/** Load recent visit rows for a site over the current + prior window (for trend).
 *  TRUTHFULNESS (AN-4): the 5000-row cap, ordered ts.desc, truncates the PRIOR
 *  window first — a busy site would silently show an inflated "up from N" trend
 *  built on an undercounted prior period. At the cap we mark the result
 *  truncated; consumers suppress the trend clause rather than fabricate one. */
export type VisitRows = VisitRow[] & { truncated?: boolean };
export async function loadVisits(siteId: string, period: Period, nowMs: number): Promise<VisitRows> {
  const startIso = new Date(nowMs - 2 * periodDays(period) * 86_400_000).toISOString();
  const r = await svc(`presence_visits?site_id=eq.${siteId}&ts=gte.${startIso}&select=ts,kind,path,ref_host,utm_source,device,country,visitor_hash&order=ts.desc&limit=5000`);
  const rows = (Array.isArray((r as any).json) ? (r as any).json : []) as VisitRows;
  if (rows.length >= 5000) rows.truncated = true;
  return rows;
}

const arr = (r: { json?: unknown }): any[] => (Array.isArray((r as { json?: unknown[] }).json) ? (r as { json: any[] }).json : []);
const periodOf = (req: Request): Period => (new URL(req.url).searchParams.get('period') === 'month' ? 'month' : 'week');

/** Are the traffic/search providers actually connected? (They are 'planned' today,
 *  so this is honestly false — Analytics then says so rather than faking a number.) */
async function connectionState(siteId: string): Promise<{ ga: boolean; gsc: boolean }> {
  const r = await svc(`presence_connections?site_id=eq.${siteId}&select=provider_key,status`);
  const live = new Set(arr(r).filter((c) => ['connected', 'verified', 'active'].includes(String(c.status))).map((c) => c.provider_key));
  return { ga: live.has('google_analytics'), gsc: live.has('google_search_console') };
}

export async function handleAnalyticsHome(req: Request, site: SiteRow, cors: Record<string, string>) {
  const period = periodOf(req);
  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const visits = await loadVisits(site.id, period, nowMs);
  const traffic = aggregateVisits(visits, nowMs, periodDays(period));
  const [subsR, pubsR, lastChangeR, momentsR, firstPubR, firstLeadR, identR, entR, metaR, conn] = await Promise.all([
    svc(`presence_form_submissions?site_id=eq.${site.id}&spam=is.false&select=created_at,form_kind,status&order=created_at.desc&limit=500`),
    svc(`presence_publishes?site_id=eq.${site.id}&status=eq.live&select=created_at&order=created_at.desc&limit=200`),
    svc(`presence_change_events?site_id=eq.${site.id}&select=created_at&order=created_at.desc&limit=1`),
    svc(`presence_moments?site_id=eq.${site.id}&status=eq.active&select=headline,summary,moment_type,created_at&order=importance.desc&limit=4`),
    svc(`presence_publishes?site_id=eq.${site.id}&status=eq.live&select=created_at,completed_at&order=created_at.asc&limit=1`),
    svc(`presence_form_submissions?site_id=eq.${site.id}&spam=is.false&select=created_at&order=created_at.asc&limit=1`),
    svc(`presence_identity?site_id=eq.${site.id}&select=settings&limit=1`),
    site.client_id ? svc(`presence_entitlements?client_id=eq.${encodeURIComponent(site.client_id)}&product=eq.presence&select=status,created_at,current_period_end&limit=1`) : Promise.resolve({ json: [] }),
    svc(`presence_sites?id=eq.${site.id}&select=created_at&limit=1`),
    connectionState(site.id),
  ]);

  // ── inquiries (the realest customer metric) ──
  const subs = arr(subsR);
  const createdAts = subs.map((s) => s.created_at).filter(Boolean);
  const w = nowMs - (period === 'week' ? 7 : 30) * 86_400_000;
  const cur = subs.filter((s) => Date.parse(s.created_at) > w);
  const byKind = { contact: 0, quote: 0, booking: 0 };
  for (const s of cur) if (s.form_kind in byKind) (byKind as any)[s.form_kind]++;
  const unread = subs.filter((s) => s.status === 'new').length;
  const inquiries = inquiriesInsight(createdAts, byKind, unread, nowMs, period);

  // ── publishing (the real "website" signal we DO have) ──
  const publishing = publishingInsight(arr(pubsR).map((p) => p.created_at).filter(Boolean), site.last_published_at || null, nowMs, period);

  // ── journey (reuse the existing pure timeline) ──
  const ent = arr(entR)[0] || {};
  const verification = arr(identR)[0]?.settings?.verification;
  const firstVisitorAt = [...visits].reverse().find((v) => v.kind === 'pageview')?.ts || null; // earliest in window (approx)
  const journey = buildTimeline({
    createdAt: arr(metaR)[0]?.created_at || nowIso,
    firstPublishedAt: arr(firstPubR)[0]?.completed_at || arr(firstPubR)[0]?.created_at || null,
    searchVerified: !!(verification && (verification.google || verification.bing)),
    firstVisitorAt,
    firstInquiryAt: arr(firstLeadR)[0]?.created_at || null,
    firstCustomerAt: ent.status === 'active' ? (ent.created_at || null) : null,
    renewsAt: ent.current_period_end || null,
  }, nowIso);
  const milestone = journey.latestCelebration
    ? { key: 'journey', title: 'A milestone', sentence: journey.latestCelebration.note, tone: 'good' as const }
    : null;

  // ── health (reuse the Health Coach's pure read) ──
  // AN-3: real Search Performance (Google) from the shared `signals` table.
  const gsc = await readGsc(site.client_id);
  const sh = searchHealth(gsc);
  const lastChangeAt = arr(lastChangeR)[0]?.created_at || null;
  const health = coachRead({
    live: site.status === 'live',
    lastPublishedAt: site.last_published_at || null,
    pendingApprovals: 0,
    connectedNeedingAttention: 0,
    searchIssues: (sh.impressionsFalling || sh.noVisibility) ? 1 : 0,   // search visibility feeds the coach
    leadsWaiting: unread,
    unpublishedChanges: !!lastChangeAt && (!site.last_published_at || lastChangeAt > site.last_published_at),
    domainExpiringDays: null,
  }, nowIso);

  // AN-2: real first-party traffic; AN-3: real search performance. Only surfaces
  // that genuinely have no data stay in "not measured".
  const trafficCards = trafficInsights(traffic, period);
  const searchCards = searchInsights(gsc);
  const notice = trafficNotice(traffic);
  const sNotice = searchNotice(gsc);
  const watching = arr(momentsR).map((m) => ({ headline: m.headline, summary: m.summary, moment_type: m.moment_type }));
  if (sNotice) watching.unshift({ headline: sNotice.headline, summary: sNotice.summary, moment_type: sNotice.tone === 'good' ? 'celebration' : 'needs_attention' });
  if (notice) watching.unshift({ ...notice, moment_type: 'celebration' });

  const gscConnected = conn.gsc || gsc.hasData;
  return json({ data: {
    period,
    headline: `Here’s how your business is doing this ${periodWord(period)}.`,
    insights: [...trafficCards, ...searchCards, inquiries, publishing, ...(milestone ? [milestone] : [])],
    health: { sentence: health.headline, status: health.status, suggestions: (health.suggestions || []).slice(0, 3) },
    watching,
    not_measured: gscConnected ? [] : notMeasured(true, false),   // traffic is first-party; search real when connected
  } }, 200, cors);
}

export async function handleAnalyticsCustomers(req: Request, site: SiteRow, cors: Record<string, string>) {
  const period = periodOf(req);
  const nowMs = Date.now();
  const subsR = await svc(`presence_form_submissions?site_id=eq.${site.id}&spam=is.false&select=created_at,form_kind,status,name,message&order=created_at.desc&limit=500`);
  const subs = arr(subsR);
  const createdAts = subs.map((s) => s.created_at).filter(Boolean);
  const wMs = nowMs - (period === 'week' ? 7 : 30) * 86_400_000;
  const cur = subs.filter((s) => Date.parse(s.created_at) > wMs);
  const byKind = { contact: 0, quote: 0, booking: 0 };
  for (const s of cur) if (s.form_kind in byKind) (byKind as any)[s.form_kind]++;
  const unread = subs.filter((s) => s.status === 'new').length;
  const inquiries = inquiriesInsight(createdAts, byKind, unread, nowMs, period);
  const recent = subs.slice(0, 8).map((s) => ({ when: s.created_at, kind: s.form_kind, who: s.name || 'Someone', unread: s.status === 'new' }));
  // Honest note: without a contact identity/orders table there is no truthful
  // "repeat customer" or "conversion" figure — we do not invent one.
  return json({ data: { period, inquiries, by_kind: byKind, total_all_time: subs.length, unread, recent, note: 'Studio OS counts inquiries — everyone who reached out. Repeat-customer and revenue figures aren’t tracked yet.' } }, 200, cors);
}

// ── AN-2: the Website view — real first-party traffic (honest empty state) ────
export async function handleAnalyticsWebsite(req: Request, site: SiteRow, cors: Record<string, string>) {
  const period = periodOf(req);
  const nowMs = Date.now();
  const visits = await loadVisits(site.id, period, nowMs);
  const agg = aggregateVisits(visits, nowMs, periodDays(period));
  return json({ data: {
    period,
    insights: trafficInsights(agg, period),
    visitors: agg.visitors, pageviews: agg.pageviews,
    top_pages: agg.topPages, top_sources: agg.topSources, devices: agg.devices, countries: agg.countries,
    events: agg.events,
    has_data: agg.hasData,
  } }, 200, cors);
}

export async function handleAnalyticsSearch(_req: Request, site: SiteRow, cors: Record<string, string>) {
  const [identR, settingsR, conn] = await Promise.all([
    svc(`presence_identity?site_id=eq.${site.id}&select=seo_title,seo_description,settings&limit=1`),
    svc(`presence_settings?site_id=eq.${site.id}&select=google_site_verification,bing_site_verification&limit=1`),
    connectionState(site.id),
  ]);
  const ident = arr(identR)[0] || {};
  const settings = arr(settingsR)[0] || {};
  const readiness = searchReadinessInsight({
    verified: !!(String(settings.google_site_verification || '').trim() || String(settings.bing_site_verification || '').trim()),
    titleSet: !!String(ident.seo_title || '').trim(),
    descriptionSet: !!String(ident.seo_description || '').trim(),
    sitemap: true, // emitted by construction for every published site
    brokenLinks: 0,
  });
  // AN-3: real Search Performance from the shared `signals` table when present.
  const gsc = await readGsc(site.client_id);
  const connected = conn.gsc || gsc.hasData;
  // AN-3.1: query/page detail now flows from presence_search_terms (via the GSC sync)
  const detail = gsc.hasData ? await readSearchTerms(site.client_id, gsc.period) : { queries: [], pages: [] };
  const detailCards = searchDetailInsights(detail.queries, detail.pages);
  return json({ data: {
    readiness,
    performance: searchInsights(gsc),               // real impressions/clicks when connected; [] otherwise
    detail: detailCards,                            // top searches + best page, in plain English
    milestones: gsc.hasData ? searchMilestones(gsc.totalImpressions, gsc.totalClicks, gsc.firstImpressionAt, gsc.firstSearchClickAt) : [],
    detail_available: detailCards.length > 0,
    not_measured: connected ? [] : notMeasured(true, false),
    connected: { search_console: connected },
  } }, 200, cors);
}

export async function handleAnalyticsPortfolio(jwt: string, cors: Record<string, string>) {
  const member = await resolveAgencyMember(jwt);
  if (!member) return json({ error: 'not_agency', message: 'Analytics across clients is for studio accounts.' }, 403, cors);
  if (!can(member.role, 'read')) return json({ error: 'forbidden', message: 'You don’t have access to the portfolio.' }, 403, cors);
  const siteIds = await agencySiteIds(member.agency_id);
  if (!siteIds.length) return json({ data: { headline: 'No clients yet.', insights: [] } }, 200, cors);
  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const input = await gather(member.agency_id, nowIso);
  const portfolio = buildPortfolio(input);
  // AN-2.4: per-client visitor counts (this week) — one bounded query, aggregated
  // in code; reuses the same visits store (no duplicate aggregation).
  const sinceIso = new Date(nowMs - 7 * 86_400_000).toISOString();
  const vr = await svc(`presence_visits?site_id=in.(${siteIds.join(',')})&kind=eq.pageview&ts=gte.${sinceIso}&select=site_id,visitor_hash&limit=20000`);
  const perSite = new Map<string, Set<string>>();
  for (const v of arr(vr)) { const s = perSite.get(v.site_id) || new Set<string>(); s.add(v.visitor_hash || String(Math.random())); perSite.set(v.site_id, s); }
  const { headline, insights } = portfolioInsights(
    (portfolio || []).map((c: any) => ({ name: c.name, leads_waiting: c.leads_waiting, unpublished_changes: c.unpublished_changes, last_published_at: c.last_published_at, attention: c.attention, visitors: (perSite.get(c.site_id) || new Set()).size })),
    nowMs,
  );

  // AN-3 (§Agency): per-client search state from the shared `signals` table — who's
  // growing/falling on Google, and who hasn't connected Search Console. Reuses the
  // portfolio; one site→client map + one signals query (no duplicate dashboard).
  const sites = arr(await svc(`presence_sites?id=in.(${siteIds.join(',')})&select=id,client_id`));
  const clientIds = sites.map((s) => s.client_id).filter(Boolean);
  const gscRows = clientIds.length ? arr(await svc(`signals?client_id=in.(${clientIds.join(',')})&source=eq.gsc&metric=eq.search_impressions&select=client_id,value,period&order=period.desc&limit=2000`)) : [];
  const byClient = new Map<string, any[]>();
  for (const r of gscRows) { const a = byClient.get(r.client_id) || []; a.push(r); byClient.set(r.client_id, a); }
  const stateFor = (clientId: string) => {
    const rows = byClient.get(clientId) || [];
    if (!rows.length) return 'not_connected';
    const periods = ([...new Set(rows.map((x: any) => String(x.period)))] as string[]).sort().reverse();
    const cur = Number(rows.find((x) => x.period === periods[0])?.value || 0);
    const prior = periods[1] ? Number(rows.find((x) => x.period === periods[1])?.value || 0) : null;
    return agencySearchState({ impressions: cur, clicks: 0, priorImpressions: prior, priorClicks: null, ctr: null, position: null, period: periods[0], hasData: true, totalImpressions: cur, totalClicks: 0, firstImpressionAt: null, firstSearchClickAt: null });
  };
  const counts = { not_connected: 0, growing: 0, falling: 0, steady: 0 } as Record<string, number>;
  for (const s of sites) counts[stateFor(s.client_id)]++;
  const searchInsightsAgency: any[] = [];
  if (counts.growing) searchInsightsAgency.push({ key: 'search_growing', title: 'Rising on Google', sentence: `${counts.growing} ${counts.growing === 1 ? 'client is' : 'clients are'} getting seen more on Google lately.`, number: counts.growing, tone: 'good' });
  if (counts.falling) searchInsightsAgency.push({ key: 'search_falling', title: 'Losing visibility', sentence: `${counts.falling} ${counts.falling === 1 ? 'client is' : 'clients are'} being seen less on Google — worth a fresh update.`, number: counts.falling, tone: 'attention' });
  if (counts.not_connected) searchInsightsAgency.push({ key: 'search_not_connected', title: 'Search not connected', sentence: `${counts.not_connected} of ${siteIds.length} ${counts.not_connected === 1 ? 'client hasn’t' : 'clients haven’t'} connected Google Search Console — so their search numbers aren’t available yet.`, number: counts.not_connected, tone: 'neutral' });

  // P2-F G4 — Studio WEBSITE OVERSIGHT (§2). Coarse per-client website health for
  // the agency, at the already-authorized site scope. Two bounded queries; reads
  // live (no customer data duplicated into the agency workspace); billing shown
  // only at the coarse plan-status level (never payment details).
  const siteToClient = new Map(sites.map((s: any) => [String(s.id), String(s.client_id)]));
  const failed7 = new Set(arr(await svc(`presence_publishes?site_id=in.(${siteIds.join(',')})&status=eq.failed&completed_at=gte.${sinceIso}&select=site_id&limit=2000`)).map((r: any) => String(r.site_id)));
  const entRows = clientIds.length ? arr(await svc(`presence_entitlements?client_id=in.(${clientIds.join(',')})&product=eq.presence&select=client_id,status`)) : [];
  const planStatus = new Map(entRows.map((e: any) => [String(e.client_id), String(e.status)]));
  const websites = (portfolio || []).map((c: any) => {
    const cid = siteToClient.get(String(c.site_id)) || '';
    const plan = planStatus.get(cid) || 'unknown';
    const pubFailed = failed7.has(String(c.site_id));
    return {
      name: c.name,
      draft_live: c.last_published_at ? 'live' : 'draft',
      last_published_at: c.last_published_at || null,
      unpublished_changes: !!c.unpublished_changes,
      leads_waiting: c.leads_waiting || 0,
      publish_failed: pubFailed,
      plan_status: plan,   // coarse SaaS blocker (active|paused|lapsed|…), never payment details
      needs_attention: !!c.attention || pubFailed || plan === 'paused' || plan === 'lapsed',
    };
  });
  const websiteInsights: any[] = [];
  const failedCount = websites.filter((w: any) => w.publish_failed).length;
  const blockedCount = websites.filter((w: any) => w.plan_status === 'paused' || w.plan_status === 'lapsed').length;
  if (failedCount) websiteInsights.push({ key: 'publish_failed', title: 'A publish needs attention', sentence: `${failedCount} ${failedCount === 1 ? 'client site' : 'client sites'} had a publish fail recently — worth a look.`, number: failedCount, tone: 'attention' });
  if (blockedCount) websiteInsights.push({ key: 'plan_blocked', title: 'A subscription needs attention', sentence: `${blockedCount} ${blockedCount === 1 ? 'client’s software subscription is' : 'clients’ software subscriptions are'} paused or ended — editing/publishing is limited until it’s resolved.`, number: blockedCount, tone: 'attention' });

  return json({ data: { headline, insights: [...insights, ...searchInsightsAgency, ...websiteInsights], websites, client_count: siteIds.length } }, 200, cors);
}
