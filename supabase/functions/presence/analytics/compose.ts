// ── Phase AN-1: Analytics — plain-English composition (PURE, no AI, no new store) ──
// Analytics is NOT a dashboard and NOT a new engine. It composes signals the
// platform ALREADY stores (inquiries, publishing, journey, health, moments) into
// calm sentences — number in service of the sentence. Everything here is a pure
// function over already-loaded rows, so reading it costs ZERO AI tokens (AN-9).
// What the platform cannot yet measure (website visitors, search performance) is
// stated honestly and never fabricated (AN-4 rule: never fake data).

export type Period = 'week' | 'month';
export const periodWord = (p: Period) => (p === 'week' ? 'week' : 'month');
export const periodDays = (p: Period) => (p === 'week' ? 7 : 30);

/** Count timestamps in the current window vs the immediately prior window. Pure. */
export function windowCounts(isoTimes: Array<string | null | undefined>, nowMs: number, windowDays: number): { current: number; prior: number } {
  const w = windowDays * 86_400_000;
  const curStart = nowMs - w, priorStart = nowMs - 2 * w;
  let current = 0, prior = 0;
  for (const t of isoTimes) {
    if (!t) continue;
    const ms = Date.parse(t);
    if (Number.isNaN(ms)) continue;
    // no upper bound on "current": clock skew must not drop a just-created row
    if (ms > curStart) current++;
    else if (ms > priorStart) prior++;
  }
  return { current, prior };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A calm trend clause comparing this period to the prior one. Never invents. */
export function trendPhrase(current: number, prior: number, word: string): string {
  if (prior === 0) return current > 0 ? '' : '';
  if (current > prior) return ` — up from ${prior} the ${word} before`;
  if (current < prior) return ` — down from ${prior} the ${word} before`;
  return ` — steady with the ${word} before`;
}

export interface Insight {
  key: string;
  title: string;
  sentence: string;           // the plain-English lead (always present)
  number?: number | null;     // a single supporting figure, or null
  detail?: string;            // one short supporting clause
  href?: string;              // where to act on it
  tone?: 'good' | 'neutral' | 'attention';
}

/** Inquiries — the realest customer metric (presence_form_submissions). AN-1/AN-3. */
export function inquiriesInsight(createdAts: string[], byKind: { contact: number; quote: number; booking: number }, unread: number, nowMs: number, period: Period): Insight {
  const w = periodWord(period);
  const { current, prior } = windowCounts(createdAts, nowMs, periodDays(period));
  let sentence: string, tone: Insight['tone'] = 'neutral';
  if (current === 0 && prior === 0) {
    sentence = `No inquiries yet this ${w} — when someone reaches out through your website, it lands here first.`;
  } else {
    sentence = `You received ${plural(current, 'inquiry', 'inquiries')} this ${w}${trendPhrase(current, prior, w)}.`;
    tone = current > 0 ? 'good' : 'neutral';
  }
  const parts: string[] = [];
  if (byKind.quote) parts.push(plural(byKind.quote, 'quote request', 'quote requests'));
  if (byKind.booking) parts.push(plural(byKind.booking, 'booking', 'bookings'));
  if (byKind.contact) parts.push(plural(byKind.contact, 'message', 'messages'));
  const detail = unread > 0
    ? `${plural(unread, 'inquiry is', 'inquiries are')} still waiting for a reply.`
    : (parts.length ? `This ${w}: ${parts.join(', ')}.` : '');
  return { key: 'inquiries', title: 'Inquiries', sentence, number: current, detail, href: '/leads.html', tone };
}

/** Publishing activity — from presence_publishes. AN-1/AN-2 (the real "website" signal). */
export function publishingInsight(livePublishIsoTimes: string[], lastPublishedAt: string | null, nowMs: number, period: Period): Insight {
  const w = periodWord(period);
  if (!lastPublishedAt) {
    return { key: 'publishing', title: 'Your website', sentence: 'Your website hasn’t been published yet — publishing puts it in front of customers.', number: 0, href: '/presence.html#publish', tone: 'attention' };
  }
  const days = Math.floor((nowMs - Date.parse(lastPublishedAt)) / 86_400_000);
  const { current } = windowCounts(livePublishIsoTimes, nowMs, periodDays(period));
  const when = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  const updates = current > 0 ? ` You published ${plural(current, 'update', 'updates')} this ${w}.` : '';
  const tone: Insight['tone'] = days > 60 ? 'attention' : 'neutral';
  return { key: 'publishing', title: 'Your website', sentence: `Your website was last updated ${when}.${updates}`, number: current, detail: days > 60 ? 'A fresh update keeps customers (and search engines) confident you’re active.' : '', href: '/presence.html', tone };
}

/** Honest "not measured yet" cards — never a fabricated number. AN-2/AN-4. */
export function notMeasured(gaConnected: boolean, gscConnected: boolean): Insight[] {
  const out: Insight[] = [];
  if (!gaConnected) out.push({ key: 'traffic', title: 'Website visitors', sentence: 'Visitor numbers aren’t turned on yet — connect Google Analytics and Studio OS will tell you how many people visit and where they come from.', number: null, href: '/connections.html', tone: 'neutral' });
  if (!gscConnected) out.push({ key: 'search', title: 'Search performance', sentence: 'Search clicks and impressions aren’t connected yet — connect Google Search Console to see how you show up when people search.', number: null, href: '/connections.html', tone: 'neutral' });
  return out;
}

// ── Whose website is this, and what can we honestly measure about it? ────────
// Not every client is a greenfield build. A large part of the book already has a
// website at their own domain and an established search presence; Studio OS is
// the workspace ABOUT that site, not its host (presence_sites.edition='monitor',
// migration 0031: "observing the customer's EXISTING external website (no
// hosting, no publishing)").
//
// That distinction decides two different things, and conflating them is what
// produced the wrong advice:
//
//   SEARCH is hosting-agnostic. Search Console reports on a verified DOMAIN
//   property; it does not care who serves the bytes. An external client has
//   nothing to publish, so "publish the site first" is both useless and untrue
//   for them — what they need is for us to know their domain.
//
//   FIRST-PARTY VISITORS are not. presence_visits is fed by one beacon that
//   lib/render.ts injects into pages WE render and deploy. On a site we don't
//   host that beacon is not on any page, so the count is not "0 visitors" and
//   not "not measured yet" — it is structurally unavailable, forever, until
//   either the site moves here or a visitor-analytics provider is connected.
//   Showing a silent zero there is a lie; so is a "connect it" nudge that
//   points at a thing which would not help.

/** The search state, in the order things actually happen. `hosted` is the one
 *  input that used to be assumed: it is FALSE for a client whose website we do
 *  not serve, and it is what stops an external client being told to publish.
 *  Pure. */
export type SearchReadiness = 'measuring' | 'no_domain' | 'draft' | 'waiting' | 'connect';
export function searchReadinessState(x: {
  hosted: boolean;                     // do WE serve this website? (edition !== 'monitor')
  lastPublishedAt?: string | null;     // only meaningful when hosted
  externalDomain?: string | null;      // the client's own address, when we don't host
  gscConnected: boolean;
  hasData: boolean;
}): SearchReadiness {
  if (x.hasData) return 'measuring';
  // We don't host it and nobody has told us where it lives — nothing downstream
  // (connect, sync, verify) can even be attempted. Checked BEFORE the draft rule:
  // an external site has no last_published_at either, and reading that absence as
  // "still a draft" is exactly the bug this replaces.
  if (!x.hosted && !x.externalDomain) return 'no_domain';
  // A site WE host that has never gone live: Google has never been able to visit
  // it, and the sync asks for the previous full calendar month, so connecting
  // today fetches a month in which nothing existed. Publishing genuinely is first
  // — UNLESS Eric has recorded that the client is ALREADY LIVE at their own
  // domain elsewhere (a rebuild-in-progress: presence_monitor_connections holds
  // the address, and lib/gsc.ts gscDomainFor already prefers a recorded external
  // domain over the unpublished netlify subdomain for exactly this row). Their
  // established search numbers exist NOW, at that domain, whoever hosts it;
  // holding them hostage to our publish date was the same lie as the external
  // "publish first" bug, one edition over.
  if (x.hosted && !x.lastPublishedAt && !x.externalDomain) return 'draft';
  if (x.gscConnected) return 'waiting';
  return 'connect';
}

/** What this website's numbers can and cannot say, and WHY — the honest header
 *  for a client whose site we don't host. Pure. */
export function hostingSurface(x: { hosted: boolean; externalDomain?: string | null; domainVerified?: boolean }): {
  hosted: boolean; external: boolean; domain: string | null; domain_verified: boolean;
  visitors_measurable: boolean; visitors_reason: string;
  search_measurable: boolean; search_reason: string;
} {
  const domain = x.externalDomain ? String(x.externalDomain) : null;
  if (x.hosted) {
    return {
      hosted: true, external: false, domain, domain_verified: !!x.domainVerified,
      visitors_measurable: true, visitors_reason: 'Visitor numbers come from this website itself — every page we publish carries the counter.',
      search_measurable: true, search_reason: 'Search numbers come from Google Search Console once this website is live and connected.',
    };
  }
  return {
    hosted: false, external: true, domain, domain_verified: !!x.domainVerified,
    visitors_measurable: false,
    visitors_reason: domain
      ? `Visitor counts can’t come from here — ${domain} isn’t hosted by the studio, so there’s no counter on its pages. Their own analytics (or a connected Google Analytics) is where those numbers live.`
      : 'Visitor counts can’t come from here — this website isn’t hosted by the studio, so there’s no counter on its pages.',
    search_measurable: true,
    search_reason: domain
      ? `Search numbers work fine: Google reports on the domain ${domain}, whoever hosts it.`
      : 'Search numbers will work as soon as we know their website address — Google reports on a domain, whoever hosts it.',
  };
}

/** SEO readiness — REAL booleans from search-health (no fake impressions). AN-4. */
export function searchReadinessInsight(x: { verified: boolean; titleSet: boolean; descriptionSet: boolean; sitemap: boolean; brokenLinks: number }): Insight {
  const gaps: string[] = [];
  if (!x.titleSet) gaps.push('a search title');
  if (!x.descriptionSet) gaps.push('a search description');
  if (!x.verified) gaps.push('Google verification');
  let sentence: string, tone: Insight['tone'];
  if (!gaps.length && x.brokenLinks === 0) { sentence = 'Your site is set up to be found: titles, descriptions, and sitemap are all in place.'; tone = 'good'; }
  else if (gaps.length) { sentence = `A few things would help search find you — you’re missing ${gaps.join(', ')}.`; tone = 'attention'; }
  else { sentence = `${plural(x.brokenLinks, 'link', 'links')} on your site point somewhere broken — worth a quick fix.`; tone = 'attention'; }
  return { key: 'search_readiness', title: 'Getting found', sentence, detail: x.sitemap ? 'Your sitemap is published for search engines.' : '', href: '/presence.html#business', tone };
}

// ── AN-2: first-party traffic, in plain English (real data now) ───────────────
// Structural param (no import) so compose.ts stays dependency-free (AN-9 guard).
export interface TrafficAgg {
  visitors: number; priorVisitors: number; pageviews: number;
  topPages: Array<{ path: string; views: number }>;
  topSources: Array<{ source: string; visits: number }>;
  devices: Array<{ device: string; share: number }>;
  events: { phone: number; email: number; cta: number; download: number };
  hasData: boolean;
  truncated?: boolean;   // fetch cap hit → prior window undercounted → NO trend claims (AN-4)
}
const prettyPath = (p: string) => {
  if (p === '/' || p === '') return 'your home page';
  const seg = p.replace(/^\/|\/$/g, '').split('/')[0].replace(/-/g, ' ');
  return `your ${seg} page`;
};

/** Visitor + page + source + engagement sentences. Empty when there's no data yet
 *  (honest — never a fabricated number). AN-2.3/2.5. */
export function trafficInsights(agg: TrafficAgg, period: Period, hosting?: { hosted: boolean; domain?: string | null }): Insight[] {
  const w = periodWord(period);
  // The empty state depends on WHOSE website this is. "Once your site is
  // published, visitor numbers show up here" is true for a site we host and
  // false forever for one we don't: presence_visits is fed by a beacon
  // lib/render.ts injects into pages WE render, so on an external site there is
  // no counter to wait for. `number: null` (not 0) because there is no zero to
  // report — the measurement doesn't exist.
  if (!agg.hasData && hosting && !hosting.hosted) {
    const at = hosting.domain ? ` on ${hosting.domain}` : '';
    return [{ key: 'traffic', title: 'Website visitors', sentence: `Visitor numbers can’t come from here — the studio doesn’t host this website, so there’s no counter${at}. Search numbers are unaffected: Google reports on the domain whoever hosts it.`, number: null, href: '/connections.html', tone: 'neutral' }];
  }
  if (!agg.hasData) return [{ key: 'traffic', title: 'Website visitors', sentence: `No visits recorded yet this ${w} — once your site is published and shared, visitor numbers show up here.`, number: 0, href: '/presence.html#publish', tone: 'neutral' }];
  const out: Insight[] = [];
  // truncated = the prior window is undercounted; stating a trend would
  // fabricate a direction (AN-4: say less, never wrong).
  out.push({ key: 'traffic', title: 'Website visitors', sentence: `${agg.visitors} ${agg.visitors === 1 ? 'person' : 'people'} visited your website this ${w}${agg.truncated ? '' : trendPhrase(agg.visitors, agg.priorVisitors, w)}.`, number: agg.visitors, detail: `${agg.pageviews} page views in all.`, href: '/analytics.html', tone: 'good' });
  if (agg.topSources.length) { const s = agg.topSources[0]; out.push({ key: 'source', title: 'Where they come from', sentence: `Most visitors arrive from ${s.source}.`, detail: agg.topSources.slice(1, 3).map((x) => x.source).join(' and ') ? `Then ${agg.topSources.slice(1, 3).map((x) => x.source).join(' and ')}.` : '', tone: 'neutral' });
  }
  if (agg.topPages.length) { const p = agg.topPages[0]; out.push({ key: 'top_page', title: 'What they look at', sentence: `${prettyPath(p.path).replace(/^your/, 'Your')} is getting the most attention.`, number: p.views, tone: 'neutral' }); }
  const clicks = agg.events.phone + agg.events.email;
  if (clicks > 0) out.push({ key: 'contact_clicks', title: 'Reaching out', sentence: `Visitors tapped to call or email you ${clicks} ${clicks === 1 ? 'time' : 'times'} this ${w}.`, number: clicks, detail: agg.events.phone ? `${agg.events.phone} tapped your phone number.` : '', tone: 'good' });
  return out;
}

/** A traffic "moment" — only on a MEANINGFUL change, never daily noise (AN-2.7). */
export function trafficNotice(agg: TrafficAgg): { headline: string; summary: string } | null {
  if (!agg.hasData || agg.visitors < 12) return null;         // too small to be meaningful
  if (agg.truncated) return null;                             // undercounted prior window → no growth claims (AN-4)
  if (agg.priorVisitors >= 4 && agg.visitors >= agg.priorVisitors * 2) {
    return { headline: 'More people are finding you.', summary: `Visitors roughly doubled — ${agg.priorVisitors} to ${agg.visitors}.` };
  }
  const s = agg.topSources[0];
  if (s && /google/i.test(s.source) && agg.topSources.length > 1 && s.visits >= agg.visitors * 0.6) {
    return { headline: 'Google is becoming your biggest source.', summary: 'Most of your recent visitors came from Google search.' };
  }
  return null;
}

/** Visitor milestones for the Customer Journey (AN-2.6). Pure. */
export function visitorMilestones(totalVisitorsAllTime: number, firstVisitorAt: string | null): Array<{ key: string; label: string; achieved: boolean; note: string }> {
  return [
    { key: 'first_visitor', label: 'First visitor', achieved: !!firstVisitorAt, note: firstVisitorAt ? 'Someone visited your website for the first time. 🎉' : 'Your first visitor will show up here.' },
    { key: 'hundred_visitors', label: 'First 100 visitors', achieved: totalVisitorsAllTime >= 100, note: totalVisitorsAllTime >= 100 ? 'Over 100 people have visited your website. 🎉' : `${totalVisitorsAllTime} of your first 100 visitors so far.` },
  ];
}

/** Agency portfolio, in plain English — composes buildPortfolio rows (AN-7). Pure. */
export interface PortfolioClientLite { name?: string; leads_waiting?: number; unpublished_changes?: boolean; last_published_at?: string | null; attention?: number; visitors?: number; }
export function portfolioInsights(clients: PortfolioClientLite[], nowMs: number): { headline: string; insights: Insight[] } {
  const total = clients.length;
  const withLeads = clients.filter((c) => (c.leads_waiting || 0) > 0);
  const needAttention = clients.filter((c) => (c.attention || 0) > 0);
  const stale = clients.filter((c) => c.last_published_at && (nowMs - Date.parse(c.last_published_at)) > 30 * 86_400_000);
  const growing = clients.filter((c) => (c.visitors || 0) > 0).sort((a, b) => (b.visitors || 0) - (a.visitors || 0));
  const trafficNoInquiry = clients.filter((c) => (c.visitors || 0) >= 15 && (c.leads_waiting || 0) === 0 && !c.unpublished_changes);
  const insights: Insight[] = [];
  if (growing.length) insights.push({ key: 'traffic', title: 'Getting visitors', sentence: `${growing.length} of your ${total} clients had website visitors recently.`, number: growing.length, detail: `Busiest: ${growing.slice(0, 3).map((c) => `${c.name || 'a client'} (${c.visitors})`).join(', ')}.`, tone: 'good' });
  if (trafficNoInquiry.length) insights.push({ key: 'traffic_no_inquiries', title: 'Traffic, no inquiries', sentence: `${trafficNoInquiry.length} ${trafficNoInquiry.length === 1 ? 'client is' : 'clients are'} getting visitors but no inquiries — their contact path may be worth a look.`, number: trafficNoInquiry.length, detail: trafficNoInquiry.slice(0, 4).map((c) => c.name || 'a client').join(', '), tone: 'attention' });
  if (withLeads.length) insights.push({ key: 'growing', title: 'New inquiries', sentence: `${withLeads.length} of your ${total} clients ${withLeads.length === 1 ? 'has' : 'have'} new inquiries waiting.`, number: withLeads.length, detail: withLeads.slice(0, 4).map((c) => c.name || 'a client').join(', '), tone: 'good' });
  if (needAttention.length) insights.push({ key: 'attention', title: 'Needs attention', sentence: `${needAttention.length} ${needAttention.length === 1 ? 'client needs' : 'clients need'} a look.`, number: needAttention.length, detail: needAttention.slice(0, 4).map((c) => c.name || 'a client').join(', '), tone: 'attention' });
  if (stale.length) insights.push({ key: 'quiet', title: 'Gone quiet', sentence: `${stale.length} ${stale.length === 1 ? 'client hasn’t' : 'clients haven’t'} published in over a month.`, number: stale.length, detail: stale.slice(0, 4).map((c) => c.name || 'a client').join(', '), tone: 'attention' });
  const headline = total === 0 ? 'No clients yet.' : insights.length ? `Across ${total} ${total === 1 ? 'client' : 'clients'}, here’s what stands out.` : `All ${total} clients are quiet and current — nothing needs you.`;
  return { headline, insights };
}

/** Cap honesty (AN-4): the /analytics/portfolio bulk visits read is bounded at
 *  this many rows. Exported so the route's query `limit=` and the fold's
 *  truncation check can never drift apart. */
export const PORTFOLIO_VISITS_CAP = 20000;

/** AN-2.4: unique visitors per site, folded from the ONE bulk portfolio visits
 *  read (pageview rows: site_id + visitor_hash). PURE so the fixture pins hold.
 *  `truncated` = the read came back AT the cap: rows beyond it were dropped by
 *  PostgREST (lib/db.ts: the correctness cliff), so the per-site counts are
 *  possibly short and NOT attributable to particular sites — one flag for the
 *  whole read, never per row (a per-row flag would claim attribution precision
 *  the data doesn't have). Consumers must stop presenting the counts as exact.
 *  Hashless rows are SKIPPED — the same unique-visitor semantics as
 *  aggregateVisits (lib/visits.ts) and weeklyVisitors (lib/analytics_dashboard
 *  .ts): counting each hashless row as a fresh unique would inflate this
 *  column above every other visitors surface for the same site. */
export function foldPortfolioVisitors(rows: Array<{ site_id?: string; visitor_hash?: string | null }>): { visitorsBySite: Record<string, number>; truncated: boolean } {
  const sets = new Map<string, Set<string>>();
  for (const v of rows || []) {
    if (!v || !v.site_id || !v.visitor_hash) continue;
    const s = sets.get(String(v.site_id)) || new Set<string>();
    s.add(String(v.visitor_hash));
    sets.set(String(v.site_id), s);
  }
  return { visitorsBySite: Object.fromEntries([...sets].map(([k, s]) => [k, s.size])), truncated: (rows || []).length >= PORTFOLIO_VISITS_CAP };
}

/** SS7 seams: the per-site website rows for /analytics/portfolio (P2-F G4),
 *  PURE so the fixture pins can hold the KPI band to the SAME client set as
 *  the /agency/portfolio rollup. Input rows are buildPortfolio output ALREADY
 *  filtered to ACTIVE clients (filterPortfolio default) — archived clients
 *  never reach this band. Additive fields (older frontends unaffected):
 *    site_id  — the join/drill key the rollup matches on (uuid)
 *    visitors — unique visitors this week; null = the visits read FAILED
 *               (AN-4: never a fabricated 0), a missing site on a successful
 *               read is an honest 0. */
export interface WebsiteRowLite { site_id: string; name?: string; last_published_at?: string | null; unpublished_changes?: unknown; leads_waiting?: number; attention?: number }
export interface WebsiteRowCtx {
  planBySite?: Record<string, string>;                 // site_id → coarse plan status (active|paused|lapsed|…) — never payment details
  failedSites?: string[];                              // sites with a recent failed publish
  visitorsBySite?: Record<string, number> | null;      // null = the visits read failed this time
}
export function websiteRows(portfolio: WebsiteRowLite[], ctx: WebsiteRowCtx) {
  const failed = new Set(ctx.failedSites || []);
  const plans = ctx.planBySite || {};
  const visitors = ctx.visitorsBySite || null;
  return (portfolio || []).map((c) => {
    const plan = plans[String(c.site_id)] || 'unknown';
    const pubFailed = failed.has(String(c.site_id));
    return {
      site_id: c.site_id,
      name: c.name,
      draft_live: c.last_published_at ? 'live' : 'draft',
      last_published_at: c.last_published_at || null,
      unpublished_changes: !!c.unpublished_changes,
      leads_waiting: c.leads_waiting || 0,
      visitors: visitors ? (Number(visitors[String(c.site_id)]) || 0) : null,
      publish_failed: pubFailed,
      plan_status: plan,   // coarse SaaS blocker (active|paused|lapsed|…), never payment details
      needs_attention: !!c.attention || pubFailed || plan === 'paused' || plan === 'lapsed',
    };
  });
}
