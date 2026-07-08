// ── Org-wide rollout (L5.6) — every org change is an Approved Plan ───────────
// A brand/hours/connected/industry/template change, or rolling a location in,
// is proposed as an Approved Plan (lib/approved_plan.ts) that fans out to the
// affected locations. No new approval system; the same propose→approve→execute
// →audit→rollback lifecycle. Pure planner.
import type { ApprovedPlanBase } from '../lib/approved_plan.ts';
import type { OrgOp } from './contract.ts';

export interface OrgPlan extends ApprovedPlanBase {
  op: OrgOp;
  org_id: string;
  targets: string[];            // location site_ids the change fans out to
  what_changes: string[];
  what_stays: string[];
  rollback: string;             // plain-language how-to-undo (shared plan field)
  rollback_note: string;
}

const COPY: Record<OrgOp, { verb: string; changes: (n: number) => string; risk: string }> = {
  brand_update: { verb: 'Update the brand across the organization', changes: (n) => `The shared brand updates for ${n} location(s) that inherit it.`, risk: 'Low. Locations that override the brand keep their own; every change is versioned.' },
  hours_update: { verb: 'Update shared hours', changes: (n) => `Shared default hours update for ${n} location(s) that inherit them.`, risk: 'Low. A location with its own hours is untouched.' },
  connected_update: { verb: 'Update connected-provider guidance', changes: (n) => `The recommended connections update for ${n} location(s).`, risk: 'Low. No credential is changed; only guidance. Each connection is still approved per location.' },
  industry_update: { verb: 'Update the Industry Pack', changes: (n) => `The organization’s Industry Pack updates for ${n} location(s) — the same pack every location already uses.`, risk: 'Low. The pack is data; behavior is identical to a single business.' },
  location_rollout: { verb: 'Roll out to locations', changes: (n) => `The change is applied to ${n} selected location(s).`, risk: 'Low. Only the selected locations are affected; the rest are untouched.' },
  template_rollout: { verb: 'Roll out a template', changes: (n) => `The shared template rolls out to ${n} location(s) that inherit it.`, risk: 'Low. Overriding locations keep theirs; every version is restorable.' },
};

export function planOrgOperation(op: OrgOp, orgId: string, targets: string[]): OrgPlan {
  const c = COPY[op];
  const n = targets.length;
  return {
    op, org_id: orgId, targets,
    title: c.verb,
    summary: `${c.verb}. Locations inherit the change unless they override it; each customer’s content, drafts, domains, and history are untouched.`,
    what_changes: [c.changes(n)],
    what_stays: [
      'Every location’s own content, media, drafts, domains, and history are untouched.',
      'A location that overrides this setting keeps its own — inheritance never overwrites a deliberate override.',
    ],
    risk: c.risk,
    reversible: true,
    rollback: 'Restore the previous shared value; overriding locations were never changed, and inheriting ones revert together.',
    rollback_note: 'Org-wide changes are versioned; the previous value is restored for every inheriting location at once.',
    requires_approval: true,
  };
}
