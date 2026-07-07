// ── The Approved Plan spine (L4.5) — ONE lifecycle for every approval-gated plan ─
// Studio OS has two executors that change things outside the customer's draft:
//   • Infrastructure Plans   (platform/plans.ts  → presence_infra_plans)
//   • Connected Write Plans   (connected/writes.ts → presence_connection_writes)
// They are DIFFERENT executors (DNS/hosting vs provider APIs) but they share the
// SAME lifecycle. This module is that shared spine — the single place the
// approval law, the decision transition, and the atomic execution claim live, so
// they can never drift apart or be re-implemented per feature.
//
//   Propose → Review → Approve → Atomic Claim → Execute → Verify → Audit → Rollback
//
// The executor may differ; the lifecycle does not.
import { svc } from './db.ts';

/** The canonical stages, for documentation + introspection. Terminal success is
 *  named by each executor ('applied' for infra, 'executed' for connected) — the
 *  spine covers the shared subset up to and including the atomic claim. */
export const APPROVED_PLAN_STAGES = ['proposed', 'approved', 'claimed', 'done', 'failed', 'abandoned'] as const;

/** The constitutional constant. Approval is a law, re-enforced by a DB CHECK on
 *  every plan table (presence_infra_plans, presence_connection_writes). */
export const REQUIRES_APPROVAL = true as const;

/** The plain-language fields EVERY approved plan carries — both InfraPlan and
 *  WritePlan structurally extend this, so "what/risk/reversible/approval" is one
 *  shape the customer reads the same way wherever a plan appears. */
export interface ApprovedPlanBase {
  title: string;
  summary: string;              // what changes and what does not, in sentences
  risk: string;                 // honest, plain words
  reversible: boolean;
  requires_approval: true;      // the constant (schema CHECK re-enforces)
}

/** The shared decision transition: a proposed plan is either approved or
 *  abandoned — nothing else, for any plan, ever. (Each route additionally gates
 *  the PATCH on status=proposed, so only an open plan can be decided.) */
export function decidePlan(decision: string): 'approved' | 'abandoned' | null {
  return decision === 'approve' ? 'approved' : decision === 'abandon' ? 'abandoned' : null;
}

/** The approval law as a predicate — an executor may run only an approved plan. */
export function isApproved(status: string): boolean { return status === 'approved'; }

const DEFAULT_STALE_MS = 2 * 60 * 1000;

/** The shared ATOMIC CLAIM: exactly one caller may execute an approved plan. It is
 *  a compare-and-swap on the executor's claim-timestamp column while the plan is
 *  still 'approved' — the winner gets the row, a concurrent/duplicate caller gets
 *  null (already claimed), and an INTERRUPTED claim becomes reclaimable after a
 *  staleness window so a plan is never wedged. Table-parameterized so every plan
 *  table reuses the identical guarantee.
 *  Returns the claimed row, or null if it could not be claimed. */
export async function claimApprovedPlan(opts: {
  table: string; id: string; siteId: string; claimColumn: string; select: string; staleMs?: number;
}): Promise<any | null> {
  const cutoff = new Date(Date.now() - (opts.staleMs ?? DEFAULT_STALE_MS)).toISOString();
  const r = await svc(
    `${opts.table}?id=eq.${encodeURIComponent(opts.id)}&site_id=eq.${encodeURIComponent(opts.siteId)}&status=eq.approved&or=(${opts.claimColumn}.is.null,${opts.claimColumn}.lt.${cutoff})&select=${opts.select}`,
    { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ [opts.claimColumn]: new Date().toISOString() }) },
  );
  return r.ok && Array.isArray(r.json) ? (r.json[0] || null) : null;
}

/** Release a claim after a run that didn't complete — the plan returns to
 *  approved-and-retryable (claim column cleared), optionally recording why. */
export async function releaseApprovedPlanClaim(table: string, id: string, claimColumn: string, extra: Record<string, unknown> = {}): Promise<void> {
  await svc(`${table}?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ [claimColumn]: null, ...extra }) });
}
