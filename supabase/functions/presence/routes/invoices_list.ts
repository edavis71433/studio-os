// ═══ THE INVOICES PAGE (sales item 85, Nov 2026) ══════════════════════════════
//   GET /sales/invoices?today=YYYY-MM-DD
// Every invoice the studio has sent, newest first: its number, who it is for (the business and
// the person), what it is for, the amount, when it was issued and when it is due, and its state
// in the one money formula's words (lib/money_state.ts, on the caller's day). A part payment
// recorded by hand is its own paid row (payment_for = the invoice it paid toward): the page shows
// it under that invoice and counts it as money in. The page works out its totals and month
// picker from these rows on its own day. Up to INVOICES_MAX; past that, `partial` says so.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';
import { UUID_RE } from '../lib/uuid.ts';
import { moneyState } from '../lib/money_state.ts';
import { invoiceNo } from '../lib/documents.ts';
import { callerToday } from '../lib/sales_lifecycle.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any)?.json) ? (r as any).json : []) as any[];
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
  const base = 'id,title,amount_cents,purpose,status,due_date,paid_at,created_at,deal_id,customer_client_id,stripe_url';
  // number, how it was paid and part payments land with APPLY-0167; processing_since with 0132
  const shapes = [`${base},processing_since,number,paid_method,paid_note,payment_for${more ? ',lines' : ''}`, `${base},processing_since`, base];
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
  const [people, customers] = await Promise.all([
    Promise.all(chunk(contactIds).map((c) => svc(`presence_contacts?id=in.(${c.join(',')})&site_id=eq.${site.id}&select=id,name,email,company`).then(rows).catch(() => [] as any[]))).then((x) => x.flat()),
    Promise.all(chunk(clientIds).map((c) => svc(`clients?id=in.(${c.join(',')})&select=id,name,email`).then(rows).catch(() => [] as any[]))).then((x) => x.flat()),
  ]);
  const byId = <T,>(list: any[]) => new Map<string, T>(list.map((x: any) => [String(x.id), x]));
  const deal = byId<any>(dealRows), person = byId<any>(people), customer = byId<any>(customers);
  const items = all.map((i: any) => {
    const d = deal.get(String(i.deal_id || ''));
    const p = d ? person.get(String(d.contact_id || '')) : null;
    const k = customer.get(String(i.customer_client_id || (d && d.converted_client_id) || ''));
    return {
      id: i.id, number: i.number ?? null, number_label: invoiceNo(i.number), title: String(i.title || ''), purpose: i.purpose || 'invoice',
      amount_cents: Number(i.amount_cents) || 0, status: String(i.status || 'open'), state: moneyState(i, today),
      due_date: i.due_date || null, issued_at: i.created_at, paid_at: i.paid_at || null, paid_method: i.paid_method || '',
      processing: !!i.processing_since, payment_for: i.payment_for || null, has_link: !!i.stripe_url,
      deal_id: i.deal_id || null, deal_title: d ? String(d.title || '') : '',
      business: k ? String(k.name || k.email || '') : (p && p.company ? String(p.company) : ''),
      person: p ? String(p.name || p.email || '') : '',
      ...(more ? { paid_note: String(i.paid_note || ''), lines: Array.isArray(i.lines) ? i.lines : [] } : {}),
    };
  });
  return { items, partial: all.length >= INVOICES_MAX };
}
