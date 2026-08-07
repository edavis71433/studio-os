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
  // The obvious to-dos AT this stage — what the deal page offers in its to-do
  // dropdown so the box is never a blank "what do I write here?". Short
  // imperatives, each within the server's 200-char task-title cap. OPTIONAL on
  // the interface so nothing that already reads StageGuidance breaks; every
  // shipped stage below carries one, and each item stays fully editable before
  // it's added (they are starting points, not a checklist to obey).
  todos?: string[];
}

// Every stage in the ladder has a tip + a suggested action. Plain words, no
// jargon, no pressure — the wording an owner reads on the deal.
export const PIPELINE_GUIDANCE: Record<Stage, StageGuidance> = {
  lead: {
    tip: 'A new enquiry — reach out while they’re still interested.',
    suggested_action: 'Get in touch and learn what they need',
    todos: ['Call them', 'Send an intro email', 'Book a discovery call', 'Look at their current site'],
  },
  qualified: {
    tip: 'They’re a fit. Show them what working together looks like.',
    suggested_action: 'Send a proposal they can accept online',
    todos: ['Send the proposal', 'Confirm scope and budget', 'Set a decision date'],
  },
  proposal: {
    tip: 'Your proposal is with them — a gentle nudge often seals it.',
    suggested_action: 'Follow up, then send the agreement once they say yes',
    todos: ['Follow up on the proposal', 'Answer their questions', 'Send the agreement once they say yes'],
  },
  contract: {
    tip: 'Agreement’s out — once they sign, they can pay right away.',
    suggested_action: 'Get it signed, then request the deposit',
    todos: ['Follow up on the agreement', 'Request the deposit', 'Book the kickoff call'],
  },
  won: {
    tip: 'They’re your customer now. Time to do great work.',
    suggested_action: 'Open their project and kick things off',
    todos: ['Open their project', 'Send the welcome + kickoff details', 'Collect content and access'],
  },
  lost: {
    tip: 'Not every deal fits — the door stays open for later.',
    suggested_action: 'Keep the relationship warm; reopen if things change',
    todos: ['Note why it didn’t fit', 'Set a reminder to check back'],
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
