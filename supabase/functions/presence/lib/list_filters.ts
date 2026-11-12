// ── Field filters on a list (sales item 90, Nov 2026) ───────────────────────
// Salesforce's list views filter on any field. Ours are a handful of ready ones,
// not a builder: not contacted in 30, 60 or 90 days, owes you money, no deal yet,
// closing this month, added this month, and how they found you. A saved view keeps
// them (lib/saved_views.ts). Pipeline filters the deals it holds; Contacts asks the
// server, which reads its list a page at a time (routes/sales.ts). Pure: the route
// reads the rows, this decides.
import { normalizeFoundVia } from './found_via.ts';
import { isDealActivityKind } from '../crm/deal_activity.ts';

export const QUIET_DAYS = [30, 60, 90] as const;
export type QuietDays = typeof QUIET_DAYS[number];
export interface ListFilters { quiet?: QuietDays; owes?: true; nodeal?: true; closing?: true; added?: true; via?: string }

/** Only the filters this file knows, each in its one shape; nothing else survives. */
export function normalizeListFilters(raw: unknown): ListFilters {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const out: ListFilters = {};
  const q = Math.trunc(Number(r.quiet));
  if ((QUIET_DAYS as readonly number[]).includes(q)) out.quiet = q as QuietDays;
  for (const k of ['owes', 'nodeal', 'closing', 'added'] as const) if (r[k] === true || r[k] === 1 || r[k] === '1' || r[k] === 'true') out[k] = true;
  const via = normalizeFoundVia(r.via);
  if (via) out.via = via;
  return out;
}
export const hasListFilters = (f: ListFilters | null | undefined): boolean => !!f && Object.keys(f).length > 0;

/** When "not contacted in N days" starts: N days before now. */
export function quietCutoff(days: number, nowMs: number): string {
  return new Date(nowMs - days * 86_400_000).toISOString();
}

/** The people contacted on or after `cutoffIso`: a call, email, meeting or dated note
 *  logged on one of their deals (the deals list's own "Last contacted" rule), by the
 *  day it happened. `dealContact` names each deal's person. */
export function contactedContactIds(events: any[], dealContact: Map<string, string>, cutoffIso: string): Set<string> {
  const out = new Set<string>();
  for (const e of Array.isArray(events) ? events : []) {
    const d = e && e.detail && typeof e.detail === 'object' ? e.detail : null;
    if (!d || !isDealActivityKind(d.activity_kind)) continue;
    const at = (typeof d.occurred_at === 'string' && d.occurred_at) || String(e.created_at || '');
    if (!at || at < cutoffIso) continue;
    const who = dealContact.get(String(e.deal_id || ''));
    if (who) out.add(who);
  }
  return out;
}

/** The people who owe you money: an invoice still waiting on them (open, and not a
 *  payment already on its way) on one of their deals, or on the customer they belong
 *  to. `clientContacts` names the people behind each customer. */
export function owingContactIds(invoices: any[], dealContact: Map<string, string>, clientContacts: Map<string, string[]>): Set<string> {
  const out = new Set<string>();
  for (const i of Array.isArray(invoices) ? invoices : []) {
    if (!i || String(i.status || '') !== 'open' || i.processing_since) continue;
    const who = dealContact.get(String(i.deal_id || ''));
    if (who) out.add(who);
    for (const c of clientContacts.get(String(i.customer_client_id || '')) || []) out.add(c);
  }
  return out;
}

/** The ids in their order, keeping only those in `only` (when given) and none in `not`. */
export function keepIds(ordered: string[], only: Set<string> | null, not: Array<Set<string>>): string[] {
  return ordered.filter((id) => (!only || only.has(id)) && !not.some((s) => s.has(id)));
}

/** The first day of the month `ymd` is in (YYYY-MM-01), for "added this month" and "closing this month". */
export function monthStart(ymd: string): string {
  return /^\d{4}-\d{2}/.test(String(ymd)) ? String(ymd).slice(0, 7) + '-01' : '';
}
