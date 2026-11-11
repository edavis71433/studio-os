// ── Which of the studio's services a client is offered in their portal ───────
// Nov 10 2026 live walk: the portal's Requests tab listed every service the studio
// keeps (its website offerings and its proposal price list), including ones
// written for a single client ("Artist page intros (11 pages)"), so each client saw
// another client's work and its price. A client now sees the general offers and
// their own.
//
// Neither list says who a service is for, so it is read from what the studio has
// actually quoted, on the proposals and estimates of its deals:
//   • quoted to nobody yet            → general (a published price, say)
//   • quoted to this client           → theirs
//   • quoted to two or more people    → general: it is sold to anyone
//   • quoted to exactly one OTHER one → written for them, so not offered here
// "Who" a deal is for is its contact (the person), else the customer it became,
// else the deal itself. Names match ignoring case and spacing. Pure.
import { splitLineItems } from './sales_lifecycle.ts';

export interface QuotedDeal { id: string; contact_id?: string | null; converted_client_id?: string | null }
export interface QuotedDoc { deal_id?: string | null; line_items?: unknown }

/** One spelling per service name: trimmed, single-spaced, lower case. */
export const serviceKey = (name: unknown): string => String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

const personOf = (d: QuotedDeal): string =>
  d.contact_id ? `contact:${d.contact_id}` : d.converted_client_id ? `client:${d.converted_client_id}` : `deal:${d.id}`;

/** service name → the people it has been quoted to (on any proposal or estimate). */
export function quotedTo(deals: QuotedDeal[], docs: QuotedDoc[]): Map<string, Set<string>> {
  const who = new Map<string, string>();
  for (const d of deals || []) if (d && d.id) who.set(String(d.id), personOf(d));
  const out = new Map<string, Set<string>>();
  for (const doc of docs || []) {
    const person = doc && doc.deal_id ? who.get(String(doc.deal_id)) : undefined;
    if (!person) continue;   // a document on no deal (or one this read didn't see) names nobody
    for (const it of splitLineItems(doc.line_items).items) {
      const k = serviceKey(it.label);
      if (!k) continue;
      if (!out.has(k)) out.set(k, new Set());
      out.get(k)!.add(person);
    }
  }
  return out;
}

/** The people this customer is: whoever each of the deals that became them was for. */
export function peopleOf(customerId: string, deals: QuotedDeal[]): Set<string> {
  const mine = new Set<string>([`client:${customerId}`]);
  for (const d of deals || []) if (d && String(d.converted_client_id || '') === String(customerId)) mine.add(personOf(d));
  return mine;
}

/** May this client be offered the service called `name`? */
export function offeredTo(name: unknown, quoted: Map<string, Set<string>>, mine: Set<string>): boolean {
  const who = quoted.get(serviceKey(name));
  if (!who || !who.size) return true;
  for (const p of who) if (mine.has(p)) return true;
  return who.size >= 2;
}
