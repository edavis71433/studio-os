// ── L5.7 Agency Expansion & Enterprise Operations suite ─────────────────────
// Proves the agency ORCHESTRATES the whole platform through one experience:
// cross-org/cross-client rollups + a unified approval queue drawn ENTIRELY from the
// Approved-Plan tables, no duplicated engine/store/table, and scaling to 100 orgs /
// 10,000 locations. (Its first sections checked agency/permissions.ts, a role-and-scope
// table that was never wired into production; builder item 423 removed it, Nov 22 2026.
// The agency routes' real gates are agency/auth.ts's, which member_capabilities and the
// designer-role suites drive.)
//
//   deno run --allow-read --allow-net --allow-env tests/presence/agency_orchestration_test.mjs
import { crossOrgRollup, approvalQueue, crossClientSummary } from '../../supabase/functions/presence/agency/orchestrate.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const src = (rel) => Deno.readTextFileSync(new URL(`../../supabase/functions/presence/${rel}`, import.meta.url));

// ═══ 4. ORCHESTRATION BUILDERS — rollups + the unified approval queue ═══
{
  const rollup = crossOrgRollup([
    { org_id: 'o1', name: 'Bistro Group', locations: [{ site_id: 'a', name: 'Downtown', active_moments: 2, needs_attention: 1 }, { site_id: 'b', name: 'Uptown', active_moments: 0, needs_attention: 0 }] },
    { org_id: 'o2', name: 'Cafe Co', locations: [{ site_id: 'c', name: 'Main', active_moments: 0, needs_attention: 0 }] },
  ]);
  ok('rollup: cross-org aggregates locations + flags orgs needing attention', rollup.organizations === 2 && rollup.locations === 3 && rollup.orgs_needing_attention.includes('Bistro Group') && !rollup.orgs_needing_attention.includes('Cafe Co'));
  const q = approvalQueue([
    { source: 'connected_write', id: '1', title: 'GBP hours', status: 'proposed', scope: 's1' },
    { source: 'org_operation', id: '2', title: 'Brand rollout', status: 'approved', scope: 'o1' },
    { source: 'pack_operation', id: '3', title: 'Install pack', status: 'proposed', scope: 'global' },
  ]);
  ok('queue: the unified approval queue splits needs-review vs ready-to-run across all sources', q.needs_review.length === 2 && q.ready_to_run.length === 1 && q.by_source.connected_write === 1 && q.total === 3);
  const cc = crossClientSummary([{ site_id: 'a', industry: 'restaurant', edition: 'presence' }, { site_id: 'b', industry: 'restaurant', edition: 'monitor' }, { site_id: 'c', industry: 'dental', edition: 'presence' }]);
  ok('summary: cross-client distribution by industry + edition', cc.clients === 3 && cc.by_industry.restaurant === 2 && cc.by_edition.presence === 2);
}

// ═══ 5. ORCHESTRATION, NOT DUPLICATION ═══
{
  const orch = src('agency/orchestrate.ts');
  ok('no-dup: orchestration imports NO pipeline engine (it consumes results)',
    !/from '\.\.\/(evidence|judgment|recommendation|moments|concierge)\/engine/.test(orch));
  const routes = src('agency/routes.ts');
  ok('no-dup: the agency ORCHESTRATES the existing Enterprise store (does not reimplement it)',
    /from '\.\.\/enterprise\/store\.ts'/.test(routes) && /saveOrgOperation/.test(routes) && /decideOrgOperation/.test(routes));
  ok('no-dup: the approval queue is drawn from the Approved-Plan tables (every change is a plan)',
    /presence_connection_writes/.test(routes) && /presence_infra_plans/.test(routes) && /presence_org_operations/.test(routes));
}

// ═══ 6. APPROVED-PLAN SPINE — every agency state change goes through it ═══
{
  const routes = src('agency/routes.ts');
  ok('spine: an agency rollout is prepared via saveOrgOperation (an Approved Plan), gated by manage_enterprise',
    /manage_enterprise/.test(routes) && /saveOrgOperation/.test(routes));
  ok('spine: approving a rollout needs approve_plans and calls decideOrgOperation (the spine)',
    /approve_plans/.test(routes) && /decideOrgOperation/.test(routes));
  // the enterprise store (which the agency calls) reuses the frozen spine
  ok('spine: the store the agency calls reuses claimApprovedPlan', /claimApprovedPlan/.test(src('enterprise/store.ts')));
}

// ═══ 8. PERFORMANCE — 100 orgs / 10,000 locations ═══
{
  const orgs = [];
  for (let o = 0; o < 100; o++) {
    const locations = [];
    for (let l = 0; l < 100; l++) locations.push({ site_id: `s${o}_${l}`, name: `L${l}`, active_moments: l % 3, needs_attention: l % 9 === 0 ? 1 : 0 });
    orgs.push({ org_id: `o${o}`, name: `Org ${o}`, locations });
  }
  const t0 = Date.now();
  const rollup = crossOrgRollup(orgs);
  const q = approvalQueue(Array.from({ length: 2000 }, (_, k) => ({ source: 'org_operation', id: `${k}`, title: 't', status: k % 2 ? 'proposed' : 'approved', scope: 'o' })));
  const ms = Date.now() - t0;
  ok(`performance: roll up 100 orgs / 10,000 locations + a 2,000-item queue in ${ms}ms`, ms < 3000 && rollup.locations === 10000 && q.total === 2000, `${ms}ms`);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ AGENCY ORCHESTRATION: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) { console.log('FAILURES:'); for (const r of results) if (!r.p) console.log('  ✗ ' + r.n); }
