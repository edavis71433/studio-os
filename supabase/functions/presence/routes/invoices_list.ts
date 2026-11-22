// ═══ THE INVOICES PAGE (sales item 85, Nov 2026) ══════════════════════════════
//   GET /sales/invoices?today=YYYY-MM-DD
// Every invoice the studio has sent, newest first: its number, who it is for (the business and
// the person), what it is for, the amount, when it was issued and when it is due, and its state
// in the one money formula's words (lib/money_state.ts, on the caller's day). A part payment
// recorded by hand is its own paid row (payment_for = the invoice it paid toward): the page shows
// it under that invoice and counts it as money in. The page works out its totals and month
// picker from these rows on its own day. Up to INVOICES_MAX; past that, `partial` says so.
import { json } from '../../_shared/http.ts';
import { svc, svcPages } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';
import { UUID_RE } from '../lib/uuid.ts';
import { moneyState, invoiceNotSent } from '../lib/money_state.ts';
import { invoiceNo } from '../lib/documents.ts';
import { callerToday } from '../lib/sales_lifecycle.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any)?.json) ? (r as any).json : []) as any[];
/** Sales item 170: a customer's name printed twice when the business and the person were the
 *  same words. The person is dropped when it is the business, ignoring case and spacing. Pure. */
export function oneName(business: string, person: string): string {
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, ' ').trim();
  return business && person && norm(business) === norm(person) ? '' : person;
}
export const INVOICES_MAX = 2000;
const PAGE = 500;

export async function handleSalesInvoicesList(req: Request, site: SiteRow, cors: Record<string, string>): Promise<Response> {
  const today = callerToday(new URL(req.url).searchParams.get('today'), new Date().toISOString());
  const book = await readInvoiceBook(site, today);
  if (!book) return json({ error: 'read_failed', message: 'Your invoices couldn’t load just now.' }, 502, cors);
  return json({ data: { items: book.items, today, partial: book.partial } }, 200, cors);
}

/** Every invoice row the studio has, newest first, each with who it is for. The Invoices page
 *  and the export for a bookkeeper (sales item 105) read the same book. `more` adds what only
 *  the export needs: each invoice's lines and its payment note. null = a page couldn't be read
 *  (part of the book is not the book). */
export async function readInvoiceBook(site: SiteRow, today: string, more = false): Promise<{ items: any[]; partial: boolean } | null> {
  const base = 'id,title,description,amount_cents,purpose,status,due_date,paid_at,created_at,deal_id,customer_client_id,stripe_url';
  // number, how it was paid and part payments land with APPLY-0167; processing_since with 0132;
  // what came back through Stripe with APPLY-0233 (sales items 126, 127)
  // sales item 141: first_sent_at and link_gen (APPLY-0188) say whether an invoice ever went out
  // sales item 162: lines ride along (the page's Change dialog edits them); the export asked for them before
  const shapes = [`${base},processing_since,number,paid_method,paid_note,payment_for,refunded_cents,dispute_status,first_sent_at,link_gen,lines`, `${base},processing_since,number,paid_method,paid_note,payment_for,refunded_cents,dispute_status${more ? ',lines' : ''}`, `${base},processing_since,number,paid_method,paid_note,payment_for${more ? ',lines' : ''}`, `${base},processing_since`, base];
  const page = (sel: string, off: number) => svc(`presence_invoices?site_id=eq.${site.id}&deleted_at=is.null&select=${sel}&order=created_at.desc,id.desc&limit=${PAGE}&offset=${off}`);
  let sel = shapes[0], r = await page(sel, 0);
  for (let i = 1; !r.ok && i < shapes.length; i++) { sel = shapes[i]; r = await page(sel, 0); }
  if (!r.ok) return null;
  const all = rows(r);
  while (rows(r).length >= PAGE && all.length < INVOICES_MAX) {
    r = await page(sel, all.length);
    if (!r.ok) return null;
    all.push(...rows(r));
  }
  // who each is for: the deal's title and person, and the customer it was billed to
  const ids = (k: string) => [...new Set(all.map((i: any) => String(i[k] || '')).filter((x: string) => UUID_RE.test(x)))];
  const chunk = (list: string[]) => { const out: string[][] = []; for (let i = 0; i < list.length; i += 100) out.push(list.slice(i, i + 100)); return out; };
  const dealRows = (await Promise.all(chunk(ids('deal_id')).map((c) => svc(`presence_deals?id=in.(${c.join(',')})&site_id=eq.${site.id}&select=id,title,contact_id,converted_client_id`).then(rows).catch(() => [] as any[])))).flat();
  const contactIds = [...new Set(dealRows.map((d: any) => String(d.contact_id || '')).filter((x: string) => UUID_RE.test(x)))];
  const clientIds = [...new Set([...ids('customer_client_id'), ...dealRows.map((d: any) => String(d.converted_client_id || '')).filter((x: string) => UUID_RE.test(x))])];
  // sales item 152: each refund or lost dispute with the day it happened, so the page takes it off that month, not the month the invoice was paid (APPLY-0233; [] before it)
  // builder item 411: every refund and lost dispute, a page at a time (limit=2000 quietly got 1,000)
  const returnedQ = svcPages(`presence_money_returns?site_id=eq.${site.id}&applies_to=eq.invoice&counted_cents=gt.0&select=invoice_id,counted_cents,counted_at,kind`, 'counted_at').then((r) => r ? r.rows : []).catch(() => [] as any[]);
  const [people, customers, returnedRows] = await Promise.all([
    Promise.all(chunk(contactIds).map((c) => svc(`presence_contacts?id=in.(${c.join(',')})&site_id=eq.${site.id}&select=id,name,email,company`).then(rows).catch(() => [] as any[]))).then((x) => x.flat()),
    Promise.all(chunk(clientIds).map((c) => svc(`clients?id=in.(${c.join(',')})&select=id,name,email`).then(rows).catch(() => [] as any[]))).then((x) => x.flat()),
    returnedQ,
  ]);
  const returnedBy = new Map<string, Array<{ cents: number; at: string; kind: string }>>();
  for (const r of returnedRows) { const k = String(r.invoice_id || ''); if (!k) continue; const l = returnedBy.get(k) || []; l.push({ cents: Number(r.counted_cents) || 0, at: String(r.counted_at || ''), kind: String(r.kind || 'refund') }); returnedBy.set(k, l); }
  const byId = <T,>(list: any[]) => new Map<string, T>(list.map((x: any) => [String(x.id), x]));
  const deal = byId<any>(dealRows), person = byId<any>(people), customer = byId<any>(customers);
  const items = all.map((i: any) => {
    const d = deal.get(String(i.deal_id || ''));
    const p = d ? person.get(String(d.contact_id || '')) : null;
    const k = customer.get(String(i.customer_client_id || (d && d.converted_client_id) || ''));
    return {
      id: i.id, number: i.number ?? null, number_label: invoiceNo(i.number), title: String(i.title || ''), purpose: i.purpose || 'invoice',
      amount_cents: Number(i.amount_cents) || 0, status: String(i.status || 'open'), not_sent: invoiceNotSent(i), state: moneyState({ ...i, not_sent: invoiceNotSent(i) }, today),
      due_date: i.due_date || null, issued_at: i.created_at, paid_at: i.paid_at || null, paid_method: i.paid_method || '',
      processing: !!i.processing_since, payment_for: i.payment_for || null, has_link: !!i.stripe_url,
      refunded_cents: Number(i.refunded_cents) || 0, dispute_status: i.dispute_status || null,
      deal_id: i.deal_id || null, deal_title: d ? String(d.title || '') : '',
      business: k ? String(k.name || k.email || '') : (p && p.company ? String(p.company) : ''),
      // sales item 170: the person once, never under a business of the same name
      person: oneName(k ? String(k.name || k.email || '') : (p && p.company ? String(p.company) : ''), p ? String(p.name || p.email || '') : ''),
      // sales item 169: the row's menu copies the pay link and sends from here
      pay_url: i.stripe_url && /^https:\/\//.test(String(i.stripe_url)) ? String(i.stripe_url) : null,
      // sales item 148: the page's Record a payment box offers a receipt only when there is someone to email
      has_email: !!(p && p.email), first: p ? String(p.name || '').trim().split(/\s+/)[0] || '' : '',
      returned: returnedBy.get(String(i.id)) || [],
      note: String(i.description || ''), lines: Array.isArray(i.lines) ? i.lines : [],
      ...(more ? { paid_note: String(i.paid_note || '') } : {}),
    };
  });
  return { items, partial: all.length >= INVOICES_MAX };
}
