// ── Agency orchestration (L5.7) — PURE builders over the EXISTING platform ───
// The agency operates the whole platform without a new engine, store, or table:
// these builders roll up what Enterprise, the Marketplace, the Connected Platform,
// and the pipeline already produced. The unified approval queue is drawn ENTIRELY
// from the Approved-Plan tables — proof that every state change flows through the
// one spine. No engine dependency.
import { aggregateLocations } from '../enterprise/inheritance.ts';
import type { LocationSignal } from '../enterprise/inheritance.ts';

// ── cross-organization rollup ────────────────────────────────────────────────
export interface OrgSummaryInput { org_id: string; name: string; locations: LocationSignal[]; }
export interface OrgSummary { org_id: string; name: string; locations: number; total_active_moments: number; needs_attention: string[]; }
export interface CrossOrgRollup {
  organizations: number;
  locations: number;
  total_active_moments: number;
  orgs_needing_attention: string[];   // orgs with at least one attention location
  per_org: OrgSummary[];
}
export function crossOrgRollup(orgs: OrgSummaryInput[]): CrossOrgRollup {
  const per_org: OrgSummary[] = orgs.map((o) => {
    const r = aggregateLocations(o.locations);
    return { org_id: o.org_id, name: o.name, locations: r.locations, total_active_moments: r.total_active_moments, needs_attention: r.needs_attention_locations };
  });
  return {
    organizations: orgs.length,
    locations: per_org.reduce((n, o) => n + o.locations, 0),
    total_active_moments: per_org.reduce((n, o) => n + o.total_active_moments, 0),
    orgs_needing_attention: per_org.filter((o) => o.needs_attention.length > 0).map((o) => o.name),
    per_org,
  };
}

// ── the unified approval queue (every source is an Approved Plan) ────────────
// One place to review + sign off every pending change across the portfolio:
// connected writes, pack operations, org rollouts, infrastructure plans. Each is
// a row in a plan table whose lifecycle IS the spine — nothing bypasses it.
export type PlanSource = 'connected_write' | 'pack_operation' | 'org_operation' | 'infra_plan';
export interface PendingPlan { source: PlanSource; id: string; title: string; status: string; scope: string; }
export interface ApprovalQueue {
  needs_review: PendingPlan[];   // status 'proposed'
  ready_to_run: PendingPlan[];   // status 'approved'
  by_source: Record<string, number>;
  total: number;
}
export function approvalQueue(plans: PendingPlan[]): ApprovalQueue {
  const by_source: Record<string, number> = {};
  for (const p of plans) by_source[p.source] = (by_source[p.source] || 0) + 1;
  return {
    needs_review: plans.filter((p) => p.status === 'proposed'),
    ready_to_run: plans.filter((p) => p.status === 'approved'),
    by_source,
    total: plans.length,
  };
}

// ── cross-client summary (industry + edition distribution) ───────────────────
export interface ClientLite { site_id: string; industry: string; edition: string; }
export function crossClientSummary(clients: ClientLite[]): { clients: number; by_industry: Record<string, number>; by_edition: Record<string, number> } {
  const by_industry: Record<string, number> = {}, by_edition: Record<string, number> = {};
  for (const c of clients) { by_industry[c.industry] = (by_industry[c.industry] || 0) + 1; by_edition[c.edition] = (by_edition[c.edition] || 0) + 1; }
  return { clients: clients.length, by_industry, by_edition };
}
