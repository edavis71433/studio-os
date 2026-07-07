// ── L5.6 Enterprise & Multi-Location Foundation suite ───────────────────────
// Proves one org owns many locations with inheritance (org→region→location, only
// differences stored), Industry Packs work automatically for chains, org-wide
// changes are Approved Plans (frozen spine), the pipeline stays unified (no engine
// change), and it scales to 1000 locations. Integration (staging): the live
// data-layer + gating.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/enterprise_test.mjs
import { resolveConfig, mergeLayer, diffFromParent, aggregateLocations } from '../../supabase/functions/presence/enterprise/inheritance.ts';
import { planOrgOperation } from '../../supabase/functions/presence/enterprise/rollout.ts';
import { ORG_OPS } from '../../supabase/functions/presence/enterprise/contract.ts';
import { composePack, resolveIndustryKey } from '../../supabase/functions/presence/industry/registry.ts';
import '../../supabase/functions/presence/industry/compose.ts'; // side effect: registers restaurant/coffee/home/pet packs

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const src = (rel) => Deno.readTextFileSync(new URL(`../../supabase/functions/presence/${rel}`, import.meta.url));
const mig = (rel) => Deno.readTextFileSync(new URL(`../../supabase/migrations/${rel}`, import.meta.url));

const ORG = { brand: { name: 'Acme', palette: 'navy', logo: 'acme.svg' }, voice: 'warm', industry: 'restaurant', compliance: ['allergens'], connected: { providers: ['google_business_profile'] }, cms: { navigation: ['Home', 'Menu'] } };

// ═══ 1. INHERITANCE — a location inherits everything by default ═══
{
  const loc = resolveConfig(ORG, null, null);
  ok('inherit: a location with no overrides IS the organization defaults', JSON.stringify(loc) === JSON.stringify(ORG));
  const over = resolveConfig(ORG, null, { brand: { palette: 'red' } });
  ok('inherit: a location overrides only what it sets (palette red), inherits the rest', over.brand.palette === 'red' && over.brand.name === 'Acme' && over.voice === 'warm' && over.industry === 'restaurant');
  ok('inherit: a deep override does not wipe sibling fields (logo survives)', over.brand.logo === 'acme.svg');
}

// ═══ 2. REGION TIER — org → region → location ═══
{
  const region = { voice: 'lively', cms: { navigation: ['Home', 'Menu', 'Events'] } };
  const location = { brand: { palette: 'gold' } };
  const r = resolveConfig(ORG, region, location);
  ok('region: region overrides org (voice lively) and location overrides both (palette gold)', r.voice === 'lively' && r.brand.palette === 'gold');
  ok('region: an array override replaces (region nav wins over org nav)', JSON.stringify(r.cms.navigation) === JSON.stringify(['Home', 'Menu', 'Events']));
  ok('region: unset-at-region still inherits from org (industry restaurant)', r.industry === 'restaurant');
}

// ═══ 3. ONLY DIFFERENCES STORED ═══
{
  const full = resolveConfig(ORG, null, { brand: { palette: 'red' }, voice: 'warm' });
  const diff = diffFromParent(ORG, full);
  ok('diff: only the genuinely-overridden fields are reported (palette), not the inherited same-value ones (voice)',
    JSON.stringify(diff) === JSON.stringify({ brand: { palette: 'red' } }));
  ok('mergeLayer: pure — neither parent nor child is mutated', (() => { const p = { a: { b: 1 } }; const c = { a: { d: 2 } }; const m = mergeLayer(p, c); return p.a.b === 1 && !('d' in p.a) && m.a.b === 1 && m.a.d === 2; })());
}

// ═══ 4. INDUSTRY PACK AUTOMATIC — a chain behaves like one business ═══
{
  const loc = resolveConfig(ORG, null, null);
  ok('industry: every location inherits the org’s Industry Pack (restaurant)', loc.industry === 'restaurant');
  // the SAME pack, no chain-specific pack — a restaurant chain composes exactly like one restaurant
  ok('industry: a restaurant chain uses the one restaurant pack (no pack change)', composePack('restaurant').key === 'restaurant' && resolveIndustryKey('restaurant-classic') === 'restaurant');
  // a coffee-shop chain inherits coffee_shop (which itself extends restaurant) — inheritance stacks
  ok('industry: a coffee-shop chain inherits coffee_shop → restaurant (extends still works)', composePack('coffee_shop').cms.pages.includes('menu'));
}

// ═══ 5. ORG-WIDE CHANGE IS AN APPROVED PLAN (frozen spine) ═══
{
  const plan = planOrgOperation('brand_update', 'org-1', ['s1', 's2', 's3']);
  ok('plan: an org change carries the shared ApprovedPlanBase (title/summary/risk/reversible/approval)',
    !!plan.title && !!plan.summary && !!plan.risk && plan.reversible === true && plan.requires_approval === true);
  ok('plan: it says what changes AND that customer content + overrides are untouched',
    plan.what_changes.length > 0 && plan.what_stays.some((s) => /content/i.test(s)) && plan.what_stays.some((s) => /override/i.test(s)));
  ok('ops: all org operations exist (brand/hours/connected/industry/location_rollout/template_rollout)',
    JSON.stringify([...ORG_OPS].sort()) === JSON.stringify(['brand_update', 'connected_update', 'hours_update', 'industry_update', 'location_rollout', 'template_rollout']));
}

// ═══ 6. UNIFIED PIPELINE — no engine change, cross-location is a READ rollup ═══
{
  const signals = [
    { site_id: 'a', name: 'Downtown', active_moments: 3, needs_attention: 1 },
    { site_id: 'b', name: 'Airport', active_moments: 0, needs_attention: 0 },
    { site_id: 'c', name: 'Mall', active_moments: 1, needs_attention: 0 },
  ];
  const rollup = aggregateLocations(signals);
  ok('unified: the org rollup aggregates per-location pipeline output (no engine change)', rollup.locations === 3 && rollup.total_active_moments === 4 && rollup.calmest === 'Airport' && rollup.busiest === 'Downtown');
  ok('no-engine: the enterprise module imports NO pipeline engine (evidence/judgment/…)',
    !/from '\.\.\/(evidence|judgment|recommendation|moments|concierge)\//.test(src('enterprise/inheritance.ts') + src('enterprise/rollout.ts') + src('enterprise/store.ts')));
}

// ═══ 7. USES THE FROZEN APPROVED-PLAN SPINE ═══
{
  const store = src('enterprise/store.ts');
  ok('spine: the enterprise store reuses decidePlan + claimApprovedPlan', /from '\.\.\/lib\/approved_plan\.ts'/.test(store) && /decidePlan/.test(store) && /claimApprovedPlan/.test(store));
  ok('spine: org operations enforce requires_approval as a DB CHECK', /requires_approval boolean not null default true check \(requires_approval = true\)/.test(mig('0043_presence_enterprise.sql')));
  ok('spine: execute enforces approval before running', /status !== 'approved'/.test(src('routes/enterprise.ts')) && /not_approved/.test(src('routes/enterprise.ts')));
}

// ═══ 8. SECURITY / ISOLATION — locations don't leak into each other ═══
{
  const a = resolveConfig(ORG, null, { brand: { palette: 'red' } });
  const b = resolveConfig(ORG, null, { brand: { palette: 'blue' } });
  ok('isolation: two locations resolve independently (one override never affects a sibling)', a.brand.palette === 'red' && b.brand.palette === 'blue' && ORG.brand.palette === 'navy');
  const overrider = resolveConfig(ORG, null, { voice: 'quirky' });
  const patched = mergeLayer(ORG, { voice: 'formal' });                     // an org-wide change
  ok('isolation: an org-wide change reaches inheritors but an overriding location keeps its own', resolveConfig(patched, null, {}).voice === 'formal' && resolveConfig(patched, null, { voice: 'quirky' }).voice === 'quirky' && overrider.voice === 'quirky');
}

// ═══ 9. PERFORMANCE — 1000 locations resolve + roll up fast ═══
{
  const t0 = Date.now();
  const signals = [];
  for (let k = 0; k < 1000; k++) { resolveConfig(ORG, { voice: 'r' }, { brand: { palette: `c${k}` } }); signals.push({ site_id: `s${k}`, name: `Loc ${k}`, active_moments: k % 4, needs_attention: k % 7 === 0 ? 1 : 0 }); }
  const rollup = aggregateLocations(signals);
  const ms = Date.now() - t0;
  ok(`performance: resolve + roll up 1000 locations in ${ms}ms`, ms < 2000 && rollup.locations === 1000, `${ms}ms`);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ ENTERPRISE: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) { console.log('FAILURES:'); for (const r of results) if (!r.p) console.log('  ✗ ' + r.n); }

// ── Integration (staging): the live data layer (inheritance + Approved-Plan spine) ──
const SB = (globalThis.Deno && Deno.env.get('SUPABASE_URL')) || '';
const SR = (globalThis.Deno && (Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))) || '';
const ANON = (globalThis.Deno && (Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('ANON_KEY'))) || '';
if (!SB || !SR || !ANON) { console.log('\n(integration tier skipped — set SUPABASE_URL, SERVICE_ROLE_KEY, SUPABASE_ANON_KEY)'); }
else { await integration({ SB, SR, ANON }); }

async function integration({ SB, SR, ANON }) {
  const ires = []; const iok = (n, p, note = '') => { ires.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  [int] ${n}${note ? ' — ' + note : ''}`); };
  const FN = `${SB}/functions/v1/presence`;
  const svcH = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
  const anonH = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };
  const rest = (p, i = {}) => fetch(`${SB}/rest/v1/${p}`, { ...i, headers: { ...svcH, ...(i.headers || {}) } });
  let orgId = null; const LOC = '00000000-0000-0000-0000-0000000000aa';
  try {
    // operator surface is deployed + gated
    const unauth = await fetch(`${FN}/enterprise/00000000-0000-0000-0000-000000000001`, { headers: anonH });
    iok('operator surface: /enterprise is live and refuses a non-operator', unauth.status === 403 || unauth.status === 401, `status=${unauth.status}`);

    const org = await (await rest('presence_organizations?select=id', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name: 'L5.6 Co', tenant_id: '00000000-0000-0000-0000-000000000000' }) })).json();
    orgId = org?.[0]?.id;
    iok('setup: an organization is created', !!orgId);

    // org-level defaults + a location override
    await rest('presence_org_config', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ org_id: orgId, level: 'org', ref_id: orgId, config: { brand: { palette: 'navy' }, industry: 'restaurant' } }) });
    await rest('presence_org_config', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ org_id: orgId, level: 'location', ref_id: LOC, config: { brand: { palette: 'red' } } }) });
    const rows = await (await rest(`presence_org_config?org_id=eq.${orgId}&select=level,config`)).json();
    const orgCfg = rows.find((r) => r.level === 'org').config; const locCfg = rows.find((r) => r.level === 'location').config;
    const resolved = { ...orgCfg, ...locCfg, brand: { ...orgCfg.brand, ...locCfg.brand } };
    iok('inheritance (live): a location overrides palette (red) and inherits industry (restaurant)', resolved.brand.palette === 'red' && resolved.industry === 'restaurant');

    // the Approved-Plan spine, live: CHECK constant + atomic claim
    const noApproval = await rest('presence_org_operations', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ site_id: orgId, org_id: orgId, op: 'brand_update', title: 't', summary: 's', requires_approval: false }) });
    iok('law: requires_approval=false is rejected by the DB CHECK', noApproval.status >= 400);
    const ins = await (await rest('presence_org_operations?select=id,status', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ site_id: orgId, org_id: orgId, op: 'brand_update', title: 'Update brand', summary: 's', patch: { brand: { palette: 'gold' } } }) })).json();
    const opId = ins?.[0]?.id;
    await rest(`presence_org_operations?id=eq.${opId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'approved' }) });
    const cutoff = new Date(Date.now() - 120000).toISOString();
    const claim = await (await rest(`presence_org_operations?id=eq.${opId}&site_id=eq.${orgId}&status=eq.approved&or=(executed_at.is.null,executed_at.lt.${cutoff})&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ executed_at: new Date().toISOString() }) })).json();
    const claim2 = await (await rest(`presence_org_operations?id=eq.${opId}&site_id=eq.${orgId}&status=eq.approved&or=(executed_at.is.null,executed_at.lt.${cutoff})&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ executed_at: new Date().toISOString() }) })).json();
    iok('spine (live): the org-operation atomic claim succeeds once, never twice', (claim?.length || 0) === 1 && (claim2?.length || 0) === 0);
  } finally {
    try { if (orgId) { await rest(`presence_org_operations?org_id=eq.${orgId}`, { method: 'DELETE' }); await rest(`presence_org_config?org_id=eq.${orgId}`, { method: 'DELETE' }); await rest(`presence_organizations?id=eq.${orgId}`, { method: 'DELETE' }); } } catch (_) { /* */ }
  }
  const ip = ires.filter((r) => r.p).length;
  console.log(`\n[integration] ${ip}/${ires.length} passed`);
  if (ip !== ires.length) { console.log('INTEGRATION FAILURES:'); for (const r of ires) if (!r.p) console.log('  ✗ ' + r.n); }
}
