// ── The Business Moment Contract (M9.3 — constitution 05 §5) ────────────────
// The first customer-facing intelligence. Moments are deterministic
// translations of M9.2 recommendations into calm merchant language:
//   at most THREE · merged, never itemized · dismissable with memory ·
//   no engineering words · no priority values exposed · no AI · no chat.
export type MomentType =
  | 'good_news' | 'needs_attention' | 'reminder' | 'opportunity'
  | 'celebration' | 'seasonal' | 'business_health' | 'learning';
export type Tone = 'reassuring' | 'attentive' | 'encouraging' | 'celebratory' | 'informative';

/** The frozen 12-field moment contract. */
export interface Moment {
  moment_id: string;                    // deterministic content hash
  timestamp: string;                    // the pass's clock — passed in
  supporting_recommendation_ids: string[];
  moment_type: MomentType;
  headline: string;                     // customer language
  summary: string;                      // customer language
  tone: Tone;
  importance: number;                   // 1–5, INTERNAL — never shown to customers
  dismissable: boolean;
  deduplication_key: string;            // stable per concern; dismissal memory keys on this
  expires_at: string;
  future_follow_up: string | null;      // when a deferred concern may resurface
  // engine fields stored alongside:
  status: 'active' | 'suppressed';
  suppression_reason: string;
  first_seen_at: string;
}

/** What a CUSTOMER may ever see of a moment. No importance, no priority, no
 *  rules, no recommendation internals — enforced by test. */
export interface MomentClientView {
  id: string;
  moment_type: MomentType;
  headline: string;
  summary: string;
  tone: Tone;
  dismissable: boolean;
  created_at: string;
}
export function clientView(row: { id: string; moment_type: MomentType; headline: string; summary: string; tone: Tone; dismissable: boolean; created_at: string }): MomentClientView {
  return { id: row.id, moment_type: row.moment_type, headline: row.headline, summary: row.summary, tone: row.tone, dismissable: row.dismissable, created_at: row.created_at };
}

/** Deterministic content hash — "new evidence exists" is precisely
 *  "this hash changed for the same deduplication_key". */
export function momentHash(siteId: string, key: string, supportingIds: string[]): string {
  const material = siteId + '|' + key + '|' + [...supportingIds].sort().join(',');
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < material.length; i++) {
    const c = material.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) >>> 0;
    h2 = ((h2 << 6) + h2 + c) >>> 0;
  }
  return 'm_' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
