// ── Builder list item 336 (Nov 22 review): a client is told, and gently reminded ──
// Waiting on a client's photos and words is where a web project stalls, and until now
// nothing emailed them about a to-do, a questionnaire, or an approval with no date: an
// approval was chased only when it had a due date (lib/approvals.ts). Now:
//   · one email when a to-do is put to the client, or a questionnaire is posted
//     (emailClientAsk, called from the routes that create or flag them);
//   · a gentle reminder after 3 days and again after 7 while it is still open, for a
//     to-do, an unanswered questionnaire, and a pending approval with no due date
//     (runClientReminders, a step of the daily tick in routes/system.ts, signed as system);
//   · a switch per client in Settings › their portal (portal settings, reminders_off).
// A shared file gets the "shared a file" email it already had (routes/project_delivery.ts)
// and no reminder: a file asks nothing of them.
// The decision is pure (clientReminderDue) and the once-only gate is the row's own
// last_reminded_at, claimed BEFORE the send with the previous value in the WHERE, the
// same race guard the approval sweep uses. Before migration 0252 the to-do and
// questionnaire reads 400 on the missing column and the sweep is a clean no-op.
import { svc } from './db.ts';
import { emailBridgedCustomer } from './service_bridge.ts';
import { loadEmailBrand, EMAIL_BRAND_DEFAULT, emailPreheader } from './email_brand.ts';
import { readPortalSettings } from './portal_settings.ts';

export type ClientAskKind = 'todo' | 'questionnaire' | 'approval';
export type ClientReminderKind = 'day3' | 'day7';
export const REMIND_DAYS: readonly [number, number] = [3, 7];
const DAY_MS = 86_400_000;
const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const escHtml = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** Whole days since an ISO stamp, or null when it isn't a date. Pure. */
export function daysSince(iso: unknown, nowIso: string): number | null {
  const t = Date.parse(String(iso || '')), n = Date.parse(nowIso);
  if (!Number.isFinite(t) || !Number.isFinite(n)) return null;
  return Math.floor((n - t) / DAY_MS);
}

/** Which reminder an open ask is owed today: the 3-day one when none went yet, the 7-day one
 *  when only the 3-day one did (or none, and it is already a week old). Nothing before 3 days,
 *  nothing after the second reminder, nothing for something answered, hidden or dated. Pure. */
export function clientReminderDue(row: { created_at: unknown; last_reminded_at?: unknown; open: boolean; client_visible?: unknown; due_date?: unknown }, nowIso: string): ClientReminderKind | null {
  if (!row.open || row.client_visible === false) return null;
  if (row.due_date) return null;   // a dated approval is the approval sweep's (day before, then daily)
  const age = daysSince(row.created_at, nowIso);
  if (age === null || age < REMIND_DAYS[0]) return null;
  const last = row.last_reminded_at ? Date.parse(String(row.last_reminded_at)) : NaN;
  const created = Date.parse(String(row.created_at));
  if (age < REMIND_DAYS[1]) return Number.isFinite(last) ? null : 'day3';
  // a week or more: the second reminder, unless one already went in this second window
  if (Number.isFinite(last) && last >= created + REMIND_DAYS[1] * DAY_MS) return null;
  return 'day7';
}

const WHAT: Record<ClientAskKind, [string, string]> = {
  todo: ['a to-do', 'it'],
  questionnaire: ['a few questions', 'them'],
  approval: ['something to approve', 'it'],
};

/** The first email, when the ask is put to the client. Pure. */
export function clientAskCopy(kind: ClientAskKind, title: string, studio = ''): { subject: string; html: string; preview: string } {
  const who = String(studio || '').trim() || 'Your studio';
  const name = (title || '').trim() || WHAT[kind][0];
  const verb = kind === 'questionnaire' ? 'Answer them' : kind === 'approval' ? 'Take a look' : 'Open it';
  const subject = `${who} needs something from you: ${name}`;
  const lead = kind === 'todo'
    ? `${escHtml(who)} has a to-do for you: <strong>${escHtml(name)}</strong>.`
    : kind === 'questionnaire'
    ? `${escHtml(who)} has a few questions for you: <strong>${escHtml(name)}</strong>.`
    : `${escHtml(who)} would like your OK on <strong>${escHtml(name)}</strong>.`;
  return { subject, preview: `${verb} in your client portal when you have a minute.`, html: `${emailPreheader(`${verb} in your client portal when you have a minute.`)}<p>${lead}</p><p>${verb} in your client portal when you have a minute. Nothing moves until you do, so there is no rush, and no hurry either.</p>` };
}

/** The gentle reminder, after 3 and after 7 days. Pure. */
export function clientReminderCopy(kind: ClientAskKind, title: string, which: ClientReminderKind, studio = ''): { subject: string; html: string } {
  const who = String(studio || '').trim() || 'Your studio';
  const name = (title || '').trim() || WHAT[kind][0];
  const subject = `A reminder — ${name} is waiting for you`;
  const days = which === 'day3' ? 'a few days' : 'about a week';
  const what = kind === 'questionnaire' ? 'is still waiting for your answers' : kind === 'approval' ? 'is still waiting for your OK' : 'is still waiting on you';
  const close = which === 'day7'
    ? `This is the last reminder we’ll send about it. If something is in the way, just reply to this email and tell ${escHtml(who)}.`
    : `Whenever you have a minute is fine. If you have a question, just reply to this email.`;
  return { subject, html: `${emailPreheader(`${name} ${what}.`)}<p><strong>${escHtml(name)}</strong> ${what}: ${escHtml(who)} sent it ${days} ago.</p><p>${close}</p>` };
}

// ── the first email: called by the routes that put something to the client ──
// One per project every ten minutes: a studio adding five to-dos in a row sends one email
// (the first), and the reminders cover the rest. Best-effort; never throws.
const ASKED = new Map<string, number>();
const ASK_EVERY_MS = 10 * 60_000;
export async function emailClientAsk(agencySiteId: string, projectId: string, kind: ClientAskKind, title: string, nowMs = Date.now()): Promise<boolean> {
  try {
    if (!projectId) return false;
    const last = ASKED.get(projectId) || 0;
    if (nowMs - last < ASK_EVERY_MS) return false;
    if (await remindersOff(agencySiteId, projectId)) return false;
    const studio = await studioName(agencySiteId);
    const copy = clientAskCopy(kind, title, studio);
    const sent = await emailBridgedCustomer(agencySiteId, projectId, copy.subject, copy.html);
    if (sent) { ASKED.set(projectId, nowMs); if (ASKED.size > 2000) ASKED.clear(); }
    return sent;
  } catch { return false; }
}

async function studioName(siteId: string): Promise<string> {
  try { const b = await loadEmailBrand(siteId); return b.name === EMAIL_BRAND_DEFAULT.name ? '' : b.name; } catch { return ''; }
}
/** The studio turned reminders off for this client (Settings › their portal). A failed read
 *  means on: the switch hides nothing by accident, but it never sends by accident either when
 *  the stored list says off. */
async function remindersOff(agencySiteId: string, projectId: string): Promise<boolean> {
  try {
    const link = rows(await svc(`presence_service_links?project_id=eq.${projectId}&agency_site_id=eq.${agencySiteId}&status=eq.active&select=customer_site_id&limit=1`))[0];
    const clientSite = String(link?.customer_site_id || '').toLowerCase();
    if (!clientSite) return false;
    const ps = await readPortalSettings(agencySiteId);
    return ps.reminders_off.includes(clientSite);
  } catch { return false; }
}

// ── the sweep ──
interface AskRow { id: string; site_id: string; project_id: string | null; title?: string; created_at: string; last_reminded_at: string | null; status?: string; client_visible?: boolean; due_date?: string | null }

/** One daily step: to-dos, questionnaires and undated approvals still open after 3 and 7 days.
 *  Reads exclude rows reminded in the last 3 days so a full window never starves the rest. */
export async function runClientReminders(limit = 50, nowIso = new Date().toISOString()): Promise<{ reminded: number; skipped_off: number; skipped_no_email: number }> {
  const nowMs = Date.parse(nowIso);
  const before = new Date(nowMs - REMIND_DAYS[0] * DAY_MS).toISOString();
  const quiet = `or=(last_reminded_at.is.null,last_reminded_at.lt.${encodeURIComponent(before)})`;
  const out = { reminded: 0, skipped_off: 0, skipped_no_email: 0 };
  const reads: Array<[ClientAskKind, string]> = [
    ['todo', `presence_tasks?status=in.(todo,in_progress,blocked)&client_visible=is.true&client_action_required=is.true&deleted_at=is.null&created_at=lte.${encodeURIComponent(before)}&${quiet}&select=id,site_id,project_id,title,created_at,last_reminded_at,status,client_visible&order=created_at.asc&limit=${limit}`],
    ['questionnaire', `presence_surveys?status=eq.active&client_visible=is.true&deleted_at=is.null&created_at=lte.${encodeURIComponent(before)}&${quiet}&select=id,site_id,project_id,title,created_at,last_reminded_at,status,client_visible&order=created_at.asc&limit=${limit}`],
    ['approval', `presence_approvals?status=eq.pending&client_visible=is.true&deleted_at=is.null&due_date=is.null&created_at=lte.${encodeURIComponent(before)}&${quiet}&select=id,site_id,project_id,title,created_at,last_reminded_at,status,client_visible,due_date&order=created_at.asc&limit=${limit}`],
  ];
  const table: Record<ClientAskKind, string> = { todo: 'presence_tasks', questionnaire: 'presence_surveys', approval: 'presence_approvals' };
  for (const [kind, path] of reads) {
    const q = await svc(path).catch(() => ({ ok: false, json: null }));
    if (!q.ok) continue;   // pre-0252 (no last_reminded_at on the table yet): a clean no-op for that kind
    let list = rows(q) as AskRow[];
    if (kind === 'questionnaire' && list.length) {
      // answered questionnaires are done, whatever their status says
      const ids = list.map((s) => s.id).join(',');
      const done = new Set(rows(await svc(`presence_survey_responses?survey_id=in.(${ids})&status=eq.submitted&deleted_at=is.null&select=survey_id&limit=1000`).catch(() => ({ json: [] }))).map((r) => String(r.survey_id)));
      list = list.filter((s) => !done.has(String(s.id)));
    }
    for (const a of list) {
      if (out.reminded >= limit) break;
      const which = clientReminderDue({ created_at: a.created_at, last_reminded_at: a.last_reminded_at, open: true, client_visible: a.client_visible, due_date: a.due_date }, nowIso);
      if (!which || !a.project_id) continue;
      if (await remindersOff(a.site_id, a.project_id)) { out.skipped_off++; continue; }
      // claim first: the previous stamp in the WHERE is the race guard
      const prev = a.last_reminded_at ? `eq.${encodeURIComponent(a.last_reminded_at)}` : 'is.null';
      const claim = await svc(`${table[kind]}?id=eq.${a.id}&site_id=eq.${a.site_id}&last_reminded_at=${prev}&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ last_reminded_at: nowIso }) });
      if (!claim.ok || !rows(claim)[0]) continue;
      const copy = clientReminderCopy(kind, a.title || '', which, await studioName(a.site_id));
      const sent = await emailBridgedCustomer(a.site_id, a.project_id, copy.subject, copy.html);
      if (sent) out.reminded++; else out.skipped_no_email++;
    }
  }
  return out;
}
