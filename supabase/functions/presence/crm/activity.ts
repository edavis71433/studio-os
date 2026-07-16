// ── /crm/activity — the ONE record timeline, as pure logic (slice 1) ─────────
// The Lightning-record-page activity timeline: every channel /crm/messages
// merges today (project messages, support threads + replies, the originating
// enquiry, bookings, logged activities, broadcasts) PLUS the system events the
// site timeline (/crm/timeline) and the deal event ledger contribute, shaped
// into ONE contract the record page renders:
//
//   { data: { upcoming: UpcomingItem[], items: ActivityItem[] } }
//
// This module is PURE (no network, no clock beyond passed-in `now`): per-source
// normalizers → ActivityItem, the reverse-chronological merge, and the
// "Upcoming & Overdue" derivation (open deal to-dos, the deal's next step,
// unpaid invoices). The impure route (routes/crm.ts handleCrmActivity) reuses
// the SAME per-channel readers /crm/messages and /crm/timeline already use —
// a read-time merge, no new tables ("one log, derived views"). Tested in
// isolation (tests/presence/crm_activity_test.mjs).
import type { TimelineItem } from './contract.ts';
import { describeSystemEvent, isActivityRow } from './deal_activity.ts';

// The six timeline types — each drives one icon + one connector color on the
// record page. Everything must land in exactly one of these.
export type ActivityType = 'message' | 'email' | 'call' | 'task' | 'note' | 'system';

export interface ActivityItem {
  id: string;
  kind: string;            // source channel (message|support|support_reply|enquiry|booking|broadcast|activity|deal_event|task|publish|change|connected|moment|approval|note|lead)
  type: ActivityType;      // drives the icon/color
  title: string;           // the actor line ("You logged a call…")
  body: string | null;     // expandable detail; null = nothing to expand
  at: string;              // ISO
  meta: string | null;     // channel tag label ("Support · open")
  href: string | null;     // deep link, when one exists
}

export interface UpcomingItem {
  kind: 'task' | 'next_step' | 'invoice';
  id: string | null;       // deal-task id (the checkbox target); null otherwise
  title: string;
  due: string | null;      // ISO date, when known
  overdue: boolean;
  href: string | null;
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const str = (v: unknown) => (v == null ? '' : String(v));
const orNull = (s: string) => (s ? s : null);

// ── /crm/messages items → ActivityItems ──────────────────────────────────────
// Input shape: the item objects handleCrmMessages already produces
// ({ kind, from, subject?, status?, activity_kind?, body, created_at }).
// The sent-document stamps (proposal_sent/contract_sent/invoice_sent) return
// null here — the deal event ledger renders them with richer labels/amounts.
const SENT_STAMPS = ['proposal_sent', 'contract_sent', 'invoice_sent'];
export function mapConversationItem(m: any): ActivityItem | null {
  if (!m || !m.created_at) return null;
  const at = str(m.created_at);
  const id = `conv:${str(m.kind)}:${str(m.id)}`;
  const mine = m.from === 'studio';
  const body = orNull(str(m.body));
  switch (m.kind) {
    case 'message':
      return { id, kind: 'message', type: 'message', title: mine ? 'You sent a message' : 'The client sent a message', body, at, meta: null, href: null };
    case 'support':
      return {
        id, kind: 'support', type: 'message',
        title: `${mine ? 'You' : 'The client'} opened a support request${m.subject ? ` — ${str(m.subject)}` : ''}`,
        body, at, meta: `Support${m.status ? ' · ' + str(m.status).replace(/_/g, ' ') : ''}`,
        href: m.support_id ? `/projects.html?support=${str(m.support_id)}` : null,
      };
    case 'support_reply':
      return { id, kind: 'support_reply', type: 'message', title: mine ? 'You replied' : 'The client replied', body, at, meta: 'Support', href: m.support_id ? `/projects.html?support=${str(m.support_id)}` : null };
    case 'enquiry':
      return { id, kind: 'enquiry', type: 'message', title: 'The client reached out from your website', body, at, meta: 'Website enquiry', href: null };
    case 'booking':
      return { id, kind: 'booking', type: 'call', title: str(m.subject) || 'The client booked a call', body, at, meta: 'Booking', href: null };
    case 'broadcast':
      return { id, kind: 'broadcast', type: 'email', title: `You sent a broadcast${m.subject ? ` — ${str(m.subject)}` : ''}`, body, at, meta: 'Broadcast', href: null };
    case 'activity': {
      const ak = str(m.activity_kind);
      if (SENT_STAMPS.includes(ak)) return null;   // the deal ledger covers these
      const map: Record<string, { type: ActivityType; title: string; meta: string }> = {
        call: { type: 'call', title: 'You logged a call', meta: 'Logged call' },
        email: { type: 'email', title: 'You logged an email', meta: 'Logged email' },
        meeting: { type: 'call', title: 'You logged a meeting', meta: 'Meeting' },
        note: { type: 'note', title: 'You added a note', meta: 'Note' },
      };
      const t = map[ak] || { type: 'note' as ActivityType, title: 'You logged an activity', meta: 'Activity' };
      return { id, kind: 'activity', type: t.type, title: t.title, body, at, meta: t.meta, href: null };
    }
    default:
      return null;
  }
}

// ── site-ops timeline items (/crm/timeline shape) → ActivityItems ────────────
const SITE_META: Record<string, string> = {
  publish: 'Website', change: 'Website', connected: 'Connected', moment: 'Moment',
  approval: 'Approval', lead: 'Enquiry',
};
export function mapSiteEvent(t: TimelineItem): ActivityItem | null {
  if (!t || !t.at) return null;
  if (t.kind === 'note') {
    return {
      id: `site:${t.id}`, kind: 'note', type: 'note', title: t.title || 'Note',
      body: orNull(str(t.detail)), at: t.at,
      meta: t.audience === 'internal' ? 'Internal note' : 'Shared note', href: null,
    };
  }
  return {
    id: `site:${t.id}`, kind: str(t.kind), type: 'system', title: t.title || cap(str(t.kind)),
    body: orNull(str(t.detail)), at: t.at, meta: SITE_META[str(t.kind)] || null, href: null,
  };
}

// ── deal system events (presence_deal_events rows) → ActivityItems ───────────
// Manual activities (kind='note' + detail.activity_kind) are already carried by
// the conversation channel — return null for them so nothing appears twice.
export function mapDealEvent(row: any, dealId: string): ActivityItem | null {
  if (!row || !row.created_at) return null;
  if (isActivityRow(row) || row.kind === 'note') return null;   // manual activities ride the conversation channel
  return {
    id: `deal:${str(row.id)}`, kind: 'deal_event', type: 'system',
    title: describeSystemEvent(row), body: null, at: str(row.created_at),
    meta: 'Deal', href: dealId ? `/pipeline.html?deal=${dealId}` : null,
  };
}

// ── completed deal to-dos → ActivityItems (the Tasks filter's history) ───────
export function mapDoneTask(row: any, dealId: string): ActivityItem | null {
  if (!row || row.status !== 'done') return null;
  const at = str(row.completed_at || row.created_at);
  if (!at) return null;
  return {
    id: `task:${str(row.id)}`, kind: 'task', type: 'task',
    title: `To-do completed — ${str(row.title) || 'To-do'}`, body: null, at,
    meta: 'To-do', href: dealId ? `/pipeline.html?deal=${dealId}` : null,
  };
}

/** Merge normalized items into ONE reverse-chronological timeline, capped. */
export function mergeActivity(groups: (ActivityItem | null)[][], limit = 400): ActivityItem[] {
  const all: ActivityItem[] = [];
  for (const g of groups) for (const it of (Array.isArray(g) ? g : [])) if (it && it.at) all.push(it);
  all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return all.slice(0, limit);
}

// ── Upcoming & Overdue ────────────────────────────────────────────────────────
// Open deal to-dos with (optional) due dates + the deal's next step + unpaid
// invoices. `now` is passed in (pure); date-only strings compare on the day.
const dayOf = (iso: string) => str(iso).slice(0, 10);
export function buildUpcoming(
  inp: { tasks?: any[]; deal?: { id?: string; next_step?: string; next_step_at?: string | null } | null; invoices?: any[] },
  nowIso: string,
): UpcomingItem[] {
  const today = dayOf(nowIso);
  const out: UpcomingItem[] = [];
  const dealHref = inp.deal?.id ? `/pipeline.html?deal=${str(inp.deal.id)}` : null;
  for (const t of (Array.isArray(inp.tasks) ? inp.tasks : [])) {
    if (!t || t.status !== 'open') continue;
    const due = t.due_date ? str(t.due_date) : null;
    out.push({ kind: 'task', id: str(t.id) || null, title: str(t.title) || 'To-do', due, overdue: !!(due && dayOf(due) < today), href: dealHref });
  }
  const ns = str(inp.deal?.next_step).trim();
  if (ns) {
    const due = inp.deal?.next_step_at ? str(inp.deal.next_step_at) : null;
    out.push({ kind: 'next_step', id: null, title: `Next step — ${ns}`, due, overdue: !!(due && dayOf(due) < today), href: dealHref });
  }
  for (const iv of (Array.isArray(inp.invoices) ? inp.invoices : [])) {
    if (!iv || iv.status !== 'open') continue;
    const due = iv.due_date ? str(iv.due_date) : null;
    const amt = Number(iv.amount_cents) || 0;
    const usd = amt ? '$' + Math.round(amt / 100).toLocaleString('en-US') : '';
    out.push({
      kind: 'invoice', id: null,
      title: `Unpaid invoice${iv.title ? ` — ${str(iv.title)}` : ''}${usd ? ` (${usd})` : ''}`,
      due, overdue: !!(due && dayOf(due) < today),
      href: iv.deal_id ? `/pipeline.html?deal=${str(iv.deal_id)}` : dealHref,
    });
  }
  // soonest first; undated items last, overdue naturally floats up
  out.sort((a, b) => {
    if (!a.due && !b.due) return 0;
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
  });
  return out;
}
