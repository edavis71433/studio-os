// ── Invoice billing rules the record and the deal page share (sales items 107, 108) ──
// Pure: no I/O, no clock beyond what the caller passes. routes/sales.ts reads
// the rows and asks these; tests/presence/invoice_billing_test.mjs pins them.

/** What the accepted proposal still has to bill: its total, less every invoice
 *  already raised on the deal (open or paid, any purpose: a deposit is part of
 *  the price). Voided, removed and recurring ones don't count; a recurring
 *  invoice is a separate bill on a schedule, never a piece of the proposal.
 *  Item 107 (J2): "+ Invoice" left blank bills THIS, not the whole total again. */
export function leftToBill(proposalTotalCents: unknown, invoices: unknown): { total_cents: number; billed_cents: number; left_cents: number } {
  const total = Math.max(0, Math.round(Number(proposalTotalCents) || 0));
  let billed = 0;
  for (const i of (Array.isArray(invoices) ? invoices : []) as any[]) {
    if (!i || i.deleted_at || i.recurring_id) continue;
    const s = String(i.status || 'open');
    if (s !== 'open' && s !== 'paid') continue;
    billed += Math.max(0, Math.round(Number(i.amount_cents) || 0));
  }
  return { total_cents: total, billed_cents: billed, left_cents: Math.max(0, total - billed) };
}

/** When "+ Invoice" finds an OPEN invoice of the same kind on the deal, what
 *  happens — the old rule re-sent it whatever the page asked for:
 *    mismatch    a different amount (typed, or what's left of the proposal):
 *                never send the old amount; let the operator choose
 *    repair      same amount, never sent (its payment link failed): finish it
 *    double_tap  same amount, sent under two minutes ago: no second email
 *    ask         same amount, already sent: re-sending it is the operator's
 *                call, never an unasked side effect of "+ Invoice" (J2)
 *  Pure. */
export type ReuseDecision = 'mismatch' | 'repair' | 'double_tap' | 'ask';
export const DOUBLE_TAP_MS = 120_000;
export function reuseDecision(open: { amount_cents?: unknown; stripe_url?: unknown; updated_at?: unknown; created_at?: unknown }, wantCents: number, nowMs: number): ReuseDecision {
  if (Math.round(Number(open?.amount_cents) || 0) !== Math.round(Number(wantCents) || 0)) return 'mismatch';
  if (!open?.stripe_url) return 'repair';
  const lastTouch = Date.parse(String(open?.updated_at || open?.created_at || '')) || 0;
  return (nowMs - lastTouch) < DOUBLE_TAP_MS ? 'double_tap' : 'ask';
}

/** Retainer payments on a deal. A retainer charge settles in Stripe and writes
 *  only a deal event (`invoice_paid` with detail.retainer), never an invoice row,
 *  so the record's Paid left it out (item 108, J4). Pure. */
export function retainerPaid(events: unknown): { cents: number; count: number; last_at: string | null } {
  let cents = 0, count = 0; let last: string | null = null;
  for (const e of (Array.isArray(events) ? events : []) as any[]) {
    const d = e && typeof e.detail === 'object' && e.detail ? e.detail : null;
    if (!e || e.kind !== 'invoice_paid' || !d || d.retainer !== true) continue;
    const amt = Math.round(Number(d.amount_cents) || 0);
    if (amt <= 0) continue;
    cents += amt; count++;
    const at = String(e.created_at || '');
    if (at && (!last || at > last)) last = at;
  }
  return { cents, count, last_at: last };
}
