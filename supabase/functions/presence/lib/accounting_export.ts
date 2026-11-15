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

export const INVOICE_HEAD = ['InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'Memo', 'Item(Product/Service)', 'ItemDescription', 'ItemQuantity', 'ItemRate', 'ItemAmount', 'Status', 'PaidDate'];
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
    const lines = invoiceLines({ lines: i.lines, title: i.title, description: i.description }, billed);
    if (lines.every((l) => l.amount_cents >= 0)) {
      for (const l of lines) out.push([...head, 'Services', l.label, String(l.qty), dollars(l.amount_cents / l.qty), dollars(l.amount_cents), ...tail]);
    } else {
      // QuickBooks refuses a negative line: one line of what it billed, the lines spelled out
      const said = lines.map((l) => `${l.label} ${l.amount_cents < 0 ? '-' : ''}$${dollars(Math.abs(l.amount_cents))}`).join('; ');
      out.push([...head, 'Services', said.slice(0, 4000), '1', dollars(billed), dollars(billed), ...tail]);
    }
    invoices++; cents += billed;
  }
  return { rows: out, invoices, cents };
}

export const PAYMENT_HEAD = ['Date', 'Customer', 'Invoice', 'For', 'How it was paid', 'Amount', 'Note'];
export interface RetainerCharge { amount_cents: number; paid_at: string; customer: string; deal_title: string }
/** payments.csv: every payment that came in during the period, oldest first. A paid invoice's
 *  own row is its last payment (what was left after any parts); each part payment is a row
 *  of its own, under its invoice's number; each retainer charge is a row. Pure. */
export function paymentExportRows(items: BookRow[], retainers: RetainerCharge[], p: ExportPeriod, tzo = 0): { rows: string[][]; payments: number; cents: number } {
  const byId = new Map(items.map((i) => [String(i.id), i]));
  const rows: Array<{ at: string; row: string[]; cents: number }> = [];
  for (const i of items) {
    if (String(i.status) !== 'paid') continue;
    const day = localYmd(i.paid_at, tzo);
    if (!inPeriod(day, p)) continue;
    const parent = i.payment_for ? byId.get(String(i.payment_for)) : null;
    const of = parent || i;
    const amt = Math.round(Number(i.amount_cents) || 0);
    rows.push({ at: String(i.paid_at || ''), cents: amt, row: [usDate(day), who(of), exportNo(of.number), String(of.deal_title || of.title || '').slice(0, 200) + (parent ? ' (part payment)' : ''), methodWord(i.paid_method), dollars(amt), String(i.paid_note || '').slice(0, 300)] });
  }
  for (const r of retainers) {
    const day = localYmd(r.paid_at, tzo);
    if (!inPeriod(day, p) || !(r.amount_cents > 0)) continue;
    rows.push({ at: r.paid_at, cents: r.amount_cents, row: [usDate(day), r.customer || 'Customer', '', `Retainer${r.deal_title ? ': ' + r.deal_title : ''}`.slice(0, 200), 'Card or bank, through Stripe', dollars(r.amount_cents), ''] });
  }
  rows.sort((a, b) => a.at.localeCompare(b.at));
  return { rows: rows.map((r) => r.row), payments: rows.length, cents: rows.reduce((a, r) => a + r.cents, 0) };
}

/** READ-ME.txt: what the two files hold and how to bring them into QuickBooks Online. */
export function exportReadMe(p: ExportPeriod, inv: { invoices: number; cents: number }, pay: { payments: number; cents: number }, partial: boolean): string {
  const money = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return [
    `Export for your bookkeeper: ${usDate(p.from)} to ${usDate(p.to)}`,
    '',
    `invoices.csv  ${inv.invoices} invoice${inv.invoices === 1 ? '' : 's'} issued in these days, ${money(inv.cents)} billed. One row per line.`,
    `payments.csv  ${pay.payments} payment${pay.payments === 1 ? '' : 's'} received in these days, ${money(pay.cents)} in all, retainer charges included.`,
    ...(partial ? ['', 'Note: this studio has more invoices than one export reads (2,000). The oldest ones are left out; pick a shorter stretch of days to get them.'] : []),
    '',
    'Bringing invoices.csv into QuickBooks Online:',
    '1. In QuickBooks, open Settings, then Import data, then Invoices.',
    '2. Choose invoices.csv. Each customer, and the product "Services", must already be in QuickBooks.',
    '3. Match the columns: InvoiceNo, Customer, InvoiceDate, DueDate and ItemAmount are the ones it needs.',
    'QuickBooks takes 100 invoices at a time, and not at all when sales tax is switched on there. In that case your bookkeeper can enter the totals from this file instead.',
    '',
    'payments.csv is for matching what came into the bank. Google Sheets, Excel and Numbers open both files.',
    'Voided invoices are left out. A part payment is listed under its invoice\'s number.',
    '',
  ].join('\r\n');
}
