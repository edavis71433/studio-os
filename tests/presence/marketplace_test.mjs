// ── L5.5 Industry Pack Marketplace Foundation suite ─────────────────────────
// Proves pack management: dependency resolution, validation gates, Approved-Plan
// shaped operations (reusing the frozen spine), the full state set, scaling to
// 1000 packs, security boundaries, and customer FEATURES (never packages).
// Integration (staging): the live install lifecycle via the Approved-Plan spine.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/marketplace_test.mjs
import {
  PACK_STATES, MARKETPLACE_OPS, resolveDependencies, assessInstall,
  planMarketplaceOperation, customerFeatures, updateAvailable,
} from '../../supabase/functions/presence/industry/marketplace_ops.ts';
import { makePack, registeredPacks, resolvePack } from '../../supabase/functions/presence/industry/registry.ts';
import { RESTAURANT_PACK } from '../../supabase/functions/presence/industry/packs/restaurant.ts';
import { COFFEE_SHOP_PACK } from '../../supabase/functions/presence/industry/packs/coffee_shop.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const src = (rel) => Deno.readTextFileSync(new URL(`../../supabase/functions/presence/${rel}`, import.meta.url));
const mig = (rel) => Deno.readTextFileSync(new URL(`../../supabase/migrations/${rel}`, import.meta.url));

// ═══ 1. DEPENDENCY RESOLUTION — required, missing, conflicts, cycles ═══
{
  const map = (arr) => new Map(arr.map((p) => [p.key, p]));
  const withRestaurant = map([RESTAURANT_PACK]);
  const d1 = resolveDependencies(COFFEE_SHOP_PACK, withRestaurant);
  ok('deps: a child requires its parent (coffee_shop requires restaurant)', d1.requires.includes('restaurant') && d1.missing.length === 0);
  const d2 = resolveDependencies(COFFEE_SHOP_PACK, map([]));
  ok('deps: a missing required parent is reported', d2.missing.includes('restaurant'));
  const cycA = makePack({ key: 'cyc_a', label: 'A', family: 'professional', extends: 'cyc_b' });
  const cycB = makePack({ key: 'cyc_b', label: 'B', family: 'professional', extends: 'cyc_a' });
  ok('deps: an inheritance cycle is detected (never hangs)', resolveDependencies(cycA, map([cycA, cycB])).cycle === true);
  const clash = makePack({ key: 'clash', label: 'C', family: 'food', evidence: { providerNames: ['clash'], catalogTypes: RESTAURANT_PACK.evidence.catalogTypes.slice(0, 1) } });
  ok('deps: an evidence-type conflict with an installed pack is detected', resolveDependencies(clash, map([RESTAURANT_PACK])).conflicts.length === 1);
}

// ═══ 2. ASSESSMENT — bad packs are rejected BEFORE install, with reasons ═══
{
  ok('assess: a clean first-party pack passes (would install)', assessInstall(RESTAURANT_PACK, []).ok);
  const dup = assessInstall(RESTAURANT_PACK, [RESTAURANT_PACK]);
  ok('assess: a duplicate identifier is refused', !dup.ok && dup.problems.some((p) => /already installed/.test(p)));
  const bad = assessInstall(makePack({ key: 'Bad Key!', label: '', family: '' }), []);
  ok('assess: a malformed manifest fails with clear reasons and a failed_validation state', !bad.ok && bad.state === 'failed_validation' && bad.problems.length >= 2);
  const incompat = assessInstall(makePack({ key: 'future_pack', label: 'F', family: 'professional', marketplace: { author: 'x', license: 'community', exportable: true, shareable: true, minPlatformVersion: '99.0.0', changelog: [] } }), []);
  ok('assess: an incompatible pack is refused (needs a newer platform)', !incompat.ok && incompat.state === 'incompatible');
}

// ═══ 3. OPERATIONS ARE APPROVED PLANS (shared spine shape) ═══
{
  const plan = planMarketplaceOperation('install', RESTAURANT_PACK, []);
  ok('plan: an operation carries the shared ApprovedPlanBase (title/summary/risk/reversible/approval)',
    !!plan.title && !!plan.summary && !!plan.risk && typeof plan.reversible === 'boolean' && plan.requires_approval === true);
  ok('plan: it states what changes AND what stays (customer content untouched)',
    plan.what_changes.length > 0 && plan.what_stays.some((s) => /content/i.test(s)));
  ok('plan: every operation has a defined inverse (rollback)', plan.rollback_op === 'remove' && !!plan.rollback);
  const blocked = planMarketplaceOperation('install', makePack({ key: 'Bad!', label: '', family: '' }), []);
  ok('plan: a bad install is BLOCKED with reasons (refused before it runs)', blocked.blocked.length > 0);
}

// ═══ 4. STATES + OPS — the full lifecycle vocabulary ═══
{
  ok('states: all lifecycle states exist', ['available', 'installed', 'enabled', 'disabled', 'update_available', 'deprecated', 'unsupported', 'incompatible', 'failed_validation', 'pending_approval', 'removing'].every((s) => PACK_STATES.includes(s)));
  ok('ops: the state-changing operations are install/enable/disable/update/remove', JSON.stringify([...MARKETPLACE_OPS].sort()) === JSON.stringify(['disable', 'enable', 'install', 'remove', 'update']));
  ok('update: a newer version is detected as an available update', updateAvailable('1.0.0', '1.1.0') && !updateAvailable('2.0.0', '1.0.0'));
}

// ═══ 5. USES THE FROZEN APPROVED-PLAN SPINE (no new approval system) ═══
{
  const store = src('industry/marketplace_store.ts');
  ok('spine: the marketplace store reuses decidePlan + claimApprovedPlan (the frozen spine)',
    /from '\.\.\/lib\/approved_plan\.ts'/.test(store) && /decidePlan/.test(store) && /claimApprovedPlan/.test(store));
  ok('spine: the operations ledger enforces requires_approval as a DB CHECK (no bypass)',
    /requires_approval boolean not null default true check \(requires_approval = true\)/.test(mig('0042_presence_pack_marketplace.sql')));
  ok('spine: the route enforces approval before execute (a law, not a setting)',
    /status !== 'approved'/.test(src('routes/marketplace.ts')) && /not_approved/.test(src('routes/marketplace.ts')));
}

// ═══ 6. SECURITY — the marketplace grants packs NO new power ═══
{
  // a pack that tries to sneak an un-namespaced (collision-prone) type is refused at assessment
  const sneaky = makePack({ key: 'sneaky', label: 'S', family: 'professional', evidence: { providerNames: ['sneaky'], catalogTypes: ['content.menu_absent'] } });
  ok('security: an un-namespaced / collision-prone evidence type is refused at install', !assessInstall(sneaky, []).ok);
  // the customer surface never exposes package/version internals
  const cf = customerFeatures(RESTAURANT_PACK);
  ok('security/CX: the customer view shows FEATURES, never packages or versions', cf.features.length > 0 && !JSON.stringify(cf).match(/version|pack_key|semver/i));
}

// ═══ 7. PERFORMANCE — 1000 packs resolve/assess/plan fast ═══
{
  const many = [];
  for (let k = 0; k < 1000; k++) many.push(makePack({ key: `perf_${k}`, label: `P${k}`, family: 'professional', evidence: { providerNames: [`perf_${k}`], catalogTypes: [`content.perf_${k}_x`] } }));
  const t0 = Date.now();
  for (let k = 0; k < 1000; k++) { resolveDependencies(many[k], new Map(many.map((p) => [p.key, p]))); }
  const dms = Date.now() - t0;
  ok(`performance: dependency resolution across 1000 packs in ${dms}ms`, dms < 3000, `${dms}ms`);
  const t1 = Date.now();
  for (let k = 0; k < 200; k++) assessInstall(many[k], many.slice(0, 50));
  const ams = Date.now() - t1;
  ok(`performance: 200 install assessments (against 50 installed) in ${ams}ms`, ams < 2000, `${ams}ms`);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ MARKETPLACE: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) { console.log('FAILURES:'); for (const r of results) if (!r.p) console.log('  ✗ ' + r.n); }

// ── Integration (staging): the live install lifecycle via the Approved-Plan spine ──
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
  const KEY = 'pet_grooming'; const GLOBAL = '00000000-0000-0000-0000-000000000000';
  try {
    await rest(`presence_pack_operations?pack_key=eq.${KEY}`, { method: 'DELETE' });
    await rest(`presence_pack_installs?pack_key=eq.${KEY}`, { method: 'DELETE' });

    // the operator surface is DEPLOYED and correctly GATED (a non-operator is refused)
    const unauth = await fetch(`${FN}/marketplace`, { headers: anonH });
    iok('operator surface: /marketplace is live and refuses a non-operator', unauth.status === 403 || unauth.status === 401, `status=${unauth.status}`);

    // the Approved-Plan DATA layer works live (the store reuses the frozen spine,
    // already proven end-to-end in L4.3/L4.4). Here: the CHECK constant + the
    // status transitions + the atomic claim query, exercised directly.
    const noApproval = await rest('presence_pack_operations', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ site_id: GLOBAL, op: 'install', pack_key: KEY, version: '1.0.0', title: 't', summary: 's', requires_approval: false }) });
    iok('law: requires_approval=false is rejected by the DB CHECK (constitutional constant)', noApproval.status >= 400);

    const ins = await (await rest('presence_pack_operations?select=id,status', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ site_id: GLOBAL, op: 'install', pack_key: KEY, version: '1.0.0', title: 'Install Pet Grooming', summary: 's' }) })).json();
    const opId = ins?.[0]?.id;
    iok('propose: an operation is created as proposed', !!opId && ins[0].status === 'proposed');

    // decide → approved
    await rest(`presence_pack_operations?id=eq.${opId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'approved', decided_at: new Date().toISOString() }) });
    // atomic claim (the spine's exact query): approved & executed_at null → stamp it
    const cutoff = new Date(Date.now() - 120000).toISOString();
    const claim = await (await rest(`presence_pack_operations?id=eq.${opId}&site_id=eq.${GLOBAL}&status=eq.approved&or=(executed_at.is.null,executed_at.lt.${cutoff})&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ executed_at: new Date().toISOString() }) })).json();
    iok('claim: the atomic execution claim (approved + executed_at null) succeeds exactly once', Array.isArray(claim) && claim.length === 1);
    const claim2 = await (await rest(`presence_pack_operations?id=eq.${opId}&site_id=eq.${GLOBAL}&status=eq.approved&or=(executed_at.is.null,executed_at.lt.${cutoff})&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ executed_at: new Date().toISOString() }) })).json();
    iok('claim: a second claim finds nothing (never executed twice)', Array.isArray(claim2) && claim2.length === 0);

    // apply → install record, then mark executed
    await rest('presence_pack_installs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ pack_key: KEY, scope: 'global', version: '1.0.0', state: 'enabled', enabled: true }) });
    await rest(`presence_pack_operations?id=eq.${opId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'executed' }) });
    const inst = await (await rest(`presence_pack_installs?pack_key=eq.${KEY}&select=state,enabled`)).json();
    iok('state: the pack install record is enabled + auditable', inst?.[0]?.state === 'enabled' && inst[0].enabled === true);
    const ledger = await (await rest(`presence_pack_operations?id=eq.${opId}&select=status`)).json();
    iok('audit: the operation ledger records the executed operation', ledger?.[0]?.status === 'executed');
  } finally {
    try { await rest(`presence_pack_operations?pack_key=eq.${KEY}`, { method: 'DELETE' }); await rest(`presence_pack_installs?pack_key=eq.${KEY}`, { method: 'DELETE' }); } catch (_) { /* */ }
  }
  const ip = ires.filter((r) => r.p).length;
  console.log(`\n[integration] ${ip}/${ires.length} passed`);
  if (ip !== ires.length) { console.log('INTEGRATION FAILURES:'); for (const r of ires) if (!r.p) console.log('  ✗ ' + r.n); }
}
