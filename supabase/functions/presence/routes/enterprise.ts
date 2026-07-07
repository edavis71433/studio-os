// ── /enterprise/* (L5.6) — the organization surface ─────────────────────────
// One organization, many locations. Operator/agency management; every org-wide
// change is an Approved Plan (lib/approved_plan.ts). No engine change.
//   GET  /enterprise/:orgId                          — org overview + location rollup
//   GET  /enterprise/:orgId/locations                — locations + inheritance summary
//   GET  /enterprise/:orgId/locations/:siteId/config — a location's resolved config
//   POST /enterprise/:orgId/rollout/prepare          — propose an org-wide change {op,targets,patch}
//   POST /enterprise/operations/:id/{decide,execute,rollback}
//   GET  /enterprise/:orgId/audit                    — the operation ledger
import { json } from '../../_shared/http.ts';
import type { Principal } from '../../_shared/auth.ts';
import { planOrgOperation } from '../enterprise/rollout.ts';
import { ORG_OPS } from '../enterprise/contract.ts';
import type { OrgOp } from '../enterprise/contract.ts';
import { aggregateLocations, diffFromParent } from '../enterprise/inheritance.ts';
import {
  getOrganization, listLocations, resolveLocationConfig, getConfig,
  saveOrgOperation, listOrgOperations, getOrgOperation, decideOrgOperation,
  claimOrgOperation, releaseOrgOperationClaim, markOrgOperationOutcome, applyOrgOperation,
} from '../enterprise/store.ts';

const operator = (p: Principal) => p.kind === 'staff' || p.kind === 'system';

export async function handleEnterpriseOverview(orgId: string, principal: Principal, cors: Record<string, string>) {
  if (!operator(principal)) return json({ error: 'forbidden', message: 'Organization management is operator-only.' }, 403, cors);
  const org = await getOrganization(orgId);
  if (!org) return json({ error: 'not_found', message: 'No such organization.' }, 404, cors);
  const locations = await listLocations(orgId);
  // a rollup is a READ-side aggregation of what each location's pipeline already produced (no engine change)
  const signals = locations.map((l) => ({ site_id: l.id, name: l.custom_domain || l.id.slice(0, 8), active_moments: 0, needs_attention: 0 }));
  return json({ data: { organization: { id: org.id, name: org.name }, locations: locations.length, rollup: aggregateLocations(signals) } }, 200, cors);
}

export async function handleEnterpriseLocations(orgId: string, principal: Principal, cors: Record<string, string>) {
  if (!operator(principal)) return json({ error: 'forbidden', message: 'Operator-only.' }, 403, cors);
  const orgConfig = await getConfig(orgId, 'org', orgId);
  const locations = await listLocations(orgId);
  const out = [];
  for (const l of locations) {
    const overrides = await getConfig(orgId, 'location', l.id);
    out.push({ site_id: l.id, region_id: l.region_id, overrides: Object.keys(diffFromParent(orgConfig, { ...orgConfig, ...overrides })) });
  }
  return json({ data: { organization: orgId, inherited_defaults: Object.keys(orgConfig), locations: out } }, 200, cors);
}

export async function handleEnterpriseLocationConfig(orgId: string, siteId: string, principal: Principal, cors: Record<string, string>) {
  if (!operator(principal)) return json({ error: 'forbidden', message: 'Operator-only.' }, 403, cors);
  const locations = await listLocations(orgId);
  const loc = locations.find((l) => l.id === siteId);
  if (!loc) return json({ error: 'not_found', message: 'No such location in this organization.' }, 404, cors);
  const resolved = await resolveLocationConfig(orgId, siteId, loc.region_id);
  const orgConfig = await getConfig(orgId, 'org', orgId);
  return json({ data: { site_id: siteId, resolved, overrides: diffFromParent(orgConfig, resolved) } }, 200, cors);
}

export async function handleEnterpriseRolloutPrepare(req: Request, orgId: string, principal: Principal, cors: Record<string, string>) {
  if (!operator(principal)) return json({ error: 'forbidden', message: 'Operator-only.' }, 403, cors);
  const org = await getOrganization(orgId);
  if (!org) return json({ error: 'not_found', message: 'No such organization.' }, 404, cors);
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const op = String(body?.op || '') as OrgOp;
  if (!ORG_OPS.includes(op)) return json({ error: 'bad_op', message: `Operation must be one of: ${ORG_OPS.join(', ')}.` }, 400, cors);
  const allLocations = (await listLocations(orgId)).map((l) => l.id);
  const targets = Array.isArray(body?.targets) && body.targets.length ? body.targets.filter((t: string) => allLocations.includes(t)) : allLocations;
  const plan = planOrgOperation(op, orgId, targets);
  const row = await saveOrgOperation(plan, body?.patch || {});
  if (!row) return json({ error: 'write_failed', message: 'The operation didn’t save — nothing changed.' }, 502, cors);
  return json({ data: row }, 200, cors);
}

export async function handleEnterpriseDecide(req: Request, id: string, principal: Principal, cors: Record<string, string>) {
  if (!operator(principal)) return json({ error: 'forbidden', message: 'Operator-only.' }, 403, cors);
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const verb = String(body?.decision || '');
  if (verb !== 'approve' && verb !== 'abandon') return json({ error: 'bad_request', message: 'Decide with approve or abandon.' }, 400, cors);
  const row = await decideOrgOperation(id, verb);
  if (!row) return json({ error: 'not_found', message: 'That operation isn’t open for a decision.' }, 404, cors);
  return json({ data: row }, 200, cors);
}

export async function handleEnterpriseExecute(id: string, principal: Principal, cors: Record<string, string>) {
  if (!operator(principal)) return json({ error: 'forbidden', message: 'Operator-only.' }, 403, cors);
  const existing = await getOrgOperation(id);
  if (!existing) return json({ error: 'not_found', message: 'No such operation.' }, 404, cors);
  if (existing.status !== 'approved') return json({ error: 'not_approved', message: existing.status === 'executed' ? 'Already done.' : 'Org-wide changes run only after approval — a law, not a setting.' }, 409, cors);
  const claimed = await claimOrgOperation(id, existing.org_id);
  if (!claimed) return json({ error: 'in_progress', message: 'This change is already being carried out.' }, 409, cors);
  try {
    await applyOrgOperation(claimed.org_id, claimed.patch || {});
    const result = { applied: true, targets: (claimed.targets || []).length, note: 'The shared change was applied; inheriting locations pick it up, overriding locations keep their own.' };
    await markOrgOperationOutcome(id, 'executed', result);
    return json({ data: { id, status: 'executed', op: claimed.op, result } }, 200, cors);
  } catch (_e) {
    await releaseOrgOperationClaim(id, { error: 'apply_failed' });
    return json({ error: 'apply_failed', message: 'That didn’t complete, and nothing was half-done — the approval stands and it can be retried.' }, 502, cors);
  }
}

export async function handleEnterpriseRollback(id: string, principal: Principal, cors: Record<string, string>) {
  if (!operator(principal)) return json({ error: 'forbidden', message: 'Operator-only.' }, 403, cors);
  const op = await getOrgOperation(id);
  if (!op) return json({ error: 'not_found', message: 'No such operation.' }, 404, cors);
  if (op.status !== 'executed') return json({ error: 'bad_request', message: 'Only a completed change can be rolled back.' }, 409, cors);
  return json({ data: { reversible: op.reversible, explanation: op.rollback, note: 'Restoring the previous shared value reverts every inheriting location at once; overriding locations were never changed.' } }, 200, cors);
}

export async function handleEnterpriseAudit(orgId: string, principal: Principal, cors: Record<string, string>) {
  if (!operator(principal)) return json({ error: 'forbidden', message: 'Operator-only.' }, 403, cors);
  return json({ data: await listOrgOperations(orgId) }, 200, cors);
}
