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

// ── client report (pure composition over AUTHORITATIVE rows — no report store) ──
export interface ReportInputs {
  tasks: Array<{ status: TaskStatus; client_action_required?: boolean | null; due_date?: string | null }>;
  milestones: Array<{ status: 'open' | 'complete' }>;
  deliverables: Array<{ status?: string | null }>;
  approvals: Array<{ status?: string | null }>;
  lastActivityAt?: string | null;
  csatRatings?: number[];               // service edge #1: raw CSAT ratings → a COMPUTED average, never a stored metric
}
/** A calm, explainable client summary composed from authoritative rows. Every
 *  number is a direct count of real data — no vanity metrics, no separate store. */
export function reportSummary(inp: ReportInputs, nowIso: string): {
  progress: { total: number; done: number; pct: number };
  milestones: { total: number; complete: number };
  open_client_actions: number;
  overdue_tasks: number;
  pending_approvals: number;
  shared_files: number;
  last_activity_at: string | null;
  csat: { count: number; average: number } | null;
} {
  const progress = progressOf(inp.tasks);
  const milestones = { total: inp.milestones.length, complete: inp.milestones.filter((m) => m.status === 'complete').length };
  const open_client_actions = inp.tasks.filter((t) => t.client_action_required === true && t.status !== 'done').length;
  const overdue_tasks = inp.tasks.filter((t) => deriveTaskState(t, nowIso).overdue).length;
  const pending_approvals = inp.approvals.filter((a) => a.status === 'pending').length;
  const shared_files = inp.deliverables.filter((d) => d.status === 'shared').length;
  // CSAT: a computed average over collected ratings (no separate store). Null = none yet.
  const ratings = (inp.csatRatings || []).filter((n) => Number.isFinite(n) && n >= 1);
  const csat = ratings.length ? { count: ratings.length, average: Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 } : null;
  return { progress, milestones, open_client_actions, overdue_tasks, pending_approvals, shared_files, last_activity_at: inp.lastActivityAt ?? null, csat };
}

// ── the Projects board (bold redesign, Nov 2026): where each project stands and
// whose move it is, so the roster can be a board by stage instead of a table ──
/** The board's columns, in delivery order — the starter template's four
 *  milestones (Kickoff & brief, Design & first draft, Review & revisions,
 *  Launch); each of the ten checklist steps names its own (project_checklist.ts). */
export type ProjectStage = 'kickoff' | 'design' | 'review' | 'launch';
export const PROJECT_STAGES: ProjectStage[] = ['kickoff', 'design', 'review', 'launch'];

/** The stage a milestone's (or a task's) words name — null when they name none.
 *  Launch and review are tried first: "Connect the domain and go live" is launch
 *  work and "Share the draft for your review" is review work, though both also
 *  say what was made. */
export function stageOfWords(s: unknown): ProjectStage | null {
  const t = String(s ?? '').toLowerCase();
  if (!t.trim()) return null;
  if (/\blaunch|go(es)?[ -]?live|site live|\bdomain|hand ?-?(off|over)|publish/.test(t)) return 'launch';
  if (/review|revis|feedback|approv|sign[ -]?off|\bqa\b|\btesting\b/.test(t)) return 'review';
  if (/design|draft|mock ?-?up|wireframe|\bbuild|develop|layout|\bcopy\b|copywrit/.test(t)) return 'design';
  if (/kick ?-?off|brief|discover|onboard|intake|questionnaire|agreement|contract|deposit|content|photos|\blogo|assets|research|\bplan/.test(t)) return 'kickoff';
  return null;
}

export interface BoardTask extends Orderable {
  status: TaskStatus; title?: string | null; client_action_required?: boolean | null;
  source?: string | null; milestone_id?: string | null; due_date?: string | null;
}
export interface BoardMilestone extends Orderable { title?: string | null; status?: string | null; }
export interface BoardApproval { status?: string | null; title?: string | null; created_at?: string | null; }
export interface BoardFacts {
  /** the board column; null only when nothing says (the page shows "No stage yet", never a guess) */
  stage: ProjectStage | null;
  /** the first open task in order — what happens next, and whether it is the client's to do */
  next: { title: string; theirs: boolean; due_date: string | null } | null;
  /** what the client owes: the oldest pending approval, else the next step when it is theirs */
  waiting: { kind: 'approval' | 'task'; title: string } | null;
  /** open tasks past their due date */
  overdue: number;
}
/** Where a project stands and whose move it is, from its own rows — already cut
 *  to the viewer's side (forViewer), so a client never learns of an internal step.
 *  The stage is the first open step's: a checklist step knows its own (the caller
 *  passes the checklist's lookup, project_checklist.ts checklistStageOf, so this
 *  file stays import-free), any other task takes its milestone's words and then
 *  its own. With no open task saying, the first open milestone that does. Then the
 *  ends: every step done → launch (it is finishing); nothing done yet → kickoff
 *  (it is starting). Pure. */
export function boardFacts(inp: { tasks: BoardTask[]; milestones: BoardMilestone[]; approvals: BoardApproval[] }, nowIso: string, stageOfSource: (source: unknown) => ProjectStage | null = () => null): BoardFacts {
  const tasks = [...(inp.tasks || [])].sort(compareOrder);
  const milestones = [...(inp.milestones || [])].sort(compareOrder);
  const msTitle = new Map(milestones.map((m) => [String(m.id || ''), m.title]));
  const open = tasks.filter((t) => t.status !== 'done');
  const stageOfTask = (t: BoardTask): ProjectStage | null =>
    stageOfSource(t.source) || stageOfWords(t.milestone_id ? msTitle.get(String(t.milestone_id)) : '') || stageOfWords(t.title);
  let stage: ProjectStage | null = null;
  for (const t of open) { stage = stageOfTask(t); if (stage) break; }
  if (!stage) for (const m of milestones) { if (m.status !== 'complete') { stage = stageOfWords(m.title); if (stage) break; } }
  if (!stage && ((tasks.length && !open.length) || (!tasks.length && milestones.length && milestones.every((m) => m.status === 'complete')))) stage = 'launch';
  if (!stage && !tasks.some((t) => t.status === 'done')) stage = 'kickoff';
  const n = open[0];
  const next = n ? { title: String(n.title ?? '').trim(), theirs: n.client_action_required === true, due_date: n.due_date || null } : null;
  const pending = (inp.approvals || []).filter((a) => a.status === 'pending')
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const waiting: BoardFacts['waiting'] = pending.length ? { kind: 'approval', title: String(pending[0].title ?? '').trim() }
    : (next && next.theirs ? { kind: 'task', title: next.title } : null);
  const overdue = open.filter((t) => deriveTaskState(t, nowIso).overdue).length;
  return { stage, next, waiting, overdue };
}
