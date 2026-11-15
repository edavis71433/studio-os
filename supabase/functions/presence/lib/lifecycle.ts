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

/** Publish's rules, for every way of putting a version on the live site (builder item 196,
 *  review finding 35: "Bring back online" skipped them, so a client could put the last version
 *  live on a site their studio had paused). An archived or closing site never goes live; a
 *  paused one only through platform staff. Null when it may. Pure. */
export function publishRefusal(status: string, principalKind: string): { error: string; message: string } | null {
  if (PUBLISH_BLOCKED_STATES.includes(status)) return { error: 'lifecycle_blocked', message: 'This site is archived and can’t be published. Contact your studio to reactivate it.' };
  if (status === 'paused' && principalKind !== 'staff') return { error: 'site_paused', message: 'Your site is currently paused. Contact your studio to resume publishing.' };
  return null;
}
