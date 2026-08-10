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
  label: string;                 // the provider's customerLabel, for messages
}

const num = (v: unknown): number | undefined => { const n = Number(v); return isFinite(n) ? n : undefined; };

// Pure normalizers: raw provider JSON → normalized. These are the tested core;
// the fetch (I/O) is a thin bearer GET around them. Representative providers have
// real mappings; the rest normalize defensively (connected, no numbers yet) so
// every provider is registered and isolated even before its shape is verified live.
export const NORMALIZERS: Record<string, (raw: any, label: string) => NormalizedConnected> = {
  google_business_profile: (r, label) => ({ label, rating: num(r?.rating ?? r?.averageRating), review_count: num(r?.reviewCount ?? r?.totalReviewCount), new_reviews: num(r?.newReviews), unreplied_reviews: num(r?.unreplied) }),
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
  google_business_profile: 'https://mybusinessbusinessinformation.googleapis.com/v1/accounts',
  google_search_console: 'https://searchconsole.googleapis.com/webmasters/v3/sites',
  // google_analytics is deliberately ABSENT: its read is a POST runReport against
  // a chosen property, which no GET-a-URL entry can express — it reads through
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
  | { ok: false; status?: number; attention?: string };  // attention: our own plain sentence — connected, but a human step is needed

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

export const READ_STRATEGIES: Record<string, (siteId: string, token: string) => Promise<StrategyRead>> = {
  google_analytics: (siteId, token) => readGa4(siteId, token),
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
        if (res.attention) { await markStatus(siteId, providerKey, 'connected', 'attention', res.attention); return null; }
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
