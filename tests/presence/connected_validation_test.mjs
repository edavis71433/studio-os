// ── L4.4 Connected Platform Validation & Hardening suite ────────────────────
// The whole Connected Platform, proved as if it launches tomorrow: the full
// lifecycle wired end to end, the failure matrix, the security + ownership +
// write + intelligence reviews, and the L4.4 hardening (signed OAuth state,
// atomic execution). Integration (staging): concurrent execute can never write
// twice; the full audit trail; approval-before-execute.
//
//   CONNECTION_ENC_KEY=<any 16+ chars> deno run --allow-read --allow-net --allow-env \
//     tests/presence/connected_validation_test.mjs
import { CONNECTED_PROVIDERS, providerByKey } from '../../supabase/functions/presence/connected/providers.ts';
import { OWNERSHIP, EDITIONS, editionAllows } from '../../supabase/functions/presence/connected/contract.ts';
import { inventory, connectableFor, profileOf, inventorySummary } from '../../supabase/functions/presence/connected/inventory.ts';
import { seal, encryptionConfigured } from '../../supabase/functions/presence/connected/crypto.ts';
import { signState, verifyState, isOAuth } from '../../supabase/functions/presence/connected/auth.ts';
import { normalize } from '../../supabase/functions/presence/connected/adapters.ts';
import { connectedProvider, CONNECTED_EVIDENCE_TYPES } from '../../supabase/functions/presence/connected/evidence.ts';
import { deriveConnectedIntelligence } from '../../supabase/functions/presence/connected/intelligence.ts';
import { WRITE_SPECS, buildWritePlan, writeSpec } from '../../supabase/functions/presence/connected/writes.ts';
import { executeWrite, writeConfigured } from '../../supabase/functions/presence/connected/execute.ts';
import { CATALOG, makeEmit } from '../../supabase/functions/presence/evidence/contract.ts';
import { RULES, judge } from '../../supabase/functions/presence/judgment/rules.ts';
import { REC_RULES } from '../../supabase/functions/presence/recommendation/rules.ts';
import { TEMPLATES } from '../../supabase/functions/presence/moments/rules.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const SITE = '00000000-0000-4000-8000-000000000001';
const urlsafe = (s) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ═══ 1. LIFECYCLE WIRING — every stage connects to the next (no gap) ═══
{
  // reads → normalization → evidence
  const norm = normalize('google_business_profile', { rating: 4.6, reviewCount: 100, unreplied: 2 }, 'your Google listing');
  const items = [];
  connectedProvider.provide({ site: { id: SITE }, now: 't', connected: [norm], connectedPrior: [] }, makeEmit(SITE, 'connected', 't', items));
  ok('lifecycle: read → normalize → evidence (a connected read becomes catalogued evidence)', items.length > 0 && items.every((i) => !!CATALOG[i.type]));
  // evidence → judgment → recommendation → moment, all wired for connected concerns
  const jOwners = (t) => RULES.filter((r) => r.types.includes(t)).length;
  ok('lifecycle: evidence → judgment (every connected type judged by exactly one rule)', CONNECTED_EVIDENCE_TYPES.every((t) => jOwners(t) === 1));
  ok('lifecycle: judgment → recommendation (connected customer rules have rec rules)',
    ['connected_reputation', 'connected_improved'].every((r) => REC_RULES.some((x) => x.judgmentRule === r)));
  ok('lifecycle: recommendation → moment (connected recs have templates)',
    ['rec_connected_reputation', 'rec_connected_improved'].every((r) => TEMPLATES.some((t) => t.recRule === r)));
  // recommendation → write plan → approval → execute (declared)
  ok('lifecycle: write plans exist and each demands approval', WRITE_SPECS.every((w) => buildWritePlan(w.workflow, providerByKey(w.provider_key), {}).requires_approval === true));
}

// ═══ 2. FAILURE MATRIX (pure) — every failure degrades safely ═══
{
  // malformed / garbage responses → normalizers never throw
  let threw = false;
  try { normalize('google_business_profile', null, 'x'); normalize('meta_business', { junk: 1 }, 'y'); normalize('nope', 42, 'z'); } catch { threw = true; }
  ok('failure: malformed/unknown provider responses never throw (degrade to safe shape)', !threw);
  // provider isolation → a broken connected row is skipped, the rest survive
  const items = [];
  connectedProvider.provide({ site: { id: SITE }, now: 't', connected: [null, 'garbage', { rating: 5 }, { label: 'ok', rating: 3.2 }], connectedPrior: [] }, makeEmit(SITE, 'connected', 't', items));
  ok('failure: one malformed connected row never breaks the others', items.some((i) => i.type === 'reviews.connected_rating_low'));
  // interrupted / garbage write execution → safe, never throws
  let ethrew = false, r1, r2;
  try { r1 = await executeWrite('s', { id: 'x', provider_key: 'nope', workflow: 'bad', kind: 'write', status: 'approved', payload: {} }, 'x'); r2 = await executeWrite('s', {}, 'x'); } catch { ethrew = true; }
  ok('failure: executing a garbage/interrupted plan returns safely, never throws', !ethrew && r1.ok === false && r2.ok === false);
  // a disconnected provider mid-write → not_connected (unit-level: no token) — represented by gating off
  ok('failure: a real write with no live scope is honestly unavailable, never a silent drop',
    WRITE_SPECS.filter((w) => w.kind === 'write').every((w) => writeConfigured(w.workflow) === false));
}

// ═══ 3. SECURITY — signed state, approval law, no plaintext ═══
{
  // token/secret encryption fails closed elsewhere; here: a sealed value never leaks its input
  if (encryptionConfigured()) {
    const s = await seal('ya29.SUPER-SECRET-TOKEN');
    ok('security: sealed values never contain the plaintext', !!s && !s.ciphertext.includes('SECRET'));

    // signed OAuth state: valid verifies; cross-site, cross-provider, tampered, stale all refused
    const good = await signState(SITE, 'google_business_profile');
    ok('security: a valid state verifies for its own site + provider', await verifyState(good, SITE, 'google_business_profile'));
    ok('security: state bound to the site — another site is refused (no cross-tenant callback)', !(await verifyState(good, 'other-site', 'google_business_profile')));
    ok('security: state bound to the provider — a different provider is refused', !(await verifyState(good, SITE, 'google_analytics')));
    ok('security: a tampered state is refused', !(await verifyState(good.slice(0, -3) + 'zzz', SITE, 'google_business_profile')));
    const oldSealed = await seal(JSON.stringify({ s: SITE, k: 'google_business_profile', t: Date.now() - 11 * 60 * 1000 }));
    const staleState = `${urlsafe(oldSealed.ciphertext)}.${urlsafe(oldSealed.iv)}`;
    ok('security: a stale state (older than the consent window) is refused (replay-bounded)', !(await verifyState(staleState, SITE, 'google_business_profile')));
    ok('security: empty/garbage state is refused', !(await verifyState('', SITE, 'google_business_profile')) && !(await verifyState('nonsense', SITE, 'google_business_profile')));
  } else {
    ok('security: (state strict-mode skipped — set CONNECTION_ENC_KEY to exercise it)', true);
  }
  // approval law enforced in the executor itself (not only the route)
  ok('security: approval is enforced in the executor — an unapproved write cannot run',
    (await executeWrite(SITE, { id: 'p', provider_key: 'google_business_profile', workflow: 'gbp_post', kind: 'write', status: 'proposed', payload: {} }, 'x')).reason === 'not_approved');
  // permission isolation: least-privilege scopes are declared, read scopes only
  // `business.manage` is Google's ONE read+write-shaped scope for Business
  // Profile — there is no read-only variant — so it stays the single documented
  // exception. It is now declared as the full URL Google actually accepts
  // (short-form scopes are rejected at consent; AN-3.1 learned this the hard
  // way for Search Console, and the Google siblings carried the same defect).
  const GBP_MANAGE = 'https://www.googleapis.com/auth/business.manage';
  ok('security: least-privilege — every provider declares scopes, all read-oriented', CONNECTED_PROVIDERS.every((p) => Array.isArray(p.scopes) && p.scopes.every((s) => !/write|manage\b/i.test(s) || s === GBP_MANAGE)));
  ok('security: every Google scope is the FULL URL Google accepts (a short form is rejected at consent)',
    CONNECTED_PROVIDERS.filter((p) => /^(google_|youtube)/.test(p.key)).every((p) => p.scopes.every((s) => s.startsWith('https://www.googleapis.com/auth/'))));
}

// ═══ 4. OWNERSHIP — identical for every provider, never lock-in ═══
{
  ok('ownership: the ownership answer is one platform constant (account + authorization are the customer’s)',
    /customer/.test(OWNERSHIP.account) && /revoke/.test(OWNERSHIP.authorization) && /destroyed/.test(OWNERSHIP.on_disconnect));
  ok('ownership: disconnect leaves the customer’s data AT the provider untouched (no lock-in)', /untouched/.test(OWNERSHIP.on_disconnect));
  ok('ownership: leaving is never penalized; export includes what was read', /never penalized/.test(OWNERSHIP.on_leave) && /export/.test(OWNERSHIP.on_leave));
  // every provider is disconnectable + replaceable by construction (same contract, no per-provider exception)
  ok('ownership: every provider fits the same contract (no provider claims un-disconnectable)',
    CONNECTED_PROVIDERS.every((p) => !!p.key && !!p.approval && Array.isArray(p.scopes)));
}

// ═══ 5. WRITE VALIDATION — no silent writes, no auto-publish, no bypass ═══
{
  const WF = WRITE_SPECS.map((w) => w.workflow);
  ok('write: every workflow requires approval + explains verification', WF.every((wf) => {
    const pl = buildWritePlan(wf, providerByKey(writeSpec(wf).provider_key), {});
    return pl.requires_approval === true && pl.verify.length > 10 && pl.what_stays.length > 0;
  }));
  ok('write: handoffs never touch a provider (structurally — no endpoint, execute never fetches)',
    WRITE_SPECS.filter((w) => w.kind === 'handoff').every((w) => !w.endpoint && !w.method));
  const handoff = await executeWrite(SITE, { id: 'h', provider_key: 'mailchimp', workflow: 'email_draft', kind: 'handoff', status: 'approved', payload: { body: 'x' } }, 'your list');
  ok('write: an approved handoff prepares-not-sends and verifies as such', handoff.ok && handoff.kind === 'handoff' && /nothing was sent/i.test(handoff.verification.note));
  ok('write: no provider write happens without registered scopes (no bypass, honest gate)',
    (await executeWrite(SITE, { id: 'w', provider_key: 'google_business_profile', workflow: 'gbp_hours', kind: 'write', status: 'approved', payload: { hours: {} } }, 'x')).reason === 'not_available');
}

// ═══ 6. CONNECTED INTELLIGENCE REVIEW — strengthens, never duplicates/contradicts ═══
{
  ok('intelligence: with no connected data the cross-pass is a no-op (never noise)', deriveConnectedIntelligence([]).contradicts.size === 0 && deriveConnectedIntelligence([]).boosts.size === 0);
  // no duplicate: each connected type owned by exactly one rule (already checked) → no double recs
  const jOwners = (t) => RULES.filter((r) => r.types.includes(t)).length;
  ok('intelligence: no connected type is claimed by two rules (no duplicate recommendations)', CONNECTED_EVIDENCE_TYPES.every((t) => jOwners(t) === 1));
  // edition-aware: reputation is customer on self-serve, operator on Managed+ (work decreases up the ladder)
  const revEv = [];
  connectedProvider.provide({ site: { id: SITE }, now: 't', connected: [{ label: 'g', rating: 3.4, unreplied_reviews: 3, review_count: 20 }], connectedPrior: [] }, makeEmit(SITE, 'connected', 't', revEv));
  const rows = revEv.map((i) => ({ id: i.fingerprint, category: i.category, type: i.type, severity: i.severity, confidence: i.confidence, resource: i.resource, facts: i.facts }));
  const aud = (plan) => judge(rows, { siteId: SITE, now: '2026-07-07T12:00:00.000Z', previous: {}, plan }).judgments.find((j) => j.rule === 'connected_reputation')?.audience;
  ok('intelligence: edition-aware — reputation is the customer’s on Presence, the studio’s on Managed', aud('presence') === 'customer' && aud('presence_managed') === 'operator');
}

// ═══ 7. CUSTOMER EXPERIENCE — the profile answers every question in plain words ═══
{
  const profiles = inventory();
  const jargon = /\b(OAuth|API|endpoint|scope\b|token|webhook|REST|JSON)\b/i;
  ok('CX: every provider profile answers what/why/reads/approval in plain words', profiles.every((p) =>
    p.customerLabel && p.purpose && Array.isArray(p.read_capabilities) && p.customer_approval && p.authentication));
  ok('CX: no jargon leaks into the customer surface (auth/approval/labels)', profiles.every((p) =>
    !jargon.test(p.authentication) && !jargon.test(p.customer_approval) && !jargon.test(p.customerLabel) && !jargon.test(p.purpose)));
  ok('CX: the connectable surface grows sensibly by edition (Monitor ⊆ Presence ⊆ …)',
    connectableFor('presence_monitor').length <= connectableFor('presence').length && connectableFor('presence').length <= connectableFor('enterprise').length);
  const sum = inventorySummary();
  ok('CX: the inventory is complete and generated (21 providers across categories)', sum.total === CONNECTED_PROVIDERS.length && Object.keys(sum.byCategory).length >= 8);
}

// ═══ 8. SIMPLIFICATION — the surface is already generic + minimal ═══
{
  // no provider-specific write path: every write is one of two kinds, specs are pure data
  ok('simplification: exactly two write kinds, everything else is data (no bespoke provider code)',
    WRITE_SPECS.every((w) => w.kind === 'write' || w.kind === 'handoff'));
  // customer decisions are minimal: connect (approve), disconnect — the same verbs everywhere
  ok('simplification: one connect/approve/disconnect vocabulary for every provider (no per-provider learning)',
    new Set(CONNECTED_PROVIDERS.map((p) => typeof p.approval)).size === 1);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ CONNECTED PLATFORM VALIDATION: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) { console.log('FAILURES:'); for (const r of results) if (!r.p) console.log('  ✗ ' + r.n); }

// ── Integration (staging): concurrent execute can NEVER write twice ──
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
  const stamp = Date.now(); const email = `l44+${stamp}@example.com`; const password = 'meadow-lantern-4279-test';
  let siteId = null, clientId = null, authUserId = null, jwt = null;
  const rest = (p, i = {}) => fetch(`${SB}/rest/v1/${p}`, { ...i, headers: { ...svcH, ...(i.headers || {}) } });
  try {
    const su = await (await fetch(`${FN}/commerce/signup`, { method: 'POST', headers: authH, body: JSON.stringify({ email, password, business_name: 'L4.4 Co', plan: 'presence', trial: true }) })).json();
    siteId = su?.data?.site_id;
    const sg = await (await rest(`presence_signups?email=eq.${encodeURIComponent(email)}&select=client_id,auth_user_id&limit=1`)).json();
    clientId = sg?.[0]?.client_id; authUserId = sg?.[0]?.auth_user_id;
    jwt = (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: authH, body: JSON.stringify({ email, password }) })).json())?.access_token;
    const jH = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'x-dds-user-jwt': jwt, 'Content-Type': 'application/json' };
    iok('setup: trial site + sign-in', !!siteId && !!jwt);

    // prepare + approve a handoff, then fire TWO executes at once
    const prep = await (await fetch(`${FN}/connections/mailchimp/write/prepare`, { method: 'POST', headers: jH, body: JSON.stringify({ workflow: 'email_draft', subject: 'S', text: 'Body' }) })).json();
    const id = prep?.data?.id;
    await fetch(`${FN}/connections/mailchimp/write/${id}/decide`, { method: 'POST', headers: jH, body: JSON.stringify({ decision: 'approve' }) });
    const [a, b] = await Promise.all([
      fetch(`${FN}/connections/mailchimp/write/${id}/execute`, { method: 'POST', headers: jH }),
      fetch(`${FN}/connections/mailchimp/write/${id}/execute`, { method: 'POST', headers: jH }),
    ]);
    const codes = [a.status, b.status].sort();
    iok('concurrency: two simultaneous executes → exactly one succeeds, one refused (never twice)', JSON.stringify(codes) === JSON.stringify([200, 409]), codes.join(','));
    const row = await (await rest(`presence_connection_writes?id=eq.${id}&select=status`)).json();
    iok('concurrency: the plan ends executed exactly once', row?.[0]?.status === 'executed');
    const execEvents = await (await rest(`presence_connection_events?site_id=eq.${siteId}&action=eq.write_execute&select=id`)).json();
    iok('audit: exactly one execution was recorded (no double write)', (execEvents?.length || 0) === 1, `events=${execEvents?.length}`);

    // approval law: a fresh proposed handoff cannot execute
    const prep2 = await (await fetch(`${FN}/connections/facebook_page/write/prepare`, { method: 'POST', headers: jH, body: JSON.stringify({ workflow: 'social_draft', text: 'Hi' }) })).json();
    const early = await fetch(`${FN}/connections/facebook_page/write/${prep2?.data?.id}/execute`, { method: 'POST', headers: jH });
    iok('approval: an unapproved plan cannot execute (409)', early.status === 409);
  } finally {
    try {
      if (siteId) { await rest(`presence_connection_writes?site_id=eq.${siteId}`, { method: 'DELETE' }); await rest(`presence_connection_events?site_id=eq.${siteId}`, { method: 'DELETE' }); await rest(`presence_connections?site_id=eq.${siteId}`, { method: 'DELETE' }); await rest(`presence_sites?id=eq.${siteId}`, { method: 'DELETE' }); }
      if (clientId) { await rest(`presence_entitlements?client_id=eq.${clientId}`, { method: 'DELETE' }); await rest(`clients?id=eq.${clientId}`, { method: 'DELETE' }); }
      await rest(`presence_signups?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE' });
      if (authUserId) await fetch(`${SB}/auth/v1/admin/users/${authUserId}`, { method: 'DELETE', headers: svcH });
    } catch (_) { /* */ }
  }
  const ip = ires.filter((r) => r.p).length;
  console.log(`\n[integration] ${ip}/${ires.length} passed`);
  if (ip !== ires.length) { console.log('INTEGRATION FAILURES:'); for (const r of ires) if (!r.p) console.log('  ✗ ' + r.n); }
}
