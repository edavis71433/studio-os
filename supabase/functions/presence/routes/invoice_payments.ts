// ── Record a payment that came in outside Stripe (sales item 77, Nov 2026 review) ──
// Small businesses pay by check, cash, bank transfer and Zelle. Until now an
// invoice paid that way stayed Overdue, kept sending "still unpaid" reminders and
// stayed in Who owes you: nothing could mark it paid but Stripe. Here the studio
// records the payment — amount, the day, how, a note — on the invoice.
//
//   all of it    the invoice is paid that day, that way: its reminders stop, its card
//                link is switched off (so it can't be paid twice), it counts in Paid and
//                the money reports, and a paid deposit does what a card deposit does
//                (ticks the checklist; wins a signed deal).
//   part of it   the payment gets a paid row of its own (payment_for = the invoice), and
//                the invoice drops by the same amount, so everything that totals invoice
//                rows stays right without knowing about part payments. The old card link
//                was for the old amount: it is switched off, and the next Send makes one
//                for what's left.
//   by mistake   Undo puts it back: the invoice is open again (a part payment's amount
//                goes back on it); its card link is made fresh on the next Send. The
//                deal's history keeps both lines.
// Optionally the client gets a receipt by email, the PDF attached.
// Studio-gated and site-scoped like every authed /sales/* route; record is an
// 'edit' write and undo a 'delete' one (lib/site_roles.ts).
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { sendEmail } from '../commerce/account.ts';
import { loadEmailBrand, EMAIL_BRAND_DEFAULT } from '../lib/email_brand.ts';
import { clearNotice, clearNoticePrefix } from '../lib/notice.ts';
import { deactivatePaymentLink } from '../commerce/stripe.ts';
import { validatePayment, paidAtOf } from '../lib/invoice_billing.ts';
import { callerToday, stageAfterDepositPaid } from '../lib/sales_lifecycle.ts';
import { invoiceNo, dayLabel, payMethodWords } from '../lib/documents.ts';
import { documentPdf, pdfFileName } from '../lib/doc_pdf.ts';
import { docContextFor } from '../lib/doc_context.ts';
import { dealEvent, docRow, clearStaleNextStep, firstNameOf, docLinkFor } from './sales.ts';
import { missingInsertColumns } from '../lib/inbound_email.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { UUID_RE } from '../lib/uuid.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any)?.json) ? (r as any).json : []) as any[];
const nowIso = () => new Date().toISOString();
const usd = (c: unknown) => '$' + ((Number(c) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escH = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));
const INV_COLS = 'id,site_id,deal_id,customer_client_id,customer_site_id,title,description,amount_cents,currency,purpose,status,stripe_url,stripe_payment_link_id,due_date,paid_at,processing_since,created_at,updated_at,number,paid_method,paid_note,payment_for';
const unavailable = (cors: Record<string, string>) => json({ error: 'unavailable', message: 'Recording a payment needs a quick database update first. Nothing changed.' }, 503, cors);

async function loadInvoice(siteId: string, id: string): Promise<{ ok: boolean; row: any | null }> {
  const r = await svc(`presence_invoices?id=eq.${id}&site_id=eq.${siteId}&deleted_at=is.null&select=${INV_COLS}&limit=1`);
  return { ok: r.ok, row: r.ok ? (rows(r)[0] || null) : null };
}
/** The reminder notices of one invoice go, as a void and a card payment take them. */
async function clearReminders(site: SiteRow, id: string): Promise<void> {
  if (!site.client_id) return;
  await clearNotice(site.client_id, 'deal_followup', `invremind:${id}`).catch(() => {});
  await clearNoticePrefix(site.client_id, 'deal_followup', `invremind:${id}:`).catch(() => {});
}
/** The card link stops taking money: true done, false it may still be live, null there was none. */
async function linkOff(row: any): Promise<boolean | null> {
  return row?.stripe_payment_link_id ? await deactivatePaymentLink(String(row.stripe_payment_link_id)).catch(() => false) : null;
}

export async function handleInvoicePayment(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const got = await loadInvoice(site.id, id);
  if (!got.ok) return unavailable(cors);   // before APPLY-0167 the columns aren't there
  const inv = got.row;
  // the caller's own day (the page sends ?today=), so this evening in Los Angeles is "today"
  const today = callerToday(new URL(req.url).searchParams.get('today'), nowIso());
  const v = validatePayment(b, inv, today);
  if (!v.ok) return json({ error: v.error, message: v.message }, v.error === 'not_found' ? 404 : v.error === 'validation' || v.error === 'more_than_due' ? 422 : 409, cors);
  const p = v.value;
  const paidAt = paidAtOf(p.paid_on);
  const who = principal.email || principal.userId || 'system';
  let payment: any = null;
  let updated: any = null;
  if (!p.part) {
    // all of it: the guard in the WHERE means a card payment landing this second wins, never both
    const up = await svc(`presence_invoices?id=eq.${id}&site_id=eq.${site.id}&status=eq.open&processing_since=is.null&deleted_at=is.null&select=${INV_COLS}`,
      { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'paid', paid_at: paidAt, paid_method: p.method, paid_note: p.note, updated_at: nowIso() }) });
    if (!up.ok) return missingInsertColumns(up.json, up.text, ['paid_method', 'paid_note']).length ? unavailable(cors) : json({ error: 'conflict', message: 'Couldn’t record it just now. Nothing changed. Try again.' }, 409, cors);
    updated = rows(up)[0] || null;
    if (!updated) {
      const now = (await loadInvoice(site.id, id)).row;
      return json({ error: now?.status === 'paid' ? 'already_paid' : 'conflict', message: now?.status === 'paid' ? 'This invoice was just paid. Nothing else changed.' : 'This invoice changed while you were recording. Reload and take another look.' }, 409, cors);
    }
  } else {
    // part of it: the payment's own row first (the record), then the invoice drops by
    // the same amount — guarded on the amount it had, so two at once can't both land
    const ins = await svc('presence_invoices', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
      site_id: site.id, deal_id: inv.deal_id, customer_client_id: inv.customer_client_id || null, customer_site_id: inv.customer_site_id || null,
      title: `Part payment — ${String(inv.title || 'Invoice')}`.slice(0, 200),
      description: `Part payment toward ${inv.purpose === 'deposit' ? 'deposit request' : 'invoice'} ${invoiceNo(inv.number)}`.trim(),
      amount_cents: p.amount_cents, currency: inv.currency || 'usd', purpose: 'service', status: 'paid', paid_at: paidAt,
      paid_method: p.method, paid_note: p.note, payment_for: id, created_by: who,
    }) });
    payment = rows(ins)[0] || null;
    if (!ins.ok || !payment) return missingInsertColumns(ins.json, ins.text, ['paid_method', 'paid_note', 'payment_for']).length ? unavailable(cors) : json({ error: 'write_failed', message: 'That payment didn’t save. Nothing changed. Try again.' }, 502, cors);
    const up = await svc(`presence_invoices?id=eq.${id}&site_id=eq.${site.id}&status=eq.open&processing_since=is.null&amount_cents=eq.${Number(inv.amount_cents)}&deleted_at=is.null&select=${INV_COLS}`,
      { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ amount_cents: p.left_cents, stripe_url: null, stripe_payment_link_id: null, updated_at: nowIso() }) });
    updated = up.ok ? (rows(up)[0] || null) : null;
    if (!updated) {
      // the invoice moved (paid, voided, another payment): take the payment back off
      await svc(`presence_invoices?id=eq.${payment.id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ deleted_at: nowIso() }) }).catch(() => {});
      return json({ error: 'conflict', message: 'This invoice changed while you were recording. Nothing was saved. Reload and take another look.' }, 409, cors);
    }
  }
  // its card link was for the old amount (or is paid now): it stops taking money
  const linkDeactivated = await linkOff(inv);
  if (!p.part) await clearReminders(site, id);
  if (inv.deal_id) await dealEvent(site.id, inv.deal_id, 'invoice_paid', principal, { detail: { invoice_id: id, amount_cents: p.amount_cents, purpose: String(inv.purpose || 'service'), method: p.method, recorded: true, ...(p.part ? { part: true, left_cents: p.left_cents } : {}) } });
  // a deposit paid in full does what a card deposit does: the checklist step, and a signed deal is won
  let moved = false;
  if (!p.part && inv.purpose === 'deposit' && inv.deal_id) {
    try {
      const { tickChecklistForDeal } = await import('../lib/service_bridge.ts');
      await tickChecklistForDeal(site.id, String(inv.deal_id), 'deposit_paid', who, 'operator').catch(() => false);
      const deal = rows(await svc(`presence_deals?id=eq.${inv.deal_id}&site_id=eq.${site.id}&select=stage&limit=1`))[0];
      const signed = rows(await svc(`presence_contracts?deal_id=eq.${inv.deal_id}&site_id=eq.${site.id}&status=eq.signed&deleted_at=is.null&select=id&limit=1`)).length > 0;
      const to = deal ? stageAfterDepositPaid({ currentStage: String(deal.stage || ''), signed, purpose: inv.purpose }) : null;
      if (to) {
        const up = await svc(`presence_deals?id=eq.${inv.deal_id}&site_id=eq.${site.id}&stage=in.(lead,qualified,proposal,contract)&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ stage: to }) });
        moved = up.ok && rows(up).length > 0;
        if (moved) { if (to === 'won') await clearStaleNextStep(site.id, String(inv.deal_id), 'won').catch(() => {}); await dealEvent(site.id, String(inv.deal_id), 'stage_change', principal, { to_stage: to, detail: { because: 'deposit_paid' } }); }
      }
    } catch { /* the payment stands; the checklist and the stage are best-effort */ }
  }
  const receipt = b.email_receipt === false ? false : await emailReceipt(site.id, payment || updated, inv, p.part ? p.left_cents : 0).catch(() => false);
  return json({ data: { invoice: updated, payment, part: p.part, left_cents: p.left_cents, link_deactivated: linkDeactivated, receipt_emailed: receipt, moved } }, 200, cors);
}

/** Undo a payment recorded by mistake. On the invoice: it is open again. On a part
 *  payment's own row: the row goes and its amount goes back on the invoice. Only a
 *  payment recorded by hand — a card payment is Stripe's, and refunds live there. */
export async function handleInvoicePaymentUndo(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const got = await loadInvoice(site.id, id);
  if (!got.ok) return unavailable(cors);
  const row = got.row;
  if (!row) return json({ error: 'not_found', message: 'That payment is no longer here.' }, 404, cors);
  if (row.status !== 'paid' || !row.paid_method) return json({ error: 'bad_state', message: row.status === 'paid' ? 'That was paid online. Refund it in Stripe if the money needs to go back.' : 'That invoice isn’t marked paid.' }, 409, cors);
  if (row.payment_for) {
    const parent = (await loadInvoice(site.id, String(row.payment_for))).row;
    if (!parent || parent.status !== 'open') return json({ error: 'bad_state', message: 'The rest of that invoice was paid or voided since, so this part payment stays. Undo that first.' }, 409, cors);
    const gone = await svc(`presence_invoices?id=eq.${id}&site_id=eq.${site.id}&status=eq.paid&deleted_at=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ deleted_at: nowIso() }) });
    if (!gone.ok || !rows(gone)[0]) return json({ error: 'conflict', message: 'That changed just now. Reload and take another look.' }, 409, cors);
    const back = await svc(`presence_invoices?id=eq.${parent.id}&site_id=eq.${site.id}&status=eq.open&amount_cents=eq.${Number(parent.amount_cents)}&select=${INV_COLS}`,
      { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ amount_cents: Number(parent.amount_cents) + Number(row.amount_cents), stripe_url: null, stripe_payment_link_id: null, updated_at: nowIso() }) });
    if (!back.ok || !rows(back)[0]) {
      await svc(`presence_invoices?id=eq.${id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ deleted_at: null }) }).catch(() => {});
      return json({ error: 'conflict', message: 'That invoice changed just now. Nothing was undone. Reload and take another look.' }, 409, cors);
    }
    const linkDeactivated = await linkOff(parent);   // its link was for the lower amount
    if (parent.deal_id) await dealEvent(site.id, parent.deal_id, 'payment_undone', principal, { detail: { invoice_id: parent.id, payment_id: id, amount_cents: Number(row.amount_cents) || 0, method: row.paid_method, part: true } });
    return json({ data: { invoice: rows(back)[0], undone: true, part: true, link_deactivated: linkDeactivated } }, 200, cors);
  }
  // the whole invoice: open again. Its card link was switched off when it was marked
  // paid, so the next Send makes a fresh one.
  const up = await svc(`presence_invoices?id=eq.${id}&site_id=eq.${site.id}&status=eq.paid&paid_method=neq.&deleted_at=is.null&select=${INV_COLS}`,
    { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'open', paid_at: null, paid_method: '', paid_note: '', stripe_url: null, stripe_payment_link_id: null, updated_at: nowIso() }) });
  if (!up.ok || !rows(up)[0]) return json({ error: 'conflict', message: 'That changed just now. Reload and take another look.' }, 409, cors);
  if (row.deal_id) await dealEvent(site.id, row.deal_id, 'payment_undone', principal, { detail: { invoice_id: id, amount_cents: Number(row.amount_cents) || 0, method: row.paid_method, title: String(row.title || '') } });
  return json({ data: { invoice: rows(up)[0], undone: true, part: false } }, 200, cors);
}

/** The client's receipt for a payment recorded by hand: what, how much, when and how,
 *  with the receipt as a PDF. Sent only when the deal's person has an email. */
async function emailReceipt(siteId: string, paidRow: any, inv: any, leftCents: number): Promise<boolean> {
  if (!paidRow || !UUID_RE.test(String(inv?.deal_id || ''))) return false;
  const deal = rows(await svc(`presence_deals?id=eq.${inv.deal_id}&site_id=eq.${siteId}&select=contact_id&limit=1`))[0];
  const contact = deal?.contact_id ? rows(await svc(`presence_contacts?id=eq.${deal.contact_id}&site_id=eq.${siteId}&select=name,email&limit=1`))[0] : null;
  if (!contact?.email) return false;
  const brand = await loadEmailBrand(siteId);
  const row = await docRow('invoice', String(paidRow.id), siteId);
  if (!row) return false;
  const ctx = await docContextFor(siteId, 'invoice', row).catch(() => null);
  const no = invoiceNo(inv.number);
  const first = firstNameOf(contact.name);
  const studio = brand.name && brand.name !== EMAIL_BRAND_DEFAULT.name ? escH(brand.name) : 'your studio';
  const how = payMethodWords(row.paid_method);
  const day = dayLabel(row.paid_at, ctx?.tz);
  const what = `${inv.purpose === 'deposit' ? 'deposit request' : 'invoice'}${no ? ' ' + no : ''}${inv.title && !/^(invoice|deposit)$/i.test(String(inv.title).trim()) ? ` (${escH(String(inv.title))})` : ''}`;
  const link = await docLinkFor('invoice', String(paidRow.id), siteId).catch(() => null);
  const { deal_id: _d, ...data } = row;
  let pdf: Uint8Array<ArrayBuffer> | null = null;
  try { pdf = documentPdf('invoice', data, brand, ctx); } catch { pdf = null; }
  const html = `<p>${first ? `Hi ${escH(first)},` : 'Hi there,'}</p>`
    + `<p>Thank you. ${studio === 'your studio' ? 'Your studio has' : studio + ' has'} recorded your payment of <strong>${usd(row.amount_cents)}</strong>${how ? ' ' + how : ''}${day ? ' on ' + day : ''} for ${what}.</p>`
    + (leftCents > 0 ? `<p>${usd(leftCents)} is still due on it.</p>` : `<p>${inv.purpose === 'deposit' ? 'Your deposit is in.' : 'The invoice is paid in full.'} Nothing else is needed from you.</p>`)
    + `<p style="margin-top:6px">Your receipt is attached as a PDF.${link ? ` <a href="${link}" style="color:${brand.accentDark}">View it online →</a>` : ''}</p>`;
  return await sendEmail(String(contact.email), `Receipt${no ? ' for ' + no : ''} — ${usd(row.amount_cents)} received, thank you`, html, brand,
    { critical: true, siteId, ...(pdf ? { attachments: [{ filename: pdfFileName('invoice', row), content: pdf }] } : {}) });   // their own payment = transactional; an answer lands in the Inbox
}
