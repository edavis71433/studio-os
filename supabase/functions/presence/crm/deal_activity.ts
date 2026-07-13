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
import { humanWhen } from './contract.ts';

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
};
const STAGE_LABEL: Record<string, string> = { lead: 'New lead', qualified: 'Qualified', proposal: 'Proposal sent', contract: 'Agreement out', won: 'Won', lost: 'Not a fit' };

function usd(cents: unknown): string {
  const n = Number(cents);
  if (!Number.isFinite(n) || n === 0) return '';
  return '$' + (n / 100).toLocaleString('en-US', { minimumFractionDigits: 0 });
}

/** Plain-language label for a SYSTEM deal event (mirrors pipeline.html's evtLabel
 *  so the merged server timeline reads identically to the legacy History strip). */
export function describeSystemEvent(row: any): string {
  const d = (row && typeof row.detail === 'object' && row.detail) || {};
  const k = row?.kind;
  if (k === 'stage_change' && row?.to_stage) return 'Moved to ' + (STAGE_LABEL[row.to_stage] || row.to_stage);
  if (k === 'proposal_decided' && d.decision) return d.decision === 'accepted' ? 'Proposal accepted' : 'Proposal declined';
  if (k === 'contract_signed' && d.signer) return 'Agreement signed — ' + d.signer;
  if (k === 'invoice_sent' && d.amount_cents) return (d.purpose === 'deposit' ? 'Deposit requested' : 'Invoice sent') + (usd(d.amount_cents) ? ' — ' + usd(d.amount_cents) : '');
  if (k === 'invoice_paid' && d.amount_cents) return (d.purpose === 'deposit' ? 'Deposit paid' : 'Invoice paid') + (usd(d.amount_cents) ? ' — ' + usd(d.amount_cents) : '');
  return SYS_LABEL[k] || String(k || '').replace(/_/g, ' ');
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
    };
  }
  return {
    id: row?.id ? `evt:${row.id}` : `evt:${idx}`,
    at: createdAt, logged_at: createdAt, source: 'system', kind: String(row?.kind || ''), icon: '',
    who, text: describeSystemEvent(row), backdated: false,
  };
}

/** Merge raw deal-event rows (activities + system events, one table) into ONE
 *  reverse-chronological timeline by EFFECTIVE time (occurred_at for activities,
 *  created_at for system events). Pure — the caller supplies the rows. */
export function mergeDealTimeline(rows: any[]): DealTimelineItem[] {
  const items = (Array.isArray(rows) ? rows : []).map((r, i) => mapDealTimelineItem(r, i)).filter((x) => x.at);
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
