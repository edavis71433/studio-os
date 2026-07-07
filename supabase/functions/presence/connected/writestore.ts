// ── Write-plan store (L4.3) — service role, function-mediated ────────────────
// The lifecycle of a write plan: propose → decide → execute/fail, with an
// append-only audit at every step (reusing presence_connection_events). Tokens
// never appear here; only plan metadata and non-sensitive provider responses.
import { svc } from '../lib/db.ts';
import type { WritePlan } from './writes.ts';

export const WRITE_SELECT = 'id,provider_key,workflow,kind,title,summary,what_changes,what_stays,risk,reversible,rollback,verify,requires_approval,payload,prior_state,recommendation_hash,status,provider_response,verification,decided_at,executed_at,created_at';

export async function saveWritePlan(siteId: string, plan: WritePlan, recommendationHash: string | null): Promise<any | null> {
  const ins = await svc(`presence_connection_writes?select=${WRITE_SELECT}`, {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      site_id: siteId, provider_key: plan.provider_key, workflow: plan.workflow, kind: plan.kind,
      title: plan.title, summary: plan.summary, what_changes: plan.what_changes, what_stays: plan.what_stays,
      risk: plan.risk, reversible: plan.reversible, rollback: plan.rollback, verify: plan.verify,
      payload: plan.payload, prior_state: plan.prior_state, recommendation_hash: recommendationHash,
    }),
  });
  return ins.ok && Array.isArray(ins.json) ? ins.json[0] : null;
}

export async function listWritePlans(siteId: string, providerKey?: string): Promise<any[]> {
  const filter = providerKey ? `&provider_key=eq.${encodeURIComponent(providerKey)}` : '';
  const r = await svc(`presence_connection_writes?site_id=eq.${encodeURIComponent(siteId)}${filter}&select=${WRITE_SELECT}&order=created_at.desc&limit=50`);
  return r.ok && Array.isArray(r.json) ? r.json : [];
}

export async function getWritePlan(siteId: string, id: string): Promise<any | null> {
  const r = await svc(`presence_connection_writes?id=eq.${encodeURIComponent(id)}&site_id=eq.${encodeURIComponent(siteId)}&select=${WRITE_SELECT}&limit=1`);
  return r.ok && Array.isArray(r.json) ? (r.json[0] || null) : null;
}

/** Approve or abandon — only ever from 'proposed'. Returns the updated row or null. */
export async function decideWritePlan(siteId: string, id: string, decision: 'approved' | 'abandoned'): Promise<any | null> {
  const r = await svc(`presence_connection_writes?id=eq.${encodeURIComponent(id)}&site_id=eq.${encodeURIComponent(siteId)}&status=eq.proposed&select=${WRITE_SELECT}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: decision, decided_at: new Date().toISOString() }),
  });
  return r.ok && Array.isArray(r.json) ? (r.json[0] || null) : null;
}

/** Record the outcome of an execution. status: 'executed' | 'failed'. */
export async function markWriteOutcome(id: string, status: 'executed' | 'failed', providerResponse: unknown, verification: unknown): Promise<void> {
  await svc(`presence_connection_writes?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify({ status, provider_response: providerResponse ?? null, verification: verification ?? null, executed_at: new Date().toISOString() }),
  });
}

export async function auditWrite(siteId: string, providerKey: string, action: string, detail: string, actorKind = 'customer'): Promise<void> {
  await svc('presence_connection_events', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ site_id: siteId, provider_key: providerKey, action, detail: String(detail).slice(0, 280), actor_kind: actorKind }),
  });
}
