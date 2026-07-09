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
import type { SiteRow } from '../lib/site.ts';

const periodDays = (p: Period) => (p === 'week' ? 7 : 30);
/** Load recent visit rows for a site over the current + prior window (for trend). */
async function loadVisits(siteId: string, period: Period, nowMs: number): Promise<VisitRow[]> {
  const startIso = new Date(nowMs - 2 * periodDays(period) * 86_400_000).toISOString();
  const r = await svc(`presence_visits?site_id=eq.${siteId}&ts=gte.${startIso}&select=ts,kind,path,ref_host,utm_source,device,country,visitor_hash&order=ts.desc&limit=5000`);
  return (Array.isArray((r as any).json) ? (r as any).json : []) as VisitRow[];
}

const arr = (r: { json?: unknown }): any[] => (Array.isArray((r as { json?: unknown[] }).json) ? (r as { json: any[] }).json : []);
const periodOf = (req: Request): Period => (new URL(req.url).searchParams.get('period') === 'month' ? 'month' : 'week');

/** Are the traffic/search providers actually connected? (They are 'planned' today,
 *  so this is honestly false — Analytics then says so rather than faking a number.) */
async function connectionState(siteId: string): Promise<{ ga: boolean; gsc: boolean }> {
  const r = await svc(`presence_connections?site_id=eq.${siteId}&select=provider,status`);
  const live = new Set(arr(r).filter((c) => ['connected', 'verified', 'active'].includes(String(c.status))).map((c) => c.provider));
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
  const lastChangeAt = arr(lastChangeR)[0]?.created_at || null;
  const health = coachRead({
    live: site.status === 'live',
    lastPublishedAt: site.last_published_at || null,
    pendingApprovals: 0,
    connectedNeedingAttention: 0,
    searchIssues: 0,
    leadsWaiting: unread,
    unpublishedChanges: !!lastChangeAt && (!site.last_published_at || lastChangeAt > site.last_published_at),
    domainExpiringDays: null,
  }, nowIso);

  // AN-2: real first-party traffic now leads the story; the traffic "not measured"
  // card is gone (we measure it ourselves) — only Search (GSC) may remain honest.
  const trafficCards = trafficInsights(traffic, period);
  const notice = trafficNotice(traffic);
  const watching = arr(momentsR).map((m) => ({ headline: m.headline, summary: m.summary, moment_type: m.moment_type }));
  if (notice) watching.unshift({ ...notice, moment_type: 'celebration' });

  return json({ data: {
    period,
    headline: `Here’s how your business is doing this ${periodWord(period)}.`,
    insights: [...trafficCards, inquiries, publishing, ...(milestone ? [milestone] : [])],
    health: { sentence: health.headline, status: health.status, suggestions: (health.suggestions || []).slice(0, 3) },
    watching,
    not_measured: conn.gsc ? [] : notMeasured(true, false),   // traffic is first-party now; only Search may need connecting
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
  return json({ data: {
    readiness,
    // AN-4: honest about what needs a connection; never a fabricated impression/click.
    not_measured: conn.gsc ? [] : notMeasured(true, false),
    connected: { search_console: conn.gsc },
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
  return json({ data: { headline, insights, client_count: siteIds.length } }, 200, cors);
}
