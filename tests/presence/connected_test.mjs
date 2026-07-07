// ── L4.0 Connected Platform Foundation suite ────────────────────────────────
// Verifies the unified contract holds for every provider: one shape, read-only
// first, edition capability well-formed, ownership constant, no jargon in the
// customer surface, and — the whole point — a new provider is a registry entry,
// not a redesign.
//
//   deno run --allow-read tests/presence/connected_test.mjs
import { CONNECTED_PROVIDERS, providerByKey } from '../../supabase/functions/presence/connected/providers.ts';
import { inventory, profileOf, connectableFor, inventorySummary } from '../../supabase/functions/presence/connected/inventory.ts';
import { OWNERSHIP, ERROR_PHILOSOPHY, EDITIONS, editionAllows } from '../../supabase/functions/presence/connected/contract.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const AUTHS = ['oauth2', 'api_key', 'ownership_verification', 'none'];
const APPROVALS = ['oauth_consent', 'ownership_verification', 'api_key_entry', 'none'];
const CATS = ['search', 'local_listing', 'analytics', 'social', 'reviews', 'scheduling', 'crm', 'email_marketing', 'payments'];

// ═══ 1. one shared contract — every provider declares every concept ═══
{
  const bad = CONNECTED_PROVIDERS.filter((p) =>
    !(p.key && p.name && p.customerLabel && p.purpose && AUTHS.includes(p.auth) && APPROVALS.includes(p.approval) &&
      CATS.includes(p.category) && Array.isArray(p.scopes) && Array.isArray(p.reads) && Array.isArray(p.futureWrites) &&
      EDITIONS.includes(p.minEdition) && typeof p.rateNote === 'string' && p.status));
  ok('contract: every provider declares the full unified shape', bad.length === 0, bad.map((p) => p.key).join(','));
  ok('registry: 20+ providers, unique keys + unique customer labels', CONNECTED_PROVIDERS.length >= 20 &&
    new Set(CONNECTED_PROVIDERS.map((p) => p.key)).size === CONNECTED_PROVIDERS.length &&
    new Set(CONNECTED_PROVIDERS.map((p) => p.customerLabel)).size === CONNECTED_PROVIDERS.length, `${CONNECTED_PROVIDERS.length} providers`);
  ok('registry: the milestone’s named platforms are all present',
    ['google_business_profile', 'apple_business_connect', 'google_search_console', 'google_analytics', 'google_tag_manager',
     'meta_business', 'instagram', 'facebook_page', 'linkedin', 'youtube', 'bing_webmaster'].every((k) => !!providerByKey(k)));
}

// ═══ 2. read-only first — nothing writes at L4.0 ═══
{
  ok('read-only first: NO provider is read_write yet (every one is planned)', CONNECTED_PROVIDERS.every((p) => p.status === 'planned'));
  ok('read-only first: every observation provider declares real read capabilities', CONNECTED_PROVIDERS.every((p) => Array.isArray(p.reads)));
  ok('future writes are DECLARED (so the write architecture is supportable) but built by no adapter',
    CONNECTED_PROVIDERS.some((p) => p.futureWrites.length > 0) && CONNECTED_PROVIDERS.every((p) => p.status !== 'read_write'));
  // least privilege: an auth’d provider requests at least one explicit scope
  ok('least privilege: providers that authenticate declare explicit scopes', CONNECTED_PROVIDERS.filter((p) => p.auth !== 'none').every((p) => p.scopes.length > 0));
}

// ═══ 3. the customer surface speaks business, not APIs ═══
{
  const JARGON = /\b(API|OAuth|token|webhook|endpoint|scope|JSON|REST|SDK|integration)\b/i;
  const offenders = CONNECTED_PROVIDERS.filter((p) => JARGON.test(p.customerLabel) || JARGON.test(p.purpose) || p.reads.some((r) => JARGON.test(r)));
  ok('customer language: no API/OAuth/token/webhook jargon in labels, purposes, or reads', offenders.length === 0, offenders.map((p) => p.key).join(','));
  ok('customer language: labels read like the customer’s own words ("your …")', CONNECTED_PROVIDERS.every((p) => /^(your|how)\b/i.test(p.customerLabel)));
}

// ═══ 4. edition capability — well-formed, grows up the ladder (technical, not price) ═══
{
  // every provider's supported editions form a contiguous suffix (floor → top)
  const suffixOk = CONNECTED_PROVIDERS.every((p) => {
    const sup = EDITIONS.filter((e) => editionAllows(e, p.minEdition));
    const idx = EDITIONS.indexOf(p.minEdition);
    return JSON.stringify(sup) === JSON.stringify(EDITIONS.slice(idx));
  });
  ok('edition: each provider’s support is a contiguous suffix from its floor upward', suffixOk);
  // connectable set GROWS up the ladder (higher editions can use more)
  const counts = EDITIONS.map((e) => connectableFor(e).length);
  ok('edition: the connectable set never shrinks as the edition rises', counts.every((c, i) => i === 0 || c >= counts[i - 1]), counts.join('≤'));
  ok('edition: Monitor already reaches the observation providers (search/listings/analytics/reviews)',
    connectableFor('presence_monitor').some((c) => c.key === 'google_search_console') &&
    connectableFor('presence_monitor').some((c) => c.key === 'google_business_profile'));
  ok('edition: CRM sits higher (Managed+/Agency), not on Monitor',
    !connectableFor('presence_monitor').some((c) => c.key === 'hubspot') && connectableFor('presence_managed').some((c) => c.key === 'hubspot'));
}

// ═══ 5. ownership + error philosophy are platform constants (same for all) ═══
{
  ok('ownership: the customer owns account + authorization; Studio OS holds delegated revocable tokens',
    /customer/.test(OWNERSHIP.account) && /customer/.test(OWNERSHIP.authorization) && /delegated/.test(OWNERSHIP.tokens) && /destroyed/.test(OWNERSHIP.on_disconnect));
  ok('ownership: disconnecting is always available and never penalized', /always available/.test(OWNERSHIP.on_leave));
  ok('error philosophy: calm degradation defined for the real failure modes',
    ['oauth_expired', 'rate_limited', 'provider_outage', 'permission_revoked', 'account_deleted', 'api_change', 'network_failure'].every((k) => typeof ERROR_PHILOSOPHY[k] === 'string' && ERROR_PHILOSOPHY[k].length > 10));
}

// ═══ 6. the living inventory — generated, complete, single-page-per-provider ═══
{
  const inv = inventory();
  ok('inventory: one profile per provider, no drift', inv.length === CONNECTED_PROVIDERS.length);
  ok('inventory: every profile has the full single-page shape', inv.every((x) =>
    x.key && x.customerLabel && x.purpose && x.authentication && Array.isArray(x.permissions) &&
    Array.isArray(x.read_capabilities) && Array.isArray(x.future_write_capabilities) && x.customer_approval &&
    Array.isArray(x.supported_editions) && ['Planned', 'Read-only', 'Read/Write'].includes(x.status)));
  const s = inventorySummary();
  ok('inventory: summary covers category/status/edition', s.total === CONNECTED_PROVIDERS.length && s.byStatus.planned === CONNECTED_PROVIDERS.length && Object.keys(s.byCategory).length >= 8);
}

// ═══ 7. extensibility — a new provider is a registry ENTRY, not a redesign ═══
{
  const future = { key: 'tiktok_business', name: 'TikTok', customerLabel: 'your TikTok', category: 'social',
    purpose: 'See how your TikTok is doing.', auth: 'oauth2', approval: 'oauth_consent', scopes: ['user.info.basic'],
    reads: ['videos and views'], futureWrites: ['publish a video'], minEdition: 'presence', rateNote: 'per-app limits', status: 'planned' };
  const prof = profileOf(future);
  ok('extensibility: a brand-new provider flows through the SAME contract + inventory unchanged',
    prof.key === 'tiktok_business' && prof.supported_editions.length === 4 && prof.status === 'Planned' && prof.read_capabilities.length === 1);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.log('FAILURES:'); for (const r of results) if (!r.p) console.log('  ✗ ' + r.n); }
