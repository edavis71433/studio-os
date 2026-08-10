// ── Connected registry liveness audit ───────────────────────────────────────
// `status` in connected/providers.ts is not documentation — it is the switch the
// customer feels. connections.html renders the Connect button ONLY for
// 'read_only'/'read_write'; a 'planned' provider renders "This one's coming soon"
// and cannot be connected at all. So the registry and the shipped adapters must
// never disagree in EITHER direction:
//
//   • a provider whose read adapter has actually shipped must not be left
//     'planned' — that is the AN-3.1 defect (the phase shipped ops/gsc_sync.ts +
//     the scope fix and never flipped the registry, so "Connect Search Console"
//     led to a card with no Connect button on it);
//   • a provider must not be flipped OFF 'planned' without a shipped read —
//     that would hand the owner a Connect button that ends in a wrong number.
//
// The audit below is the evidence. DEFERRED names every provider that is still
// 'planned' and the CONCRETE reason — not "unfinished", but the specific thing
// that would go wrong today. Flipping one requires deleting its reason here,
// which is exactly the review this file exists to force.
//
//   deno run --allow-read --allow-env tests/presence/connected_registry_test.mjs
import { CONNECTED_PROVIDERS, providerByKey } from '../../supabase/functions/presence/connected/providers.ts';
import { NORMALIZERS, normalize } from '../../supabase/functions/presence/connected/adapters.ts';
import { isOAuth } from '../../supabase/functions/presence/connected/auth.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const src = (rel) => Deno.readTextFileSync(new URL(`../../supabase/functions/presence/${rel}`, import.meta.url));

// ── the code-derived half of the criterion (no judgement, just what exists) ──
const adaptersSrc = src('connected/adapters.ts');
const readEndpointBlock = adaptersSrc.slice(
  adaptersSrc.indexOf('const READ_ENDPOINT'),
  adaptersSrc.indexOf('// Per-provider request shaping'),
);
const hasReadEndpoint = (key) => new RegExp(`^\\s*${key}:\\s*'https?://`, 'm').test(readEndpointBlock);
// A provider whose call shape the shared GET cannot express reads through a
// per-provider strategy instead (READ_STRATEGIES) — GA4's POST runReport is the
// first. Either one satisfies "a read exists"; a strategy is MORE evidence, not
// less, because it had to be written deliberately.
const strategiesBlock = adaptersSrc.slice(adaptersSrc.indexOf('export const READ_STRATEGIES'));
const hasReadStrategy = (key) => new RegExp(`^\\s*${key}:`, 'm').test(strategiesBlock);
const hasRead = (key) => hasReadEndpoint(key) || hasReadStrategy(key);

// A normalizer counts as REAL only if it maps something. The kitchen-sink probe
// mirrors connected/maturity.ts: a defensive `{ label }` fallback produces no
// business field and is therefore not a read.
const SINK = {
  rating: 1, averageRating: 1, reviewCount: 1, totalReviewCount: 1, newReviews: 1, unreplied: 1,
  clicks: 1, impressions: 1, indexingIssues: 1, Clicks: 1, Impressions: 1,
  visitors: 1, pageviews: 1, stars: 1, numberOfReviews: 1, verified: true,
  followers_count: 1, fan_count: 1, firstDegreeSize: 1, followerCount: 1,
  total: 1, totalSize: 1, total_items: 1, tag: [{}], container: [{}], account: [{}],
  totals: { users: 1, screenPageViews: 1 }, score: { trustScore: 1 }, stats: { member_count: 1, open_rate: 1 },
  items: [{ statistics: { subscriberCount: 1, videoCount: 1 } }], collection: [{}], results: [{}],
  data: [{ attributes: { profile_count: 1 } }], posts: { data: [{}] }, media: { data: [{}] }, payments: [{}],
};
const mapsSomething = (key, label) => {
  const n = normalize(key, SINK, label);
  return Object.keys(n).some((k) => k !== 'label' && n[k] !== undefined);
};
// Can a customer even START a connection? handleConnectionConnect only has two
// paths: OAuth (an OAUTH endpoints entry) or a pasted read-only key.
const hasConnectPath = (p) => isOAuth(p.key) || p.auth === 'api_key';

// ── the judgement half: why each still-'planned' provider is still 'planned' ──
// Every reason is a defect you can read off the adapter TODAY, not a vague
// "not done". Delete an entry only when the read is verified end-to-end the way
// google_search_console's was (AN-3.1: request/response shape copied verbatim
// from the shipping clever-api collector, full-URL scope, sync tested against
// the real stores).
const DEFERRED = {
  // ── Google family: the endpoint is a placeholder or the wrong resource ──
  google_business_profile:
    'READ_ENDPOINT lists ACCOUNTS (mybusinessbusinessinformation/v1/accounts); the normalizer reads rating/reviewCount, which live on a location’s reviews resource. No location is ever resolved, so a connected customer would see a blank card.',
  // google_analytics's entry is DELETED — its documented defect ("READ_ENDPOINT
  // is the GA4 Data API BASE with no property id; GA4 reporting is a POST
  // runReport against a specific property; the shared bearer GET can only 404")
  // was fixed the honest way: the adapter layer grew a per-provider read
  // STRATEGY (connected/adapters.ts readGa4 — Admin-API property discovery +
  // POST properties/{id}:runReport), the chosen property lives on the
  // connection (0128 config), and ops/ga4_sync.ts writes the shared `signals`
  // store (source='ga4'). Evidence bar met AN-3.1-style: request/response
  // shapes transcribed from the official Data/Admin API discovery documents,
  // pinned in tests/presence/ga4_test.mjs (doc URLs cited there and in
  // lib/ga4.ts). The flip's own audit is section 1b below.
  google_tag_manager:
    'The endpoint returns GTM ACCOUNTS; the normalizer publishes that count as "tags installed". Accounts are not tags — connecting it would print a confidently wrong number.',
  google_calendar:
    'The events read has no timeMin/singleEvents, so Google returns PAST events too; "upcoming appointments" would count history. Also hard-capped at maxResults=10.',
  youtube:
    'channels?mine=true is plausible but has never been run against the live API, and the read is not wired into any surface — nothing would display what it fetched.',
  // ── Local listings ──
  apple_business_connect:
    'auth is ownership_verification, and the OAUTH entry’s businessconnect.apple.com/oauth/* endpoints are placeholders — Apple Business Connect exposes no such public OAuth. There is no flow to complete.',
  // ── Search (the other one) ──
  bing_webmaster:
    'GetRankAndTrafficStats requires a siteUrl parameter; the shared read sends only apikey, so the call errors before any normalizing happens.',
  // ── Social ──
  meta_business:
    'The business_management permission requires Meta App Review; the /me/businesses shape has never been verified, and nothing consumes managed_assets.',
  facebook_page:
    'graph.facebook.com/me with a USER token returns the user, not the Page — fan_count needs a page-scoped token and a page id, neither of which the shared flow obtains.',
  instagram:
    'Same as facebook_page: /me on a user token has no followers_count. An IG Business account id must be resolved through the linked Page first.',
  linkedin:
    '/v2/networkSizes requires an entity URN path segment and an edgeType parameter; as written it is a 400 every time.',
  // ── Reviews ──
  yelp:
    'businesses/search requires a location (or lat/long); without one Yelp answers 400. The business is never identified, so there is nothing to rate.',
  trustpilot:
    'business-units/find requires a name query parameter; the shared read sends none and gets a 400.',
  // ── Scheduling ──
  calendly:
    'scheduled_events requires a user or organization parameter; without it Calendly answers 400.',
  // ── CRM ──
  hubspot:
    'contacts?limit=1 returns {results,paging} with no total, so the normalizer reports results.length — literally always 1. A wrong number, not a missing one.',
  salesforce:
    'The endpoint is login.salesforce.com/.../limits with an "instance_url substituted at activation" note — a placeholder host — and /limits never returns the totalSize the normalizer reads.',
  // ── Email marketing ──
  mailchimp:
    'The host hardcodes the us1 data centre. A Mailchimp account lives on the dc in its own token metadata, so this is the wrong host for most accounts.',
  klaviyo:
    'The Lists API returns list objects without profile_count; the normalizer reads data[0].attributes.profile_count and would always find nothing.',
  // ── Payments ──
  stripe_connect:
    'charges?limit=100 has no `total` field, so revenue is always undefined and payments is "up to the last 100 charges" presented as a payment count.',
  square:
    'ListPayments has no `total` field either — same defect as stripe_connect: a revenue figure with nothing behind it.',
};

// ═══ 1. the AN-3.1 regression guard ═══
{
  const gsc = providerByKey('google_search_console');
  ok('AN-3.1: Search Console is read_only — the phase shipped the read, so the Connect button must render',
    gsc.status === 'read_only', gsc.status);
  ok('AN-3.1: Search Console asks for the FULL scope URL Google accepts (the short form is rejected)',
    gsc.scopes.includes('https://www.googleapis.com/auth/webmasters.readonly'));
  ok('AN-3.1: the shipped sync exists and targets this exact provider key',
    /const PROVIDER = 'google_search_console'/.test(src('ops/gsc_sync.ts')));
}

// ═══ 1b. the GA4 flip — live requires the strategy AND the property id ═══
// GA4's read is only real if all three legs exist: a per-provider strategy (the
// POST call shape the shared GET could never express), a property selection
// (discovery + stored choice — a report without a property id is a 404), and
// the scheduled sync into `signals`. Words in the registry are not evidence;
// these greps hold the flip to the code that actually shipped.
{
  const ga = providerByKey('google_analytics');
  ok('GA4: google_analytics is read_only — the read shipped, so the Connect button must render',
    ga.status === 'read_only', ga.status);
  ok('GA4: asks for the FULL analytics.readonly scope URL (covers both the Data and Admin APIs)',
    ga.scopes.length === 1 && ga.scopes[0] === 'https://www.googleapis.com/auth/analytics.readonly');
  ok('GA4: reads through a per-provider STRATEGY, not a GET-a-URL endpoint',
    hasReadStrategy('google_analytics') && !hasReadEndpoint('google_analytics'));
  ok('GA4: the strategy is the real call shape — POST properties/{id}:runReport on the Data API',
    /analyticsdata\.googleapis\.com\/v1beta\/\$\{prop\}:runReport/.test(adaptersSrc) && /method: 'POST'/.test(adaptersSrc));
  ok('GA4: the strategy resolves a PROPERTY ID (stored 0128 config, else Admin-API discovery)',
    /getConnectionConfig\(siteId, 'google_analytics'\)/.test(adaptersSrc) &&
    /ga4PropertyPath\(cfg\.property_id\)/.test(adaptersSrc) &&
    /analyticsadmin\.googleapis\.com\/v1beta\/accountSummaries/.test(adaptersSrc));
  ok('GA4: several properties never guess — the human is asked to choose',
    /Choose which Google Analytics property/.test(adaptersSrc));
  const ga4Sync = src('ops/ga4_sync.ts');
  ok('GA4: the shipped sync exists and targets this exact provider key',
    /const PROVIDER = 'google_analytics'/.test(ga4Sync));
  ok('GA4: the sync labels its signals with the external source (ga4), never the first-party one',
    /source: 'ga4'/.test(src('lib/ga4.ts')));
}

// ═══ 2. no shipped read adapter is left 'planned' (the defect that started this) ═══
{
  const stranded = CONNECTED_PROVIDERS.filter((p) =>
    p.status === 'planned' && !DEFERRED[p.key] && mapsSomething(p.key, p.customerLabel) && hasRead(p.key) && hasConnectPath(p));
  ok('audit: every provider with a live read adapter and no deferral reason is OFF “planned”',
    stranded.length === 0,
    stranded.length ? `still planned with nothing explaining it: ${stranded.map((p) => p.key).join(', ')}` : '');
}

// ═══ 3. nothing is flipped without an adapter behind it (the opposite mistake) ═══
{
  const hollow = CONNECTED_PROVIDERS.filter((p) => p.status !== 'planned' &&
    !(NORMALIZERS[p.key] && mapsSomething(p.key, p.customerLabel) && hasRead(p.key) && hasConnectPath(p)));
  ok('audit: no provider is connectable without a normalizer, a read (endpoint or strategy) and a connect path',
    hollow.length === 0, hollow.map((p) => p.key).join(', '));
}

// ═══ 4. the deferral list stays honest — no stale reasons, no unexplained gaps ═══
{
  const known = new Set(CONNECTED_PROVIDERS.map((p) => p.key));
  const ghosts = Object.keys(DEFERRED).filter((k) => !known.has(k));
  ok('audit: every deferral names a real provider (no stale entries)', ghosts.length === 0, ghosts.join(', '));

  const flippedButDeferred = CONNECTED_PROVIDERS.filter((p) => p.status !== 'planned' && DEFERRED[p.key]);
  ok('audit: a provider cannot be flipped live while its deferral reason still stands',
    flippedButDeferred.length === 0, flippedButDeferred.map((p) => p.key).join(', '));

  const unexplained = CONNECTED_PROVIDERS.filter((p) => p.status === 'planned' && !DEFERRED[p.key]);
  ok('audit: every still-planned provider says WHY, in one concrete sentence',
    unexplained.length === 0, unexplained.map((p) => p.key).join(', '));

  ok('audit: the reasons are specific, not filler',
    Object.values(DEFERRED).every((r) => r.length > 60 && !/^(not done|todo|wip|coming soon)/i.test(r)));
}

// ═══ 5. the audit covers the whole registry exactly once ═══
{
  const live = CONNECTED_PROVIDERS.filter((p) => p.status !== 'planned');
  ok('audit: deferred + live accounts for every provider exactly once',
    Object.keys(DEFERRED).length + live.length === CONNECTED_PROVIDERS.length,
    `${Object.keys(DEFERRED).length} deferred + ${live.length} live = ${CONNECTED_PROVIDERS.length}`);
  const liveKeys = live.map((p) => p.key).sort().join(',');
  ok('audit: exactly two providers are live today — Search Console (AN-3.1) and Google Analytics (the GA4 build)',
    liveKeys === 'google_analytics,google_search_console', liveKeys);
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) Deno.exit(1);
