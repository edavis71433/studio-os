// ── Connected Intelligence (L4.2) — connected evidence makes judgment smarter ──
// Connected data must STRENGTHEN the pipeline, never bypass it. It has already
// entered as ordinary evidence (connected/evidence.ts, no bypass); this pure
// module lets that evidence inform OTHER judgments during the judgment pass:
//
//   • CONTRADICT  — a connected fact proves an on-site heuristic wrong, so the
//                   false judgment is suppressed (fewer false positives).
//   • CORROBORATE — a connected fact independently confirms an on-site judgment,
//                   so its confidence is nudged up and its reasoning says why.
//
// It NEVER creates a judgment (new connected concerns are their own rules) and
// NEVER manufactures a contradiction it can't defend. Deterministic: same
// evidence in → same effects out. Data-driven so future providers extend it by
// adding a row, never by touching the engine.
import type { EvidenceRow } from '../judgment/contract.ts';

/** The measured signals we can defend, derived from connected evidence only. */
export interface ConnectedSignals {
  liveActivity: boolean;   // real visitors or real search clicks — the site is provably live & found
  searchActive: boolean;   // people are already arriving from search
  reviewsPresent: boolean; // a connected review source is reporting
}

const factNum = (e: EvidenceRow, k: string): number => {
  const v = e.facts?.[k];
  const n = typeof v === 'number' ? v : Number(v);
  return isFinite(n) ? n : 0;
};

export function deriveSignals(evidence: EvidenceRow[]): ConnectedSignals {
  let liveActivity = false, searchActive = false, reviewsPresent = false;
  for (const e of evidence) {
    if (e.type === 'analytics.connected_traffic' && factNum(e, 'visitors') > 0) liveActivity = true;
    if (e.type === 'seo.connected_search' && factNum(e, 'clicks') > 0) { liveActivity = true; searchActive = true; }
    if (e.type === 'reviews.connected_summary') reviewsPresent = true;
  }
  return { liveActivity, searchActive, reviewsPresent };
}

/** A cross-effect: when a signal holds, a target judgment is contradicted or
 *  corroborated. The `note` is appended to the target's reasoning (auditable). */
export interface ConnectedEffect {
  kind: 'contradict' | 'corroborate';
  when: (s: ConnectedSignals) => boolean;
  targets: string[];        // judgment rule keys
  note: string;
  confidenceBump?: number;  // corroboration only — bounded, capped at 1.0 downstream
}

// Every effect here is one we can defend to a skeptical merchant.
export const CONNECTED_EFFECTS: ConnectedEffect[] = [
  // A site with real visitors or real search clicks is, by definition, live and
  // being found — so an on-site heuristic that thinks it "isn't live yet" is
  // simply wrong. Suppress it rather than send the customer to publish a site
  // that's already up. (The strongest false-positive reduction connected data buys.)
  { kind: 'contradict', when: (s) => s.liveActivity, targets: ['site_not_yet_live'],
    note: 'Connected analytics/search show real recent activity — the site is live and being found, so this is not applicable.' },

  // People already arrive from search: improving the search listing compounds a
  // channel we can independently see is working. Honest corroboration — a nudge,
  // not a certainty; capped so it never overstates.
  { kind: 'corroborate', when: (s) => s.searchActive, targets: ['search_snippets', 'opt_ai_search'],
    note: 'Connected search data shows people already reach you this way — strengthening it compounds real, measured reach.',
    confidenceBump: 0.05 },
];

export interface ConnectedIntelligence {
  contradicts: Set<string>;                        // judgment rule keys to suppress
  boosts: Map<string, { bump: number; note: string }>; // judgment rule key → confidence nudge + reasoning note
}

/** Pure: derive the cross-effects from the evidence set. */
export function deriveConnectedIntelligence(evidence: EvidenceRow[]): ConnectedIntelligence {
  const s = deriveSignals(evidence);
  const contradicts = new Set<string>();
  const boosts = new Map<string, { bump: number; note: string }>();
  for (const eff of CONNECTED_EFFECTS) {
    if (!eff.when(s)) continue;
    for (const t of eff.targets) {
      if (eff.kind === 'contradict') contradicts.add(t);
      else {
        const prev = boosts.get(t);
        const bump = eff.confidenceBump ?? 0;
        // deterministic: strongest single bump wins (no compounding order effects)
        if (!prev || bump > prev.bump) boosts.set(t, { bump, note: eff.note });
      }
    }
  }
  return { contradicts, boosts };
}
