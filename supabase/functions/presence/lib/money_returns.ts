// ── Money that went back, for the money reports (sales items 126, 127) ─────────
// presence_money_returns (migration 0233) holds one row per Stripe refund or dispute,
// written by commerce/charge_returns.ts. counted_cents is what comes off the money
// Studio OS counted, on counted_at: a refund when it was made, a lost dispute when it
// closed. Revenue by month (routes/sales.ts), the weekly email (commerce/lifecycle.ts)
// and the bookkeeper file (routes/accounting_export.ts) read the rows with
// RETURNED_SELECT and shape them here, so all three take off the same money in the
// same month. Pure, no imports.

export const RETURNED_SELECT = 'kind,applies_to,invoice_id,deal_id,amount_cents,counted_cents,counted_at,fee_cents,status,happened_at,method';

export interface ReturnedRow { kind?: unknown; applies_to?: unknown; invoice_id?: unknown; deal_id?: unknown; amount_cents?: unknown; counted_cents?: unknown; counted_at?: unknown; fee_cents?: unknown; status?: unknown; happened_at?: unknown; method?: unknown }

const cents = (v: unknown) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? x : 0; };

/** Each counted return as money out of its month: a refund, or a dispute lost, on an
 *  invoice's own payment or a retainer charge. A refund of an extra payment or of money on
 *  a withdrawn invoice was never counted as money in, so it never comes off. Pure. */
export function returnedPayments(rows: unknown): Array<{ amount_cents: number; paid_at: string; retainer: boolean; kind: 'refund' | 'dispute'; invoice_id: string; deal_id: string; bank: boolean }> {
  const out: Array<{ amount_cents: number; paid_at: string; retainer: boolean; kind: 'refund' | 'dispute'; invoice_id: string; deal_id: string; bank: boolean }> = [];
  for (const r of (Array.isArray(rows) ? rows : []) as ReturnedRow[]) {
    if (!r || (r.applies_to !== 'invoice' && r.applies_to !== 'retainer')) continue;
    const c = cents(r.counted_cents);
    const at = String(r.counted_at || '');
    if (c <= 0 || !Number.isFinite(Date.parse(at))) continue;
    out.push({ amount_cents: c, paid_at: at, retainer: r.applies_to === 'retainer', kind: r.kind === 'dispute' ? 'dispute' : 'refund', invoice_id: String(r.invoice_id || ''), deal_id: String(r.deal_id || ''), bank: r.method === 'bank' });
  }
  return out;
}

/** Stripe's dispute fees, each on the day the dispute opened (when Stripe took it), net of
 *  any it gave back. For the bookkeeper file. Pure. */
export function disputeFees(rows: unknown): Array<{ amount_cents: number; paid_at: string; invoice_id: string; deal_id: string; retainer: boolean }> {
  const out: Array<{ amount_cents: number; paid_at: string; invoice_id: string; deal_id: string; retainer: boolean }> = [];
  for (const r of (Array.isArray(rows) ? rows : []) as ReturnedRow[]) {
    if (!r || r.kind !== 'dispute') continue;
    const c = cents(r.fee_cents);
    const at = String(r.happened_at || '');
    if (c <= 0 || !Number.isFinite(Date.parse(at))) continue;
    out.push({ amount_cents: c, paid_at: at, invoice_id: String(r.invoice_id || ''), deal_id: String(r.deal_id || ''), retainer: r.applies_to === 'retainer' });
  }
  return out;
}
