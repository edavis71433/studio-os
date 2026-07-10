// ── Service delivery — pure decision logic (Presence CMS Phase 2, P2-D) ──────
// Project/task/milestone status ladders, overdue/blocked derivation, deterministic
// ordering, pagination, and the client-visibility projection — all pure (no DB, no
// network) so the delivery rules are unit-testable and deterministic.
// routes/projects.ts wires these to the site-scoped tables.

// ── project status ──
export type ProjectStatus = 'active' | 'on_hold' | 'complete' | 'archived';
export const PROJECT_STATUSES: ProjectStatus[] = ['active', 'on_hold', 'complete', 'archived'];
// Bounded: active↔on_hold, either → complete, anything → archived, archived reopens to active.
const PROJECT_NEXT: Record<ProjectStatus, ProjectStatus[]> = {
  active: ['on_hold', 'complete', 'archived'],
  on_hold: ['active', 'complete', 'archived'],
  complete: ['active', 'archived'],
  archived: ['active'],
};
export function isProjectStatus(s: unknown): s is ProjectStatus {
  return typeof s === 'string' && (PROJECT_STATUSES as string[]).includes(s);
}
export function canProjectTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  if (from === to) return false;
  return (PROJECT_NEXT[from] || []).includes(to);
}

// ── task status ──
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done';
export const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'blocked', 'done'];
// todo↔in_progress, either active state → blocked or done, blocked → todo/in_progress,
// done reopens to todo/in_progress. No arbitrary jumps.
const TASK_NEXT: Record<TaskStatus, TaskStatus[]> = {
  todo: ['in_progress', 'blocked', 'done'],
  in_progress: ['todo', 'blocked', 'done'],
  blocked: ['todo', 'in_progress'],
  done: ['todo', 'in_progress'],
};
export function isTaskStatus(s: unknown): s is TaskStatus {
  return typeof s === 'string' && (TASK_STATUSES as string[]).includes(s);
}
export function canTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return false;
  return (TASK_NEXT[from] || []).includes(to);
}
export type TaskPriority = 'low' | 'normal' | 'high';
export function isTaskPriority(p: unknown): p is TaskPriority {
  return p === 'low' || p === 'normal' || p === 'high';
}

// ── derived task state (never stored — computed from due_date + status) ──
export interface TaskLike { status: TaskStatus; due_date?: string | null; }
/** Overdue = past its due date and not done. Blocked = status blocked. Pure over
 *  an ISO `now` so it's deterministic in tests. `due_date` is an ISO date (YYYY-MM-DD). */
export function deriveTaskState(task: TaskLike, nowIso: string): { overdue: boolean; blocked: boolean; open: boolean } {
  const open = task.status !== 'done';
  const blocked = task.status === 'blocked';
  let overdue = false;
  if (open && task.due_date && /^\d{4}-\d{2}-\d{2}$/.test(task.due_date)) {
    const due = Date.parse(task.due_date + 'T23:59:59.999Z');
    const now = Date.parse(nowIso);
    overdue = Number.isFinite(due) && Number.isFinite(now) && due < now;
  }
  return { overdue, blocked, open };
}

// ── deterministic ordering: sort_order asc, then created_at asc, then id asc ──
export interface Orderable { sort_order?: number | null; created_at?: string | null; id?: string | null; }
export function compareOrder(a: Orderable, b: Orderable): number {
  const sa = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : 0;
  const sb = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 0;
  if (sa !== sb) return sa - sb;
  const ca = String(a.created_at || ''), cb = String(b.created_at || '');
  if (ca !== cb) return ca < cb ? -1 : 1;
  return String(a.id || '') < String(b.id || '') ? -1 : 1;
}
/** Next sort_order after the current max (append at the end, deterministic). */
export function nextSortOrder(existing: Array<{ sort_order?: number | null }>): number {
  let max = -1;
  for (const e of existing) { const n = Number(e.sort_order); if (Number.isFinite(n) && n > max) max = n; }
  return max + 1;
}

// ── client-visibility projection ──
/** May this row be shown to the CLIENT side (the customer / reviewer)? The studio
 *  side sees everything; the client side sees only client_visible rows. Pure. */
export function visibleToClient(row: { client_visible?: boolean | null }, isStudio: boolean): boolean {
  return isStudio || row.client_visible === true;
}
/** Filter a list for the caller's side. */
export function forViewer<T extends { client_visible?: boolean | null }>(rows: T[], isStudio: boolean): T[] {
  return isStudio ? rows : rows.filter((r) => r.client_visible === true);
}

// ── pagination (bounded list queries) ──
export const DEFAULT_PAGE = 25;
export const MAX_PAGE = 100;
export function clampLimit(raw: unknown): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PAGE;
  return Math.min(MAX_PAGE, n);
}
export function clampOffset(raw: unknown): number {
  return Math.max(0, Math.trunc(Number(raw)) || 0);
}

// ── progress summary (pure roll-up for reporting/UI; computed, not stored) ──
export interface TaskCount { status: TaskStatus; }
export function progressOf(tasks: TaskCount[]): { total: number; done: number; pct: number } {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, pct };
}
