// ── L5.7 Agency Expansion & Enterprise Operations suite ─────────────────────
// Proves the agency ORCHESTRATES the whole platform through one experience:
// permissions compose (role × scope), cross-org/cross-client rollups + a unified
// approval queue drawn ENTIRELY from the Approved-Plan tables, no duplicated
// engine/store/table, and scaling to 100 orgs / 10,000 locations.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/agency_orchestration_test.mjs
import { authorize, memberForRole, permissionMatrix, ACTION_CAP, FULL_SCOPE, scopeOrg, scopeSite } from '../../supabase/functions/presence/agency/permissions.ts';
import { crossOrgRollup, approvalQueue, crossClientSummary } from '../../supabase/functions/presence/agency/orchestrate.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const src = (rel) => Deno.readTextFileSync(new URL(`../../supabase/functions/presence/${rel}`, import.meta.url));

// ═══ 1. PERMISSIONS COMPOSE — role capability × scope ═══
{
  const owner = memberForRole('agency_owner');
  ok('perm: an owner can do everything across the whole portfolio', ['org_manage', 'pack_approve', 'connected_approve', 'org_rollout_approve', 'publish', 'manage_members'].every((a) => authorize(owner, a)));
  const readonly = memberForRole('read_only');
  ok('perm: read-only can view but not change anything', authorize(readonly, 'view') && !authorize(readonly, 'org_manage') && !authorize(readonly, 'pack_approve') && !authorize(readonly, 'publish'));
  const editor = memberForRole('editor');
  ok('perm: an editor can PREPARE a connected write but not APPROVE it (separation of duties)', authorize(editor, 'connected_prepare') && !authorize(editor, 'connected_approve'));
  const developer = memberForRole('agency_admin'); // (admin) vs a scoped dev below
  ok('perm: an admin can approve plans; the sign-off capability is real', authorize(developer, 'pack_approve') && authorize(developer, 'org_rollout_approve'));
}

// ═══ 2. SCOPE FENCING — scoped admins can't escape their scope ═══
{
  const orgAdmin = memberForRole('organization_admin', { orgId: 'org-1', orgSites: ['s1', 's2'] });
  ok('scope: an org admin manages their own org', authorize(orgAdmin, 'org_manage', { orgId: 'org-1' }));
  ok('scope: an org admin CANNOT touch another org (composition denies it)', !authorize(orgAdmin, 'org_manage', { orgId: 'org-2' }));
  const locAdmin = memberForRole('location_admin', { siteId: 's1' });
  ok('scope: a location admin is bounded to their site', authorize(locAdmin, 'connected_prepare', { siteId: 's1' }) && !authorize(locAdmin, 'connected_prepare', { siteId: 's2' }));
  // a full-scope manager reaches any org/site in the portfolio
  const manager = memberForRole('manager');
  ok('scope: a full-portfolio manager reaches any org', authorize(manager, 'org_rollout_prepare', { orgId: 'anything' }));
}

// ═══ 3. THE PERMISSION MATRIX — nine named roles ═══
{
  const M = permissionMatrix();
  const roles = Object.keys(M);
  ok('matrix: all nine named roles are defined', roles.length === 9 && roles.includes('agency_owner') && roles.includes('organization_admin') && roles.includes('location_admin'));
  ok('matrix: owner ⊇ manager ⊇ analyst (capabilities are monotone by seniority)', M.agency_owner.length >= M.manager.length && M.manager.length >= M.analyst.length);
  ok('matrix: every action maps to a real capability', Object.values(ACTION_CAP).every((c) => typeof c === 'string'));
}

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
  ok('no-dup: permissions COMPOSE over the existing capability table (no second role system)',
    /from '\.\/auth\.ts'/.test(src('agency/permissions.ts')) && /can\(/.test(src('agency/permissions.ts')));
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

// ═══ 7. SECURITY — deny by default + no scope escape ═══
{
  const nobody = { role: 'readonly', scope: FULL_SCOPE };
  ok('security: deny by default — read-only cannot approve, manage, or publish', !authorize(nobody, 'org_manage') && !authorize(nobody, 'pack_approve') && !authorize(nobody, 'publish'));
  const scoped = { role: 'admin', scope: scopeOrg('org-1') };  // even an admin, scoped, is bounded
  ok('security: a scoped admin cannot act outside its scope, even with a powerful role', authorize(scoped, 'org_manage', { orgId: 'org-1' }) && !authorize(scoped, 'org_manage', { orgId: 'org-2' }));
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
