// ── The Recommendation Contract (M9.2 — constitution 05 §2/§6) ──────────────
// Recommendation sits strictly between judgment and human decision:
//   consumes ONLY M9.1 judgments · produces ONLY structured recommendation
//   objects · writes NO content · publishes NOTHING · speaks NO customer
//   language · calls NO model.
// Deterministic: same judgments in → byte-identical recommendations out.
//
// Two constitutional constants are part of the TYPE, not configuration:
//   approval_required: true  — nothing auto-completes, ever
//   manual_available: true   — Law 25: every AI action has a manual equivalent
// The database re-enforces both with CHECK constraints (0022).

import type { Priority, Timing, JudgmentCategory } from '../judgment/contract.ts';

export type ActionType =
  | 'create' | 'update' | 'remove' | 'review' | 'verify' | 'monitor'
  | 'connect' | 'complete' | 'refresh' | 'replace' | 'enable' | 'disable';

export type ValueDimension =
  | 'trust' | 'search_visibility' | 'accessibility' | 'customer_experience'
  | 'performance' | 'business_accuracy' | 'reputation' | 'conversion' | 'freshness';

export type Effort = 'minutes' | 'hour' | 'hours' | 'project';
export type Risk = 'none' | 'low' | 'medium';
export type Undoability = 'not_applicable' | 'fully_undoable' | 'versioned';

/** The judgment shape this engine consumes — exactly M9.1's stored fields it needs. */
export interface JudgmentRow {
  judgment_hash: string;
  judgment_key: string;
  rule: string;
  category: JudgmentCategory;
  priority: Priority;
  severity: 'critical' | 'warning' | 'info';
  confidence: number;
  reasoning: string;
  timing: Timing;
  audience: 'customer' | 'operator' | 'none';
  status: 'active' | 'suppressed';
  evidence_count: number;
  evidence_ids: string[];
  first_seen_at: string;
  expires_at: string;
}

/** The frozen 19-field recommendation contract. */
export interface Recommendation {
  recommendation_id: string;            // deterministic content hash
  timestamp: string;                     // the pass's clock — passed in
  supporting_judgment_ids: string[];     // M9.1 judgment_hash values
  category: JudgmentCategory;
  title: string;                         // internal structured title — NOT customer copy
  description: string;                   // internal: what should be done
  reason: string;                        // internal: why — carries the judgment's reasoning
  expected_benefit: string;              // honest, hedged, no invented numbers
  estimated_effort: Effort;
  estimated_risk: Risk;
  undoability: Undoability;
  timing: Timing;
  affected_resources: string[];
  recommended_action: ActionType;        // exactly one action type
  requires_ai: boolean;                  // the proposed workflow uses AI drafting (M9.3+)
  manual_available: true;                // constitutional constant
  approval_required: true;               // constitutional constant
  expiration: string;                    // = min(judgment expirations) + never past rule TTL
  deduplication_key: string;             // stable per (site, rule)
  // engine fields stored alongside the contract:
  rule: string;
  priority: Priority;
  audience: 'customer' | 'operator';
  value_dimensions: ValueDimension[];
  status: 'active' | 'suppressed';
  suppression_reason: string;
  first_seen_at: string;
}

/** Deterministic content hash — same supporting judgments under the same rule
 *  for the same site → the same recommendation_id, always. */
export function recommendationHash(siteId: string, rule: string, judgmentHashes: string[]): string {
  const material = siteId + '|' + rule + '|' + [...judgmentHashes].sort().join(',');
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < material.length; i++) {
    const c = material.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) >>> 0;
    h2 = ((h2 << 6) + h2 + c) >>> 0;
  }
  return 'r_' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
