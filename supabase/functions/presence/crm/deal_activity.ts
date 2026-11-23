// ── Deal activity (per-deal timeline + quick-log) — PURE logic ───────────────
// The highest-value CRM gap: a solo owner logging a call / email / meeting /
// dated note on a deal, interleaved with the deal's system event history, so
// "when did I last talk to them, and what did we say?" is answerable at a glance.
//
// STORAGE (no migration): a manual activity rides the EXISTING presence_deal_events
// table as a `kind='note'` row — a value permitted by that table's CHECK constraint
// since migration 0074 — whose jsonb `detail` carries { activity_kind, body,
// occurred_at } and whose existing `actor`/`created_at` columns record who + when
// it was logged. `occurred_at` (the operator's dated "when it happened") is the
// effective time the timeline orders by, so a back-dated note lands in its right
// place; `created_at` stays the immutable audit trail of when it was entered.
//
// This module is PURE (no network, no clock beyond passed-in `now`): kind/body
// validation + escaping, the merge of activities + system events into ONE
// reverse-chronological timeline, and the "last contacted" derivation. Tested in
// isolation (tests/presence/deal_activity_test.mjs).
import { declineWords } from '../lib/agreement_layout.ts';   // sales item 88
import { humanWhen } from './contract.ts';
import { estimateEventLine } from '../lib/estimates.ts';            // item 47
import { recurringEventLine } from '../lib/recurring_invoices.ts';

export type DealActivityKind = 'call' | 'email' | 'meeting' | 'note';
export const DEAL_ACTIVITY_KINDS: readonly DealActivityKind[] = ['call', 'email', 'meeting', 'note'];
export function isDealActivityKind(k: unknown): k is DealActivityKind {
  return typeof k === 'string' && DEAL_ACTIVITY_KINDS.includes(k as DealActivityKind);
}

// A note may need text; a logged call/email/meeting is meaningful on its own.
export function activityNeedsBody(kind: DealActivityKind): boolean { return kind === 'note'; }

// Strip control chars (keeps \t \x09 and \n \x0A); the value is HTML-escaped
// again at render time.
const CONTROL = /[\x00-\x08\x0B-\x1F\x7F]/g;
/** Clean an operator-typed activity body: strip control chars, trim, cap length.
 *  Storage-safe; the value is HTML-escaped again at render time. */
export function cleanActivityBody(s: unknown, max = 2000): string {
  return String(s ?? '').replace(CONTROL, '').trim().slice(0, max);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** Normalize the operator's "when it happened". Accepts an ISO date (YYYY-MM-DD,
 *  anchored to noon UTC so it lands on the intended day in every timezone) or a
 *  full ISO datetime. Anything invalid or empty falls back to `nowIso`. A dated
 *  log is about the past/now, so a future value is clamped to `nowIso`. Returns
 *  an ISO string. */
export function normalizeOccurredAt(input: unknown, nowIso: string): string {
  const parsedNow = Date.parse(nowIso);
  const nowMs = Number.isFinite(parsedNow) ? parsedNow : Date.now();
  if (typeof input === 'string' && input.trim()) {
    const s = input.trim();
    const ms = DATE_ONLY.test(s) ? Date.parse(s + 'T12:00:00.000Z') : Date.parse(s);
    if (Number.isFinite(ms)) return new Date(Math.min(ms, nowMs)).toISOString();
  }
  return new Date(nowMs).toISOString();
}

/** The jsonb `detail` payload for a manual-activity presence_deal_events row. */
export function buildActivityDetail(kind: DealActivityKind, body: string, occurredAt: string) {
  return { activity_kind: kind, body, occurred_at: occurredAt };
}

// ── display normalization ────────────────────────────────────────────────────
const ACTIVITY_ICON: Record<DealActivityKind, string> = { call: '📞', email: '✉️', meeting: '🤝', note: '📝' };
const ACTIVITY_VERB: Record<DealActivityKind, string> = { call: 'Logged a call', email: 'Logged an email', meeting: 'Logged a meeting', note: 'Note' };
const SYS_LABEL: Record<string, string> = {
  created: 'Deal created', stage_change: 'Moved stage', proposal_sent: 'Proposal sent',
  proposal_decided: 'Proposal decision', contract_sent: 'Agreement sent', contract_signed: 'Agreement signed',
  invoice_sent: 'Invoice sent', invoice_paid: 'Invoice paid', converted: 'Converted to a customer',
  // item 107 (J8): these three fell through to "invoice voided" in lower case
  invoice_voided: 'Invoice voided', proposal_deleted: 'Draft proposal removed', contract_deleted: 'Draft agreement removed',
  // sales items 162, 165, 166 (0249)
  invoice_changed: 'Invoice changed', invoice_reminded: 'Reminder sent', money_back: 'Money given back',
};
// Item 69: the client opened a document's page (routes/sales.ts firstOpen) — "They
// opened your proposal". pipeline.html mirrors these by hand, like SYS_LABEL.
const OPENED_WHAT: Record<string, string> = { proposal: 'proposal', agreement: 'agreement', invoice: 'invoice', deposit: 'deposit request', estimate: 'estimate' };
/** "They opened your proposal". Pure. */
export function openedLine(what: unknown): string {
  return 'They opened your ' + (OPENED_WHAT[String(what || '')] || 'document');
}
const STAGE_LABEL: Record<string, string> = { lead: 'New lead', qualified: 'Qualified', proposal: 'Proposal sent', contract: 'Agreement out', won: 'Won', lost: 'Not a fit' };

/** Money the way the record prints it: whole dollars when whole, else two
 *  decimals — "$1,250" and "$1,250.50", never "$1,250.5" (item 107, J7). Empty
 *  for nothing. Pure; crm/activity.ts uses it for the Upcoming band too. */
export function usd(cents: unknown): string {
  const n = Math.round(Number(cents));
  if (!Number.isFinite(n) || n === 0) return '';
  const whole = n % 100 === 0;
  return (n < 0 ? '−$' : '$') + (Math.abs(n) / 100).toLocaleString('en-US', whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── sales item 191 (Nov 22 2026 review): what changed on a deal, in its history ──
// Ticking the next step, or changing the value, close date or owner, left no line.
// Each is now a `kind='note'` row (allowed since 0074, so no migration) whose detail
// carries { change, from, to } or { change: 'step_done', step }. It has no
// activity_kind, so nothing counts it as a call, email, meeting or note.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Nov 3" for a date in `year`, else "Nov 3, 2027". Empty for nothing. Pure. */
export function dayWords(ymd: unknown, year?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  if (!m) return '';
  return `${MONTHS[Number(m[2]) - 1] || ''} ${Number(m[3])}` + (year && year === m[1] ? '' : `, ${m[1]}`);
}
export type DealChange = { change: 'value' | 'close' | 'owner'; from: unknown; to: unknown } | { change: 'step_done'; step: string };
/** The history lines one saved change to a deal writes: `before` is the deal as it was, `patch`
 *  what was saved, `stepDone` that the next step was ticked (a cleared one alone writes nothing). Pure. */
export function dealChanges(before: Record<string, unknown>, patch: Record<string, unknown>, stepDone = false): DealChange[] {
  const out: DealChange[] = [];
  if ('expected_value_cents' in patch) {
    const from = Math.trunc(Number(before?.expected_value_cents) || 0), to = Math.trunc(Number(patch.expected_value_cents) || 0);
    if (from !== to) out.push({ change: 'value', from, to });
  }
  if ('expected_close' in patch) {
    const from = String(before?.expected_close || '').slice(0, 10) || null, to = String(patch.expected_close || '').slice(0, 10) || null;
    if (from !== to) out.push({ change: 'close', from, to });
  }
  if ('assigned_to' in patch) {
    const from = before?.assigned_to ? String(before.assigned_to) : null, to = patch.assigned_to ? String(patch.assigned_to) : null;
    if (from !== to) out.push({ change: 'owner', from, to });
  }
  const step = String(before?.next_step || '').trim();
  if (stepDone && step && 'next_step' in patch && !String(patch.next_step || '').trim()) out.push({ change: 'step_done', step: step.slice(0, 200) });
  return out;
}
/** One change line in words. `year` is the line's own year, so a date in it reads "Nov 3". Pure. */
export function dealChangeLine(d: any, year?: string): string {
  if (d?.change === 'step_done') return 'Done: ' + String(d.step || 'the next step');
  if (d?.change === 'value') {
    const from = usd(d.from), to = usd(d.to);
    return from && to ? `Value changed from ${from} to ${to}` : to ? `Value set to ${to}` : from ? `Value cleared (it was ${from})` : 'Value changed';
  }
  if (d?.change === 'close') {
    const from = dayWords(d.from, year), to = dayWords(d.to, year);
    return from && to ? `Close date moved from ${from} to ${to}` : to ? `Close date set to ${to}` : from ? `Close date cleared (it was ${from})` : 'Close date changed';
  }
  if (d?.change === 'owner') return 'Owner changed';   // the page names them: only it knows the team's names
  return 'Deal changed';
}

/** "$2,916" when a decision filled in the deal's value (value_backfilled_cents), else "". Pure. */
function valueFilled(d: Record<string, unknown>): string {
  return Number(d.value_backfilled_cents) > 0 ? usd(d.value_backfilled_cents) : '';
}

/** Plain-language label for a SYSTEM deal event (mirrors pipeline.html's evtLabel
 *  so the merged server timeline reads identically to the legacy History strip). */
export function describeSystemEvent(row: any): string {
  const d = (row && typeof row.detail === 'object' && row.detail) || {};
  const k = row?.kind;
  if (k === 'stage_change' && row?.to_stage) return 'Moved to ' + (STAGE_LABEL[row.to_stage] || row.to_stage);
  if (k === 'note' && d.change) return dealChangeLine(d, String(row?.created_at || '').slice(0, 4));   // sales item 191
  // sales item 88: a decline says what would make it a yes; a signature names the studio's countersigner too
  // sales item 136: an accept that filled in the deal's value says so, since the price change is part
  // of the record (value_backfilled_cents rides the event, routes/sales.ts). It said only "Proposal accepted".
  if (k === 'proposal_decided' && d.decision) return d.decision === 'accepted' ? 'Proposal accepted' + (valueFilled(d) ? ' — deal value set to ' + valueFilled(d) : '') : 'Proposal declined' + (declineWords(d.reason, d.note) ? ' — ' + declineWords(d.reason, d.note) : '');
  if (k === 'estimate_decided' && d.decision === 'approved' && valueFilled(d)) return estimateEventLine(k, d) + ' (deal value set to ' + valueFilled(d) + ')';   // item 136: an approved estimate fills it too
  if (k === 'contract_signed' && d.signer) return 'Agreement signed — ' + d.signer + (d.countersigned_by ? ', countersigned by ' + d.countersigned_by : '');
  if (k === 'client_question') return 'They asked' + (d.on === 'contract' ? ' about the agreement' : d.on === 'estimate' ? ' about the estimate' : ' about the proposal') + (d.text ? ': “' + String(d.text).slice(0, 140) + (String(d.text).length > 140 ? '…' : '') + '”' : '');
  if (k === 'invoice_sent' && d.amount_cents && d.recurring_id) return 'Recurring invoice sent' + (usd(d.amount_cents) ? ' — ' + usd(d.amount_cents) : '') + (d.period ? ` (${d.period})` : '');   // item 47
  if (k === 'invoice_sent' && d.amount_cents) return (d.purpose === 'deposit' ? 'Deposit requested' : 'Invoice sent') + (usd(d.amount_cents) ? ' — ' + usd(d.amount_cents) : '');
  // item 108 (J4): a retainer charge writes no invoice — it is a retainer payment, not "Invoice paid"
  if (k === 'invoice_paid' && d.amount_cents) return (d.retainer ? 'Retainer payment' : d.purpose === 'deposit' ? 'Deposit paid' : 'Invoice paid') + (usd(d.amount_cents) ? ' — ' + usd(d.amount_cents) : '');
  // item 107 (J8): the withdrawn invoice and the removed drafts name what they were
  if (k === 'invoice_voided') return (d.purpose === 'deposit' ? 'Deposit request voided' : 'Invoice voided') + (d.title ? ' — ' + String(d.title) : '') + (usd(d.amount_cents) ? (d.title ? ` (${usd(d.amount_cents)})` : ' — ' + usd(d.amount_cents)) : '');
  if ((k === 'proposal_deleted' || k === 'contract_deleted') && d.title) return SYS_LABEL[k] + ' — ' + String(d.title);
  if (k === 'doc_opened') return openedLine(d.what);
  if (k === 'estimate_sent' || k === 'estimate_decided' || k === 'estimate_deleted') return estimateEventLine(k, d);   // item 47
  if (k === 'recurring_invoice') return recurringEventLine(d);
  // sales items 126, 127 (and item 118's Undo): money given back rides payment_undone; its detail says which
  if (k === 'payment_undone') return moneyBackLine(d);
  // sales items 162, 165, 166: a changed invoice names its changes; a reminder and money back name the amount
  if (k === 'invoice_changed') return (d.purpose === 'deposit' ? 'Deposit request changed' : 'Invoice changed') + (Array.isArray(d.words) && d.words.length ? ' — ' + d.words.join('; ') : '');
  if (k === 'invoice_reminded') return 'Reminder sent by hand' + (usd(d.amount_cents) ? ' — ' + usd(d.amount_cents) : '');
  if (k === 'money_back') return 'Money given back' + (usd(d.amount_cents) ? ' — ' + usd(d.amount_cents) : '') + (d.method ? ' by ' + String(d.method).replace('_', ' ') : '') + (d.note ? ' · ' + String(d.note).slice(0, 120) : '');
  return SYS_LABEL[k] || String(k || '').replace(/_/g, ' ');
}

/** A payment_undone event in words: a refund made in Stripe, a dispute opening or closing,
 *  or a payment recorded by hand and undone. pipeline.html's evtLabel carries a copy. Pure. */
export function moneyBackLine(d: any): string {
  const a = usd(d?.amount_cents) ? ' — ' + usd(d.amount_cents) : '';
  if (d?.refund) return (d.applies_to === 'extra' ? 'Extra payment refunded' : d.applies_to === 'void' ? 'Payment on a withdrawn invoice refunded' : d.full ? 'Refunded in full' : 'Refunded') + a;
  if (d?.dispute === 'opened' || d?.dispute === 'reopened') return (d.inquiry ? 'Card company asked about the payment' : d.bank ? 'Bank payment disputed' : d.dispute === 'reopened' ? 'Dispute reopened' : 'Payment disputed') + a;
  if (d?.dispute === 'won') return 'Dispute won' + a;
  if (d?.dispute === 'closed') return 'Card company’s question closed';
  if (d?.dispute === 'lost') return 'Dispute lost' + a;
  return 'Payment undone' + a;
}

export interface DealTimelineItem {
  id: string;
  at: string;                    // effective ISO time the timeline orders by
  logged_at: string;             // when the row was actually entered (audit)
  source: 'activity' | 'system';
  kind: string;                  // activity_kind for activities; event kind for system
  icon: string;                  // emoji for activities; '' for system rows
  who: string;                   // actor (email/name/'system')
  text: string;                  // plain-language line to render (escape at render)
  backdated: boolean;            // an activity logged for an earlier day than entered
  // sales item 186: a hand-logged line can be corrected or removed (routes/sales_history.ts)
  log_id?: string;               // the row's own id, for PATCH /sales/logs/:id
  body?: string;                 // the words as logged ('' for a call logged without any)
  via?: string;                  // '' by hand · 'app' sent from Studio OS · 'bcc' logged from your BCC
  edited_at?: string | null;     // when it was last corrected
  mine?: boolean;                // the reader logged it by hand (set by the route: only it knows who reads)
  // sales item 191: a change line says what changed, so the page can name a new owner
  change?: { kind: string; from: unknown; to: unknown };
}

/** Sales item 186: a removed log keeps its row (Recently deleted brings it back for 30 days) as
 *  activity_kind 'removed', its words moved under `removed`, so nothing reads it as a call,
 *  email, meeting or note, and a search of the words never finds it. Pure. */
export function isRemovedLog(row: any): boolean {
  const d = row && typeof row.detail === 'object' ? row.detail : null;
  return row?.kind === 'note' && !!d && d.activity_kind === 'removed';
}
/** A line Studio OS wrote itself, which stays as it happened: an email it sent (via 'app'), one
 *  logged from your BCC address (via 'bcc'), and the "Welcome email re-sent to …" line the re-send
 *  writes. That line carries via 'app' since Nov 23 2026; the ones before it are known by their
 *  words (the live check of sales item 186 found them offering Change). Pure. */
export function writtenByStudioOs(d: { via?: unknown; body?: unknown } | null | undefined): boolean {
  return !!String(d?.via ?? '') || /^Welcome email re-sent to /.test(String(d?.body ?? ''));
}
/** The timeline as one reader sees it: their own hand-logged lines say so (`mine`), never one
 *  Studio OS wrote (writtenByStudioOs). `actor` is who reads. Pure. */
export function markMine<T extends { source?: string; who?: string; via?: string; body?: string }>(items: T[], actor: string): Array<T & { mine?: boolean }> {
  const me = String(actor || '').trim().toLowerCase();
  return items.map((it) => (it.source === 'activity' && me && !writtenByStudioOs(it) && String(it.who || '').trim().toLowerCase() === me ? { ...it, mine: true } : it));
}

/** Is this raw presence_deal_events row a manual (operator-logged) activity? */
export function isActivityRow(row: any): boolean {
  const d = row && typeof row.detail === 'object' ? row.detail : null;
  return row?.kind === 'note' && !!d && isDealActivityKind(d.activity_kind);
}

/** Normalize ONE raw presence_deal_events row (manual activity OR system event)
 *  into a display item. `idx` provides a stable key when the row carries no id. */
export function mapDealTimelineItem(row: any, idx = 0): DealTimelineItem {
  const createdAt = String(row?.created_at || '');
  const who = String(row?.actor || '');
  const d = (row && typeof row.detail === 'object' && row.detail) || {};
  if (isActivityRow(row)) {
    const ak = d.activity_kind as DealActivityKind;
    const at = (typeof d.occurred_at === 'string' && d.occurred_at) || createdAt;
    const body = typeof d.body === 'string' ? d.body : '';
    return {
      id: row?.id ? `act:${row.id}` : `act:${idx}`,
      at, logged_at: createdAt, source: 'activity', kind: ak, icon: ACTIVITY_ICON[ak],
      who, text: body || ACTIVITY_VERB[ak],
      backdated: !!(at && createdAt && at.slice(0, 10) !== createdAt.slice(0, 10)),
      ...(row?.id ? { log_id: String(row.id) } : {}), body, via: typeof d.via === 'string' ? d.via : '',
      edited_at: typeof d.edited_at === 'string' ? d.edited_at : null,
    };
  }
  return {
    id: row?.id ? `evt:${row.id}` : `evt:${idx}`,
    at: createdAt, logged_at: createdAt, source: 'system', kind: String(row?.kind || ''), icon: '',
    who, text: describeSystemEvent(row), backdated: false,
    ...(row?.kind === 'note' && d.change ? { kind: 'deal_change', change: { kind: String(d.change), from: d.from ?? null, to: d.to ?? null } } : {}),
  };
}

/** Merge raw deal-event rows (activities + system events, one table) into ONE
 *  reverse-chronological timeline by EFFECTIVE time (occurred_at for activities,
 *  created_at for system events). Pure — the caller supplies the rows. */
export function mergeDealTimeline(rows: any[]): DealTimelineItem[] {
  const items = (Array.isArray(rows) ? rows : []).filter((r) => !isRemovedLog(r)).map((r, i) => mapDealTimelineItem(r, i)).filter((x) => x.at);
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return items;
}

/** The effective time of the most recent MANUAL activity (any kind) on a deal —
 *  the "last contacted" signal an owner most wants at a glance. Null if the deal
 *  has never been logged against. Ignores system events. Pure. */
export function lastContactedAt(rows: any[]): string | null {
  let best: string | null = null;
  for (const r of (Array.isArray(rows) ? rows : [])) {
    if (!isActivityRow(r)) continue;
    const d = r.detail;
    const at = (typeof d.occurred_at === 'string' && d.occurred_at) || String(r.created_at || '');
    if (at && (!best || at > best)) best = at;
  }
  return best;
}

/** Calm "Last contacted <relative date>" (reuses the CRM's humanWhen). Empty when
 *  never contacted. Pure. */
export function lastContactedLabel(iso: string | null, nowIso: string): string {
  if (!iso) return '';
  return `Last contacted ${humanWhen(iso, nowIso)}`;
}
