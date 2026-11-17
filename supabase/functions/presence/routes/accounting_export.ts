// ── GET /sales/export/accounting?from=YYYY-MM-DD&to=YYYY-MM-DD&tzo=&today= ───────
// Export for your bookkeeper (sales item 105): one zip with invoices.csv (the columns
// QuickBooks Online's invoice import maps), payments.csv (every payment that came in,
// retainer charges too) and READ-ME.txt. For the platform's own studio (sales item 133)
// payments.csv also shows Stripe's fee on each payment and the day it was paid out, and
// payouts.csv lists each deposit from Stripe. The invoices are the Invoices page's own book
// (routes/invoices_list.ts readInvoiceBook); the shaping is lib/accounting_export.ts.
// A read that fails downloads nothing and says so: a short file at tax time is worse
// than none.
import { json } from '../../_shared/http.ts';
import { svc, svcPages } from '../lib/db.ts';
import { toCsv, zipStore } from '../lib/zip_csv.ts';
import { siteCan, isSiteRole } from '../lib/site_roles.ts';
import { callerToday } from '../lib/sales_lifecycle.ts';
import { retainerPayments } from '../lib/invoice_billing.ts';
import { UUID_RE } from '../lib/uuid.ts';
import { exportNo, exportPeriod, invoiceExportRows, paymentExportRows, exportReadMe, INVOICE_HEAD, PAYMENT_HEAD, type RetainerCharge, type MoneyBack, type ExportPeriod } from '../lib/accounting_export.ts';
import { RETURNED_SELECT, returnedPayments, disputeFees } from '../lib/money_returns.ts';
import { indexPayments, attachPayouts, stripeSide, payoutExportRows, PAYOUT_HEAD } from '../lib/stripe_ledger.ts';
import { stripeConfigured, listPaymentBalanceTransactions, listPayouts, listPayoutTransactions, paymentIntentForInvoice } from '../commerce/stripe.ts';
import { fewAtATime } from '../lib/few_at_a_time.ts';
import { readInvoiceBook } from './invoices_list.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any)?.json) ? (r as any).json : []) as any[];

// ── Sales item 133: what reached the bank ─────────────────────────────────────
// Stripe's fee on each payment it took, the day the payout carrying it arrived, and
// payouts.csv. Every pay link is made with the platform's own Stripe key, so the payouts
// are the platform studio's: they're read for platform staff signed in as themselves,
// never for a studio drilled into a client, a seat on someone's business, or anyone else.
export const seesStripeBooks = (p: Principal) => p.kind === 'staff' && !p.scope && !p.member;
const PAYOUTS_DETAILED = 120;   // payouts whose contents are listed in one export (one Stripe read each)
const DAY = 86400;
const unixDay = (ymd: string) => Date.parse(ymd + 'T00:00:00Z') / 1000;

/** Read Stripe's side of the days asked for. Throws when Stripe can't be read. A payment
 *  is looked for from ten days before (a bank payment starts days before it settles) to
 *  three after, and payouts due up to ten days after the last day are read so a payment
 *  late in the stretch still finds the deposit it went out in. */
async function readStripeBooks(p: ExportPeriod, retainerInvoices: string[]) {
  const [pays, pos] = await Promise.all([
    listPaymentBalanceTransactions(unixDay(p.from) - 10 * DAY, unixDay(p.to) + 4 * DAY, 20),
    listPayouts(unixDay(p.from), unixDay(p.to) + 11 * DAY, 5),
  ]);
  const ledger = indexPayments(pays.data);
  const detailable = pos.data.filter((po: any) => po && po.automatic !== false && po.reconciliation_status !== 'not_applicable' && po.status !== 'canceled' && po.status !== 'failed');
  const listed = await fewAtATime(detailable.slice(0, PAYOUTS_DETAILED), 4, async (po: any) => [String(po.id), (await listPayoutTransactions(String(po.id), 5)).data] as [string, unknown[]]);
  const carried = new Map<string, unknown[]>(listed);
  attachPayouts(ledger, pos.data, carried);
  const intents = new Map<string, string>(await fewAtATime([...new Set(retainerInvoices.filter(Boolean))].slice(0, 200), 4, async (id) => [id, await paymentIntentForInvoice(id)] as [string, string]));
  return { lookup: stripeSide(ledger, intents), payouts: pos.data, carried, capped: pays.more || pos.more || detailable.length > PAYOUTS_DETAILED };
}

export async function handleAccountingExport(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  // owners always; a team seat only when its role may see everything and download it
  const role = String((principal as any)?.member?.role || '');
  if (role && (!isSiteRole(role) || !siteCan(role, 'export') || !siteCan(role, 'view_all'))) {
    return json({ error: 'forbidden', message: 'The export for your bookkeeper is for the studio’s owner.' }, 403, cors);
  }
  const u = new URL(req.url);
  const today = callerToday(u.searchParams.get('today'), new Date().toISOString());
  const tzo = Math.max(-840, Math.min(840, Math.trunc(Number(u.searchParams.get('tzo')) || 0)));
  const p = exportPeriod(u.searchParams.get('from'), u.searchParams.get('to'), today);
  if ('error' in p) return json({ error: 'validation', message: p.error }, 422, cors);
  const book = await readInvoiceBook(site, today, true);
  if (!book) return json({ error: 'read_failed', message: 'Your invoices couldn’t load just now, so nothing was downloaded. Try again in a moment.' }, 502, cors);
  // retainer charges: a day either side of the stretch, then each kept by the studio's own day
  const fromIso = new Date(Date.parse(p.from + 'T00:00:00Z') - 86400_000).toISOString();
  const toIso = new Date(Date.parse(p.to + 'T00:00:00Z') + 2 * 86400_000).toISOString();
  const ev = await svcPages(`presence_deal_events?site_id=eq.${site.id}&kind=eq.invoice_paid&detail->>retainer=eq.true&created_at=gte.${encodeURIComponent(fromIso)}&created_at=lt.${encodeURIComponent(toIso)}&select=deal_id,kind,detail,created_at`, 'created_at').catch(() => null);
  if (!ev) return json({ error: 'read_failed', message: 'Your retainer payments couldn’t load just now, so nothing was downloaded. Try again in a moment.' }, 502, cors);
  // sales items 126, 127: money that went back in these days (refunds, disputes lost) and Stripe's dispute fees
  const [backR, feeR] = await Promise.all([
    svcPages(`presence_money_returns?site_id=eq.${site.id}&counted_cents=gt.0&counted_at=gte.${encodeURIComponent(fromIso)}&counted_at=lt.${encodeURIComponent(toIso)}&select=${RETURNED_SELECT}`, 'counted_at').catch(() => null),
    svcPages(`presence_money_returns?site_id=eq.${site.id}&kind=eq.dispute&fee_cents=gt.0&happened_at=gte.${encodeURIComponent(fromIso)}&happened_at=lt.${encodeURIComponent(toIso)}&select=${RETURNED_SELECT}`, 'happened_at').catch(() => null),
  ]);
  if (!backR || !feeR) return json({ error: 'read_failed', message: 'Your refunds couldn’t load just now, so nothing was downloaded. Try again in a moment.' }, 502, cors);
  const backs = returnedPayments(backR.rows), fees = disputeFees(feeR.rows);
  const dealIds = [...new Set([...ev.rows.map((e: any) => String(e.deal_id || '')), ...backs.map((b) => b.deal_id), ...fees.map((f) => f.deal_id)].filter((x: string) => UUID_RE.test(x)))];
  const deals = new Map<string, any>();
  for (let i = 0; i < dealIds.length; i += 100) {
    const r = await svc(`presence_deals?id=in.(${dealIds.slice(i, i + 100).join(',')})&site_id=eq.${site.id}&select=id,title,contact_id,converted_client_id`).catch(() => null);
    if (!r || !r.ok) return json({ error: 'read_failed', message: 'Your retainer payments couldn’t load just now, so nothing was downloaded. Try again in a moment.' }, 502, cors);
    for (const d of rows(r)) deals.set(String(d.id), d);
  }
  // who each retainer is for: the customer the deal became, else the person on it
  const clientIds = [...new Set([...deals.values()].map((d: any) => String(d.converted_client_id || '')).filter((x: string) => UUID_RE.test(x)))];
  const contactIds = [...new Set([...deals.values()].map((d: any) => String(d.contact_id || '')).filter((x: string) => UUID_RE.test(x)))];
  const [clients, people] = await Promise.all([
    clientIds.length ? svc(`clients?id=in.(${clientIds.join(',')})&select=id,name,email`).then(rows).catch(() => []) : Promise.resolve([]),
    contactIds.length ? svc(`presence_contacts?id=in.(${contactIds.join(',')})&site_id=eq.${site.id}&select=id,name,email,company`).then(rows).catch(() => []) : Promise.resolve([]),
  ]);
  const clientOf = new Map(clients.map((c: any) => [String(c.id), String(c.name || c.email || '')]));
  const personOf = new Map(people.map((c: any) => [String(c.id), String(c.company || c.name || c.email || '')]));
  const charges: RetainerCharge[] = [];
  ev.rows.forEach((e: any) => {
    const [pay] = retainerPayments([e]);
    if (!pay) return;
    const d = deals.get(String(e.deal_id || ''));
    const stripeInvoice = e.detail && typeof e.detail === 'object' ? String(e.detail.stripe_invoice || '') : '';
    charges.push({ ...pay, customer: (d && (clientOf.get(String(d.converted_client_id || '')) || personOf.get(String(d.contact_id || '')))) || '', deal_title: d ? String(d.title || '') : '', ...(stripeInvoice ? { stripe_invoice: stripeInvoice } : {}) });
  });
  // each one under its invoice's number and customer, or its retainer's deal
  const bookById = new Map(book.items.map((i: any) => [String(i.id), i]));
  const backOf = (x: { invoice_id: string; deal_id: string }) => {
    const i = bookById.get(x.invoice_id);
    if (i) return { customer: String(i.business || i.person || '').trim(), invoice_no: exportNo(i.number), what: String(i.deal_title || i.title || '') };
    const d = deals.get(x.deal_id);
    return { customer: (d && (clientOf.get(String(d.converted_client_id || '')) || personOf.get(String(d.contact_id || '')))) || '', invoice_no: '', what: `Retainer${d && d.title ? ': ' + d.title : ''}` };
  };
  const back: MoneyBack[] = [
    ...backs.map((b) => ({ kind: b.kind, amount_cents: b.amount_cents, at: b.paid_at, bank: b.bank, ...backOf(b) })),
    ...fees.map((f) => ({ kind: 'fee' as const, amount_cents: f.amount_cents, at: f.paid_at, ...backOf(f) })),
  ];
  // sales item 133: Stripe's fees and payouts; a Stripe that can't be read downloads nothing, like the rest
  const books = seesStripeBooks(principal) && stripeConfigured() ? await readStripeBooks(p, charges.map((c) => c.stripe_invoice || '')).catch(() => null) : undefined;
  if (books === null) return json({ error: 'read_failed', message: 'Stripe’s fees and payouts couldn’t load just now, so nothing was downloaded. Try again in a moment.' }, 502, cors);
  const inv = invoiceExportRows(book.items, p, tzo);
  const pay = paymentExportRows(book.items, charges, p, tzo, back, books ? books.lookup : null);
  const outs = books ? payoutExportRows(books.payouts, books.carried, p) : null;
  const enc = new TextEncoder();
  const zip = zipStore([
    { name: 'invoices.csv', data: enc.encode(toCsv(INVOICE_HEAD, inv.rows)) },
    { name: 'payments.csv', data: enc.encode(toCsv(PAYMENT_HEAD, pay.rows)) },
    ...(outs ? [{ name: 'payouts.csv', data: enc.encode(toCsv(PAYOUT_HEAD, outs.rows)) }] : []),
    { name: 'READ-ME.txt', data: enc.encode(exportReadMe(p, inv, pay, book.partial, books && outs ? { payouts: outs.payouts, cents: outs.cents, capped: books.capped } : null)) },
  ]);
  return new Response(zip.buffer as ArrayBuffer, { status: 200, headers: { ...cors, 'Access-Control-Expose-Headers': 'Content-Disposition', 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="for-your-bookkeeper-${p.from}-to-${p.to}.zip"`, 'Cache-Control': 'no-store' } });
}
