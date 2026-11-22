// ── The Invoices page as a money home (sales item 173, Nov 22 2026 review) ───────
// Eric picked direction A, "the money wall": a deep plum band across the top with what is
// owed and a bar of it by how late, then money in by month, the three customers who owe
// most, and a Stripe strip (paid online this month, Stripe's fees, what reached the bank,
// the next payout and its day). The page works the owed bar and the debtors out from the
// rows it already has; this file shapes the two things it can't: the months (routes/
// money_home.ts reads the payments and asks revenueByMonth) and Stripe's side. Pure.
import type { RevenueMonth } from './sales_reports.ts';

export interface MoneyHomeMonth { month: string; label: string; cents: number; retainer_cents: number }
/** The last twelve months of money in, each what came in less what went back. Pure. */
export function homeMonths(months: RevenueMonth[]): MoneyHomeMonth[] {
  return (months || []).map((m) => ({ month: m.month, label: m.label, cents: Math.max(0, Math.round(Number(m.this_year) || 0)), retainer_cents: Math.round(Number(m.retainer) || 0) }));
}

export interface StripeStrip {
  month: string;                 // YYYY-MM, the studio's month
  paid_online_cents: number;     // what Stripe took this month, before its fee
  fee_cents: number;             // Stripe's fees on those
  net_cents: number;             // what the studio kept of them
  reached_bank_cents: number;    // payouts that arrived this month
  next_payout: { cents: number; arrival: string } | null;   // the next one on its way, and the day it lands (YYYY-MM-DD)
  more: boolean;                 // Stripe had more than was read
}
const int = (v: unknown) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };
const dayOf = (sec: unknown) => { const n = Number(sec); return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString().slice(0, 10) : ''; };
/** Stripe's side of the month: the payments it took (balance transactions of type charge or
 *  payment, read for the month), the payouts (read from the month's start to a few weeks
 *  ahead), and the moment now, in unix seconds. Pure. */
export function stripeStrip(month: string, bts: unknown, payouts: unknown, nowSec: number, more = false): StripeStrip {
  let gross = 0, fee = 0, net = 0;
  for (const bt of (Array.isArray(bts) ? bts : []) as any[]) {
    if (!bt || (bt.type !== 'charge' && bt.type !== 'payment')) continue;
    gross += int(bt.amount); fee += int(bt.fee); net += int(bt.net);
  }
  let reached = 0;
  let next: { cents: number; arrival: string } | null = null, nextSec = Infinity;
  for (const po of (Array.isArray(payouts) ? payouts : []) as any[]) {
    if (!po || po.status === 'canceled' || po.status === 'failed') continue;
    const arrival = Number(po.arrival_date) || 0;
    if (po.status === 'paid' && arrival <= nowSec && dayOf(arrival).slice(0, 7) === month) { reached += int(po.amount); continue; }
    if ((po.status === 'pending' || po.status === 'in_transit') && arrival < nextSec) { nextSec = arrival; next = { cents: int(po.amount), arrival: dayOf(arrival) }; }
  }
  return { month, paid_online_cents: gross, fee_cents: fee, net_cents: net, reached_bank_cents: reached, next_payout: next, more };
}

export interface AgeRow { name: string; current: number; d30: number; d60: number; d90: number; total: number; oldest: number; n: number }
/** What is owed, by how late, and by whom (the page's own copy mirrors this). `items` are the
 *  Invoices page's rows; a draft, a part payment, a settling or closed row counts nowhere. Pure. */
export function owedByAge(items: Array<{ status?: unknown; processing?: unknown; state?: unknown; not_sent?: unknown; payment_for?: unknown; due_date?: unknown; amount_cents?: unknown; business?: unknown; person?: unknown }>, todayYmd: string): { buckets: { current: number; d30: number; d60: number; d90: number }; rows: AgeRow[]; total: number } {
  const dayDiff = (a: string, b: string) => Math.round((Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 86400000);
  const by = new Map<string, AgeRow>();
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0 };
  for (const i of items || []) {
    if (!i || i.payment_for || String(i.status) !== 'open' || i.processing || i.state === 'processing' || i.not_sent === true || i.state === 'draft') continue;
    const name = String(i.business || i.person || 'Customer');
    const row = by.get(name) || { name, current: 0, d30: 0, d60: 0, d90: 0, total: 0, oldest: 0, n: 0 };
    const due = /^\d{4}-\d{2}-\d{2}/.test(String(i.due_date || '')) ? String(i.due_date).slice(0, 10) : '';
    const late = due ? -dayDiff(due, todayYmd) : 0;
    const c = Math.max(0, Math.round(Number(i.amount_cents) || 0));
    const k: 'current' | 'd30' | 'd60' | 'd90' = late <= 0 ? 'current' : late <= 30 ? 'd30' : late <= 60 ? 'd60' : 'd90';
    row[k] += c; buckets[k] += c; row.total += c; row.oldest = Math.max(row.oldest, late); row.n++;
    by.set(name, row);
  }
  const rows = [...by.values()].sort((a, b) => b.oldest - a.oldest || b.total - a.total);
  return { buckets, rows, total: rows.reduce((n, r) => n + r.total, 0) };
}
