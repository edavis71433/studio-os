// ── Enterprise store (L5.6) — orgs, locations, config, rollout lifecycle ─────
// The rollout lifecycle IS the Approved-Plan spine (lib/approved_plan.ts). No new
// approval logic. Deny-all tables, function-mediated.
import { svc } from '../lib/db.ts';
import { decidePlan, claimApprovedPlan, releaseApprovedPlanClaim } from '../lib/approved_plan.ts';
import { resolveConfig, mergeLayer } from './inheritance.ts';
import type { OrgConfigLayer, ConfigLevel } from './contract.ts';
import type { OrgPlan as Plan } from './rollout.ts';

const OP_TABLE = 'presence_org_operations';
const OP_SELECT = 'id,site_id,org_id,op,title,summary,what_changes,what_stays,risk,reversible,rollback,requires_approval,targets,patch,status,executed_at,decided_at,result,created_at';

export async function getOrganization(orgId: string): Promise<any | null> {
  const r = await svc(`presence_organizations?id=eq.${encodeURIComponent(orgId)}&select=id,name,tenant_id&limit=1`);
  return r.ok && Array.isArray(r.json) ? (r.json[0] || null) : null;
}
export async function listLocations(orgId: string): Promise<any[]> {
  const r = await svc(`presence_sites?org_id=eq.${encodeURIComponent(orgId)}&select=id,region_id,template_slug,custom_domain,status&order=id.asc&limit=2000`);
  return r.ok && Array.isArray(r.json) ? r.json : [];
}
export async function getConfig(orgId: string, level: ConfigLevel, refId: string): Promise<OrgConfigLayer> {
  const r = await svc(`presence_org_config?org_id=eq.${encodeURIComponent(orgId)}&level=eq.${level}&ref_id=eq.${encodeURIComponent(refId)}&select=config&limit=1`);
  return (r.ok && Array.isArray(r.json) && r.json[0]) ? (r.json[0].config || {}) : {};
}
export async function saveConfig(orgId: string, level: ConfigLevel, refId: string, config: OrgConfigLayer): Promise<void> {
  await svc('presence_org_config?on_conflict=org_id,level,ref_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ org_id: orgId, level, ref_id: refId, config }),
  });
}

/** Resolve a location's effective config from its org → region → location chain. */
export async function resolveLocationConfig(orgId: string, siteId: string, regionId: string | null): Promise<OrgConfigLayer> {
  const [org, region, location] = await Promise.all([
    getConfig(orgId, 'org', orgId),
    regionId ? getConfig(orgId, 'region', regionId) : Promise.resolve({}),
    getConfig(orgId, 'location', siteId),
  ]);
  return resolveConfig(org, region, location);
}

// ── rollout lifecycle via the spine ──────────────────────────────────────────
export async function saveOrgOperation(plan: Plan, patch: OrgConfigLayer): Promise<any | null> {
  const ins = await svc(`${OP_TABLE}?select=${OP_SELECT}`, {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      site_id: plan.org_id, org_id: plan.org_id, op: plan.op, title: plan.title, summary: plan.summary,
      what_changes: plan.what_changes, what_stays: plan.what_stays, risk: plan.risk, reversible: plan.reversible,
      rollback: plan.rollback, targets: plan.targets, patch,
    }),
  });
  return ins.ok && Array.isArray(ins.json) ? ins.json[0] : null;
}
export async function listOrgOperations(orgId: string, limit = 50): Promise<any[]> {
  const r = await svc(`${OP_TABLE}?org_id=eq.${encodeURIComponent(orgId)}&select=${OP_SELECT}&order=created_at.desc&limit=${limit}`);
  return r.ok && Array.isArray(r.json) ? r.json : [];
}
export async function getOrgOperation(id: string): Promise<any | null> {
  const r = await svc(`${OP_TABLE}?id=eq.${encodeURIComponent(id)}&select=${OP_SELECT}&limit=1`);
  return r.ok && Array.isArray(r.json) ? (r.json[0] || null) : null;
}
export async function decideOrgOperation(id: string, verb: 'approve' | 'abandon'): Promise<any | null> {
  const target = decidePlan(verb);
  if (!target) return null;
  const r = await svc(`${OP_TABLE}?id=eq.${encodeURIComponent(id)}&status=eq.proposed&select=${OP_SELECT}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: target, decided_at: new Date().toISOString() }),
  });
  return r.ok && Array.isArray(r.json) ? (r.json[0] || null) : null;
}
export function claimOrgOperation(id: string, orgId: string): Promise<any | null> {
  return claimApprovedPlan({ table: OP_TABLE, id, siteId: orgId, claimColumn: 'executed_at', select: OP_SELECT });
}
export function releaseOrgOperationClaim(id: string, result: unknown = null): Promise<void> {
  return releaseApprovedPlanClaim(OP_TABLE, id, 'executed_at', { result });
}
export async function markOrgOperationOutcome(id: string, status: 'executed' | 'failed', result: unknown): Promise<void> {
  await svc(`${OP_TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify({ status, result: result ?? null, executed_at: new Date().toISOString() }),
  });
}

/** Apply an approved rollout: merge its patch into the ORG-level config layer.
 *  Locations inherit it automatically; overriding locations keep their own. */
export async function applyOrgOperation(orgId: string, patch: OrgConfigLayer): Promise<{ ok: boolean }> {
  const current = await getConfig(orgId, 'org', orgId);
  await saveConfig(orgId, 'org', orgId, mergeLayer(current, patch));
  return { ok: true };
}
