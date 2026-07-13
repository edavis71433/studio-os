// ── Pipeline "Path" guidance — the calm one-line tip + next action per stage ──
// A non-technical owner should NEVER wonder "what do I do next" on a deal. This
// is the single source of truth for the per-stage guidance the pipeline drawer
// shows and the Kanban board leans on. Pure data + tiny helpers (no DB, no
// network) so pipeline.html mirrors it inline and a test can prove it covers the
// whole ladder. The stages themselves come from lib/sales_lifecycle.ts — this
// module never invents a stage; it just says what to do at each one.
import { STAGES, canTransition, type Stage } from './sales_lifecycle.ts';

export interface StageGuidance {
  tip: string;              // one calm line — the "where you are"
  suggested_action: string; // the plain next thing to do
}

// Every stage in the ladder has a tip + a suggested action. Plain words, no
// jargon, no pressure — the wording an owner reads on the deal.
export const PIPELINE_GUIDANCE: Record<Stage, StageGuidance> = {
  lead: {
    tip: 'A new enquiry — reach out while they’re still interested.',
    suggested_action: 'Get in touch and learn what they need',
  },
  qualified: {
    tip: 'They’re a fit. Show them what working together looks like.',
    suggested_action: 'Send a proposal they can accept online',
  },
  proposal: {
    tip: 'Your proposal is with them — a gentle nudge often seals it.',
    suggested_action: 'Follow up, then send the agreement once they say yes',
  },
  contract: {
    tip: 'Agreement’s out — once they sign, they can pay right away.',
    suggested_action: 'Get it signed, then request the deposit',
  },
  won: {
    tip: 'They’re your customer now. Time to do great work.',
    suggested_action: 'Open their project and kick things off',
  },
  lost: {
    tip: 'Not every deal fits — the door stays open for later.',
    suggested_action: 'Keep the relationship warm; reopen if things change',
  },
};

/** The guidance for a stage (falls back to the lead guidance for a stray value). Pure. */
export function guidanceFor(stage: string): StageGuidance {
  return PIPELINE_GUIDANCE[stage as Stage] || PIPELINE_GUIDANCE.lead;
}

/** The stages a deal at `from` may be MOVED to on the board — exactly the
 *  canTransition-allowed targets (so 'won', a convert-only outcome, is never
 *  offered). Pure; the board mirrors this and the server re-checks canTransition. */
export function boardMoveTargets(from: Stage): Stage[] {
  return STAGES.filter((to) => canTransition(from, to));
}
