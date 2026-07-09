// ── Phase T · Launches (FD-T7) — the named-release STATE MACHINE (pure) ───────
// A Launch is a NAMED STAGED SNAPSHOT that flows through the ONE publishing
// pipeline. It reuses:
//   • serializeDraft        → capture the staged version (a normal snapshot)
//   • runPipeline(publish)  → atomic promote (one publish record, one deploy)
//   • runPipeline(restore)  → rollback (restore the pre-promote live snapshot)
//   • presence_scheduled_publishes + the existing cron → scheduled launch
//   • the site-role `approve` capability + writeChangeEvent → review/approval
// No second publishing engine, scheduler, or renderer. This file is only the pure
// state machine + validation — the I/O lives in routes/launches.ts.

export type LaunchStatus = 'draft' | 'approved' | 'scheduled' | 'published' | 'rolled_back' | 'canceled';
export const LAUNCH_STATUSES: readonly LaunchStatus[] = ['draft', 'approved', 'scheduled', 'published', 'rolled_back', 'canceled'];

/** Recapture pulls the current draft into the launch again; allowed while it's
 *  still being shaped (draft/approved). Re-capturing an approved launch reverts it
 *  to draft — the changed content must be re-approved (no silent approval drift). */
export const canRecapture = (s: LaunchStatus): boolean => s === 'draft' || s === 'approved';
export const canApprove = (s: LaunchStatus): boolean => s === 'draft';
export const canSchedule = (s: LaunchStatus): boolean => s === 'approved';
export const canPromote = (s: LaunchStatus): boolean => s === 'approved';
export const canRollback = (s: LaunchStatus): boolean => s === 'published';
export const canCancel = (s: LaunchStatus): boolean => s === 'draft' || s === 'approved' || s === 'scheduled';
export const isTerminal = (s: LaunchStatus): boolean => s === 'rolled_back' || s === 'canceled';

/** The status after recapture (approved → draft; draft stays draft). */
export const statusAfterRecapture = (s: LaunchStatus): LaunchStatus => (s === 'approved' ? 'draft' : s);

/** Trim + cap a launch name; empty → a sensible default. Pure. */
export function cleanLaunchName(raw: unknown): string {
  let s = '';
  for (const ch of String(raw ?? '')) { const c = ch.codePointAt(0)!; if (c >= 32) s += ch; }
  s = s.replace(/\s+/g, ' ').trim().slice(0, 80);
  return s || 'Untitled launch';
}

/** Whether a scheduled_for ISO string is a valid future moment relative to nowIso.
 *  Pure (both injected). Rejects non-parseable or past times. */
export function isValidSchedule(scheduledForIso: string, nowIso: string): boolean {
  const t = Date.parse(scheduledForIso), n = Date.parse(nowIso);
  return Number.isFinite(t) && Number.isFinite(n) && t > n;
}

/** The customer-facing one-liner for a launch state (Law 13: plain language). */
export function launchStatusLabel(s: LaunchStatus): string {
  switch (s) {
    case 'draft': return 'Being prepared';
    case 'approved': return 'Approved — ready to launch';
    case 'scheduled': return 'Scheduled';
    case 'published': return 'Launched';
    case 'rolled_back': return 'Rolled back';
    case 'canceled': return 'Canceled';
  }
}
