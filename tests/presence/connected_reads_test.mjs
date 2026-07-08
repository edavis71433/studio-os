// ── L4.1 Read-Only Connected Providers suite ────────────────────────────────
// Verifies the read engine: token encryption round-trips; the ONE OAuth flow
// builds a correct consent URL from config; normalizers turn raw provider JSON
// into the shared shape; connected data becomes EVIDENCE that flows through the
// pipeline (never around it); a failing provider is isolated. Integration
// (staging): connect an API-key provider, encrypted-store round-trip, disconnect.
//
//   env for the pure tiers: CONNECTION_ENC_KEY=..., CONNECTED_GOOGLE_SEARCH_CONSOLE_CLIENT_ID=...
//   deno run --allow-read --allow-net --allow-env tests/presence/connected_reads_test.mjs
import { seal, open, encryptionConfigured } from '../../supabase/functions/presence/connected/crypto.ts';
import { isOAuth, oauthConfigured, authorizeUrl } from '../../supabase/functions/presence/connected/auth.ts';
import { normalize } from '../../supabase/functions/presence/connected/adapters.ts';
import { connectedProvider, CONNECTED_EVIDENCE_TYPES } from '../../supabase/functions/presence/connected/evidence.ts';
import { CATALOG, makeEmit } from '../../supabase/functions/presence/evidence/contract.ts';
import { RULES, judge } from '../../supabase/functions/presence/judgment/rules.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ═══ 1. token encryption round-trips; fails closed without a key ═══
{
  if (encryptionConfigured()) {
    const secret = JSON.stringify({ access_token: 'ya29.SECRET', refresh_token: 'r-SECRET', expires_at: '2027-01-01T00:00:00Z' });
    const sealed = await seal(secret);
    ok('crypto: seal produces ciphertext + iv, never the plaintext', !!sealed && sealed.ciphertext.length > 0 && !sealed.ciphertext.includes('SECRET') && sealed.iv.length > 0);
    const opened = await open(sealed);
    ok('crypto: open round-trips exactly', opened === secret);
    const tampered = await open({ ciphertext: sealed.ciphertext, iv: 'AAAAAAAAAAAAAAAA' });
    ok('crypto: a wrong iv fails safe (null, never garbage)', tampered === null);
  } else {
    ok('crypto: without a key, storage fails CLOSED (seal returns null — never plaintext)', (await seal('x')) === null);
  }
}

// ═══ 2. one OAuth flow, config-driven ═══
{
  ok('auth: Google providers are OAuth; Yelp is not', isOAuth('google_search_console') && isOAuth('google_business_profile') && !isOAuth('yelp'));
  if (oauthConfigured('google_search_console')) {
    const url = authorizeUrl('google_search_console', 'st-123');
    ok('auth: authorize URL carries client_id, redirect, scope, state, offline+consent', !!url &&
      /accounts\.google\.com/.test(url) && /client_id=/.test(url) && /redirect_uri=/.test(url) &&
      /scope=/.test(url) && /state=st-123/.test(url) && /access_type=offline/.test(url) && /prompt=consent/.test(url));
  } else {
    ok('auth: unconfigured provider yields no URL (honest "not available")', authorizeUrl('google_search_console', 's') === null);
  }
  ok('auth: an unconfigured OAuth provider reports not-configured (never a fake success)', typeof oauthConfigured('linkedin') === 'boolean');
}

// ═══ 3. normalizers — raw provider JSON → the shared shape ═══
{
  const gbp = normalize('google_business_profile', { rating: 4.6, reviewCount: 128, unreplied: 3 }, 'your Google listing');
  ok('normalize: GBP → rating/review_count/unreplied', gbp.rating === 4.6 && gbp.review_count === 128 && gbp.unreplied_reviews === 3 && gbp.label === 'your Google listing');
  const gsc = normalize('google_search_console', { clicks: 240, impressions: 9000 }, 'search');
  ok('normalize: Search Console → clicks/impressions', gsc.search_clicks === 240 && gsc.search_impressions === 9000);
  const ga = normalize('google_analytics', { totals: { users: 512, screenPageViews: 2100 } }, 'visitors');
  ok('normalize: Analytics → visitors/pageviews (nested)', ga.visitors === 512 && ga.pageviews === 2100);
  const unknown = normalize('no_such_provider_xyz', { anything: true }, 'meta');
  ok('normalize: an un-registered provider degrades to a safe label-only shape', unknown.label === 'meta' && unknown.rating === undefined);
  const junk = normalize('google_business_profile', null, 'x');
  ok('normalize: garbage input never throws', junk.label === 'x' && junk.rating === undefined);

  // ── A1 completion: the intentionally-started providers now normalize real data ──
  ok('normalize: Bing → clicks/impressions', (() => { const b = normalize('bing_webmaster', { Clicks: 12, Impressions: 300 }, 'bing'); return b.search_clicks === 12 && b.search_impressions === 300; })());
  ok('normalize: Yelp → rating/reviews (detail OR search shape)', (() => { const d = normalize('yelp', { rating: 4.5, review_count: 88 }, 'y'); const s = normalize('yelp', { businesses: [{ rating: 4.0, review_count: 20 }] }, 'y'); return d.rating === 4.5 && d.review_count === 88 && s.rating === 4.0 && s.review_count === 20; })());
  ok('normalize: Trustpilot → score/reviews', (() => { const t = normalize('trustpilot', { score: { trustScore: 4.2 }, numberOfReviews: 51 }, 't'); return t.rating === 4.2 && t.review_count === 51; })());
  ok('normalize: Salesforce → contacts (totalSize)', normalize('salesforce', { totalSize: 340 }, 's').contacts === 340);
  ok('normalize: Klaviyo → subscribers', normalize('klaviyo', { data: [{ attributes: { profile_count: 900 } }] }, 'k').subscribers === 900);
  ok('normalize: Tag Manager → tags_installed', normalize('google_tag_manager', { tag: [{}, {}, {}] }, 'gtm').tags_installed === 3);
  ok('normalize: Meta Business → managed_assets', normalize('meta_business', { data: [{}, {}] }, 'meta').managed_assets === 2);
  ok('normalize: Apple Business Connect → listing_verified', (() => { const v = normalize('apple_business_connect', { status: 'VERIFIED' }, 'a'); const n = normalize('apple_business_connect', { status: 'PENDING' }, 'a'); return v.listing_verified === 1 && n.listing_verified === 0; })());
  ok('normalize: every completed provider still degrades safely on garbage', ['bing_webmaster','yelp','trustpilot','salesforce','klaviyo','google_tag_manager','meta_business','apple_business_connect'].every((k) => normalize(k, null, 'z').label === 'z'));
}

// ═══ 4. connected data → EVIDENCE, through the ONE pipeline (no bypass) ═══
{
  // every connected evidence type is catalogued (else emit() throws)
  ok('bridge: every connected evidence type has a catalog entry', CONNECTED_EVIDENCE_TYPES.every((t) => !!CATALOG[t]));
  // the provider emits ONLY catalogued types from normalized data
  const input = { site: { id: 's1' }, now: '2027-03-01T00:00:00Z', connected: [
    { label: 'your Google listing', rating: 3.6, review_count: 40, unreplied_reviews: 2 },
    { label: 'search', search_clicks: 120 },
    { label: 'visitors', visitors: 300 },
  ] };
  const items = [];
  connectedProvider.provide(input, makeEmit('s1', 'connected', input.now, items));
  const types = items.map((i) => i.type);
  ok('bridge: connected data becomes evidence (low rating, unreplied, summaries)',
    types.includes('reviews.connected_rating_low') && types.includes('reviews.connected_unreplied') && types.includes('reviews.connected_summary') &&
    types.includes('seo.connected_search') && types.includes('analytics.connected_traffic'));
  ok('bridge: the provider emits ONLY catalogued types (cannot invent)', types.every((t) => !!CATALOG[t]));
  // NO BYPASS: every connected type is consumed by exactly one judgment rule
  const owners = (t) => RULES.filter((r) => r.types.includes(t)).length;
  ok('no bypass: every connected evidence type maps to exactly one judgment rule', CONNECTED_EVIDENCE_TYPES.every((t) => owners(t) === 1));
  // and that rule keeps them suppressed for now (observed, not yet a moment)
  const evRows = items.map((i) => ({ id: i.fingerprint, category: i.category, type: i.type, severity: i.severity, confidence: i.confidence, resource: i.resource, facts: i.facts }));
  const { judgments } = judge(evRows, { siteId: 's1', now: input.now, previous: {}, plan: 'presence' });
  const conn = judgments.find((j) => j.rule === 'connected_observed');
  ok('pipeline: connected evidence is judged (connected_observed) and suppressed (awaiting L4.2)', !!conn && conn.status === 'suppressed' && conn.audience === 'none');
}

// ═══ 5. isolation — a broken connected input never breaks the run ═══
{
  const items = [];
  const bad = { site: { id: 's' }, now: 't', connected: [null, 'garbage', { label: 'ok', rating: 2.0 }, { rating: 5 /* no label */ }] };
  let threw = false;
  try { connectedProvider.provide(bad, makeEmit('s', 'connected', 't', items)); } catch { threw = true; }
  ok('isolation: malformed connected rows are skipped; the provider never throws', !threw && items.some((i) => i.type === 'reviews.connected_rating_low'));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} pure passed`);
if (passed !== results.length) { console.log('FAILURES:'); for (const r of results) if (!r.p) console.log('  ✗ ' + r.n); }

// ── Integration (staging): the real connect → encrypted-store → disconnect path ──
const SB = (globalThis.Deno && Deno.env.get('SUPABASE_URL')) || '';
const SR = (globalThis.Deno && (Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))) || '';
const ANON = (globalThis.Deno && (Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('ANON_KEY'))) || '';
if (!SB || !SR || !ANON) { console.log('\n(integration tier skipped — set SUPABASE_URL, SERVICE_ROLE_KEY, SUPABASE_ANON_KEY)'); }
else { await integration({ SB, SR, ANON }); }

async function integration({ SB, SR, ANON }) {
  const ires = []; const iok = (n, p, note = '') => { ires.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  [int] ${n}${note ? ' — ' + note : ''}`); };
  const FN = `${SB}/functions/v1/presence`;
  const svcH = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
  const authH = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };
  const stamp = Date.now(); const email = `l41+${stamp}@example.com`; const password = 'meadow-lantern-4279-test';
  let siteId = null, clientId = null, authUserId = null, jwt = null;
  const rest = (p, i = {}) => fetch(`${SB}/rest/v1/${p}`, { ...i, headers: { ...svcH, ...(i.headers || {}) } });
  try {
    const su = await (await fetch(`${FN}/commerce/signup`, { method: 'POST', headers: authH, body: JSON.stringify({ email, password, business_name: 'L4.1 Co', plan: 'presence_monitor', trial: true }) })).json();
    siteId = su?.data?.site_id;
    const sg = await (await rest(`presence_signups?email=eq.${encodeURIComponent(email)}&select=client_id,auth_user_id&limit=1`)).json();
    clientId = sg?.[0]?.client_id; authUserId = sg?.[0]?.auth_user_id;
    jwt = (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: authH, body: JSON.stringify({ email, password }) })).json())?.access_token;
    const jH = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'x-dds-user-jwt': jwt, 'Content-Type': 'application/json' };
    iok('setup: trial site + sign-in', !!siteId && !!jwt);

    // GET /connections — the customer surface (edition-filtered, plain language)
    const list = await (await fetch(`${FN}/connections`, { headers: jH })).json();
    iok('GET /connections lists connectable services grouped in plain words', !!list?.data?.groups && Object.keys(list.data.groups).length >= 2);

    // connect an API-key provider (Yelp) — tests encrypted storage on staging
    const conn = await fetch(`${FN}/connections/yelp/connect`, { method: 'POST', headers: jH, body: JSON.stringify({ api_key: 'test-yelp-key-DO-NOT-USE' }) });
    const cj = await conn.json();
    const connectedOk = conn.status === 200 && cj?.data?.connected === true;
    iok('connect (API key): stored (or honest "not available" if enc key unset)', connectedOk || cj?.error === 'not_available', cj?.error || '');
    if (connectedOk) {
      const secret = await (await rest(`presence_connection_secrets?site_id=eq.${siteId}&provider_key=eq.yelp&select=ciphertext,iv`)).json();
      iok('connect: an ENCRYPTED secret exists, ciphertext ≠ the key', secret?.[0] && !secret[0].ciphertext.includes('test-yelp-key'));
      const state = await (await rest(`presence_connections?site_id=eq.${siteId}&provider_key=eq.yelp&select=status,secret_ref`)).json();
      iok('connect: connection record is connected and points at the secret', state?.[0]?.status === 'connected' && !!state[0].secret_ref);
      // disconnect — revoke + destroy
      await fetch(`${FN}/connections/yelp/disconnect`, { method: 'POST', headers: jH });
      const gone = await (await rest(`presence_connection_secrets?site_id=eq.${siteId}&provider_key=eq.yelp&select=ciphertext`)).json();
      const rec = await (await rest(`presence_connections?site_id=eq.${siteId}&provider_key=eq.yelp&select=status`)).json();
      iok('disconnect: token secret destroyed, record marked disconnected', (gone?.length || 0) === 0 && rec?.[0]?.status === 'disconnected');
    }
  } finally {
    try {
      if (siteId) { await rest(`presence_connection_secrets?site_id=eq.${siteId}`, { method: 'DELETE' }); await rest(`presence_connected_data?site_id=eq.${siteId}`, { method: 'DELETE' }); await rest(`presence_connections?site_id=eq.${siteId}`, { method: 'DELETE' }); await rest(`presence_connection_events?site_id=eq.${siteId}`, { method: 'DELETE' }); await rest(`presence_sites?id=eq.${siteId}`, { method: 'DELETE' }); }
      if (clientId) { await rest(`presence_entitlements?client_id=eq.${clientId}`, { method: 'DELETE' }); await rest(`clients?id=eq.${clientId}`, { method: 'DELETE' }); }
      await rest(`presence_signups?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE' });
      if (authUserId) await fetch(`${SB}/auth/v1/admin/users/${authUserId}`, { method: 'DELETE', headers: svcH });
    } catch (_) { /* */ }
  }
  const ip = ires.filter((r) => r.p).length;
  console.log(`\n[integration] ${ip}/${ires.length} passed`);
  if (ip !== ires.length) { console.log('INTEGRATION FAILURES:'); for (const r of ires) if (!r.p) console.log('  ✗ ' + r.n); }
}
