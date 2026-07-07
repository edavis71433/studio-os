// ── Connected read adapters (L4.1) — one interface, every provider ──────────
// A read adapter turns a provider's raw response into ONE normalized shape the
// Evidence Engine understands. No provider-specific architecture: each adapter
// is just an endpoint to GET and a pure normalizer. Adapters are ISOLATED — a
// throwing or failing adapter contributes nothing and never touches another (the
// same failure-isolation the evidence providers guarantee). READ-ONLY: adapters
// only ever GET.
import { svc } from '../lib/db.ts';
import { CONNECTED_PROVIDERS } from './providers.ts';
import { loadTokens, saveConnectedData, markStatus } from './store.ts';
import { refreshTokens, isOAuth, oauthConfigured } from './auth.ts';
import { saveTokens } from './store.ts';

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
  google_analytics: (r, label) => ({ label, visitors: num(r?.visitors ?? r?.totals?.users), pageviews: num(r?.pageviews ?? r?.totals?.screenPageViews) }),
  yelp: (r, label) => ({ label, rating: num(r?.rating), review_count: num(r?.review_count) }),
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
  google_tag_manager: (r, label) => ({ label }),
  meta_business: (r, label) => ({ label }),
  apple_business_connect: (r, label) => ({ label }),
};

// Where each adapter reads from (documented endpoints). The fetch is a bearer GET;
// the exact query shaping is a per-provider detail set at app registration.
const READ_ENDPOINT: Record<string, string> = {
  google_business_profile: 'https://mybusinessbusinessinformation.googleapis.com/v1/accounts',
  google_search_console: 'https://searchconsole.googleapis.com/webmasters/v3/sites',
  google_analytics: 'https://analyticsdata.googleapis.com/v1beta',
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
};

export interface ConnectedAdapter { key: string; label: string; }
export const ADAPTERS: ConnectedAdapter[] = CONNECTED_PROVIDERS.map((p) => ({ key: p.key, label: p.customerLabel }));

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
    const endpoint = READ_ENDPOINT[providerKey];
    if (!endpoint) { await saveConnectedData(siteId, providerKey, normalize(providerKey, {}, label)); return normalize(providerKey, {}, label); }
    const r = await fetch(endpoint, { headers: { Authorization: `Bearer ${tokens.access_token}`, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) { await markStatus(siteId, providerKey, r.status === 401 ? 'expired' : 'error', r.status === 401 ? 'attention' : 'down', `read ${r.status}`); return null; }
    const raw = await r.json().catch(() => ({}));
    const data = normalize(providerKey, raw, label);
    await saveConnectedData(siteId, providerKey, data);
    await markStatus(siteId, providerKey, 'connected', 'ok', '');
    return data;
  } catch (e) {
    await markStatus(siteId, providerKey, 'error', 'down', String((e as Error)?.message || e).slice(0, 120));
    return null; // isolation: one provider's failure never propagates
  }
}
