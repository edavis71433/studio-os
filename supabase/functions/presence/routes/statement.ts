// ── A customer's statement (sales item 171, Nov 22 2026 review) ────────────────
//   GET  /sales/statement?deal=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD&format=pdf|json&today=
//   POST /sales/statement/email   { deal, from, to }   → the same PDF, emailed to the deal's person
// One page: every invoice issued to the customer in those days (an amount owed), every payment
// (an amount paid, by hand or online, part payments too), every retainer charge, every refund or
// dispute lost, each with its day, and a running balance; the balance before the first day
// opens it. The customer is the deal's person: when the deal became a customer account, every
// deal that became the same account counts, so a repeat customer gets one statement.
// Pure shaping in statementRows / statementPdf; the reads here. Studio-gated and site-scoped.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { UUID_RE } from '../lib/uuid.ts';
import { callerToday } from '../lib/sales_lifecycle.ts';
import { exportPeriod, localYmd, usDate } from '../lib/accounting_export.ts';
import { retainerPayments } from '../lib/invoice_billing.ts';
import { RETURNED_SELECT, returnedPayments } from '../lib/money_returns.ts';
import { invoiceNo, dayLabel } from '../lib/documents.ts';
import { statementPdf, type StatementLine } from '../lib/doc_pdf.ts';
import { loadEmailBrand, EMAIL_BRAND_DEFAULT, emailBand, emailFacts } from '../lib/email_brand.ts';
import { sendEmail } from '../commerce/account.ts';
import { studioParty, billToForDeal } from '../lib/doc_context.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any)?.json) ? (r as any).json : []) as any[];
const money = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface StatementIn { invoices: any[]; charges: Array<{ amount_cents: number; paid_at: string }>; returned: Array<{ amount_cents: number; paid_at: string; kind: string; invoice_id: string }> }
/** The lines, oldest first, with a running balance; `opening` is what was owed before `from`. Pure. */
export function statementRows(x: StatementIn, p: { from: string; to: string }, tz = 0): { opening: number; lines: StatementLine[]; closing: number; owed_now: number } {
  const ev: Array<{ at: string; day: string; what: string; ref: string; owed: number; paid: number }> = [];
  const byId = new Map(x.invoices.map((i) => [String(i.id), i]));
  for (const i of x.invoices) {
    if (i.status === 'void' || i.status === 'canceled') continue;
    const parent = i.payment_for ? byId.get(String(i.payment_for)) : null;
    const no = invoiceNo(parent ? parent.number : i.number);
    if (!i.payment_for) {
      const billed = Math.round(Number(i.amount_cents) || 0) + x.invoices.filter((q) => String(q.payment_for) === String(i.id) && q.status === 'paid').reduce((n, q) => n + Math.round(Number(q.amount_cents) || 0), 0);
      ev.push({ at: String(i.created_at || ''), day: localYmd(i.created_at, tz), what: `${i.purpose === 'deposit' ? 'Deposit request' : 'Invoice'}${i.title ? ': ' + String(i.title).slice(0, 60) : ''}`, ref: no, owed: billed, paid: 0 });
    }
    if (i.status === 'paid' && i.paid_at) ev.push({ at: String(i.paid_at), day: localYmd(i.paid_at, tz), what: `Payment${parent ? ' (part)' : ''}${i.paid_method ? ', by ' + String(i.paid_method).replace('_', ' ') : ', online'}`, ref: no, owed: 0, paid: Math.round(Number(i.amount_cents) || 0) });
  }
  for (const c of x.charges) ev.push({ at: c.paid_at, day: localYmd(c.paid_at, tz), what: 'Retainer charge', ref: '', owed: c.amount_cents, paid: c.amount_cents });
  for (const r of x.returned) ev.push({ at: r.paid_at, day: localYmd(r.paid_at, tz), what: r.kind === 'dispute' ? 'Dispute lost (payment returned)' : 'Refund', ref: invoiceNo(byId.get(r.invoice_id)?.number), owed: r.amount_cents, paid: 0 });
  ev.sort((a, b) => a.at.localeCompare(b.at));
  let bal = 0, opening = 0;
  const lines: StatementLine[] = [];
  for (const e of ev) {
    if (e.day < p.from) { bal += e.owed - e.paid; opening = bal; continue; }
    if (e.day > p.to) continue;
    bal += e.owed - e.paid;
    lines.push({ day: usDate(e.day), what: e.what, ref: e.ref, owed: e.owed ? money(e.owed) : '', paid: e.paid ? money(e.paid) : '', balance: money(bal) });
  }
  const owedNow = ev.reduce((n, e) => n + e.owed - e.paid, 0);
  return { opening, lines, closing: bal, owed_now: owedNow };
}

async function readStatement(site: SiteRow, dealId: string): Promise<{ invoices: any[]; charges: Array<{ amount_cents: number; paid_at: string }>; returned: ReturnType<typeof returnedPayments>; deals: string[]; title: string } | null> {
  const deal = rows(await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${site.id}&deleted_at=is.null&select=id,title,contact_id,converted_client_id&limit=1`))[0];
  if (!deal) return null;
  // every deal of the same customer account, or of the same person, counts as the one customer
  let dealIds = [String(deal.id)];
  const q = deal.converted_client_id ? `converted_client_id=eq.${deal.converted_client_id}` : deal.contact_id ? `contact_id=eq.${deal.contact_id}` : '';
  if (q) { const r = await svc(`presence_deals?site_id=eq.${site.id}&${q}&deleted_at=is.null&select=id&limit=200`); if (r.ok) dealIds = [...new Set([...dealIds, ...rows(r).map((d) => String(d.id))])]; }
  const inQ = `deal_id=in.(${dealIds.join(',')})`;
  let ir = await svc(`presence_invoices?site_id=eq.${site.id}&${inQ}&deleted_at=is.null&select=id,number,title,amount_cents,purpose,status,paid_at,paid_method,payment_for,created_at,refunded_cents&order=created_at.asc&limit=1000`);
  if (!ir.ok) ir = await svc(`presence_invoices?site_id=eq.${site.id}&${inQ}&deleted_at=is.null&select=id,title,amount_cents,purpose,status,paid_at,created_at&order=created_at.asc&limit=1000`);
  if (!ir.ok) return null;
  const ev = await svc(`presence_deal_events?site_id=eq.${site.id}&${inQ}&kind=eq.invoice_paid&detail->>retainer=eq.true&select=kind,detail,created_at&order=created_at.asc&limit=1000`).catch(() => ({ ok: false, json: null }));
  const ret = await svc(`presence_money_returns?site_id=eq.${site.id}&${inQ}&counted_cents=gt.0&select=${RETURNED_SELECT}&order=counted_at.asc&limit=500`).catch(() => ({ ok: false, json: null }));
  return { invoices: rows(ir), charges: ev.ok ? retainerPayments(rows(ev)) : [], returned: ret.ok ? returnedPayments(rows(ret)) : [], deals: dealIds, title: String(deal.title || '') };
}

async function buildStatement(req: Request, site: SiteRow, dealId: string, fromRaw: unknown, toRaw: unknown): Promise<{ pdf: Uint8Array<ArrayBuffer>; name: string; who: string; email: string; p: { from: string; to: string }; sum: ReturnType<typeof statementRows> } | { error: string; message: string; status: number }> {
  if (!UUID_RE.test(dealId)) return { error: 'bad_request', message: 'Which customer?', status: 400 };
  const today = callerToday(new URL(req.url).searchParams.get('today'), new Date().toISOString());
  const p = exportPeriod(fromRaw, toRaw, today);
  if ('error' in p) return { error: 'validation', message: p.error, status: 422 };
  const x = await readStatement(site, dealId);
  if (!x) return { error: 'read_failed', message: 'The customer’s invoices couldn’t load just now. Try again.', status: 502 };
  const [studio, billTo, brand] = await Promise.all([studioParty(site.id), billToForDeal(site.id, dealId), loadEmailBrand(site.id).catch(() => null)]);
  const tzo = Math.max(-840, Math.min(840, Math.trunc(Number(new URL(req.url).searchParams.get('tzo')) || 0)));
  const sum = statementRows({ invoices: x.invoices, charges: x.charges, returned: x.returned }, p, tzo);
  const who = String(billTo?.company || billTo?.name || x.title || 'Customer');
  const pdf = statementPdf({ from: p.from, to: p.to, opening: money(sum.opening), closing: money(sum.closing), lines: sum.lines, who, studio: { ...studio.party, name: brand?.name && brand.name !== EMAIL_BRAND_DEFAULT.name ? brand.name : studio.party.name || 'Studio OS' }, billTo, issued: dayLabel(today, studio.tz) }, brand);
  return { pdf, name: `Statement-${p.from}-to-${p.to}.pdf`, who, email: String(billTo?.email || ''), p, sum };
}

export async function handleStatement(req: Request, site: SiteRow, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  const u = new URL(req.url);
  const built = await buildStatement(req, site, String(u.searchParams.get('deal') || ''), u.searchParams.get('from'), u.searchParams.get('to'));
  if ('error' in built) return json({ error: built.error, message: built.message }, built.status, cors);
  if (u.searchParams.get('format') === 'json') return json({ data: { from: built.p.from, to: built.p.to, who: built.who, has_email: !!built.email, opening_cents: built.sum.opening, closing_cents: built.sum.closing, owed_now_cents: built.sum.owed_now, lines: built.sum.lines } }, 200, cors);
  return new Response(built.pdf, { status: 200, headers: { ...cors, 'Access-Control-Expose-Headers': 'Content-Disposition', 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${built.name}"`, 'Cache-Control': 'no-store' } });
}

export async function handleStatementEmail(req: Request, site: SiteRow, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const built = await buildStatement(req, site, String(b.deal || ''), b.from, b.to);
  if ('error' in built) return json({ error: built.error, message: built.message }, built.status, cors);
  if (!built.email) return json({ error: 'no_email', message: 'There’s no email on this customer’s contact, so the statement can’t be sent. Download it instead.' }, 409, cors);
  const brand = await loadEmailBrand(site.id);
  const studio = brand.name && brand.name !== EMAIL_BRAND_DEFAULT.name ? brand.name : 'your studio';
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));
  const sent = await sendEmail(built.email, `Your statement from ${studio}: ${usDate(built.p.from)} to ${usDate(built.p.to)}`,
    emailBand('Statement', `${usDate(built.p.from)} to ${usDate(built.p.to)}`) + `<p>Here is your statement from ${esc(studio)}: every invoice and payment in those days, with the balance as it went.</p>` +
    emailFacts([['Owed now', money(Math.max(0, built.sum.owed_now))]], { big: true }) + `<p>It is attached as a PDF. Have a question about it? Just reply to this email.</p>`,
    brand, { critical: true, asBusiness: true, siteId: site.id, attachments: [{ filename: built.name, content: built.pdf }] }).catch(() => false);
  if (!sent) return json({ error: 'send_failed', message: 'The statement didn’t send. Try again, or download it.' }, 502, cors);
  return json({ data: { sent: true, to_first: built.who } }, 200, cors);
}
