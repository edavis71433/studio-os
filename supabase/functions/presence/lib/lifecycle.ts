// ── Site lifecycle (M6 §4) ────────────────────────────────────────────────────
// Admin-driven state machine. The publish pipeline additionally sets 'live' on
// a successful deploy (system transition) — that is the ONLY status write
// outside this map. Illegal transitions fail cleanly with the allowed set.

export const LIFECYCLE_STATES = ['draft', 'provisioning', 'ready', 'live', 'paused', 'archived', 'deleting'] as const;
export type LifecycleState = typeof LIFECYCLE_STATES[number];

const TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  draft: ['provisioning', 'archived'],
  provisioning: ['ready', 'draft'],          // draft = provisioning rolled back
  ready: ['live', 'paused', 'archived'],
  live: ['paused', 'archived'],
  paused: ['live', 'ready', 'archived'],
  archived: ['ready', 'deleting'],
  deleting: [],                              // terminal
};

export function isLifecycleState(s: string): s is LifecycleState {
  return (LIFECYCLE_STATES as readonly string[]).includes(s);
}

export function allowedTransitions(from: string): LifecycleState[] {
  return isLifecycleState(from) ? TRANSITIONS[from] : [];
}

export function canTransition(from: string, to: string): boolean {
  return isLifecycleState(to) && allowedTransitions(from).includes(to);
}

/** States in which NO publish may run (client or admin). */
export const PUBLISH_BLOCKED_STATES: ReadonlyArray<string> = ['archived', 'deleting'];
