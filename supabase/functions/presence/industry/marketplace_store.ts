// ── Marketplace store (L5.5) — install state + the operation lifecycle ───────
// The operation lifecycle IS the Approved-Plan spine (lib/approved_plan.ts):
// decidePlan for approve/abandon, claimApprovedPlan for the atomic execute claim.
// No new approval logic. Deny-all tables, function-mediated. Marketplace ops are
// global by default (the all-zero site_id sentinel reuses the spine's claim).
import { svc } from '../lib/db.ts';
import { decidePlan, claimApprovedPlan, releaseApprovedPlanClaim } from '../lib/approved_plan.ts';
import type { MarketplacePlan, PackState, InstallRecord } from './marketplace_ops.ts';

export const GLOBAL_SCOPE = 'global';
const GLOBAL_SITE = '00000000-0000-0000-0000-000000000000';   // sentinel for global (non-site-scoped) ops
const OP_TABLE = 'presence_pack_operations';
const OP_SELECT = 'id,site_id,op,pack_key,version,title,summary,what_changes,what_stays,risk,reversible,rollback,requires_approval,blocked,status,executed_at,decided_at,result,created_at';

// ── install state ────────────────────────────────────────────────────────────
export async function listInstalls(scope: string = GLOBAL_SCOPE): Promise<InstallRecord[]> {
  const r = await svc(`presence_pack_installs?scope=eq.${encodeURIComponent(scope)}&select=pack_key,version,state,enabled,scope&order=pack_key.asc`);
  return r.ok && Array.isArray(r.json) ? r.json : [];
}
export async function getInstall(packKey: string, scope: string = GLOBAL_SCOPE): Promise<InstallRecord | null> {
  const r = await svc(`presence_pack_installs?pack_key=eq.${encodeURIComponent(packKey)}&scope=eq.${encodeURIComponent(scope)}&select=pack_key,version,state,enabled,scope&limit=1`);
  return r.ok && Array.isArray(r.json) ? (r.json[0] || null) : null;
}
export async function upsertInstall(packKey: string, version: string, state: PackState, enabled: boolean, scope: string = GLOBAL_SCOPE): Promise<void> {
  await svc('presence_pack_installs?on_conflict=pack_key,scope', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ pack_key: packKey, scope, version, state, enabled }),
  });
}
export async function deleteInstall(packKey: string, scope: string = GLOBAL_SCOPE): Promise<void> {
  await svc(`presence_pack_installs?pack_key=eq.${encodeURIComponent(packKey)}&scope=eq.${encodeURIComponent(scope)}`, { method: 'DELETE' });
}

// ── the operation lifecycle (propose → decide → execute), via the spine ──────
export async function saveOperation(plan: MarketplacePlan, scope: string = GLOBAL_SCOPE): Promise<any | null> {
  const siteId = scope === GLOBAL_SCOPE ? GLOBAL_SITE : scope;
  const ins = await svc(`${OP_TABLE}?select=${OP_SELECT}`, {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      site_id: siteId, op: plan.op, pack_key: plan.pack_key, version: plan.version,
      title: plan.title, summary: plan.summary, what_changes: plan.what_changes, what_stays: plan.what_stays,
      risk: plan.risk, reversible: plan.reversible, rollback: plan.rollback, blocked: plan.blocked,
    }),
  });
  return ins.ok && Array.isArray(ins.json) ? ins.json[0] : null;
}
export async function listOperations(limit = 50): Promise<any[]> {
  const r = await svc(`${OP_TABLE}?select=${OP_SELECT}&order=created_at.desc&limit=${limit}`);
  return r.ok && Array.isArray(r.json) ? r.json : [];
}
export async function getOperation(id: string): Promise<any | null> {
  const r = await svc(`${OP_TABLE}?id=eq.${encodeURIComponent(id)}&select=${OP_SELECT}&limit=1`);
  return r.ok && Array.isArray(r.json) ? (r.json[0] || null) : null;
}
/** Approve/abandon — the shared decision transition (only from 'proposed'). */
export async function decideOperation(id: string, verb: 'approve' | 'abandon'): Promise<any | null> {
  const target = decidePlan(verb);
  if (!target) return null;
  const r = await svc(`${OP_TABLE}?id=eq.${encodeURIComponent(id)}&status=eq.proposed&select=${OP_SELECT}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: target, decided_at: new Date().toISOString() }),
  });
  return r.ok && Array.isArray(r.json) ? (r.json[0] || null) : null;
}
/** Atomically claim an approved operation for execution (the spine's guarantee). */
export function claimOperation(id: string, scope: string = GLOBAL_SCOPE): Promise<any | null> {
  const siteId = scope === GLOBAL_SCOPE ? GLOBAL_SITE : scope;
  return claimApprovedPlan({ table: OP_TABLE, id, siteId, claimColumn: 'executed_at', select: OP_SELECT });
}
export function releaseOperationClaim(id: string, result: unknown = null): Promise<void> {
  return releaseApprovedPlanClaim(OP_TABLE, id, 'executed_at', { result });
}
export async function markOperationOutcome(id: string, status: 'executed' | 'failed', result: unknown): Promise<void> {
  await svc(`${OP_TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify({ status, result: result ?? null, executed_at: new Date().toISOString() }),
  });
}

// ── apply an approved operation to the install state ─────────────────────────
export async function applyOperation(op: string, packKey: string, version: string, scope: string = GLOBAL_SCOPE): Promise<{ ok: boolean; state: PackState }> {
  switch (op) {
    case 'install': await upsertInstall(packKey, version, 'enabled', true, scope); return { ok: true, state: 'enabled' };
    case 'enable': await upsertInstall(packKey, version, 'enabled', true, scope); return { ok: true, state: 'enabled' };
    case 'disable': await upsertInstall(packKey, version, 'disabled', false, scope); return { ok: true, state: 'disabled' };
    case 'update': await upsertInstall(packKey, version, 'enabled', true, scope); return { ok: true, state: 'enabled' };
    case 'remove': await deleteInstall(packKey, scope); return { ok: true, state: 'removing' };
    default: return { ok: false, state: 'failed_validation' };
  }
}
