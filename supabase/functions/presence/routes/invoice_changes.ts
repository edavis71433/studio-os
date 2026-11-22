// ── Change an unpaid invoice · Remind now · Give money back by hand (sales items 162, 166, 165) ──
//   PATCH /sales/invoices/:id              the title, note, due date; the amount and lines while
//                                          nothing was paid toward it. The number is kept. A new
//                                          amount gets a fresh pay link; one already sent is sent
//                                          again as corrected (resend: false holds the email).
//   POST  /sales/invoices/:id/remind       one reminder email now, on the invoice's own words for
//                                          where it stands (coming up · due today · still open).
//                                          Once a day per invoice; the deal's history says so.
//   POST  /sales/invoices/:id/money-back   money given back by hand on an invoice paid by hand:
//                                          amount, day, how, note. A presence_money_returns row
//                                          (0233) with stripe_id 'hand:<id>', the invoice's
//                                          refunded_cents up by it, a line on the deal.
// Studio-gated and site-scoped like every authed /sales/* route (lib/invoice_changes.ts holds
// the pure rules). Money words come from lib/money_state.ts as before: a part refund still
// reads Paid, a whole one Refunded.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { UUID_RE } from '../lib/uuid.ts';
import { callerToday } from '../lib/sales_lifecycle.ts';
import { validateInvoiceEdit, changeWords, validateMoneyBack, remindNowSlot } from '../lib/invoice_changes.ts';
import { deactivatePaymentLink } from '../commerce/stripe.ts';
import { mintPayLink } from '../lib/pay_link.ts';
import { invoiceNo } from '../lib/documents.ts';
import { raiseNotice } from '../lib/notice.ts';
import { loadEmailBrand } from '../lib/email_brand.ts';
import { sendEmail } from '../commerce/account.ts';
import { missingInsertColumns } from '../lib/inbound_email.ts';
import { paidAtOf, PAY_METHODS, PAY_METHOD_LABEL, type PayMethod } from '../lib/invoice_billing.ts';
import { readDocToken, saidPaidWords } from '../lib/documents.ts';
import { rateAllow, clientIp, tooMany } from '../lib/ratelimit.ts';
import { clearNotice, clearNoticePrefix } from '../lib/notice.ts';
import { dayLabel } from '../lib/documents.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any)?.json) ? (r as any).json : []) as any[];
const nowIso = () => new Date().toISOString();
const INV_COLS = 'id,site_id,deal_id,customer_client_id,title,description,amount_cents,currency,purpose,status,stripe_url,stripe_payment_link_id,due_date,paid_at,paid_method,paid_note,payment_for,processing_since,created_at,updated_at,number,link_gen,first_sent_at,lines,refunded_cents,dispute_status';
const INV_COLS_OLD = 'id,site_id,deal_id,customer_client_id,title,description,amount_cents,currency,purpose,status,stripe_url,stripe_payment_link_id,due_date,paid_at,paid_method,paid_note,payment_for,processing_since,created_at,updated_at,number,link_gen,first_sent_at,lines';
const unavailable = (cors: Record<string, string>, what: string) => json({ error: 'unavailable', message: `${what} needs a quick database update first. Nothing changed.` }, 503, cors);

async function loadInvoice(siteId: string, id: string): Promise<{ ok: boolean; row: any | null; old: boolean }> {
  let r = await svc(`presence_invoices?id=eq.${id}&site_id=eq.${siteId}&deleted_at=is.null&select=${INV_COLS}&limit=1`);
  let old = false;
  if (!r.ok) { r = await svc(`presence_invoices?id=eq.${id}&site_id=eq.${siteId}&deleted_at=is.null&select=${INV_COLS_OLD}&limit=1`); old = true; }
  return { ok: r.ok, row: r.ok ? (rows(r)[0] || null) : null, old };
}
/** What was paid toward an invoice in parts (each part is its own paid row). */
async function partsPaid(siteId: string, id: string): Promise<number | null> {
  const r = await svc(`presence_invoices?payment_for=eq.${id}&site_id=eq.${siteId}&status=eq.paid&deleted_at=is.null&select=amount_cents&limit=100`).catch(() => ({ ok: false, json: null }));
  if (!r.ok) return null;
  return rows(r).reduce((n: number, p: any) => n + Math.max(0, Math.round(Number(p.amount_cents) || 0)), 0);
}
/** The deal's person: name and email. */
async function dealContact(siteId: string, dealId: unknown): Promise<{ name: string; email: string }> {
  if (!UUID_RE.test(String(dealId || ''))) return { name: '', email: '' };
  const deal = rows(await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${siteId}&select=contact_id&limit=1`).catch(() => ({ json: [] })))[0];
  const c = deal?.contact_id ? rows(await svc(`presence_contacts?id=eq.${deal.contact_id}&site_id=eq.${siteId}&select=name,email&limit=1`).catch(() => ({ json: [] })))[0] : null;
  return { name: String(c?.name || ''), email: String(c?.email || '').trim() };
}
const wasSent = (inv: any) => !!(inv.stripe_url || inv.first_sent_at || Number(inv.link_gen) > 0);

// ═══ 172. the client says they paid another way; the studio confirms or says not received ═══
const SAID_PREFIX = (id: string) => `saidpaid:${id}:`;
/** Pure: what the client sent, checked. */
export function validateSaidPaid(b: any, todayYmd: string): { ok: true; value: { method: PayMethod; on: string } } | { ok: false; message: string } {
  const method = String(b?.method || '') as PayMethod;
  if (!(PAY_METHODS as readonly string[]).includes(method)) return { ok: false, message: 'Pick how you paid.' };
  const on = String(b?.on || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || !Number.isFinite(Date.parse(on + 'T12:00:00Z')) || on < '2000-01-01') return { ok: false, message: 'Enter the day you paid.' };
  if (on > todayYmd) return { ok: false, message: 'That day hasn’t come yet.' };
  return { ok: true, value: { method, on } };
}
/** POST /sales/doc/:token/said-paid (public, under the invoice's own signed token). */
export async function handleSaidPaid(req: Request, token: string, cors: Record<string, string>): Promise<Response> {
  if (!(await rateAllow(`said_paid:${clientIp(req)}`, 10, 60))) return tooMany(cors);
  const { linkSecret } = await import('./sales.ts');
  const secret = linkSecret();
  if (!secret) return json({ error: 'unavailable', message: 'This isn’t available right now.' }, 503, cors);
  const tok = await readDocToken(token, secret);
  if (!tok || tok.k !== 'invoice') return json({ error: 'invalid_link', message: 'This link isn’t valid.' }, 403, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json', message: 'That didn’t come through. Try again.' }, 400, cors); }
  const today = nowIso().slice(0, 10);
  const v = validateSaidPaid(b, today);
  if (!v.ok) return json({ error: 'validation', message: v.message }, 422, cors);
  const got = await loadInvoice(tok.site_id, tok.id);
  if (!got.ok) return json({ error: 'read_failed', message: 'Something went wrong. Try again in a moment.' }, 502, cors);
  const inv = got.row;
  if (!inv || inv.payment_for) return json({ error: 'not_found', message: 'This invoice is no longer here.' }, 404, cors);
  if (inv.status === 'paid') return json({ data: { words: 'This invoice is already marked paid. Thank you.' } }, 200, cors);
  if (inv.status !== 'open' || inv.processing_since) return json({ error: 'bad_state', message: inv.processing_since ? 'Your payment is already on its way.' : 'This invoice is no longer payable.' }, 409, cors);
  const at = nowIso();
  const claim = { method: v.value.method, on: v.value.on, at };
  const up = await svc(`presence_invoices?id=eq.${inv.id}&site_id=eq.${tok.site_id}&status=eq.open&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ client_says_paid: claim, updated_at: at }) });
  if (!up.ok) return json({ error: 'unavailable', message: 'This isn’t switched on yet. Reply to the email instead and we will mark it paid.' }, 503, cors);   // before APPLY-0250
  if (!rows(up)[0]) return json({ error: 'conflict', message: 'This invoice just changed. Reload and take another look.' }, 409, cors);
  // the studio's Needs-you line, once per claim; recording the payment or Not received takes it down
  const site = rows(await svc(`presence_sites?id=eq.${tok.site_id}&select=client_id&limit=1`).catch(() => ({ json: [] })))[0];
  const who = await dealContact(tok.site_id, inv.deal_id);
  const no = invoiceNo(inv.number);
  const first = String(who.name || '').trim().split(/\s+/)[0] || 'The client';
  const amount = '$' + ((Number(inv.amount_cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
  if (site?.client_id) {
    await raiseNotice({ siteId: tok.site_id, clientId: String(site.client_id), kind: 'client_said_paid', period: `${SAID_PREFIX(inv.id)}${at.slice(0, 10)}`,
      headline: `${first} says they paid ${no || 'the invoice'} (${amount}) by ${PAY_METHOD_LABEL[v.value.method].toLowerCase()} on ${dayLabel(v.value.on)}`,
      body: 'Check your bank. On the invoice, press Confirm to record the payment, or Not received to carry on reminding them. Reminders are paused meanwhile.' }).catch(() => false);
  }
  return json({ data: { words: saidPaidWords(claim, null) } }, 200, cors);
}
/** The claim and its line go: the payment was recorded, or the studio pressed Not received. */
export async function clearSaidPaid(site: SiteRow, id: string): Promise<void> {
  await svc(`presence_invoices?id=eq.${id}&site_id=eq.${site.id}&client_says_paid=not.is.null`, { method: 'PATCH', body: JSON.stringify({ client_says_paid: null }) }).catch(() => {});
  if (site.client_id) await clearNoticePrefix(String(site.client_id), 'client_said_paid', SAID_PREFIX(id)).catch(() => {});
}
/** POST /sales/invoices/:id/not-paid: the money never came; the reminders carry on. */
export async function handleInvoiceNotPaid(_req: Request, site: SiteRow, _principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const got = await loadInvoice(site.id, id);
  if (!got.ok) return json({ error: 'read_failed', message: 'We couldn’t read that invoice just now. Try again.' }, 502, cors);
  if (!got.row) return json({ error: 'not_found', message: 'That invoice is no longer here.' }, 404, cors);
  await clearSaidPaid(site, id);
  void clearNotice;
  return json({ data: { ok: true, cleared: true } }, 200, cors);
}

// ═══ 162. Change an unpaid invoice ═══
export async function handleInvoiceEdit(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const got = await loadInvoice(site.id, id);
  if (!got.ok) return unavailable(cors, 'Changing an invoice');
  const inv = got.row;
  if (!inv) return json({ error: 'not_found', message: 'That invoice is no longer here.' }, 404, cors);
  const parts = await partsPaid(site.id, id);
  if (parts === null) return json({ error: 'read_failed', message: 'We couldn’t check what was paid toward it, so nothing changed. Try again.' }, 502, cors);
  const today = callerToday(new URL(req.url).searchParams.get('today'), nowIso());
  const v = validateInvoiceEdit(b, inv, parts, today);
  if (!v.ok) return json({ error: v.error, message: v.message }, v.error === 'not_found' ? 404 : v.error === 'validation' ? 422 : 409, cors);
  if (!v.changes.length) return json({ data: inv, changed: false, changes: [] }, 200, cors);
  const amountChanges = 'amount_cents' in v.patch;
  const hadLink = !!inv.stripe_url;
  // the old link was for the old amount: it comes off the row (and is switched off below), and
  // whoever clears the stored link adds one to link_gen (lib/pay_link.ts)
  const patch: Record<string, unknown> = { ...v.patch, updated_at: nowIso() };
  if (amountChanges) Object.assign(patch, { stripe_url: null, stripe_payment_link_id: null, link_gen: Math.max(0, Math.trunc(Number(inv.link_gen) || 0)) + 1 });
  const guard = `presence_invoices?id=eq.${id}&site_id=eq.${site.id}&status=eq.open&processing_since=is.null&deleted_at=is.null${amountChanges ? `&amount_cents=eq.${Math.round(Number(inv.amount_cents) || 0)}` : ''}&select=${got.old ? INV_COLS_OLD : INV_COLS}`;
  const up = await svc(guard, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!up.ok) return missingInsertColumns(up.json, up.text, ['lines', 'link_gen']).length ? unavailable(cors, 'Changing an invoice') : json({ error: 'conflict', message: 'Couldn’t change it just now. Nothing changed. Try again.' }, 409, cors);
  let updated = rows(up)[0] || null;
  if (!updated) return json({ error: 'conflict', message: 'This invoice changed while you were editing it (it may have been paid). Reload and take another look.' }, 409, cors);
  let linkDeactivated: boolean | null = null;
  let freshLink: boolean | null = null;
  if (amountChanges) {
    linkDeactivated = inv.stripe_payment_link_id ? await deactivatePaymentLink(String(inv.stripe_payment_link_id)).catch(() => false) : null;
    if (hadLink) { const url = await mintPayLink(updated); freshLink = !!url; if (url) updated = { ...updated, stripe_url: url }; }
  }
  const words = changeWords(v.changes, String(inv.currency || 'usd'));
  const no = invoiceNo(inv.number);
  // the deal's history keeps each change, old and new
  const { dealEvent } = await import('./sales.ts');
  if (inv.deal_id) await dealEvent(site.id, inv.deal_id, 'invoice_changed', principal, { detail: { invoice_id: id, number: inv.number ?? null, purpose: String(inv.purpose || 'service'), amount_cents: Math.round(Number(updated.amount_cents) || 0), changes: v.changes, words } });
  // one already sent goes again, as corrected, with the same number
  let resent = false;
  if (wasSent(inv) && b.resend !== false && updated.stripe_url && inv.deal_id) {
    const { emailInvoice } = await import('./sales.ts');
    const note = `This replaces the earlier copy of ${inv.purpose === 'deposit' ? 'deposit request' : 'invoice'}${no ? ' ' + no : ''}: ${words.join('; ')}. The number is the same; please use this one.`;
    resent = await emailInvoice(site.id, String(inv.deal_id), String(updated.title || inv.title || 'Invoice'), String(updated.stripe_url), Math.round(Number(updated.amount_cents) || 0), id, note).catch(() => false);
  }
  return json({ data: updated, changed: true, changes: v.changes, words, resent, sent_before: wasSent(inv), link_deactivated: linkDeactivated, fresh_link: freshLink }, 200, cors);
}

// ═══ 166. Remind now ═══
export async function handleInvoiceRemindNow(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const got = await loadInvoice(site.id, id);
  if (!got.ok) return json({ error: 'read_failed', message: 'We couldn’t read that invoice just now. Try again.' }, 502, cors);
  const inv = got.row;
  if (!inv) return json({ error: 'not_found', message: 'That invoice is no longer here.' }, 404, cors);
  if (inv.payment_for || inv.status !== 'open') return json({ error: 'bad_state', message: inv.status === 'paid' ? 'This invoice is paid, so there is nothing to remind them about.' : 'This invoice isn’t open.' }, 409, cors);
  if (inv.processing_since) return json({ error: 'processing', message: 'The client has already paid this and the payment is on its way. Nothing to remind them about.' }, 409, cors);
  if (!inv.stripe_url) return json({ error: 'not_sent', message: 'This invoice hasn’t been sent yet. Press Send first; a reminder comes after.' }, 409, cors);
  if (!site.client_id) return json({ error: 'bad_state', message: 'This workspace can’t send reminders.' }, 409, cors);
  const who = await dealContact(site.id, inv.deal_id);
  if (!who.email) return json({ error: 'no_email', message: 'There’s no email on this deal’s contact, so nothing can be sent. Add their email on the contact first.' }, 409, cors);
  const today = callerToday(new URL(req.url).searchParams.get('today'), nowIso());
  // the ledger row is the once-a-day gate: the same key as the automatic reminders, so paying
  // or voiding the invoice takes it down with them
  const created = await raiseNotice({ siteId: site.id, clientId: String(site.client_id), kind: 'deal_followup', period: `invremind:${id}:now:${today}`, headline: `Reminder sent — ${inv.title || 'invoice'}`, body: 'You sent a reminder by hand.', status: 'dismissed' });
  if (!created) return json({ error: 'already_today', message: 'A reminder already went to them today. Give it a day before the next.' }, 409, cors);
  const { invoiceReminderCopy, invoiceReminderMore } = await import('../commerce/lifecycle.ts');
  const { docLinkFor } = await import('./sales.ts');
  const amount = '$' + ((Number(inv.amount_cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
  const what: 'deposit' | 'invoice' = inv.purpose === 'deposit' ? 'deposit' : 'invoice';
  const slot = remindNowSlot(inv.due_date, today);
  let sent = false;
  try {
    const brand = await loadEmailBrand(site.id);
    const copy = invoiceReminderCopy(slot, what, amount, String(inv.title || ''), !inv.due_date);
    const btn = `<a href="${inv.stripe_url}" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">Pay ${amount} securely →</a>`;
    const doc = await docLinkFor('invoice', id, site.id).catch(() => null);
    sent = await sendEmail(who.email, copy.subject, `<p>${copy.line}</p><p class="cta">${btn}</p>${invoiceReminderMore(doc, brand.accentDark)}`, brand, { critical: true, asBusiness: true, siteId: site.id }).catch(() => false);
  } catch { sent = false; }
  if (!sent) {
    // the claim comes off, so it can be tried again
    await svc(`presence_plan_notices?client_id=eq.${encodeURIComponent(String(site.client_id))}&kind=eq.deal_followup&period=eq.${encodeURIComponent(`invremind:${id}:now:${today}`)}`, { method: 'DELETE' }).catch(() => {});
    return json({ error: 'send_failed', message: 'The reminder didn’t go out. Nothing changed. Try again in a moment.' }, 502, cors);
  }
  const { dealEvent } = await import('./sales.ts');
  if (inv.deal_id) await dealEvent(site.id, inv.deal_id, 'invoice_reminded', principal, { detail: { invoice_id: id, number: inv.number ?? null, amount_cents: Math.round(Number(inv.amount_cents) || 0), purpose: String(inv.purpose || 'service'), slot } });
  return json({ data: { sent: true, slot, to_first: String(who.name || '').trim().split(/\s+/)[0] || '' } }, 200, cors);
}

// ═══ 165. Give money back by hand ═══
export async function handleInvoiceMoneyBack(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const got = await loadInvoice(site.id, id);
  if (!got.ok || got.old) return unavailable(cors, 'Giving money back');   // refunded_cents lands with APPLY-0233
  const inv = got.row;
  const parts = inv ? await partsPaid(site.id, id) : 0;
  if (parts === null) return json({ error: 'read_failed', message: 'We couldn’t check what was paid on it, so nothing changed. Try again.' }, 502, cors);
  const today = callerToday(new URL(req.url).searchParams.get('today'), nowIso());
  const v = validateMoneyBack(b, inv, parts, today);
  if (!v.ok) return json({ error: v.error, message: v.message }, v.error === 'not_found' ? 404 : v.error === 'validation' ? 422 : 409, cors);
  const p = v.value;
  const at = paidAtOf(p.on);
  const ret = await svc('presence_money_returns', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    site_id: site.id, invoice_id: id, deal_id: inv.deal_id || null, kind: 'refund', applies_to: 'invoice', stripe_id: `hand:${crypto.randomUUID()}`,
    amount_cents: p.amount_cents, counted_cents: p.amount_cents, counted_at: at, fee_cents: 0, status: 'succeeded', stripe_status: 'by_hand', reason: p.note, method: p.method, happened_at: at, client_emailed: false, livemode: null,
  }) });
  const row = rows(ret)[0] || null;
  if (!ret.ok || !row) return json({ error: 'write_failed', message: 'That didn’t save. Nothing changed. Try again.' }, 502, cors);
  const was = Math.max(0, Math.round(Number(inv.refunded_cents) || 0));
  const up = await svc(`presence_invoices?id=eq.${id}&site_id=eq.${site.id}&status=eq.paid&refunded_cents=eq.${was}&deleted_at=is.null&select=${INV_COLS}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ refunded_cents: was + p.amount_cents, updated_at: nowIso() }) });
  const updated = up.ok ? (rows(up)[0] || null) : null;
  if (!updated) {
    await svc(`presence_money_returns?id=eq.${row.id}&site_id=eq.${site.id}`, { method: 'DELETE' }).catch(() => {});
    return json({ error: 'conflict', message: 'This invoice changed while you were recording. Nothing was saved. Reload and take another look.' }, 409, cors);
  }
  const { dealEvent } = await import('./sales.ts');
  if (inv.deal_id) await dealEvent(site.id, inv.deal_id, 'money_back', principal, { detail: { invoice_id: id, number: inv.number ?? null, amount_cents: p.amount_cents, method: p.method, note: p.note, on: p.on, purpose: String(inv.purpose || 'service'), full: was + p.amount_cents >= Math.round(Number(inv.amount_cents) || 0) + parts } });
  return json({ data: { invoice: updated, returned_cents: p.amount_cents, refunded_cents: was + p.amount_cents, kept_cents: v.kept_cents - p.amount_cents } }, 200, cors);
}
