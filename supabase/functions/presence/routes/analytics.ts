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
import { buildPortfolio, filterPortfolio } from '../agency/portfolio.ts';
import {
  inquiriesInsight, publishingInsight, notMeasured, searchReadinessInsight, portfolioInsights, websiteRows,
  trafficInsights, trafficNotice, periodWord, foldPortfolioVisitors, PORTFOLIO_VISITS_CAP,
  searchReadinessState, hostingSurface, type Period,
} from '../analytics/compose.ts';
import { aggregateVisits, type VisitRow } from '../lib/visits.ts';
import { searchInsights, searchNotice, searchHealth, searchMilestones, searchDetailInsights, agencySearchState, type GscMetrics } from '../analytics/search_perf.ts';
import { summarizePipeline } from '../lib/sales_lifecycle.ts';
import {
  parseDashPeriod, dashRange, priorMonthIso, weeklyBuckets, weeklyVisitors, sourceShares,
  invoiceBuckets, recentWins, oldestAgeDays, DASH_WEEKS,
} from '../lib/analytics_dashboard.ts';

/** AN-3.1: top queries + pages for a period (from presence_search_terms).
 *  Exported so the client portal's website card (client_delivery.ts) reads the
 *  SAME terms the studio dashboard shows — the numbers must always agree. */
export async function readSearchTerms(clientId: string, period: string): Promise<{ queries: any[]; pages: any[] }> {
  if (!clientId || !period) return { queries: [], pages: [] };
  const r = await svc(`presence_search_terms?client_id=eq.${encodeURIComponent(clientId)}&period=eq.${encodeURIComponent(period)}&select=dimension,key,clicks,impressions,position&order=clicks.desc&limit=20`);
  const rows = Array.isArray((r as any).json) ? (r as any).json : [];
  return { queries: rows.filter((x: any) => x.dimension === 'query').slice(0, 5), pages: rows.filter((x: any) => x.dimension === 'page').slice(0, 5) };
}
import type { SiteRow } from '../lib/site.ts';

/** Read the Google Search Console metrics that already live in the shared `signals`
 *  table (source='gsc', keyed by client_id). No new store, no ingestion — reuse.
 *  Returns hasData:false honestly when there's none (the state everywhere today).
 *  `ok:false` marks a FAILED read (transient signals-table trouble) — distinct
 *  from "genuinely no data", so consumers never show a connect-CTA to a
 *  connected user just because one read hiccuped. */
export type GscRead = GscMetrics & { ok: boolean };
export async function readGsc(clientId: string | null | undefined): Promise<GscRead> {
  const empty: GscRead = { impressions: 0, clicks: 0, priorImpressions: null, priorClicks: null, ctr: null, position: null, period: '', hasData: false, totalImpressions: 0, totalClicks: 0, firstImpressionAt: null, firstSearchClickAt: null, ok: true };
  if (!clientId) return empty;
  const r = await svc(`signals?client_id=eq.${encodeURIComponent(clientId)}&source=eq.gsc&select=metric,value,period&order=period.desc&limit=48`);
  if (!(r as any).ok) return { ...empty, ok: false };
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
    ok: true,
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
  // Whose website is this? A monitor-edition workspace watches a site the client
  // already had — no beacon of ours is on it, so the visitor empty state must say
  // that rather than promise numbers "once your site is published".
  const homeHosted = site.edition !== 'monitor';
  const homeExternalDomain = homeHosted ? null
    : (arr(await svc(`presence_monitor_connections?site_id=eq.${site.id}&select=domain&limit=1`).catch(() => ({})))[0]?.domain || null);
  const trafficCards = trafficInsights(traffic, period, { hosted: homeHosted, domain: homeExternalDomain });
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
    // Named plainly so the page never has to guess whose website this is.
    hosting: hostingSurface({ hosted: homeHosted, externalDomain: homeExternalDomain }),
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
  // SS7 fix (review-confirmed): gather() is deliberately UNFILTERED (archived
  // links included, for /agency/portfolio?archived=true) — but THIS band must
  // count the SAME clients as client_count (agencySiteIds, active-only) and the
  // /agency/portfolio rollup (archived excluded by default). filterPortfolio's
  // default drops archived, so "Sites live" can never exceed "Clients" and an
  // archived client's waiting leads never raise "Needs attention" here.
  const portfolio = filterPortfolio(buildPortfolio(input), {});
  // AN-2.4: per-client visitor counts (this week) — one bounded query, aggregated
  // in code; reuses the same visits store (no duplicate aggregation).
  // Cap honesty (AN-4, like loadVisits above): the read is ORDERED ts.desc —
  // past PostgREST's cap an UNORDERED read returns an ARBITRARY subset (lib/
  // db.ts: the correctness cliff), so at worst this is the deterministic
  // "most recent 20k". Even so, a truncated read undercounts unpredictably per
  // site — foldPortfolioVisitors raises `truncated` and the payload carries it
  // (visitors_truncated below) so the page stops presenting the column as exact.
  const sinceIso = new Date(nowMs - 7 * 86_400_000).toISOString();
  const vr = await svc(`presence_visits?site_id=in.(${siteIds.join(',')})&kind=eq.pageview&ts=gte.${sinceIso}&select=site_id,visitor_hash&order=ts.desc&limit=${PORTFOLIO_VISITS_CAP}`);
  const { visitorsBySite: perSiteVisitors, truncated: visitorsTruncated } = foldPortfolioVisitors(arr(vr));
  const { headline, insights } = portfolioInsights(
    // truncated ⇒ per-site attribution is unknown — visitor-derived insight
    // cards ("Getting visitors" / "Traffic, no inquiries") are SUPPRESSED via
    // visitors:0 (their >0 gates) rather than composed from subset counts, so
    // the cards can never contradict the page's — column (say less, never wrong).
    (portfolio || []).map((c: any) => ({ name: c.name, leads_waiting: c.leads_waiting, unpublished_changes: c.unpublished_changes, last_published_at: c.last_published_at, attention: c.attention, visitors: visitorsTruncated ? 0 : (perSiteVisitors[String(c.site_id)] || 0) })),
    nowMs,
  );

  // AN-3 (§Agency): per-client search state from the shared `signals` table — who's
  // growing/falling on Google, and who hasn't connected Search Console. Reuses the
  // portfolio; one site→client map + one signals query (no duplicate dashboard).
  const sites = arr(await svc(`presence_sites?id=in.(${siteIds.join(',')})&select=id,client_id,last_published_at,edition`));
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
  // ── The order of operations, told honestly (AN-3.1 follow-up) ───────────────
  // The old band inferred exactly two states from the presence/absence of
  // `signals` rows: "connected" or "connect Search Console". Both of the states
  // in between were being nagged with the wrong step.
  //
  //   NO_DOMAIN — we DON'T host this client's website (monitor edition) and no
  //               address has been recorded. This band used to read the absent
  //               last_published_at as "still a draft" and tell Eric to publish
  //               — but an established site at the client's own domain has
  //               nothing to publish, and Search Console reports on a verified
  //               DOMAIN property regardless of who hosts it. The only real
  //               blocker is that we don't know the domain yet.
  //   DRAFT     — a site WE host that has never been published. Search Console
  //               cannot report on a page Google has never been able to crawl,
  //               and lib/gsc.ts queries the PREVIOUS FULL CALENDAR MONTH, so
  //               connecting a draft today fetches a month in which nothing was
  //               live. Publishing comes first — for the sites we publish.
  //   WAITING   — genuinely connected (presence_connections says so — the old
  //               code never read that table at all), but no month has landed
  //               yet. A real connection was being nagged to "connect Search
  //               Console" for weeks.
  //   NOT_CONN. — ready to connect (published-and-hosted, or external with a
  //               known domain), and nothing is connected. The ask is right.
  const gscConnected = new Set(
    arr(await svc(`presence_connections?site_id=in.(${siteIds.join(',')})&provider_key=eq.google_search_console&select=site_id,status`))
      .filter((c: any) => ['connected', 'verified', 'active'].includes(String(c.status)))
      .map((c: any) => String(c.site_id)),
  );
  // The external addresses, in one batched read — a monitor-edition site's real
  // website lives here, not in custom_domain/netlify_site_id.
  const externalDomains = new Map<string, string>(
    arr(await svc(`presence_monitor_connections?site_id=in.(${siteIds.join(',')})&select=site_id,domain`))
      .filter((c: any) => c && c.domain)
      .map((c: any) => [String(c.site_id), String(c.domain)] as [string, string]),
  );
  const nameOf = (siteId: string) => String((portfolio || []).find((c: any) => String(c.site_id) === String(siteId))?.name || 'this client');
  const counts = { no_domain: 0, draft: 0, waiting: 0, not_connected: 0, growing: 0, falling: 0, steady: 0 } as Record<string, number>;
  const noDomainSites: any[] = [], draftSites: any[] = [], waitingSites: any[] = [], notConnectedSites: any[] = [];
  for (const s of sites) {
    const st = stateFor(s.client_id);
    if (st === 'not_connected') {
      // no numbers yet — but WHY there are none is four different situations
      const readiness = searchReadinessState({
        hosted: s.edition !== 'monitor',
        lastPublishedAt: s.last_published_at || null,
        externalDomain: externalDomains.get(String(s.id)) || null,
        gscConnected: gscConnected.has(String(s.id)),
        hasData: false,
      });
      if (readiness === 'no_domain') { counts.no_domain++; noDomainSites.push(s); continue; }
      if (readiness === 'draft') { counts.draft++; draftSites.push(s); continue; }
      if (readiness === 'waiting') { counts.waiting++; waitingSites.push(s); continue; }
      counts.not_connected++; notConnectedSites.push(s); continue;
    }
    counts[st]++;
  }
  // One link per client — never a CTA that points nowhere. `href`/`cta` stay set
  // to the FIRST client so an older page (which knows nothing of `sites`) still
  // lands somewhere that can act; the shipped '/agency.html' fallback could not,
  // since Studio has no Search Console affordance at all.
  const linksFor = (rows: any[], path: (id: string) => string, verb: string) => rows.slice(0, 8).map((s: any) => ({
    id: String(s.id), name: nameOf(s.id), href: path(String(s.id)), cta: `${verb} ${nameOf(s.id)}`,
  }));
  const searchInsightsAgency: any[] = [];
  if (counts.growing) searchInsightsAgency.push({ key: 'search_growing', title: 'Rising on Google', sentence: `${counts.growing} ${counts.growing === 1 ? 'client is' : 'clients are'} getting seen more on Google lately.`, number: counts.growing, tone: 'good' });
  if (counts.falling) searchInsightsAgency.push({ key: 'search_falling', title: 'Losing visibility', sentence: `${counts.falling} ${counts.falling === 1 ? 'client is' : 'clients are'} being seen less on Google — worth a fresh update.`, number: counts.falling, tone: 'attention' });
  if (counts.no_domain) {
    const links = linksFor(noDomainSites, (id) => `/presence.html?client=${encodeURIComponent(id)}#monitor`, 'Add the website for');
    searchInsightsAgency.push({
      key: 'search_no_domain', title: 'Tell us where their website is',
      sentence: `${counts.no_domain} of ${siteIds.length} ${counts.no_domain === 1 ? 'client has a website you don’t host' : 'clients have websites you don’t host'}, and no address on file. Google reports on a domain whoever hosts it — record the address and their search numbers start arriving. Nothing needs publishing.`,
      number: counts.no_domain, tone: 'neutral',
      sites: links, href: links[0]?.href, cta: links.length === 1 ? links[0].cta : 'Add the first address',
    });
  }
  if (counts.draft) {
    const links = linksFor(draftSites, (id) => `/presence.html?client=${encodeURIComponent(id)}#publish`, 'Publish');
    searchInsightsAgency.push({
      key: 'search_draft', title: 'Publish the site first',
      sentence: `${counts.draft} of ${siteIds.length} ${counts.draft === 1 ? 'site is' : 'sites are'} still a draft. Google can’t measure a site it has never been able to visit — publishing comes before Search Console, not after.`,
      number: counts.draft, tone: 'neutral',
      sites: links, href: links[0]?.href, cta: links.length === 1 ? links[0].cta : 'Publish the first one',
    });
  }
  if (counts.waiting) {
    const links = linksFor(waitingSites, (id) => `/connections.html?client=${encodeURIComponent(id)}`, 'Check');
    searchInsightsAgency.push({
      key: 'search_waiting', title: 'Connected — waiting on Google',
      sentence: `${counts.waiting} ${counts.waiting === 1 ? 'client is' : 'clients are'} connected to Search Console with no numbers yet. That’s normal: Google reports on whole past months, so the first figures land after the site has been live through one — expect a few weeks, not days. Nothing to do.`,
      number: counts.waiting, tone: 'neutral',
      sites: links, href: links[0]?.href, cta: links.length === 1 ? links[0].cta : 'Check the connections',
    });
  }
  if (counts.not_connected) {
    // Connecting Search Console is the STUDIO's setup job — a client never touches
    // it. Frame it as the operator's action and link straight to each client's
    // connections page, scoped. Never '/agency.html': `grep -c connections
    // agency.html` is 0, so that CTA landed somewhere that could not act.
    const links = linksFor(notConnectedSites, (id) => `/connections.html?client=${encodeURIComponent(id)}`, 'Connect');
    searchInsightsAgency.push({
      key: 'search_not_connected', title: 'Connect Search Console',
      sentence: `${counts.not_connected} of ${siteIds.length} ${counts.not_connected === 1 ? 'published client needs' : 'published clients need'} Google Search Console connected — connect it for them (it’s your setup, not theirs) to unlock their search numbers.`,
      number: counts.not_connected, tone: 'neutral',
      sites: links, href: links[0]?.href, cta: links.length === 1 ? links[0].cta : 'Connect the first one',
    });
  }

  // P2-F G4 — Studio WEBSITE OVERSIGHT (§2). Coarse per-client website health for
  // the agency, at the already-authorized site scope. Two bounded queries; reads
  // live (no customer data duplicated into the agency workspace); billing shown
  // only at the coarse plan-status level (never payment details).
  const failed7 = new Set(arr(await svc(`presence_publishes?site_id=in.(${siteIds.join(',')})&status=eq.failed&completed_at=gte.${sinceIso}&select=site_id&limit=2000`)).map((r: any) => String(r.site_id)));
  const entRows = clientIds.length ? arr(await svc(`presence_entitlements?client_id=in.(${clientIds.join(',')})&product=eq.presence&select=client_id,status`)) : [];
  const planStatus = new Map(entRows.map((e: any) => [String(e.client_id), String(e.status)]));
  // SS7 seams: rows built by the PURE websiteRows (analytics/compose.ts) so the
  // active-only parity + additive site_id/visitors shape are fixture-pinned.
  // visitors reuses the perSite aggregation above; a FAILED visits read is
  // null per row (AN-4: never a fabricated 0).
  const websites = websiteRows(portfolio, {
    planBySite: Object.fromEntries(sites.map((s: any) => [String(s.id), planStatus.get(String(s.client_id)) || 'unknown'])),
    failedSites: [...failed7] as string[],
    visitorsBySite: (vr as any).ok ? perSiteVisitors : null,
  });
  const websiteInsights: any[] = [];
  const failedCount = websites.filter((w: any) => w.publish_failed).length;
  const blockedCount = websites.filter((w: any) => w.plan_status === 'paused' || w.plan_status === 'lapsed').length;
  if (failedCount) websiteInsights.push({ key: 'publish_failed', title: 'A publish needs attention', sentence: `${failedCount} ${failedCount === 1 ? 'client site' : 'client sites'} had a publish fail recently — worth a look.`, number: failedCount, tone: 'attention' });
  if (blockedCount) websiteInsights.push({ key: 'plan_blocked', title: 'A subscription needs attention', sentence: `${blockedCount} ${blockedCount === 1 ? 'client’s software subscription is' : 'clients’ software subscriptions are'} paused or ended — editing/publishing is limited until it’s resolved.`, number: blockedCount, tone: 'attention' });

  // visitors_truncated: ONE top-level marker for the whole bulk read (dropped
  // by JSON.stringify when false/undefined). Additive both ways: an old page
  // ignores it (numbers render as before — no worse than today); an old
  // function never sends it, so the new page renders numbers as exact.
  return json({ data: { headline, insights: [...insights, ...searchInsightsAgency, ...websiteInsights], websites, client_count: siteIds.length, visitors_truncated: visitorsTruncated || undefined } }, 200, cors);
}

// ── Slice 8: GET /analytics/dashboard — the Business dashboard summary ────────
// ONE read-only aggregate feeding analytics.html's two bands (Sales · Your
// website). Zero schema change: it reads presence_deals / form_submissions /
// support_requests / invoices / visits / gsc signals the platform already
// stores. A dashboard must render PARTIAL data — every aggregate is tolerant:
// a failed read yields `null` for that widget (the page shows its empty state),
// never a 500 for the whole board. Pure math lives in lib/analytics_dashboard.ts
// (+ summarizePipeline in lib/sales_lifecycle.ts) so tests can pin it.
export async function handleAnalyticsDashboard(req: Request, site: SiteRow, cors: Record<string, string>) {
  const period = parseDashPeriod(new URL(req.url).searchParams.get('period'));
  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const { startMs, days } = dashRange(period, nowMs);
  // one visits fetch serves the KPIs (period window) AND the 12-week line
  const visitStartIso = new Date(Math.min(startMs, nowMs - DASH_WEEKS * 7 * 86_400_000)).toISOString();

  const safe = async <T>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };

  // ── Whose sales are these? ───────────────────────────────────────────────────
  // Deals and invoices only ever live on the OPERATOR's agency site — sales.ts
  // says so in a comment ("Deals only ever live on agency sites"), the inserts
  // put them there, and 0086 calls site_id "the agency site that issued it". So
  // reading them as site_id = <the drilled client's site> can only ever return
  // nothing: every client drill-in showed "Open pipeline $0 · 0 open deals · No
  // invoices yet · No wins yet", forever, for structural reasons. A guaranteed
  // $0 is not an empty state, it is a false statement — Eric's Bacchus deal is
  // won AND converted, and the board said he had none.
  //
  // The join key already exists and is indexed: presence_deals.converted_client_id
  // (0074, UNIQUE) and presence_invoices.customer_client_id (0086:37) both point
  // at the CLIENT. So when scoped we read by client instead of by site, and the
  // band becomes what Eric expected it to be — the business dashboard FOR
  // Bacchus, showing the studio's actual sales relationship with Bacchus.
  //
  // Only when SCOPED. `x-dds-scope-site` reaching this handler means index.ts
  // already ran resolveScopedSite and it passed (agency membership + role +
  // authorized-client, fail-closed), so the caller is an authorized operator.
  // Unscoped, the site_id read stands: a client owner must never be handed the
  // studio's deal record about them, and an operator on their own site gets
  // their whole pipeline exactly as before.
  const scopedTo = String(req.headers.get('x-dds-scope-site') || '');
  const isScoped = !!scopedTo && scopedTo === String(site.id);
  const clientId = String(site.client_id || '');
  // converted_*_id is the conversion link; customer_*_id is the billing link.
  // Both site variants are included because an upsell invoice may be addressed
  // to the workspace rather than the client record — a superset of the truth,
  // never a guess.
  const dealsQuery = isScoped && clientId
    ? `presence_deals?or=(converted_client_id.eq.${clientId},converted_site_id.eq.${site.id})&deleted_at=is.null&select=title,stage,expected_value_cents,converted_client_id,converted_at,updated_at&order=updated_at.desc&limit=2000`
    : `presence_deals?site_id=eq.${site.id}&deleted_at=is.null&select=title,stage,expected_value_cents,converted_client_id,converted_at,updated_at&order=updated_at.desc&limit=2000`;
  const invoicesQuery = isScoped && clientId
    ? `presence_invoices?or=(customer_client_id.eq.${clientId},customer_site_id.eq.${site.id})&deleted_at=is.null&select=status,amount_cents,due_date,paid_at&order=created_at.desc&limit=1000`
    : `presence_invoices?site_id=eq.${site.id}&deleted_at=is.null&select=status,amount_cents,due_date,paid_at&order=created_at.desc&limit=1000`;

  // TRUTHFULNESS (AN-4, like loadVisits above): every capped read is ORDERED
  // newest-first, so hitting a cap means "the most recent N" — a deterministic,
  // honest subset — and the per-section truncated_* flags below let the page
  // say so instead of presenting a silent undercount as the whole story.
  const [dealsR, subsR, supR, invR, visitsR, gsc] = await Promise.all([
    safe(svc(dealsQuery)),
    safe(svc(`presence_form_submissions?site_id=eq.${site.id}&spam=is.false&select=created_at,status&order=created_at.desc&limit=1000`)),
    safe(svc(`presence_support_requests?site_id=eq.${site.id}&deleted_at=is.null&status=in.(open,in_progress)&select=created_at&order=created_at.asc&limit=500`)),
    safe(svc(invoicesQuery)),
    safe(svc(`presence_visits?site_id=eq.${site.id}&ts=gte.${visitStartIso}&select=ts,kind,path,ref_host,utm_source,device,country,visitor_hash&order=ts.desc&limit=5000`)),
    safe(readGsc(site.client_id)),
  ]);
  // Do WE serve this website? A monitor-edition workspace watches a website the
  // client already had (0031); everything about what we can measure follows from
  // this one fact, so it is read, never assumed.
  const hosted = site.edition !== 'monitor';
  const extConn = hosted ? null : arr(await safe(svc(`presence_monitor_connections?site_id=eq.${site.id}&select=domain,status&limit=1`)) || {})[0] || null;
  const externalDomain = extConn?.domain ? String(extConn.domain) : null;
  const okRows = (r: unknown): any[] | null => (r && (r as { ok?: boolean }).ok ? arr(r as { json?: unknown }) : null);

  // ── Sales band ──
  const deals = okRows(dealsR);
  let pipeline: unknown = null, won: unknown = null, recent_wins: unknown[] = [];
  if (deals) {
    const sum = summarizePipeline(deals, nowIso);
    pipeline = { open: sum.open, stages: sum.by_stage };
    won = { this_month: sum.won_month, last_month: summarizePipeline(deals, priorMonthIso(nowMs)).won_month };
    recent_wins = recentWins(deals, nowMs);
  }
  const subs = okRows(subsR);
  const enquiries = subs ? {
    count: subs.filter((s) => Date.parse(s.created_at) >= startMs).length,
    unanswered: subs.filter((s) => s.status === 'new').length,
    weekly: weeklyBuckets(subs.map((s) => s.created_at), nowMs),
  } : null;
  const sup = okRows(supR);
  const support = sup ? { open: sup.length, oldest_age_days: oldestAgeDays(sup.map((s) => s.created_at), nowMs) } : null;
  const invs = okRows(invR);
  const invoices = invs ? invoiceBuckets(invs, nowIso.slice(0, 10), startMs) : null;

  // ── Website band ──
  const visits = okRows(visitsR) as VisitRow[] | null;
  let traffic: unknown = null;
  if (visits) {
    // EXACT calendar boundary: aggregateVisits rebuilds its window as
    // nowMs − days·DAY, which (days being a ceil) can bleed up to ~24h of the
    // prior period into "This month" — worst on the 1st. Intersect with the
    // true period start first; the days arg then only bounds, never widens.
    const periodRows = visits.filter((v) => { const ms = Date.parse(String(v.ts || '')); return Number.isFinite(ms) && ms >= startMs; });
    const agg = aggregateVisits(periodRows, nowMs, days);
    traffic = {
      visitors: agg.visitors, pageviews: agg.pageviews,
      actions: agg.events.phone + agg.events.email + agg.events.cta,
      top_pages: agg.topPages,
      top_sources: sourceShares(agg.topSources, agg.visitors),
      weekly: weeklyVisitors(visits, nowMs),
      has_data: agg.hasData,
      truncated: visits.length >= 5000,
    };
  }
  // search states, in the order they actually happen:
  //   { unavailable }  — the signals read failed. NOT a connect prompt (AN-4).
  //   { no_domain }    — we DON'T host this website and nobody has told us where
  //                      it is. The previous gate read the absent
  //                      last_published_at as "still a draft" and told Eric to
  //                      publish — for a client with an established site at
  //                      their own domain there is nothing to publish, and
  //                      Search Console never cared who hosts it. The one real
  //                      blocker is that we don't know the domain.
  //   { draft }        — a site WE host that has never been published. Search
  //                      Console cannot report on a page Google has never
  //                      crawled, and lib/gsc.ts asks for the PREVIOUS FULL
  //                      CALENDAR MONTH, so connecting a draft today fetches a
  //                      month in which nothing was live. Still the right ask —
  //                      but only for a site we actually publish.
  //   { waiting }      — connected (presence_connections, which this handler
  //                      never read), no month landed yet. Honest lag, not a
  //                      missing connection.
  //   null             — ready to connect: either published-and-hosted, or an
  //                      external site whose domain we know.
  //   { clicks, … }    — real numbers.
  const gscConnected = !!(await safe(connectionState(site.id)))?.gsc;
  const readiness = searchReadinessState({
    hosted, lastPublishedAt: site.last_published_at || null, externalDomain,
    gscConnected, hasData: !!gsc?.hasData,
  });
  let search: unknown = null;
  if (!gsc || !gsc.ok) search = { unavailable: true };
  else if (readiness === 'no_domain') {
    search = { no_domain: true, external: true, record_href: '/presence.html#monitor' };
  } else if (readiness === 'draft') {
    search = { draft: true, publish_href: '/presence.html#publish' };
  } else if (readiness === 'waiting') {
    search = { waiting: true, external: !hosted, domain: externalDomain };
  } else if (gsc.hasData) {
    const terms = await safe(readSearchTerms(site.client_id || '', gsc.period));
    search = {
      clicks: gsc.clicks, impressions: gsc.impressions, period: gsc.period,
      top_terms: (terms?.queries || []).map((q: any) => ({ term: String(q.key || ''), clicks: Number(q.clicks) || 0, impressions: Number(q.impressions) || 0 })),
    };
  }

  return json({ data: {
    period,
    generated_at: nowIso,
    sales: {
      // `scope`: 'client' means the deals/invoices above are the ones ATTACHED to
      // this client (converted / billed), not the studio's whole pipeline. The
      // page says so, because "Open pipeline" means a different thing here and a
      // number whose meaning is ambiguous is barely better than a wrong one.
      // Enquiries and support stay site-scoped either way — those genuinely are
      // the client's own.
      scope: isScoped && clientId ? 'client' : 'studio',
      pipeline, won, enquiries, support, invoices, recent_wins,
      truncated_deals: !!deals && deals.length >= 2000,
      truncated_invoices: !!invs && invs.length >= 1000,
      truncated_enquiries: !!subs && subs.length >= 1000,
    },
    // `hosting` says plainly which of these numbers can exist at all, and why.
    // For a client whose website we don't serve, first-party visitor counts are
    // not "not measured yet" — they are structurally unavailable (our beacon is
    // only on pages we render), while search works perfectly. The page prints
    // the reason instead of a silent zero.
    website: { traffic, search, hosting: hostingSurface({ hosted, externalDomain, domainVerified: extConn?.status === 'verified' }) },
  } }, 200, cors);
}
