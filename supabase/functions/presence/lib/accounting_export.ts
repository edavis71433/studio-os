// ── Export for your bookkeeper (sales item 105, Nov 2026) ─────────────────────
// Salesforce links to QuickBooks Online and Google Sheets, and the Nov 12 review
// (file 05, finding 4) says the accounting export is what a bookkeeper asks for
// first at tax time. One zip, for a stretch of days the studio picks:
//   invoices.csv  one row per invoice line, in the columns QuickBooks Online's invoice
//                 import maps (number, customer, invoice date, due date, item, its
//                 description, quantity, rate, amount), dates as MM/DD/YYYY. QuickBooks
//                 takes no negative line, so an invoice with a discount or "Less deposit"
//                 line goes in as one line of what it billed, its lines in the description.
//   payments.csv  every payment that came in: invoices paid, part payments recorded by
//                 hand, and retainer charges (only ever a deal event), with how each came.
//                 Money that went back is a row with a minus amount on the day it went:
//                 a refund made in Stripe, a dispute lost, Stripe's dispute fee (sales
//                 items 126, 127).
//   READ-ME.txt   what is in it, and how to bring it into QuickBooks.
// Pure: routes/accounting_export.ts reads the rows; these shape them.
import { invoiceLines } from './documents.ts';
import { PAY_METHOD_LABEL, type PayMethod } from './invoice_billing.ts';

export interface ExportPeriod { from: string; to: string }   // the studio's own days, both included

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const okYmd = (s: string) => YMD.test(s) && Number.isFinite(Date.parse(s + 'T12:00:00Z')) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s;

/** The days asked for: both YYYY-MM-DD, from no later than to, to no later than today, and
 *  at most six years. Pure. */
export function exportPeriod(fromRaw: unknown, toRaw: unknown, todayYmd: string): ExportPeriod | { error: string } {
  const from = String(fromRaw ?? '').trim(), to = String(toRaw ?? '').trim() || todayYmd;
  if (!okYmd(from) || !okYmd(to)) return { error: 'Pick the first and last day to include.' };
  if (from > to) return { error: 'The first day comes after the last one. Swap them and try again.' };
  if (from < '2000-01-01') return { error: 'That’s further back than anything here.' };
  if (Date.parse(to) - Date.parse(from) > 6 * 366 * 86400_000) return { error: 'Pick six years or less at a time.' };
  return { from, to: to > todayYmd ? todayYmd : to };
}

/** A moment as the studio's own day: `tzo` is minutes behind UTC (the page's
 *  getTimezoneOffset), so 7pm in Los Angeles on the 31st stays the 31st. Pure. */
export function localYmd(iso: unknown, tzo = 0): string {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return '';
  return new Date(t - Math.max(-840, Math.min(840, Math.trunc(Number(tzo) || 0))) * 60_000).toISOString().slice(0, 10);
}
/** "2026-11-03" → "11/03/2026", the way QuickBooks in the US reads a date. Pure. */
export const usDate = (ymd: string) => (YMD.test(ymd) ? `${ymd.slice(5, 7)}/${ymd.slice(8, 10)}/${ymd.slice(0, 4)}` : '');
const inPeriod = (ymd: string, p: ExportPeriod) => !!ymd && ymd >= p.from && ymd <= p.to;
const dollars = (c: number) => (Math.round(c) / 100).toFixed(2);
/** The number a bookkeeper files it under: "0013" (no #, which some imports refuse). */
export const exportNo = (n: unknown) => { const v = Math.trunc(Number(n)); return Number.isFinite(v) && v > 0 ? String(v).padStart(4, '0') : ''; };
const methodWord = (m: unknown) => PAY_METHOD_LABEL[String(m || '') as PayMethod] || (m ? String(m) : 'Card or bank, through Stripe');
const who = (i: { business?: unknown; person?: unknown }) => String(i.business || i.person || '').trim() || 'Customer';

export interface BookRow {
  id: string; number?: unknown; title?: unknown; amount_cents?: unknown; status?: unknown; due_date?: unknown; issued_at?: unknown; paid_at?: unknown;
  paid_method?: unknown; paid_note?: unknown; payment_for?: unknown; deal_title?: unknown; business?: unknown; person?: unknown; lines?: unknown; description?: unknown;
}

/** Sales item 185: QuickBooks multiplies the quantity by the rate, and 0.75 × $83.33 is not the
 *  $62.50 the line billed, so a part quantity goes in as quantity 1 at the line's own total, its
 *  words saying the real quantity: "Design hours (2.5 × $100.00)". Whole quantities are as before. Pure. */
export function wholeQtyLine(l: { label: string; qty: number; amount_cents: number }): { label: string; qty: number; amount_cents: number } {
  const q = Number(l.qty) || 1;
  if (Number.isInteger(q)) return l;
  return { label: `${l.label} (${q} × $${dollars(l.amount_cents / q)})`, qty: 1, amount_cents: l.amount_cents };
}
export const INVOICE_HEAD = ['InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'Memo', 'Item(Product/Service)', 'ItemDescription', 'ItemQuantity', 'ItemRate', 'ItemAmount', 'Status', 'PaidDate', 'Tax'];   // Tax: sales item 175
/** Sales item 175: a tax line ("Tax (8.5%)") is not income. Pure. */
export const isTaxLine = (label: unknown) => /^tax\b/i.test(String(label || '').trim());
/** invoices.csv: each invoice issued in the period, open or paid (never a voided one, and a
 *  part payment is a payment, not an invoice), one row per line. Lines add up to what it
 *  billed: its amount now plus what was paid toward it in parts. Pure. */
export function invoiceExportRows(items: BookRow[], p: ExportPeriod, tzo = 0): { rows: string[][]; invoices: number; cents: number } {
  const partsFor = new Map<string, number>();
  for (const i of items) if (i.payment_for && String(i.status) === 'paid') partsFor.set(String(i.payment_for), (partsFor.get(String(i.payment_for)) || 0) + Math.round(Number(i.amount_cents) || 0));
  const out: string[][] = []; let invoices = 0, cents = 0;
  const list = items.filter((i) => !i.payment_for && (i.status === 'open' || i.status === 'paid') && inPeriod(localYmd(i.issued_at, tzo), p))
    .sort((a, b) => String(a.issued_at || '').localeCompare(String(b.issued_at || '')) || (Number(a.number) || 0) - (Number(b.number) || 0));
  for (const i of list) {
    const billed = Math.round(Number(i.amount_cents) || 0) + (partsFor.get(String(i.id)) || 0);
    const day = localYmd(i.issued_at, tzo);
    const due = /^\d{4}-\d{2}-\d{2}/.test(String(i.due_date || '')) ? String(i.due_date).slice(0, 10) : day;
    const no = exportNo(i.number) || String(i.id).slice(0, 8);
    const memo = String(i.deal_title || i.title || '').slice(0, 200);
    const paid = i.status === 'paid';
    const head = [no, who(i), usDate(day), usDate(due), memo];
    const tail = [paid ? 'Paid' : 'Open', paid ? usDate(localYmd(i.paid_at, tzo)) : ''];
    const all = invoiceLines({ lines: i.lines, title: i.title, description: i.description }, billed);
    // sales item 175: sales tax is its own column, never a Services line filed as income
    const taxCents = all.filter((l) => isTaxLine(l.label)).reduce((n, l) => n + l.amount_cents, 0);
    const lines = all.filter((l) => !isTaxLine(l.label));
    const taxCol = taxCents ? dollars(taxCents) : '';
    if (lines.every((l) => l.amount_cents >= 0)) {
      lines.forEach((l, n) => { const w = wholeQtyLine(l); out.push([...head, 'Services', w.label, String(w.qty), dollars(w.amount_cents / w.qty), dollars(w.amount_cents), ...tail, n === 0 ? taxCol : '']); });
    } else {
      // QuickBooks refuses a negative line: one line of what it billed, the lines spelled out
      const said = lines.map((l) => `${l.label} ${l.amount_cents < 0 ? '-' : ''}$${dollars(Math.abs(l.amount_cents))}`).join('; ');
      out.push([...head, 'Services', said.slice(0, 4000), '1', dollars(billed - taxCents), dollars(billed - taxCents), ...tail, taxCol]);
    }
    invoices++; cents += billed;
  }
  return { rows: out, invoices, cents };
}

// Sales item 133: Stripe fee, You kept and Paid out on show what reached the bank. A
// payment taken by hand (check, cash, Zelle...) has no fee and was kept whole; one Stripe
// took shows its fee once Stripe has been read (routes/accounting_export.ts, staff only).
export const PAYMENT_HEAD = ['Date', 'Customer', 'Invoice', 'For', 'How it was paid', 'Amount', 'Stripe fee', 'You kept', 'Paid out on', 'Note'];
// Sales item 176: costs paid for a customer, each on the day it was paid
export const COST_HEAD = ['Date', 'Customer', 'What', 'Amount', 'On invoice', 'Note'];
export interface CostOut { spent_on: string; customer: string; label: string; amount_cents: number; invoice_no: string; note: string }
/** costs.csv: every cost paid in the period, oldest first. Pure. */
export function costExportRows(costs: CostOut[], p: ExportPeriod): { rows: string[][]; costs: number; cents: number } {
  const list = costs.filter((c) => inPeriod(String(c.spent_on || '').slice(0, 10), p)).sort((a, b) => String(a.spent_on).localeCompare(String(b.spent_on)));
  return { rows: list.map((c) => [usDate(String(c.spent_on).slice(0, 10)), c.customer || 'Customer', String(c.label || '').slice(0, 200), dollars(c.amount_cents), c.invoice_no, String(c.note || '').slice(0, 300)]), costs: list.length, cents: list.reduce((n, c) => n + c.amount_cents, 0) };
}
export interface RetainerCharge { amount_cents: number; paid_at: string; customer: string; deal_title: string; stripe_invoice?: string }
/** Money that went back (sales items 126, 127): a refund made in Stripe or a dispute lost,
 *  on the day it happened, or Stripe's dispute fee, on the day Stripe took it. `what` is
 *  the invoice's or the retainer's name; `invoice_no` its number ('' for a retainer). */
export interface MoneyBack { kind: 'refund' | 'dispute' | 'fee'; amount_cents: number; at: string; customer: string; invoice_no: string; what: string; bank?: boolean; by_hand?: string }   // by_hand: how money given back by hand went (sales item 165)
/** Stripe's side of a payment it took: its fee, and the day the payout carrying it
 *  arrived ('' while it hasn't). lib/stripe_ledger.ts stripeSide makes one. */
export interface StripeSide { fee_cents: number; paid_out_on: string }
export interface StripeLookup { forInvoice(id: string): StripeSide | null; forRetainer(stripeInvoice: string): StripeSide | null }
/** payments.csv: every payment that came in during the period, oldest first. A paid invoice's
 *  own row is its last payment (what was left after any parts); each part payment is a row
 *  of its own, under its invoice's number; each retainer charge is a row; each refund, dispute
 *  lost and dispute fee is a row with a minus amount. `payments` and `cents` count what came
 *  in; `returned` and `returned_cents` what went back. `stripe`, when Stripe was read, fills
 *  in the fee on each payment it took (sales item 133). Pure. */
export function paymentExportRows(items: BookRow[], retainers: RetainerCharge[], p: ExportPeriod, tzo = 0, back: MoneyBack[] = [], stripe: StripeLookup | null = null): { rows: string[][]; payments: number; cents: number; returned: number; returned_cents: number; fee_cents: number; kept_cents: number; fees_missing: number } {
  const byId = new Map(items.map((i) => [String(i.id), i]));
  const rows: Array<{ at: string; row: string[]; cents: number }> = [];
  let feeCents = 0, keptCents = 0, missing = 0;
  // the three new columns: by hand, kept whole; through Stripe, its fee when Stripe said
  const money = (amt: number, viaStripe: boolean, side: StripeSide | null) => {
    if (!viaStripe) { keptCents += amt; return ['', dollars(amt), '']; }
    if (!side) { if (stripe) missing++; return ['', '', '']; }
    feeCents += side.fee_cents; keptCents += amt - side.fee_cents;
    return [dollars(side.fee_cents), dollars(amt - side.fee_cents), side.paid_out_on ? usDate(side.paid_out_on) : ''];
  };
  for (const i of items) {
    if (String(i.status) !== 'paid') continue;
    const day = localYmd(i.paid_at, tzo);
    if (!inPeriod(day, p)) continue;
    const parent = i.payment_for ? byId.get(String(i.payment_for)) : null;
    const of = parent || i;
    const amt = Math.round(Number(i.amount_cents) || 0);
    const viaStripe = !i.paid_method;   // the webhook leaves paid_method blank; by hand always names one
    rows.push({ at: String(i.paid_at || ''), cents: amt, row: [usDate(day), who(of), exportNo(of.number), String(of.deal_title || of.title || '').slice(0, 200) + (parent ? ' (part payment)' : ''), methodWord(i.paid_method), dollars(amt),
      ...money(amt, viaStripe, viaStripe && stripe ? stripe.forInvoice(String(i.id)) : null), String(i.paid_note || '').slice(0, 300)] });
  }
  for (const r of retainers) {
    const day = localYmd(r.paid_at, tzo);
    if (!inPeriod(day, p) || !(r.amount_cents > 0)) continue;
    rows.push({ at: r.paid_at, cents: r.amount_cents, row: [usDate(day), r.customer || 'Customer', '', `Retainer${r.deal_title ? ': ' + r.deal_title : ''}`.slice(0, 200), 'Card or bank, through Stripe', dollars(r.amount_cents),
      ...money(r.amount_cents, true, stripe && r.stripe_invoice ? stripe.forRetainer(r.stripe_invoice) : null), ''] });
  }
  for (const r of back) {
    const day = localYmd(r.at, tzo);
    if (!inPeriod(day, p) || !(r.amount_cents > 0)) continue;
    const label = r.kind === 'refund' ? 'Refund' : r.kind === 'dispute' ? 'Dispute lost' : 'Stripe dispute fee';
    const how = r.kind === 'refund' ? (r.by_hand ? `Given back by ${PAY_METHOD_LABEL[r.by_hand as PayMethod] ? PAY_METHOD_LABEL[r.by_hand as PayMethod].toLowerCase() : r.by_hand}` : 'Refunded through Stripe') : r.kind === 'dispute' ? (r.bank ? 'Bank dispute, through Stripe' : 'Card dispute, through Stripe') : 'Stripe fee';
    rows.push({ at: r.at, cents: -r.amount_cents, row: [usDate(day), r.customer || 'Customer', r.invoice_no, `${label}: ${r.what || 'Invoice'}`.slice(0, 200), how, dollars(-r.amount_cents), '', dollars(-r.amount_cents), '', ''] });   // ten columns: no fee of its own, kept = the minus amount, never paid out
  }
  rows.sort((a, b) => a.at.localeCompare(b.at));
  const ins = rows.filter((r) => r.cents >= 0), outs = rows.filter((r) => r.cents < 0);
  return { rows: rows.map((r) => r.row), payments: ins.length, cents: ins.reduce((a, r) => a + r.cents, 0), returned: outs.length, returned_cents: -outs.reduce((a, r) => a + r.cents, 0), fee_cents: feeCents, kept_cents: keptCents, fees_missing: missing };
}

/** READ-ME.txt: what the files hold and how to bring them into QuickBooks Online. `stripe`
 *  is set when Stripe's fees and payouts were read (sales item 133). */
export function exportReadMe(p: ExportPeriod, inv: { invoices: number; cents: number }, pay: { payments: number; cents: number; returned?: number; returned_cents?: number; fee_cents?: number; kept_cents?: number; fees_missing?: number }, partial: boolean,
  stripe: { payouts: number; cents: number; capped: boolean } | null = null, costs: { costs: number; cents: number } | null = null): string {
  const money = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return [
    `Export for your bookkeeper: ${usDate(p.from)} to ${usDate(p.to)}`,
    '',
    `invoices.csv  ${inv.invoices} invoice${inv.invoices === 1 ? '' : 's'} issued in these days, ${money(inv.cents)} billed. One row per line.`,
    `payments.csv  ${pay.payments} payment${pay.payments === 1 ? '' : 's'} received in these days, ${money(pay.cents)} in all, retainer charges included.`,
    ...(stripe ? [`              Stripe kept ${money(pay.fee_cents || 0)} in fees from the ones it took, so you kept ${money(pay.kept_cents || 0)}.`] : []),
    ...(pay.returned ? [`              ${pay.returned} row${pay.returned === 1 ? '' : 's'} of money that went back, ${money(pay.returned_cents || 0)} in all: refunds made in Stripe, disputes lost and Stripe's dispute fees, each with a minus amount on the day it went.`] : []),
    ...(stripe ? [`payouts.csv   ${stripe.payouts} payout${stripe.payouts === 1 ? '' : 's'} from Stripe due in these days, ${money(stripe.cents)} arrived. Each row is one deposit; its columns show what made it up.`] : []),
    ...(costs && costs.costs ? [`costs.csv     ${costs.costs} cost${costs.costs === 1 ? '' : 's'} paid for customers in these days, ${money(costs.cents)} in all, each saying which invoice it went on.`] : []),
    'invoices.csv has a Tax column: sales tax on an invoice is there, not among its Services lines.',
    ...(partial ? ['', 'Note: this studio has more invoices than one export reads (2,000). The oldest ones are left out; pick a shorter stretch of days to get them.'] : []),
    ...(stripe && pay.fees_missing ? ['', `Note: Stripe had no fee for ${pay.fees_missing} payment${pay.fees_missing === 1 ? '' : 's'} it took, so their Stripe fee and You kept are blank. Its dashboard has them.`] : []),
    ...(stripe && stripe.capped ? ['', 'Note: Stripe had more for these days than one export reads. Pick a shorter stretch of days to get all of it.'] : []),
    '',
    'Bringing invoices.csv into QuickBooks Online:',
    '1. In QuickBooks, open Settings, then Import data, then Invoices.',
    '2. Choose invoices.csv. Each customer, and the product "Services", must already be in QuickBooks.',
    '3. Match the columns: InvoiceNo, Customer, InvoiceDate, DueDate and ItemAmount are the ones it needs.',
    'QuickBooks takes 100 invoices at a time, and not at all when sales tax is switched on there. In that case your bookkeeper can enter the totals from this file instead.',
    '',
    ...(stripe ? [
      'Matching what came into the bank: Stripe keeps its fee from each payment it takes and sends the rest in payouts, usually two business days later.',
      'Each row of payouts.csv is one deposit from Stripe. In payments.csv, Paid out on says which deposit carried each payment, and You kept is the payment less Stripe\'s fee.',
      'payouts.csv counts every payment Stripe took, including any that isn\'t an invoice here, such as a free-tools order.',
      'Google Sheets, Excel and Numbers open all three files.',
    ] : ['payments.csv is for matching what came into the bank. Google Sheets, Excel and Numbers open both files.']),
    'Voided invoices are left out. A part payment is listed under its invoice\'s number.',
    '',
  ].join('\r\n');
}
