// ── Connected read adapters (L4.1) — one interface, every provider ──────────
// A read adapter turns a provider's raw response into ONE normalized shape the
// Evidence Engine understands. No provider-specific architecture: each adapter
// is just an endpoint to GET and a pure normalizer. Adapters are ISOLATED — a
// throwing or failing adapter contributes nothing and never touches another (the
// same failure-isolation the evidence providers guarantee). READ-ONLY: adapters
// only ever GET.
import { svc } from '../lib/db.ts';
import { CONNECTED_PROVIDERS } from './providers.ts';
import { loadTokens, saveConnectedData, markStatus, getConnectionConfig, setConnectionConfig } from './store.ts';
import { refreshTokens, isOAuth, oauthConfigured } from './auth.ts';
import { saveTokens } from './store.ts';
import { ga4PropertyPath, ga4RunReportBody, ga4RecentWindow, parseGa4Report, parseAccountSummaries, type Ga4Property } from '../lib/ga4.ts';
import { GBP_READ_MASK, autoPickGbp, gbpAccountPath, gbpLocationPath, gbpPerformanceQuery, gbpProblem, gbpWaitingOnStudio, parseGbpAccounts, parseGbpLocation, parseGbpLocations, parseGbpPerformance, parseGbpReviews, type GbpLocation } from '../lib/gbp.ts';
import { gscDomainFor } from '../lib/gsc.ts';
import { syncGscForSite } from '../ops/gsc_sync.ts';

// The one normalized shape. Every field optional — the evidence provider reads
// whatever a given adapter could supply. Plain business quantities, never raw
// API payloads.
export interface NormalizedConnected {
  rating?: number; review_count?: number; new_reviews?: number; unreplied_reviews?: number;
  search_clicks?: number; search_impressions?: number; indexing_issues?: number;
  visitors?: number; pageviews?: number;
  followers?: number; posts_recent?: number;
  upcoming_appointments?: number; contacts?: number;
  subscribers?: number; open_rate?: number;
  revenue?: number; payments?: number;
  tags_installed?: number;       // Google Tag Manager — measurement tags present
  managed_assets?: number;       // Meta Business — pages/accounts managed
  listing_verified?: number;     // Apple Business Connect — 1 if the place card is claimed/verified
  calls?: number; direction_requests?: number; website_clicks?: number;   // Google listing, last 30 days
  listing_name?: string; listing_address?: string; listing_maps_uri?: string; listing_review_uri?: string; hours_set?: boolean;
  label: string;                 // the provider's customerLabel, for messages
}

const num = (v: unknown): number | undefined => { const n = Number(v); return isFinite(n) ? n : undefined; };

// Pure normalizers: raw provider JSON → normalized. These are the tested core;
// the fetch (I/O) is a thin bearer GET around them. Representative providers have
// real mappings; the rest normalize defensively (connected, no numbers yet) so
// every provider is registered and isolated even before its shape is verified live.
export const NORMALIZERS: Record<string, (raw: any, label: string) => NormalizedConnected> = {
  // readGbp below assembles this from the listing, reviews and performance reads.
  google_business_profile: (r, label) => ({
    label, rating: num(r?.rating ?? r?.averageRating), review_count: num(r?.reviewCount ?? r?.totalReviewCount), new_reviews: num(r?.newReviews), unreplied_reviews: num(r?.unreplied),
    calls: num(r?.calls), direction_requests: num(r?.directions), website_clicks: num(r?.websiteClicks),
    ...(r?.location ? { listing_name: r.location.name, listing_address: r.location.address, listing_maps_uri: r.location.maps_uri, listing_review_uri: r.location.review_uri, hours_set: r.location.hours_set } : {}),
  }),
  google_search_console: (r, label) => ({ label, search_clicks: num(r?.clicks ?? r?.rows?.[0]?.clicks), search_impressions: num(r?.impressions ?? r?.rows?.[0]?.impressions), indexing_issues: num(r?.indexingIssues) }),
  bing_webmaster: (r, label) => ({ label, search_clicks: num(r?.Clicks), search_impressions: num(r?.Impressions) }),
  // GA4 Data API RunReportResponse (metric values matched by header name — see
  // lib/ga4.ts for the doc-transcribed shape), with the legacy defensive shapes
  // kept as fallbacks so garbage still degrades to a label-only card.
  google_analytics: (r, label) => { const t = parseGa4Report(r); return { label, visitors: t.visitors ?? num(r?.visitors ?? r?.totals?.users), pageviews: t.pageviews ?? num(r?.pageviews ?? r?.totals?.screenPageViews) }; },
  yelp: (r, label) => ({ label, rating: num(r?.rating ?? r?.businesses?.[0]?.rating), review_count: num(r?.review_count ?? r?.businesses?.[0]?.review_count) }),
  trustpilot: (r, label) => ({ label, rating: num(r?.score?.trustScore ?? r?.stars), review_count: num(r?.numberOfReviews) }),
  facebook_page: (r, label) => ({ label, followers: num(r?.followers_count ?? r?.fan_count), posts_recent: num(r?.posts?.data?.length) }),
  instagram: (r, label) => ({ label, followers: num(r?.followers_count), posts_recent: num(r?.media?.data?.length) }),
  linkedin: (r, label) => ({ label, followers: num(r?.firstDegreeSize ?? r?.followerCount) }),
  youtube: (r, label) => ({ label, followers: num(r?.items?.[0]?.statistics?.subscriberCount), posts_recent: num(r?.items?.[0]?.statistics?.videoCount) }),
  google_calendar: (r, label) => ({ label, upcoming_appointments: num(r?.items?.length) }),
  calendly: (r, label) => ({ label, upcoming_appointments: num(r?.collection?.length) }),
  hubspot: (r, label) => ({ label, contacts: num(r?.total ?? r?.results?.length) }),
  salesforce: (r, label) => ({ label, contacts: num(r?.totalSize) }),
  mailchimp: (r, label) => ({ label, subscribers: num(r?.stats?.member_count ?? r?.total_items), open_rate: num(r?.stats?.open_rate) }),
  klaviyo: (r, label) => ({ label, subscribers: num(r?.data?.[0]?.attributes?.profile_count) }),
  stripe_connect: (r, label) => ({ label, payments: num(r?.data?.length), revenue: num(r?.total) }),
  square: (r, label) => ({ label, payments: num(r?.payments?.length), revenue: num(r?.total) }),
  // Google Tag Manager — how many measurement tags/containers are installed.
  google_tag_manager: (r, label) => ({ label, tags_installed: num(r?.tag?.length ?? r?.container?.length ?? r?.account?.length) }),
  // Meta Business — how many pages/accounts the business manages.
  meta_business: (r, label) => ({ label, managed_assets: num(r?.data?.length ?? r?.businesses?.data?.length ?? r?.accounts?.data?.length) }),
  // Apple Business Connect — whether the place card is claimed/verified (1/0).
  apple_business_connect: (r, label) => ({ label, listing_verified: (r?.verified === true || r?.status === 'VERIFIED' || r?.status === 'PUBLISHED') ? 1 : ((r?.status !== undefined || r?.verified !== undefined) ? 0 : undefined) }),
};

// Where each adapter reads from (documented endpoints). The fetch is a bearer GET;
// the exact query shaping is a per-provider detail set at app registration.
const READ_ENDPOINT: Record<string, string> = {
  // google_analytics, google_search_console and google_business_profile are
  // deliberately ABSENT: each needs a chosen property or location and more than
  // one request, which no GET-a-URL entry can express — they read through
  // READ_STRATEGIES below instead.
  youtube: 'https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true',
  google_calendar: 'https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=10',
  facebook_page: 'https://graph.facebook.com/v19.0/me?fields=fan_count,followers_count',
  instagram: 'https://graph.facebook.com/v19.0/me?fields=followers_count',
  linkedin: 'https://api.linkedin.com/v2/networkSizes',
  calendly: 'https://api.calendly.com/scheduled_events',
  hubspot: 'https://api.hubapi.com/crm/v3/objects/contacts?limit=1',
  mailchimp: 'https://us1.api.mailchimp.com/3.0/lists',
  stripe_connect: 'https://api.stripe.com/v1/charges?limit=100',
  square: 'https://connect.squareup.com/v2/payments',
  // ── A1 completion: the remaining intentionally-started providers ──
  // Documented base endpoints; account-specific parameters (business id, site
  // url, Salesforce instance) are finalized at owner activation — the platform's
  // "query shaping set at app registration" principle, unchanged.
  bing_webmaster: 'https://ssl.bing.com/webmaster/api.svc/json/GetRankAndTrafficStats',
  yelp: 'https://api.yelp.com/v3/businesses/search?limit=1',
  trustpilot: 'https://api.trustpilot.com/v1/business-units/find',
  salesforce: 'https://login.salesforce.com/services/data/v59.0/limits',   // instance_url substituted at activation
  klaviyo: 'https://a.klaviyo.com/api/lists/',
  google_tag_manager: 'https://tagmanager.googleapis.com/tagmanager/v2/accounts',
  meta_business: 'https://graph.facebook.com/v19.0/me/businesses',
  apple_business_connect: 'https://businessconnect.apple.com/businesses',   // read via ownership-verified session (activation)
};

// Per-provider request shaping. The shared read is a bearer GET; the API-key
// providers that don't use a Bearer header get their documented auth here. This
// is the "per-provider detail" the contract always allowed — not a new flow.
function readRequest(providerKey: string, endpoint: string, token: string): { url: string; headers: Record<string, string> } {
  const accept: Record<string, string> = { accept: 'application/json' };
  switch (providerKey) {
    case 'bing_webmaster':
      return { url: `${endpoint}${endpoint.includes('?') ? '&' : '?'}apikey=${encodeURIComponent(token)}`, headers: accept };
    case 'trustpilot':
      return { url: endpoint, headers: { ...accept, apikey: token } };
    case 'klaviyo':
      return { url: endpoint, headers: { ...accept, Authorization: `Klaviyo-API-Key ${token}`, revision: '2024-10-15' } };
    default:
      return { url: endpoint, headers: { ...accept, Authorization: `Bearer ${token}` } };
  }
}

export interface ConnectedAdapter { key: string; label: string; }
export const ADAPTERS: ConnectedAdapter[] = CONNECTED_PROVIDERS.map((p) => ({ key: p.key, label: p.customerLabel }));

// ── Per-provider READ STRATEGY — the honest extension for non-GET reads ──────
// The shared read is "bearer-GET a URL, normalize a field". GA4 cannot be
// expressed that way: reporting is a POST runReport against ONE chosen property
// (https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport)
// — the old READ_ENDPOINT entry was the bare API base and could only 404, which
// is exactly why the provider stayed 'planned'. A strategy fetches the
// provider's RAW payload its own way (or reports an honest failure);
// readProvider still owns normalize → cache → markStatus, so failure isolation
// and status honesty live in ONE place for every provider, strategied or not.
export type StrategyRead =
  | { ok: true; raw: unknown }
  | { ok: false; status?: number; attention?: string; quiet?: boolean };  // attention: our own plain sentence — connected, but a human step is needed; quiet: no notice (see markStatus)

/** List the GA4 properties this token's Google account can read, via the Admin
 *  API (shape transcribed in lib/ga4.ts):
 *  GET https://analyticsadmin.googleapis.com/v1beta/accountSummaries
 *  https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list */
export async function discoverGa4Properties(token: string): Promise<{ ok: true; properties: Ga4Property[] } | { ok: false; status: number }> {
  const r = await fetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200', {
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return { ok: false, status: r.status };
  return { ok: true, properties: parseAccountSummaries(await r.json().catch(() => ({}))) };
}

/** The GA4 read: resolve the property (stored choice, else discover — exactly
 *  one auto-selects and is recorded as such; several ask the human), then POST
 *  runReport for the recent window. Returns the raw RunReportResponse; the
 *  normalizer (parseGa4Report) turns it into plain visitors/pageviews. */
export async function readGa4(siteId: string, token: string, now: Date = new Date()): Promise<StrategyRead> {
  const cfg = await getConnectionConfig(siteId, 'google_analytics');
  let prop = ga4PropertyPath(cfg.property_id);
  if (!prop) {
    const found = await discoverGa4Properties(token);
    if (!found.ok) return { ok: false, status: found.status };
    if (found.properties.length === 0) {
      return { ok: false, attention: 'That Google account has no Google Analytics property yet — connect the account that owns this website’s Analytics, or create the property first.' };
    }
    if (found.properties.length > 1) {
      return { ok: false, attention: `Choose which Google Analytics property is this website — that account has ${found.properties.length}.` };
    }
    const only = found.properties[0];
    await setConnectionConfig(siteId, 'google_analytics', { property_id: only.id, property_name: only.name, auto_selected: true });
    prop = ga4PropertyPath(only.id) as string;
  }
  const { startDate, endDate } = ga4RecentWindow(now);
  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/${prop}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(ga4RunReportBody(startDate, endDate)),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return { ok: false, status: r.status };
  return { ok: true, raw: await r.json().catch(() => ({})) };
}

const gbpGet = async (url: string, token: string): Promise<{ ok: boolean; status: number; json: any }> => {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
};

/** Every listing this token's Google account manages: accounts, then each
 *  account's locations (one page of 100 per account is far beyond a small
 *  business's estate). One account failing doesn't hide the others' listings; only
 *  when nothing could be read at all does the failure come back. */
export async function discoverGbpLocations(token: string): Promise<{ ok: true; locations: GbpLocation[] } | { ok: false; status: number; body: unknown }> {
  const accounts = await gbpGet('https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20', token);
  if (!accounts.ok) return { ok: false, status: accounts.status, body: accounts.json };
  const names = parseGbpAccounts(accounts.json).slice(0, 10);
  const results = await Promise.all(names.map(async (account) => ({
    account,
    res: await gbpGet(`https://mybusinessbusinessinformation.googleapis.com/v1/${account}/locations?pageSize=100&readMask=${encodeURIComponent(GBP_READ_MASK)}`, token),
  })));
  const worked = results.filter((x) => x.res.ok);
  if (names.length && !worked.length) return { ok: false, status: results[0].res.status, body: results[0].res.json };
  return { ok: true, locations: worked.flatMap((x) => parseGbpLocations(x.res.json, x.account)) };
}

/** The website address this site reports on, for matching a listing to it. */
async function siteDomain(siteId: string): Promise<string | null> {
  const [siteQ, extQ] = await Promise.all([
    svc(`presence_sites?id=eq.${siteId}&select=id,edition,custom_domain,netlify_site_id&limit=1`).catch(() => null),
    svc(`presence_monitor_connections?site_id=eq.${siteId}&select=domain&limit=1`).catch(() => null),
  ]);
  const row = (siteQ as any)?.json?.[0];
  return row ? (gscDomainFor(row, (extQ as any)?.json?.[0]?.domain ?? null)?.domain ?? null) : null;
}

/** The listing read: resolve which location (stored choice, else auto-pick only
 *  the unambiguous case), then read the listing, its reviews and its performance.
 *  The three reads are separate APIs a Google project can have partly enabled, so
 *  whichever answered still counts; the failure only surfaces if all three failed. */
export async function readGbp(siteId: string, token: string, now: Date = new Date()): Promise<StrategyRead> {
  const cfg = await getConnectionConfig(siteId, 'google_business_profile');
  let locationId = gbpLocationPath(cfg.location_id);
  let account = gbpAccountPath(cfg.account);
  if (!locationId || !account) {
    const found = await discoverGbpLocations(token);
    if (!found.ok) {
      const attention = gbpProblem(found.status, found.body);
      return attention ? { ok: false, attention, quiet: gbpWaitingOnStudio(found.status, found.body) } : { ok: false, status: found.status };
    }
    if (!found.locations.length) return { ok: false, attention: 'That Google account doesn’t manage a business listing yet. Connect the account that does.' };
    const pick = autoPickGbp(found.locations, await siteDomain(siteId));
    if (!pick) return { ok: false, attention: `Choose which Google listing is this business. That account manages ${found.locations.length}.` };
    await setConnectionConfig(siteId, 'google_business_profile', { location_id: pick.id, account: pick.account, location_name: pick.name, auto_selected: true });
    locationId = pick.id; account = pick.account;
  }
  const accountId = account.replace(/^accounts\//, ''), locId = locationId.replace(/^locations\//, '');
  const [detail, reviews, perf] = await Promise.all([
    gbpGet(`https://mybusinessbusinessinformation.googleapis.com/v1/${locationId}?readMask=${encodeURIComponent(GBP_READ_MASK)}`, token),
    gbpGet(`https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locId}/reviews?pageSize=50`, token),
    gbpGet(`https://businessprofileperformance.googleapis.com/v1/${locationId}:fetchMultiDailyMetricsTimeSeries?${gbpPerformanceQuery(now)}`, token),
  ]);
  if (!detail.ok && !reviews.ok && !perf.ok) {
    const attention = gbpProblem(detail.status, detail.json);
    return attention ? { ok: false, attention, quiet: gbpWaitingOnStudio(detail.status, detail.json) } : { ok: false, status: detail.status };
  }
  return { ok: true, raw: {
    ...(reviews.ok ? parseGbpReviews(reviews.json, now.getTime()) : {}),
    ...(perf.ok ? parseGbpPerformance(perf.json) : {}),
    location: detail.ok ? parseGbpLocation(detail.json, account) : null,
  } };
}

/** The Search Console read IS the sync: it finds the verified property, stores the
 *  month in `signals`, and gives us the totals for the connection card. The sync
 *  records its own "attention" reasons, and they come back through here so that
 *  readProvider keeps the one place status is written. */
export async function readGscConnection(siteId: string): Promise<StrategyRead> {
  const site = (await svc(`presence_sites?id=eq.${siteId}&select=id,client_id,custom_domain,netlify_site_id,edition,last_published_at&limit=1`) as any)?.json?.[0];
  if (!site) return { ok: false, status: 404 };
  const res = await syncGscForSite(site, new Date(), undefined, { backfill: true });
  if (res.ok) return { ok: true, raw: { clicks: res.totals?.clicks, impressions: res.totals?.impressions } };
  return res.attention ? { ok: false, attention: res.attention } : { ok: false, status: res.status ?? 0 };
}

export const READ_STRATEGIES: Record<string, (siteId: string, token: string) => Promise<StrategyRead>> = {
  google_analytics: (siteId, token) => readGa4(siteId, token),
  google_business_profile: (siteId, token) => readGbp(siteId, token),
  google_search_console: (siteId) => readGscConnection(siteId),
};

// Normalize raw JSON for a provider (pure, defensive). Exported for tests.
export function normalize(providerKey: string, raw: any, label: string): NormalizedConnected {
  const fn = NORMALIZERS[providerKey];
  return fn ? fn(raw, label) : { label };
}

// A read pass for ONE connected provider: refresh if needed, bearer-GET, normalize,
// cache. Never throws; failures mark the connection's health and return null so a
// broken provider never affects the others or the run. READ-ONLY.
export async function readProvider(siteId: string, providerKey: string, label: string): Promise<NormalizedConnected | null> {
  try {
    let tokens = await loadTokens(siteId, providerKey);
    if (!tokens?.access_token) return null;
    // silent refresh if expired and we can
    if (tokens.expires_at && new Date(tokens.expires_at) <= new Date() && tokens.refresh_token && isOAuth(providerKey) && oauthConfigured(providerKey)) {
      try { tokens = await refreshTokens(providerKey, tokens.refresh_token); await saveTokens(siteId, providerKey, tokens, []); }
      catch { await markStatus(siteId, providerKey, 'expired', 'attention', 'needs a quick reconnect'); return null; }
    }
    // Strategied providers (GA4) fetch their own way; the default stays the
    // shared bearer GET. Either way the raw payload flows through the SAME
    // normalize → cache → markStatus below — one contract, two fetch shapes.
    let raw: unknown;
    const strategy = READ_STRATEGIES[providerKey];
    if (strategy) {
      const res = await strategy(siteId, tokens.access_token);
      if (!res.ok) {
        if (res.attention) { await markStatus(siteId, providerKey, 'connected', 'attention', res.attention, { quiet: res.quiet }); return null; }
        await markStatus(siteId, providerKey, res.status === 401 ? 'expired' : 'error', res.status === 401 ? 'attention' : 'down', `read ${res.status ?? 0}`);
        return null;
      }
      raw = res.raw;
    } else {
      const endpoint = READ_ENDPOINT[providerKey];
      if (!endpoint) { await saveConnectedData(siteId, providerKey, normalize(providerKey, {}, label)); return normalize(providerKey, {}, label); }
      const req = readRequest(providerKey, endpoint, tokens.access_token);
      const r = await fetch(req.url, { headers: req.headers, signal: AbortSignal.timeout(8000) });
      if (!r.ok) { await markStatus(siteId, providerKey, r.status === 401 ? 'expired' : 'error', r.status === 401 ? 'attention' : 'down', `read ${r.status}`); return null; }
      raw = await r.json().catch(() => ({}));
    }
    const data = normalize(providerKey, raw, label);
    await saveConnectedData(siteId, providerKey, data);
    await markStatus(siteId, providerKey, 'connected', 'ok', '');
    return data;
  } catch (e) {
    await markStatus(siteId, providerKey, 'error', 'down', String((e as Error)?.message || e).slice(0, 120));
    return null; // isolation: one provider's failure never propagates
  }
}
