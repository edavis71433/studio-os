// ── Notifications — pure derivation (Presence CMS Phase 2, P2-D-3) ───────────
// Notifications are a VIEW over the project activity log (presence_project_events)
// — never a second store. These pure helpers map an event to a human label + a
// deep link to its source, and compute read/unread against a last-seen marker.

export function isAudience(x: unknown): x is 'internal' | 'client' {
  return x === 'internal' || x === 'client';
}

/** Deep link to the source of an activity event. Pure. */
export function notifHref(kind: string, projectId: string | null, detail: Record<string, unknown> = {}): string {
  const base = projectId ? `/projects/${projectId}` : '';
  switch (kind) {
    case 'approval_requested':
    case 'approval_decided':
      return base + (detail && detail.approval_id ? `#approval-${detail.approval_id}` : '#approvals');
    case 'message': return base + '#messages';
    case 'deliverable_added': return base + '#files';
    case 'task_created':
    case 'task_status_change':
      return base + (detail && detail.task_id ? `#task-${detail.task_id}` : '#tasks');
    case 'milestone_created':
    case 'milestone_completed':
      return base + '#milestones';
    case 'survey_requested':
    case 'survey_submitted':
      return base + '#surveys';
    case 'support_opened':
    case 'support_message':
    case 'support_resolved':
      return detail && detail.request_id ? `/support#request-${detail.request_id}` : '/support';
    default: return base;
  }
}

/** A short human label for an activity event. Pure. */
export function notifLabel(kind: string): string {
  const m: Record<string, string> = {
    project_created: 'Project started',
    status_change: 'Project status changed',
    task_created: 'A task was added',
    task_status_change: 'A task moved',
    milestone_created: 'A milestone was set',
    milestone_completed: 'A milestone was completed',
    deliverable_added: 'A file was shared',
    approval_requested: 'Your approval is requested',
    approval_decided: 'An approval was decided',
    message: 'New message',
    client_action: 'Action needed',
    survey_requested: 'A survey is ready for you',
    survey_submitted: 'A survey was submitted',
    support_opened: 'A support request was opened',
    support_message: 'New reply on a support request',
    support_resolved: 'A support request was resolved',
    note: 'A note was added',
  };
  return m[kind] || 'Activity';
}

/** Read = created strictly at or before the last-seen mark. Pure. */
export function isRead(createdAtIso: string, lastSeenIso: string | null): boolean {
  if (!lastSeenIso) return false;
  const c = Date.parse(createdAtIso), s = Date.parse(lastSeenIso);
  return Number.isFinite(c) && Number.isFinite(s) && c <= s;
}
