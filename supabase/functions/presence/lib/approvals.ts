// ── Approvals — pure decision logic (Presence CMS Phase 2, P2-D) ─────────────
// One generic approval that references the exact item + version. The version is a
// content_hash (SHA-256), and a decision is only valid from 'pending' AND only
// when the presented hash matches the stored one — the same version-integrity
// idiom as contract signing (lib/sales_lifecycle.ts). Pure (no DB, no network).

export type ApprovalDecision = 'approved' | 'rejected' | 'changes_requested';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'changes_requested' | 'superseded';
export type SubjectType = 'deliverable' | 'task' | 'project' | 'custom';

export function isDecision(x: unknown): x is ApprovalDecision {
  return x === 'approved' || x === 'rejected' || x === 'changes_requested';
}
export function isSubjectType(x: unknown): x is SubjectType {
  return x === 'deliverable' || x === 'task' || x === 'project' || x === 'custom';
}
/** A decision is valid only from 'pending' (idempotent-safe: an already-decided or
 *  superseded approval is refused, so a stale/superseded version can't be decided). */
export function canDecideApproval(current: ApprovalStatus): boolean {
  return current === 'pending';
}

/** SHA-256 hex over the EXACT identity + version marker a reviewer sees, so a
 *  decision binds to that version and can never apply to a changed item. Pure. */
export async function approvalHash(subjectType: string, subjectId: string, versionMarker: string): Promise<string> {
  const material = `${subjectType}:${subjectId}:${versionMarker}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ═══ Due dates + reminders (studio audit, Oct 2026, change 8) ════════════════
// An approval may carry `due_date` (date, migration 0135). The reminder sweep
// (commerce/lifecycle.runApprovalReminders) decides with the pure rule below and
// records `last_reminded_at` as its once-per-day gate. Benchmark: Basecamp's
// Clientside reminds 24h before the due date and daily when overdue.

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date in YYYY-MM-DD, or null. Pure. */
export function cleanDueDate(x: unknown): string | null {
  const s = String(x ?? '').trim().slice(0, 10);
  const m = ISO_DATE.exec(s);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;   // Feb 30 etc.
  return s;
}

/** "October 24, 2026" — the one way a due date reads in mail and notices. Pure. */
export function dueDateText(dueDate: string): string {
  return new Date(`${String(dueDate).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export type ApprovalReminderKind = 'day_before' | 'overdue';

/** Whole UTC days from today (nowIso) to the due date: 1 = tomorrow, 0 = today,
 *  -1 = yesterday. null when either side is not a date. Pure. */
export function daysUntilDue(dueDate: string | null | undefined, nowIso: string): number | null {
  const due = cleanDueDate(dueDate);
  const today = cleanDueDate(String(nowIso || '').slice(0, 10));
  if (!due || !today) return null;
  return Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

/** THE reminder rule. Which reminder, if any, a pending client-visible approval
 *  is owed right now:
 *    · 'day_before' — the due date is tomorrow
 *    · 'overdue'    — the due date has passed (every day, until decided)
 *    · null         — no due date; due today or later than tomorrow; not pending;
 *                     not client-visible; or already reminded today (UTC)
 *  Once per day: `last_reminded_at` on the same UTC date as `nowIso` → null.
 *  Pure, clock-free (the caller passes now). */
export function approvalReminderDue(
  a: { status?: string; client_visible?: boolean; due_date?: string | null; last_reminded_at?: string | null },
  nowIso: string,
): ApprovalReminderKind | null {
  if (a.status !== 'pending' || a.client_visible !== true) return null;
  const days = daysUntilDue(a.due_date, nowIso);
  if (days === null) return null;
  const kind: ApprovalReminderKind | null = days === 1 ? 'day_before' : days < 0 ? 'overdue' : null;
  if (!kind) return null;
  if (a.last_reminded_at && String(a.last_reminded_at).slice(0, 10) === String(nowIso).slice(0, 10)) return null;
  return kind;
}

const escHtml = (s: string) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

/** The client's reminder — subject and body. Calm, dated, nothing moves without
 *  them. Pure. */
export function approvalReminderCopy(title: string, dueDate: string, kind: ApprovalReminderKind): { subject: string; html: string } {
  const name = (title || '').trim() || 'something your studio shared';
  const when = dueDateText(dueDate);
  const subject = `A reminder — ${name} is waiting for your OK`;
  const lead = kind === 'day_before'
    ? `Your studio would like your answer on <strong>${escHtml(name)}</strong> by <strong>${when}</strong> — that's tomorrow.`
    : `<strong>${escHtml(name)}</strong> was due <strong>${when}</strong> and is still waiting for your OK.`;
  return { subject, html: `<p>${lead}</p><p>Nothing goes ahead without you — approve it, or tell your studio what to change, when you have a minute.</p>` };
}

/** The studio's one overdue notice per approval (kind 'approval_overdue'). The
 *  period names the project so the bell can deep-link it; the approval id keeps
 *  it once-ever per request (a re-request is a new approval, a new row). Pure. */
export function approvalOverduePeriod(projectId: string, approvalId: string): string {
  return `approval:${projectId}:${approvalId}`;
}
export function projectIdOfApprovalPeriod(period: unknown): string | null {
  const m = /^approval:([0-9a-f-]{36}):[0-9a-f-]{36}$/i.exec(String(period ?? ''));
  return m ? m[1] : null;
}
export function approvalOverdueCopy(title: string, dueDate: string): { headline: string; body: string } {
  const name = (title || '').trim() || 'an approval';
  return {
    headline: `Still waiting on the client — ${name}`,
    body: `Their answer was due ${dueDateText(dueDate)}. They've been reminded by email and will be again each day — a personal note usually lands best from here.`,
  };
}
