// ── What reached the bank (sales item 133; Stripe review Nov 15 2026, finding 7) ──
// The bookkeeper file listed what clients paid. Stripe keeps its fee from each payment
// and sends the rest out in payouts, about two business days later, so no line in the
// file matched anything that arrived. This folds Stripe's own record into it:
//   each payment's fee, matched to its invoice by the notes Stripe copies from the
//     payment onto its charge (presence_invoice_id; every pay link puts them on the
//     payment), and for a retainer charge by the Stripe invoice it paid
//   the payout that carried each payment, and the day that payout arrived
//   payouts.csv: one row per payout due in the days asked for, with what made it up, so
//     each row matches one deposit
// Pure: routes/accounting_export.ts reads Stripe (commerce/stripe.ts) and hands it here.
import { usDate } from './accounting_export.ts';

export interface PaymentFee { charge: string; intent: string; invoice: string; gross_cents: number; fee_cents: number; net_cents: number; created: number; payout: string; paid_out_on: string }
export interface Ledger { byInvoice: Map<string, PaymentFee>; byIntent: Map<string, PaymentFee>; byCharge: Map<string, PaymentFee> }

const int = (v: unknown) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };
const idOf = (v: unknown) => String((typeof v === 'string' ? v : v && typeof v === 'object' ? (v as { id?: unknown }).id : '') || '');
// a card payment is type charge, a bank payment type payment; both come from a charge
const isPayment = (t: any) => !!t && (t.type === 'charge' || t.type === 'payment');
const dollars = (c: number) => (Math.round(c) / 100).toFixed(2);

/** A payment's balance transaction, its source expanded to the charge, as a fee line;
 *  null for anything that isn't a payment. Pure. */
export function paymentFee(bt: any): PaymentFee | null {
  if (!isPayment(bt)) return null;
  const src = bt.source && typeof bt.source === 'object' ? bt.source : null;
  const meta = src && src.metadata && typeof src.metadata === 'object' ? src.metadata : {};
  return { charge: idOf(bt.source), intent: idOf(src?.payment_intent), invoice: String(meta.presence_invoice_id || ''), gross_cents: int(bt.amount), fee_cents: int(bt.fee), net_cents: int(bt.net), created: int(bt.created), payout: '', paid_out_on: '' };
}

/** The payments, findable three ways. An invoice paid twice keeps its first payment;
 *  the second still counts in its payout's totals. Pure. */
export function indexPayments(bts: unknown): Ledger {
  const l: Ledger = { byInvoice: new Map(), byIntent: new Map(), byCharge: new Map() };
  const fees = (Array.isArray(bts) ? bts : []).map(paymentFee).filter((f): f is PaymentFee => !!f).sort((a, b) => a.created - b.created);
  for (const f of fees) {
    if (f.charge && !l.byCharge.has(f.charge)) l.byCharge.set(f.charge, f);
    if (f.intent && !l.byIntent.has(f.intent)) l.byIntent.set(f.intent, f);
    if (f.invoice && !l.byInvoice.has(f.invoice)) l.byInvoice.set(f.invoice, f);
  }
  return l;
}

/** The day a payout arrives. Stripe sends it as midnight UTC of that day, so it is read
 *  in UTC: the studio's own clock would move it to the day before in the Americas. Pure. */
export const arrivalYmd = (sec: unknown): string => { const n = Number(sec); return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString().slice(0, 10) : ''; };

/** Mark each payment with the payout that carried it. `carried` maps a payout's id to the
 *  balance transactions Stripe says it paid out. Fills the ledger's lines in place. */
export function attachPayouts(l: Ledger, payouts: unknown, carried: Map<string, unknown[]>): void {
  for (const po of (Array.isArray(payouts) ? payouts : []) as any[]) {
    for (const t of carried.get(String(po?.id || '')) || []) {
      if (!isPayment(t)) continue;
      const f = l.byCharge.get(idOf((t as any).source));
      if (f && !f.payout) { f.payout = String(po.id); f.paid_out_on = arrivalYmd(po.arrival_date); }
    }
  }
}

/** Stripe's side of one row of payments.csv: an invoice paid through Stripe, else a
 *  retainer charge by the Stripe invoice it paid (`intentOf` maps that to its payment). */
export function stripeSide(l: Ledger, intentOf: Map<string, string>) {
  const side = (f: PaymentFee | null | undefined) => (f ? { fee_cents: f.fee_cents, paid_out_on: f.paid_out_on } : null);
  return {
    forInvoice: (id: string) => side(l.byInvoice.get(String(id))),
    forRetainer: (stripeInvoice: string) => side(l.byIntent.get(intentOf.get(String(stripeInvoice)) || '')),
  };
}

export const PAYOUT_HEAD = ['Date', 'Amount', 'Status', 'Payments in it', 'Paid by clients', 'Stripe fees', 'Refunds and other', 'Stripe payout ID'];
const PAYOUT_WORD: Record<string, string> = { paid: 'Paid', in_transit: 'On its way', pending: 'On its way', canceled: 'Cancelled', failed: 'Failed' };

/** payouts.csv: each payout due in the days asked for, oldest first. When Stripe can say
 *  what one carried (an automatic payout), its columns add up to it: what clients paid,
 *  less Stripe's fees, plus the rest (refunds, disputes, adjustments), is the amount.
 *  The total counts only payouts that arrived. Pure. */
export function payoutExportRows(payouts: unknown, carried: Map<string, unknown[]>, p: { from: string; to: string }): { rows: string[][]; payouts: number; cents: number } {
  const list = ((Array.isArray(payouts) ? payouts : []) as any[])
    .filter((po) => { const d = arrivalYmd(po?.arrival_date); return !!d && d >= p.from && d <= p.to; })
    .sort((a, b) => int(a.arrival_date) - int(b.arrival_date) || String(a.id).localeCompare(String(b.id)));
  let cents = 0;
  const rows = list.map((po) => {
    const amount = int(po.amount);
    if (po.status === 'paid') cents += amount;
    const txns = carried.get(String(po.id));
    let parts = ['', '', '', ''];
    if (txns) {
      let n = 0, gross = 0, fees = 0;
      for (const t of txns as any[]) {
        if (!t || t.type === 'payout') continue;   // the payout's own line
        fees += int(t.fee);
        if (isPayment(t)) { n++; gross += int(t.amount); }
      }
      parts = [String(n), dollars(gross), dollars(fees), dollars(amount - gross + fees)];
    }
    return [usDate(arrivalYmd(po.arrival_date)), dollars(amount), PAYOUT_WORD[String(po.status)] || String(po.status || ''), ...parts, String(po.id || '')];
  });
  return { rows, payouts: rows.length, cents };
}
