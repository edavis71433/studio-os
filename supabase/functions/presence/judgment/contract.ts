// ── The Judgment Contract (M9.1 — constitution 05 §2) ───────────────────────
// Judgment sits strictly between evidence and recommendation:
//   consumes ONLY M9.0 evidence rows · produces ONLY structured judgments ·
//   speaks to NO customer · recommends NOTHING · calls NO model.
// Deterministic by construction: same evidence in, byte-identical judgments
// out — the judgment_hash proves it.

export type Priority = 'critical' | 'high' | 'medium' | 'low' | 'informational';
export type Timing = 'immediate' | 'soon' | 'seasonal' | 'whenever' | 'none';
export type Audience = 'customer' | 'operator' | 'none';
export type JudgmentCategory =
  | 'availability' | 'discoverability' | 'accessibility' | 'accuracy' | 'trust'
  | 'freshness' | 'media' | 'conversion' | 'content' | 'platform' | 'operations';
export type ImpactDimension =
  | 'search_visibility' | 'customer_trust' | 'accessibility' | 'business_accuracy'
  | 'conversion' | 'reputation' | 'performance';

/** The evidence a judgment consumes — exactly the M9.0 stored shape it needs. */
export interface EvidenceRow {
  id: string;
  category: string;
  type: string;
  severity: 'critical' | 'warning' | 'info';
  confidence: number;
  resource: string;
  facts: Record<string, string | number | boolean>;
}

/** The frozen 13-field judgment contract. */
export interface Judgment {
  judgment_id: string;               // deterministic: hash of (site | rule | evidence content)
  timestamp: string;                 // the pass's clock — passed in, never read
  evidence_ids: string[];            // supporting M9.0 rows
  category: JudgmentCategory;
  priority: Priority;
  severity: 'critical' | 'warning' | 'info';
  confidence: number;                // conservative: min of supporting evidence confidences
  reasoning: string;                 // deterministic template — counts, types, thresholds
  business_impact: { dimensions: ImpactDimension[]; note: string };
  customer_impact: string;           // internal explanation (never customer copy)
  timing: Timing;
  dedupe_key: string;                // stable per (site, rule) across runs
  expires_at: string;                // timestamp + rule TTL
  // engine fields (stored alongside the contract):
  rule: string;
  audience: Audience;
  status: 'active' | 'suppressed';
  suppression_reason: string;
  evidence_count: number;
  first_seen_at: string;             // carried from prior batches for the same key
}

/** Deterministic content hash — same evidence set (types+resources+severities)
 *  under the same rule for the same site → the same judgment_id, always. */
export function judgmentHash(siteId: string, rule: string, evidence: EvidenceRow[]): string {
  const material = siteId + '|' + rule + '|' +
    evidence.map((e) => `${e.type}@${e.resource}#${e.severity}`).sort().join(',');
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < material.length; i++) {
    const c = material.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) >>> 0;
    h2 = ((h2 << 6) + h2 + c) >>> 0;
  }
  return 'j_' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export const SEV_RANK: Record<string, number> = { critical: 3, warning: 2, info: 1 };
export const maxSeverity = (ev: EvidenceRow[]): 'critical' | 'warning' | 'info' =>
  ev.reduce((m, e) => (SEV_RANK[e.severity] > SEV_RANK[m] ? e.severity : m), 'info' as 'critical' | 'warning' | 'info');
export const minConfidence = (ev: EvidenceRow[]): number =>
  Math.round(ev.reduce((m, e) => Math.min(m, e.confidence), 1) * 100) / 100;

/** Deterministic reasoning: what was seen, how much, and how severe. */
export function buildReasoning(rule: string, ev: EvidenceRow[], extra: string): string {
  const byType = new Map<string, number>();
  for (const e of ev) byType.set(e.type, (byType.get(e.type) || 0) + 1);
  const parts = [...byType.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([t, n]) => (n > 1 ? `${t}×${n}` : t));
  return `rule=${rule}: ${ev.length} observation${ev.length === 1 ? '' : 's'} [${parts.join(', ')}]; max severity ${maxSeverity(ev)}; min confidence ${minConfidence(ev)}.${extra ? ' ' + extra : ''}`;
}
