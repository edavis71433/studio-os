// ── GET /sales/export/accounting?from=YYYY-MM-DD&to=YYYY-MM-DD&tzo=&today= ───────
// Export for your bookkeeper (sales item 105): one zip with invoices.csv (the columns
// QuickBooks Online's invoice import maps), payments.csv (every payment that came in,
// retainer charges too) and READ-ME.txt. The invoices are the Invoices page's own book
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
import { exportPeriod, invoiceExportRows, paymentExportRows, exportReadMe, INVOICE_HEAD, PAYMENT_HEAD, type RetainerCharge } from '../lib/accounting_export.ts';
import { readInvoiceBook } from './invoices_list.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any)?.json) ? (r as any).json : []) as any[];

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
  const dealIds = [...new Set(ev.rows.map((e: any) => String(e.deal_id || '')).filter((x: string) => UUID_RE.test(x)))];
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
    charges.push({ ...pay, customer: (d && (clientOf.get(String(d.converted_client_id || '')) || personOf.get(String(d.contact_id || '')))) || '', deal_title: d ? String(d.title || '') : '' });
  });
  const inv = invoiceExportRows(book.items, p, tzo);
  const pay = paymentExportRows(book.items, charges, p, tzo);
  const enc = new TextEncoder();
  const zip = zipStore([
    { name: 'invoices.csv', data: enc.encode(toCsv(INVOICE_HEAD, inv.rows)) },
    { name: 'payments.csv', data: enc.encode(toCsv(PAYMENT_HEAD, pay.rows)) },
    { name: 'READ-ME.txt', data: enc.encode(exportReadMe(p, inv, pay, book.partial)) },
  ]);
  return new Response(zip.buffer as ArrayBuffer, { status: 200, headers: { ...cors, 'Access-Control-Expose-Headers': 'Content-Disposition', 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="for-your-bookkeeper-${p.from}-to-${p.to}.zip"`, 'Cache-Control': 'no-store' } });
}
