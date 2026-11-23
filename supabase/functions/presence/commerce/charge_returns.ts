// ── Refunds and disputes made in Stripe (sales items 126, 127; Stripe review, Nov 15 2026) ──
// A refund the studio makes in Stripe, or a dispute a client opens with their card
// company or bank, used to leave Studio OS untouched: the invoice kept saying Paid,
// revenue, the weekly email and the bookkeeper file kept counting the money, the
// client heard nothing (Stripe's own refund email is switched off), and a dispute's
// deadline passed with nothing on Today.
//
// The webhook hands the charge or the dispute here by id (/commerce/charge-event).
// Everything is read FRESH from Stripe, never from the event, so an event that comes
// late, twice or out of order still lands on Stripe's latest word, and the daily
// check (sales item 130) can call the same three functions for a payment whose
// message was lost:
//   syncChargeRefunds(chargeId)   every refund on one charge
//   syncDispute(disputeId)        one dispute
//   syncCharge(chargeId)          both, for one charge
// Each returns { ok, found, invoice_id, changed } and never throws. ok false means
// Stripe or the database didn't answer: call again later (the webhook answers 500 and
// Stripe sends the event again). A repeat call records nothing and tells nobody twice.
//
// WHAT A CHARGE PAID, found from the payment intent Stripe names on it:
//   invoice   the invoice's own payment (paid_ref, migration 0188; for the invoices
//             paid before Nov 12 2026, the pay link's metadata, and paid_ref is filled in)
//   extra     a second payment on an invoice already paid (paid twice), or money on
//             an invoice that was open: nothing was counted for it, so nothing comes off
//   void      money on a withdrawn invoice: never counted either
//   retainer  a monthly retainer charge (a deal event since item 128), found through
//             Stripe's invoice payments: a charge no longer names its invoice
//   none      not ours (an audit order, a plan subscription): nothing happens
//
// WHAT IS RECORDED: one presence_money_returns row per Stripe refund or dispute,
// keyed by its Stripe id (migration 0233), with what comes off the money Studio OS
// counted (counted_cents) and when (counted_at); and on the invoice, refunded_cents
// and dispute_status, which the money words read (lib/money_state.ts: Refunded,
// Paid with what was refunded, Disputed, Dispute lost).
//
// WHO IS TOLD, once each, gated on the row's first insert or on its one guarded move:
//   a refund      the client gets an email (Stripe's is off) and the studio a line
//                 under Updates; a refund that failed is a Needs you line
//   a dispute     a Needs you line with Stripe's deadline (and an email to the studio),
//                 cleared when it closes; won is an update, lost is a Needs you line
// The money lines ride the money kind (invoice_void_paid, 0119) and the updates the
// paid kind (invoice_paid), each under its own period, so no kind list changes.
import { appBase } from '../../_shared/app_url.ts';   // builder item 388: every link starts at the app's address
import { svc } from '../lib/db.ts';
import { raiseNoticeDetailed, clearNotice } from '../lib/notice.ts';
import { UUID_RE } from '../lib/uuid.ts';
import { monthIn, studioZone } from '../lib/studio_clock.ts';   // sales item 152
import { retrieveCharge, listChargeRefunds, retrieveDispute, listChargeDisputes, retrievePaymentIntent, invoiceForPaymentIntent, stripeConfigured } from './stripe.ts';

export interface ReturnSync { ok: boolean; found: 'invoice' | 'extra' | 'retainer' | 'none'; invoice_id: string | null; changed: boolean }
type Applies = 'invoice' | 'extra' | 'void' | 'retainer' | 'none';

const n = (v: unknown) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? x : 0; };
const idOf = (v: unknown): string => String((typeof v === 'string' ? v : (v && typeof v === 'object' ? (v as { id?: unknown }).id : '')) || '');
const iso = (unix: unknown): string | null => { const t = Number(unix); return Number.isFinite(t) && t > 0 ? new Date(t * 1000).toISOString() : null; };
const rows = (r: { json?: unknown }) => (Array.isArray((r as { json?: unknown })?.json) ? (r as { json: unknown[] }).json : []) as any[];
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));
export const usd = (c: unknown) => '$' + ((Number(c) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "November", the month revenue takes it off in: the studio's own month when its zone is
 *  given (sales item 152), UTC's without one. Pure. */
export const monthOf = (at: string | null, tz?: string | null): string => { const t = Date.parse(String(at || '')); if (!Number.isFinite(t)) return 'this month'; const k = tz ? monthIn(at, tz) : ''; return k ? MONTHS[Number(k.slice(5)) - 1] : MONTHS[new Date(t).getUTCMonth()]; };
/** "Nov 30" (with the year when it isn't this one): a deadline as Stripe gave it, in UTC. Pure. */
export function dueDay(at: string | null, nowIso = new Date().toISOString()): string {
  const t = Date.parse(String(at || '')); if (!Number.isFinite(t)) return '';
  const d = new Date(t); const now = new Date(Date.parse(nowIso) || Date.now());
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCDate()}${d.getUTCFullYear() !== now.getUTCFullYear() ? ', ' + d.getUTCFullYear() : ''}`;
}
/** A Stripe id as it can safely go in a query: ch_…, py_…, re_…, du_…, pi_…, in_… Pure. */
export const stripeIdOk = (s: unknown): boolean => /^[a-z]{2,6}_[A-Za-z0-9]{6,250}$/.test(String(s || ''));

/** A refund's status in Studio OS's words. pending and requires_action are money on
 *  its way back, and count; failed and canceled never left. Pure. */
export function refundStatus(s: unknown): 'pending' | 'succeeded' | 'failed' | 'canceled' {
  const v = String(s || '');
  return v === 'succeeded' ? 'succeeded' : v === 'failed' ? 'failed' : v === 'canceled' ? 'canceled' : 'pending';
}
export const refundLive = (s: string): boolean => s === 'pending' || s === 'succeeded';

/** A dispute in three words. An inquiry closed without a dispute (warning_closed) or a
 *  dispute the card network stopped (prevented) keep the money with the studio. Pure. */
export function disputeOutcome(status: unknown): 'open' | 'won' | 'lost' {
  const s = String(status || '');
  if (s === 'lost') return 'lost';
  if (s === 'won' || s === 'warning_closed' || s === 'prevented') return 'won';
  return 'open';
}
/** A card company's question that isn't a dispute yet: no money has moved. Pure. */
export const isInquiry = (status: unknown): boolean => /^warning_/.test(String(status || ''));
/** A bank (ACH) payment. Its disputes are final: there is nothing to answer. Pure. */
export const isBankPayment = (charge: any): boolean => String(charge?.payment_method_details?.type || '') === 'us_bank_account';

/** How much of each refund comes off what Studio OS counted for the payment.
 *  `paidCents` is what Stripe took; `countedCents` what Studio OS counted for it (the
 *  invoice's amount when it was paid; a retainer charge's amount). An overpayment
 *  going back is the first money refunded and was never counted, so it takes nothing
 *  off; past it, each refund comes off in full, never past what was counted. A charge
 *  Stripe says is refunded in full takes everything counted off, even when less came
 *  in than was counted (a short payment marked paid). A refund that failed or was
 *  canceled takes nothing. `refunds` oldest first. Pure. */
export function countedRefunds(paidCents: number, countedCents: number, refunds: Array<{ id: string; amount: number; live: boolean }>, fullyRefunded: boolean): Map<string, number> {
  const out = new Map<string, number>();
  const counted = Math.max(0, n(countedCents));
  const excess = Math.max(0, n(paidCents) - counted);
  const live = refunds.filter((r) => r.live);
  const lastLive = live.length ? live[live.length - 1].id : '';
  let back = 0, sofar = 0;
  for (const r of refunds) {
    if (!r.live) { out.set(r.id, 0); continue; }
    back += Math.max(0, n(r.amount));
    let upto = Math.min(counted, Math.max(0, back - excess));
    if (fullyRefunded && r.id === lastLive) upto = counted;
    out.set(r.id, Math.max(0, upto - sofar));
    sofar = Math.max(sofar, upto);
  }
  return out;
}

/** The part of a lost dispute that comes off what was counted: the disputed amount,
 *  never more than was counted and not already refunded. Pure. */
export const disputeCounted = (amountCents: number, countedCents: number, refundedCents: number): number =>
  Math.max(0, Math.min(n(amountCents), n(countedCents) - n(refundedCents)));

/** Stripe's dispute fee as it stands: what it took, less anything it gave back. Pure. */
export const disputeFee = (d: any): number => (Array.isArray(d?.balance_transactions) ? d.balance_transactions : []).reduce((a: number, b: any) => a + n(b?.fee), 0);

/** Where the studio answers a dispute in Stripe. Pure. */
export const stripeDisputeUrl = (disputeId: string, livemode: unknown): string =>
  `https://dashboard.stripe.com/${livemode === false ? 'test/' : ''}disputes/${encodeURIComponent(disputeId)}`;

/** The client's side of the story, as the card company or bank passed it on. Pure. */
export function disputeReasonWords(reason: unknown, who = 'they'): string {
  const w = who || 'they';
  switch (String(reason || '')) {
    case 'fraudulent': return `${w} say they didn’t make this payment`;
    case 'unrecognized': return `${w} don’t recognize the payment`;
    case 'product_not_received': return `${w} say the work wasn’t delivered`;
    case 'product_unacceptable': return `${w} say the work wasn’t what was agreed`;
    case 'duplicate': return `${w} say they were charged twice`;
    case 'subscription_canceled': return `${w} say they had cancelled`;
    case 'credit_not_processed': return `${w} say a refund was promised and never came`;
    case 'debit_not_authorized': return `${w} say they didn’t agree to the payment`;
    case 'insufficient_funds': case 'incorrect_account_details': case 'bank_cannot_process': return 'their bank couldn’t complete the payment after all';
    default: return 'no reason was given';
  }
}

// ═══ what a charge paid ══════════════════════════════════════════════════════
interface Match {
  applies: Applies;
  inv: any | null;          // the invoice (invoice / extra / void)
  siteId: string;
  dealId: string | null;
  countedCents: number;     // what Studio OS counted for this payment
  stripeInvoice: string;    // a retainer charge's Stripe invoice
  backfill: boolean;        // an invoice paid before paid_ref existed: fill it in
}
const INV_COLS = 'id,site_id,deal_id,customer_client_id,title,amount_cents,purpose,status,number,paid_ref,paid_method,refunded_cents,dispute_status';
const NONE: Match = { applies: 'none', inv: null, siteId: '', dealId: null, countedCents: 0, stripeInvoice: '', backfill: false };

/** Throws when a read didn't answer, so the caller can say "try again". */
async function matchCharge(charge: any): Promise<Match> {
  const pi = idOf(charge?.payment_intent);
  if (!stripeIdOk(pi)) return NONE;   // a charge with no payment intent was never made by Studio OS
  const byRef = await svc(`presence_invoices?paid_ref=eq.${encodeURIComponent(pi)}&deleted_at=is.null&select=${INV_COLS}&limit=1`);
  if (!byRef.ok) throw new Error(`invoice read ${byRef.status}`);
  const own = rows(byRef)[0];
  if (own) return { applies: own.status === 'paid' ? 'invoice' : own.status === 'void' ? 'void' : 'extra', inv: own, siteId: String(own.site_id), dealId: own.deal_id || null, countedCents: n(own.amount_cents), stripeInvoice: '', backfill: false };
  // the pay link puts the invoice on the payment; the charge may carry it too
  let invoiceId = String(charge?.metadata?.presence_invoice_id || '');
  if (!UUID_RE.test(invoiceId)) {
    const intent = await retrievePaymentIntent(pi);
    invoiceId = String(intent?.metadata?.presence_invoice_id || '');
  }
  if (UUID_RE.test(invoiceId)) {
    const r = await svc(`presence_invoices?id=eq.${invoiceId}&deleted_at=is.null&select=${INV_COLS}&limit=1`);
    if (!r.ok) throw new Error(`invoice read ${r.status}`);
    const inv = rows(r)[0];
    if (!inv) return NONE;
    const base = { inv, siteId: String(inv.site_id), dealId: inv.deal_id || null, stripeInvoice: '' };
    if (inv.status === 'void') return { ...base, applies: 'void', countedCents: 0, backfill: false };
    // paid by this payment: paid online (no method recorded by hand) and no other payment named
    if (inv.status === 'paid' && !String(inv.paid_method || '') && (!inv.paid_ref || inv.paid_ref === pi)) return { ...base, applies: 'invoice', countedCents: n(inv.amount_cents), backfill: !inv.paid_ref };
    return { ...base, applies: 'extra', countedCents: 0, backfill: false };
  }
  // a retainer charge: the Stripe invoice it paid, then the charge item 128 recorded for it
  const stripeInvoice = await invoiceForPaymentIntent(pi);
  if (!stripeIdOk(stripeInvoice)) return NONE;
  const ev = await svc(`presence_deal_events?kind=eq.invoice_paid&detail->>stripe_invoice=eq.${encodeURIComponent(stripeInvoice)}&select=site_id,deal_id,detail&limit=1`);
  if (!ev.ok) throw new Error(`charge read ${ev.status}`);
  const e = rows(ev)[0];
  if (!e || e.detail?.retainer !== true) return NONE;
  return { applies: 'retainer', inv: null, siteId: String(e.site_id), dealId: e.deal_id || null, countedCents: n(e.detail?.amount_cents), stripeInvoice, backfill: false };
}

// ═══ who to name, who to tell ═════════════════════════════════════════════════
interface People { studioClientId: string; who: string; first: string; email: string; dealTitle: string }
async function peopleFor(m: Match): Promise<People> {
  const out: People = { studioClientId: '', who: '', first: '', email: '', dealTitle: '' };
  try {
    out.studioClientId = String(rows(await svc(`presence_sites?id=eq.${encodeURIComponent(m.siteId)}&select=client_id&limit=1`))[0]?.client_id || '');
    if (m.dealId && UUID_RE.test(m.dealId)) {
      const deal = rows(await svc(`presence_deals?id=eq.${m.dealId}&site_id=eq.${encodeURIComponent(m.siteId)}&select=title,contact_id,converted_client_id&limit=1`))[0];
      out.dealTitle = String(deal?.title || '').slice(0, 120);
      if (deal?.contact_id) {
        const c = rows(await svc(`presence_contacts?id=eq.${deal.contact_id}&site_id=eq.${encodeURIComponent(m.siteId)}&select=name,email&limit=1`))[0];
        out.who = String(c?.name || '').slice(0, 80);
        out.first = out.who;
        out.email = String(c?.email || '').trim();
      }
      if (!out.email && deal?.converted_client_id) {
        const c = rows(await svc(`clients?id=eq.${deal.converted_client_id}&select=name,email&limit=1`))[0];
        out.email = String(c?.email || '').trim();
        if (!out.who) out.who = String(c?.name || '').slice(0, 80);
      }
      if (!out.who) out.who = out.dealTitle;
    }
    if (!out.email && m.inv?.customer_client_id && UUID_RE.test(String(m.inv.customer_client_id))) {
      const c = rows(await svc(`clients?id=eq.${m.inv.customer_client_id}&select=name,email&limit=1`))[0];
      out.email = String(c?.email || '').trim();
      if (!out.who) out.who = String(c?.name || '').slice(0, 80);
    }
  } catch { /* the lines still go, less specific */ }
  return out;
}
const whatOf = (m: Match, p: People): string => m.applies === 'retainer'
  ? `Retainer${p.dealTitle ? ': ' + p.dealTitle : ''}`
  : String(m.inv?.title || (m.inv?.purpose === 'deposit' ? 'Deposit' : 'Invoice'));
const numberOf = (m: Match): string => { const v = Math.trunc(Number(m.inv?.number)); return Number.isFinite(v) && v > 0 ? String(v).padStart(4, '0') : ''; };
/** A line's period: what it is, the deal it opens, the Stripe id that makes it once.
 *  `again` for a dispute that moves a second time (reopened on appeal, or turned
 *  round), so its new line isn't swallowed by the first one's key. */
export const returnPeriod = (what: 'refund' | 'refundfailed' | 'dispute' | 'disputewon' | 'disputelost', dealId: string | null, stripeId: string, again = false): string =>
  `${what}:${dealId && UUID_RE.test(dealId) ? dealId : 'nodeal'}:${stripeId}${again ? ':again' : ''}`;
const dealHref = (dealId: string | null) => {
  const base = appBase();
  return dealId ? `${base}/pipeline.html?deal=${dealId}&dtab=billing` : `${base}/invoices.html`;
};

/** What the studio reads about one refund. Says what happened to the money and what
 *  was, or wasn't, done about it, so nothing is claimed that didn't happen. Pure. */
export function refundLineCopy(p: { applies: Applies; what: string; who: string; amount: number; counted: number; full: boolean; whole?: boolean; month: string; emailed: boolean; hasEmail: boolean; bank: boolean; pending: boolean; partLeft: number }): { headline: string; body: string } {
  const money = usd(p.amount);
  const told = p.emailed ? `We emailed ${p.who || 'them'} to say so.` : p.hasEmail ? 'Our email to them didn’t go out, so a quick note from you helps.' : 'There’s no email for them on the deal, so let them know yourself.';
  const way = p.bank ? (p.pending ? ' It takes a few business days to reach their bank.' : '') : '';
  if (p.applies === 'extra') return { headline: `Refunded an extra payment: ${p.what} (${money})`, body: `${money} went back to ${p.who || 'them'}. The invoice stays paid, and nothing was counted twice.${way} ${told}` };
  // the invoice's own payment, but only what they paid over the invoice: never counted, so nothing comes off
  if (p.applies === 'invoice' && p.counted === 0 && !p.full) return { headline: `Refunded what they overpaid: ${p.what} (${money})`, body: `${money} went back to ${p.who || 'them'}. The invoice stays paid, and revenue doesn’t change: the extra was never counted.${way} ${told}` };
  if (p.applies === 'void') return { headline: `Refunded the payment on a withdrawn invoice: ${p.what} (${money})`, body: `${money} went back to ${p.who || 'them'}. The invoice stays withdrawn.${way} ${told}` };
  const reads = p.applies === 'retainer' ? '' : p.full ? ' The invoice now reads Refunded,' : ` The invoice now reads Paid with ${usd(p.partLeft)} refunded,`;
  return {
    headline: (p.whole ?? p.full) && p.applies === 'invoice' ? `Refunded in full: ${p.what} (${money})` : `Refunded ${money}: ${p.what}`,
    body: `${money} went back to ${p.who || 'them'} through Stripe.${reads}${reads ? ' and' : ''} ${reads ? 'it' : 'It'} comes off ${p.month}’s revenue.${way} ${told}`.replace(/\s+/g, ' ').trim(),
  };
}

/** What the studio reads when a dispute opens. Pure. */
export function disputeOpenedCopy(p: { what: string; who: string; amount: number; fee: number; due: string; reason: string; bank: boolean; inquiry: boolean }): { headline: string; body: string } {
  const money = usd(p.amount);
  if (p.inquiry) {
    return {
      headline: `${p.bank ? 'Their bank' : 'A card company'} is asking about ${money}: ${p.what}${p.due ? `. Answer by ${p.due}` : ''}`,
      body: `${p.bank ? `${p.who || 'The client'}’s bank asks for proof they agreed to the payment` : `${p.who || 'The client'}’s card company has a question before it becomes a dispute: ${disputeReasonWords(p.reason, 'they')}`}. No money has moved yet. Open the deal to download your proof, then answer in Stripe${p.due ? ` by ${p.due}` : ''}.`,
    };
  }
  if (p.bank) {
    return {
      headline: `Bank payment disputed: ${p.what} (${money})`,
      body: `${p.who || 'The client'}’s bank took the payment back: ${disputeReasonWords(p.reason, 'they')}. Bank payment disputes are final, so there’s nothing to answer in Stripe. Talk to them about paying another way, and raise a new invoice from the deal if the work is still owed.`,
    };
  }
  const fee = p.fee > 0 ? ` and a ${usd(p.fee)} fee` : '';
  return {
    headline: `Disputed: ${p.what} (${money})${p.due ? `. Answer by ${p.due}` : ''}`,
    body: `${p.who || 'The client'}’s card company is asking for the money back: ${disputeReasonWords(p.reason, 'they')}. Stripe has taken ${money}${fee} from your balance for now. Open the deal to download your proof, then answer in Stripe${p.due ? ` by ${p.due}` : ''}. If nobody answers, the client wins.`,
  };
}

/** What the studio reads when a dispute closes. Pure. */
export function disputeClosedCopy(p: { what: string; who: string; amount: number; fee: number; outcome: 'won' | 'lost'; inquiry: boolean; month: string; counted: boolean }): { headline: string; body: string } {
  const money = usd(p.amount);
  if (p.outcome === 'won') {
    if (p.inquiry) return { headline: `Question closed: ${p.what} (${money})`, body: 'The card company closed its question without a dispute. The money stays with you.' };
    return { headline: `Dispute won: ${p.what} (${money})`, body: `The money stays with you, and the invoice reads Paid again.${p.fee > 0 ? ` Stripe kept its ${usd(p.fee)} dispute fee.` : ''}` };
  }
  const gone = p.fee > 0 ? `${money} went back to ${p.who || 'the client'} and Stripe kept its ${usd(p.fee)} fee.` : `${money} went back to ${p.who || 'the client'}.`;
  return { headline: `Dispute lost: ${p.what} (${money})`, body: `${gone}${p.counted ? ` It comes off ${p.month}’s revenue.` : ''} If the work was done, ask them to pay another way: raise a new invoice from the deal.` };
}

/** The client's email about their refund: what, how much, where it goes, how long. */
async function emailRefund(m: Match, p: People, refund: { amount: number; full: boolean }, bank: boolean, paidCents: number): Promise<boolean> {
  if (!p.email) return false;
  try {
    const [{ sendEmail }, { loadEmailBrand, EMAIL_BRAND_DEFAULT, emailBand, emailFacts }, { firstNameOf }] = await Promise.all([
      import('./account.ts'), import('../lib/email_brand.ts'), import('../routes/sales.ts'),
    ]);
    const brand = await loadEmailBrand(m.siteId);
    const studio = brand.name && brand.name !== EMAIL_BRAND_DEFAULT.name ? esc(brand.name) : 'We';
    const has = studio === 'We' ? 'have' : 'has';
    const first = firstNameOf(p.first);
    const no = numberOf(m);
    const what = m.applies === 'retainer' ? 'your retainer charge' : `${m.inv?.purpose === 'deposit' ? 'deposit' : 'invoice'}${no ? ' ' + no : ''}${m.inv?.title && !/^(invoice|deposit)$/i.test(String(m.inv.title).trim()) ? ` (${esc(String(m.inv.title))})` : ''}`;
    const money = usd(refund.amount);
    const said = m.applies === 'extra' ? `refunded your extra payment of <strong>${money}</strong> for ${what}. The invoice stays paid, and nothing else is needed from you.`
      : m.applies === 'void' ? `refunded your payment of <strong>${money}</strong> for ${what}, which was withdrawn.`
      : refund.full ? `refunded your payment of <strong>${money}</strong> for ${what} in full.`
      : `refunded <strong>${money}</strong> of your payment for ${what}.`;
    const where = bank ? 'It goes back to the bank account you paid from, usually within a few business days.' : 'It goes back to the card or account you paid with. Most banks show it within 5 to 10 business days.';
    const facts = emailFacts([
      [m.applies === 'retainer' ? 'Retainer' : m.inv?.purpose === 'deposit' ? 'Deposit' : 'Invoice', m.applies === 'retainer' ? (p.dealTitle || 'Retainer') : `${String(m.inv?.title || 'Invoice')}${no ? ' ' + no : ''}`],
      ['You paid', usd(paidCents)],
      ['Refunded', money],
    ], { big: true });
    const html = emailBand(`Refund${no ? ' · ' + no : ''}`, 'Your refund is on its way.')
      + `<p>${first ? `Hi ${esc(first)},` : 'Hi there,'}</p>`
      + `<p>${studio} ${has} ${said}</p>` + facts
      + `<p>${where}</p>`
      + `<p style="color:#6b6478;font-size:14px;margin-top:14px">Questions about it? Just reply to this email.</p>`;
    return await sendEmail(p.email, `Your refund of ${money} is on its way`, html, brand, { critical: true, asBusiness: true, siteId: m.siteId });   // their own money = transactional; an answer lands in the Inbox
  } catch (e) { console.warn(`[charge-returns] refund email failed: ${String((e as Error)?.message || e)} (non-fatal)`); return false; }
}

/** The deal's history keeps each refund and dispute. payment_undone is the deal-event
 *  kind for money given back (0167); its detail says which, so no kind list changes. */
async function historyLine(m: Match, detail: Record<string, unknown>): Promise<void> {
  if (!m.dealId || !UUID_RE.test(m.dealId)) return;
  await svc('presence_deal_events', { method: 'POST', body: JSON.stringify({
    site_id: m.siteId, deal_id: m.dealId, kind: 'payment_undone', actor: 'stripe', actor_kind: 'system',
    detail: { ...(m.inv ? { invoice_id: m.inv.id, purpose: m.inv.purpose || 'service', title: String(m.inv.title || '') } : {}), ...(m.applies === 'retainer' ? { retainer: true, stripe_invoice: m.stripeInvoice } : {}), ...detail },
  }) }).catch(() => {});
}

// ═══ refunds ═════════════════════════════════════════════════════════════════
const RET_COLS = 'id,stripe_id,status,amount_cents,counted_cents,counted_at,client_emailed';
const foundOf = (a: Applies): ReturnSync['found'] => (a === 'void' ? 'extra' : a);

/** Every refund on one charge, from Stripe: recorded, counted, and told once. */
export async function syncChargeRefunds(chargeId: string): Promise<ReturnSync> {
  const out: ReturnSync = { ok: false, found: 'none', invoice_id: null, changed: false };
  if (!stripeIdOk(chargeId)) return { ...out, ok: true };
  if (!stripeConfigured()) { console.error('[charge-returns] STRIPE_SECRET unset: cannot read the refund'); return out; }
  let charge: any, refunds: any[], m: Match;
  try {
    charge = await retrieveCharge(chargeId);
    refunds = await listChargeRefunds(chargeId);
    m = await matchCharge(charge);
  } catch (e) { console.error(`[charge-returns] ${chargeId}: Stripe or the database didn’t answer (${String((e as Error)?.message || e)}), try again`); return out; }
  out.found = foundOf(m.applies); out.invoice_id = m.inv ? String(m.inv.id) : null;
  if (m.applies === 'none') { console.log(`[charge-returns] ${chargeId}: not a payment Studio OS made, nothing to record`); return { ...out, ok: true }; }

  const pi = idOf(charge.payment_intent);
  const paid = n(charge.amount_captured) || n(charge.amount);
  const bank = isBankPayment(charge);
  const ordered = refunds.filter((r) => stripeIdOk(r?.id)).sort((a, b) => (n(a.created) - n(b.created)) || String(a.id).localeCompare(String(b.id)));
  const countable = m.applies === 'invoice' || m.applies === 'retainer';
  const counts = countable ? countedRefunds(paid, m.countedCents, ordered.map((r) => ({ id: String(r.id), amount: n(r.amount), live: refundLive(refundStatus(r.status)) })), charge.refunded === true) : new Map<string, number>();
  const have = ordered.length ? await svc(`presence_money_returns?stripe_id=in.(${ordered.map((r) => String(r.id)).join(',')})&select=${RET_COLS}`) : { ok: true, json: [] } as any;
  if (!have.ok) { console.error(`[charge-returns] ${chargeId}: refunds unread (${have.status}; migration 0233 applied?), try again`); return out; }
  const known = new Map(rows(have).map((r: any) => [String(r.stripe_id), r]));

  const fresh: any[] = [], failedNow: any[] = [];
  for (const r of ordered) {
    const status = refundStatus(r.status);
    const counted = counts.get(String(r.id)) || 0;
    const at = iso(r.created) || new Date().toISOString();
    const prev = known.get(String(r.id));
    if (!prev) {
      const ins = await svc('presence_money_returns?on_conflict=stripe_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({
        site_id: m.siteId, invoice_id: m.inv ? m.inv.id : null, deal_id: m.dealId, kind: 'refund', applies_to: m.applies,
        stripe_id: String(r.id), stripe_charge: chargeId, stripe_payment_intent: pi, stripe_invoice: m.stripeInvoice,
        amount_cents: Math.max(0, n(r.amount)), counted_cents: counted, counted_at: at, status, stripe_status: String(r.status || ''),
        reason: String(r.reason || '').slice(0, 60), method: bank ? 'bank' : String(charge?.payment_method_details?.type || '').slice(0, 40),
        happened_at: at, livemode: typeof charge.livemode === 'boolean' ? charge.livemode : null,
      }) });
      if (!ins.ok) { console.error(`[charge-returns] ${chargeId}: refund ${r.id} not recorded (${ins.status}; migration 0233 applied?), try again`); return out; }
      const row = rows(ins)[0];
      if (row) { fresh.push({ ...row, refund: r }); out.changed = true; }
      continue;
    }
    if (prev.status === status && n(prev.counted_cents) === counted && n(prev.amount_cents) === n(r.amount)) continue;
    // moved: guarded on what it was, so of two deliveries only one sees the move
    const up = await svc(`presence_money_returns?stripe_id=eq.${encodeURIComponent(String(r.id))}&status=eq.${encodeURIComponent(String(prev.status))}&select=${RET_COLS}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
      status, stripe_status: String(r.status || ''), amount_cents: Math.max(0, n(r.amount)), counted_cents: counted, updated_at: new Date().toISOString(),
    }) });
    if (!up.ok) { console.error(`[charge-returns] ${chargeId}: refund ${r.id} not updated (${up.status}), try again`); return out; }
    if (rows(up)[0]) { out.changed = true; if (refundLive(String(prev.status)) && !refundLive(status)) failedNow.push({ ...rows(up)[0], refund: r }); }
  }

  // the invoice's own number, from everything Stripe holds for this charge
  if (m.applies === 'invoice' && m.inv) {
    let total = 0;
    for (const r of ordered) if (refundLive(refundStatus(r.status))) total += counts.get(String(r.id)) || 0;
    total = Math.min(total, n(m.inv.amount_cents));
    if (total !== n(m.inv.refunded_cents) || m.backfill) {
      const up = await svc(`presence_invoices?id=eq.${m.inv.id}&site_id=eq.${encodeURIComponent(m.siteId)}`, { method: 'PATCH', body: JSON.stringify({ refunded_cents: total, ...(m.backfill ? { paid_ref: pi } : {}), updated_at: new Date().toISOString() }) });
      if (!up.ok) { console.error(`[charge-returns] ${chargeId}: invoice ${m.inv.id} not updated (${up.status}), try again`); return out; }
      m.inv = { ...m.inv, refunded_cents: total };
      out.changed = true;
    }
  }

  if (fresh.length || failedNow.length) await tellRefunds(m, charge, fresh, failedNow, paid, bank);
  // a refund that settles a Needs you line Studio OS raised takes it down
  if (m.inv && out.changed) await settleMoneyLines(m, charge, ordered, paid);
  return { ...out, ok: true };
}

async function tellRefunds(m: Match, charge: any, fresh: any[], failedNow: any[], paid: number, bank: boolean): Promise<void> {
  const p = await peopleFor(m);
  if (!p.studioClientId) return;
  const what = whatOf(m, p);
  for (const row of fresh) {
    const amount = n(row.amount_cents);
    if (!refundLive(String(row.status))) { failedNow.push(row); continue; }
    // whole: this refund alone sent the whole payment back ("in full" in the email, the headline and the
    // history); full: the invoice now reads Refunded, which two part refunds can add up to
    const whole = paid > 0 && amount >= paid;
    const full = m.applies === 'invoice' ? n(m.inv?.refunded_cents) >= n(m.inv?.amount_cents) && n(m.inv?.amount_cents) > 0 : whole;
    const emailed = await emailRefund(m, p, { amount, full: whole }, bank, paid);
    if (emailed) await svc(`presence_money_returns?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ client_emailed: true }) }).catch(() => {});
    const copy = refundLineCopy({ applies: m.applies, what, who: p.who, amount, counted: n(row.counted_cents), full, whole, month: monthOf(row.counted_at, await studioZone(m.siteId)), emailed, hasEmail: !!p.email, bank, pending: row.status === 'pending', partLeft: n(m.inv?.refunded_cents) });
    await raiseNoticeDetailed({ siteId: m.siteId, clientId: p.studioClientId, kind: 'invoice_paid', period: returnPeriod('refund', m.dealId, String(row.stripe_id)), headline: copy.headline, body: copy.body });
    await historyLine(m, { refund: true, stripe_refund: String(row.stripe_id), amount_cents: amount, full: whole, applies_to: m.applies });
  }
  for (const row of failedNow) {
    const amount = n(row.amount_cents);
    await raiseNoticeDetailed({ siteId: m.siteId, clientId: p.studioClientId, kind: 'invoice_void_paid', period: returnPeriod('refundfailed', m.dealId, String(row.stripe_id)),
      headline: `A refund didn’t go through: ${what} (${usd(amount)})`,
      body: `Stripe couldn’t send ${usd(amount)} back to ${p.who || 'them'}, so it’s in your Stripe balance again${m.applies === 'invoice' ? ' and the invoice counts it as paid' : ''}. Try the refund again in Stripe, or pay them back another way.` });
  }
}

/** Paid twice, paid too much, money on a withdrawn invoice: each told the studio to
 *  refund in Stripe (stripe-webhook, item 116), and nothing took the line down. Once
 *  Stripe has sent back what the line asked for, it goes. */
async function settleMoneyLines(m: Match, charge: any, refunds: any[], paid: number): Promise<void> {
  const pi = idOf(charge.payment_intent);
  const back = refunds.filter((r) => refundLive(refundStatus(r.status))).reduce((a, r) => a + n(r.amount), 0);
  if (!back || !m.inv) return;
  const clientId = String(rows(await svc(`presence_sites?id=eq.${encodeURIComponent(m.siteId)}&select=client_id&limit=1`).catch(() => ({ json: [] }) as any))[0]?.client_id || '');
  if (!clientId) return;
  const inv = String(m.inv.id);
  if (m.applies === 'extra' && back >= paid) await clearNotice(clientId, 'invoice_void_paid', `paidtwice:${inv}:${pi}`);
  if (m.applies === 'void' && back >= paid) await clearNotice(clientId, 'invoice_void_paid', `voidpaid:${inv}`);
  // paid too much: the line asked for the difference back (a short payment's line asks for more money, and stays)
  const over = paid - n(m.inv.amount_cents);
  if (m.applies === 'invoice' && over > 0 && back >= over) await clearNotice(clientId, 'invoice_void_paid', `payamount:${inv}:${pi}`);
}

// ═══ disputes ════════════════════════════════════════════════════════════════
const DSP_COLS = 'id,stripe_id,status,amount_cents,counted_cents,fee_cents,due_by,closed_at';

/** One dispute, from Stripe: recorded, shown on the invoice, and the studio told when
 *  it opens and when it closes. */
export async function syncDispute(disputeId: string): Promise<ReturnSync> {
  const out: ReturnSync = { ok: false, found: 'none', invoice_id: null, changed: false };
  if (!stripeIdOk(disputeId)) return { ...out, ok: true };
  if (!stripeConfigured()) { console.error('[charge-returns] STRIPE_SECRET unset: cannot read the dispute'); return out; }
  let d: any, charge: any, m: Match;
  try {
    d = await retrieveDispute(disputeId);
    charge = await retrieveCharge(idOf(d.charge));
    m = await matchCharge(charge);
  } catch (e) { console.error(`[charge-returns] ${disputeId}: Stripe or the database didn’t answer (${String((e as Error)?.message || e)}), try again`); return out; }
  out.found = foundOf(m.applies); out.invoice_id = m.inv ? String(m.inv.id) : null;
  if (m.applies === 'none') { console.log(`[charge-returns] ${disputeId}: not a payment Studio OS made, nothing to record`); return { ...out, ok: true }; }

  const outcome = disputeOutcome(d.status);
  const amount = Math.max(0, n(d.amount));
  const fee = disputeFee(d);
  const bank = isBankPayment(charge);
  const countable = m.applies === 'invoice' || m.applies === 'retainer';
  const counted = outcome === 'lost' && countable ? disputeCounted(amount, m.countedCents, n(m.inv?.refunded_cents)) : 0;
  const dueBy = iso(d?.evidence_details?.due_by);
  const now = new Date().toISOString();
  const facts = {
    amount_cents: amount, fee_cents: fee, stripe_status: String(d.status || '').slice(0, 40), reason: String(d.reason || '').slice(0, 60),
    due_by: bank && !isInquiry(d.status) ? null : dueBy,
  };
  const have = await svc(`presence_money_returns?stripe_id=eq.${encodeURIComponent(disputeId)}&select=${DSP_COLS}&limit=1`);
  if (!have.ok) { console.error(`[charge-returns] ${disputeId}: disputes unread (${have.status}; migration 0233 applied?), try again`); return out; }
  const prev = rows(have)[0];
  // what to tell: 'opened' (a new dispute, or one reopened on appeal) or 'closed'; `again` when it isn't the first move
  let tell: '' | 'opened' | 'closed' = '';
  let again = false;
  const sameDay = (a: unknown, b: unknown) => (Date.parse(String(a || '')) || 0) === (Date.parse(String(b || '')) || 0);
  if (!prev) {
    const ins = await svc('presence_money_returns?on_conflict=stripe_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({
      site_id: m.siteId, invoice_id: m.inv ? m.inv.id : null, deal_id: m.dealId, kind: 'dispute', applies_to: m.applies,
      stripe_id: disputeId, stripe_charge: idOf(d.charge), stripe_payment_intent: idOf(charge.payment_intent), stripe_invoice: m.stripeInvoice,
      ...facts, status: outcome, counted_cents: counted, counted_at: outcome === 'lost' ? now : null,
      method: bank ? 'bank' : String(d?.payment_method_details?.type || charge?.payment_method_details?.type || '').slice(0, 40),
      happened_at: iso(d.created) || now, closed_at: outcome === 'open' ? null : now, livemode: typeof d.livemode === 'boolean' ? d.livemode : null,
    }) });
    if (!ins.ok) { console.error(`[charge-returns] ${disputeId}: not recorded (${ins.status}; migration 0233 applied?), try again`); return out; }
    if (rows(ins)[0]) { out.changed = true; tell = outcome === 'open' ? 'opened' : 'closed'; }
  } else if (String(prev.status) !== outcome) {
    // it moved: guarded on what it was, so of two deliveries only one tells
    const up = await svc(`presence_money_returns?stripe_id=eq.${encodeURIComponent(disputeId)}&status=eq.${encodeURIComponent(String(prev.status))}&select=${DSP_COLS}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
      ...facts, status: outcome, counted_cents: counted, counted_at: outcome === 'lost' ? now : null, closed_at: outcome === 'open' ? null : now, updated_at: now,
    }) });
    if (!up.ok) { console.error(`[charge-returns] ${disputeId}: not updated (${up.status}), try again`); return out; }
    if (rows(up)[0]) { out.changed = true; tell = outcome === 'open' ? 'opened' : 'closed'; again = String(prev.status) !== 'open'; }
  } else if (n(prev.fee_cents) !== fee || !sameDay(prev.due_by, facts.due_by) || n(prev.amount_cents) !== amount) {
    // the same state, a new fact (the fee taken or given back, a new deadline)
    const up = await svc(`presence_money_returns?stripe_id=eq.${encodeURIComponent(disputeId)}`, { method: 'PATCH', body: JSON.stringify({ ...facts, updated_at: now }) });
    if (!up.ok) { console.error(`[charge-returns] ${disputeId}: not updated (${up.status}), try again`); return out; }
    out.changed = true;
  }

  if (m.applies === 'invoice' && m.inv && (String(m.inv.dispute_status || '') !== outcome || m.backfill)) {
    const up = await svc(`presence_invoices?id=eq.${m.inv.id}&site_id=eq.${encodeURIComponent(m.siteId)}`, { method: 'PATCH', body: JSON.stringify({ dispute_status: outcome, ...(m.backfill ? { paid_ref: idOf(charge.payment_intent) } : {}), updated_at: now }) });
    if (!up.ok) { console.error(`[charge-returns] ${disputeId}: invoice ${m.inv.id} not updated (${up.status}), try again`); return out; }
    out.changed = true;
  }

  if (tell) {
    const p = await peopleFor(m);
    if (p.studioClientId) {
      const what = whatOf(m, p);
      const inquiry = isInquiry(d.status);
      if (tell === 'opened') {
        const copy = disputeOpenedCopy({ what, who: p.who, amount, fee, due: facts.due_by ? dueDay(facts.due_by) : '', reason: String(d.reason || ''), bank, inquiry });
        const made = await raiseNoticeDetailed({ siteId: m.siteId, clientId: p.studioClientId, kind: 'invoice_void_paid', period: returnPeriod('dispute', m.dealId, disputeId, again), headline: copy.headline, body: copy.body });
        if (made === 'created') {
          try {
            const { emailOperator } = await import('../lib/service_bridge.ts');
            const answer = bank && !inquiry ? '' : `<p><a href="${esc(stripeDisputeUrl(disputeId, d.livemode))}">Answer it in Stripe</a></p>`;
            await emailOperator(m.siteId, copy.headline, `<p>${esc(copy.body)}</p>${answer}`, 'dispute_opened', { label: 'Open the deal', href: dealHref(m.dealId) });
          } catch { /* the line carries it */ }
        }
        await historyLine(m, { dispute: again ? 'reopened' : 'opened', stripe_dispute: disputeId, amount_cents: amount, inquiry, bank });
      } else {
        // its open line goes, whichever round it was
        await clearNotice(p.studioClientId, 'invoice_void_paid', returnPeriod('dispute', m.dealId, disputeId));
        await clearNotice(p.studioClientId, 'invoice_void_paid', returnPeriod('dispute', m.dealId, disputeId, true));
        const lost = outcome === 'lost';
        if (!lost) await clearNotice(p.studioClientId, 'invoice_void_paid', returnPeriod('disputelost', m.dealId, disputeId));   // turned round after all
        const copy = disputeClosedCopy({ what, who: p.who, amount, fee, outcome: lost ? 'lost' : 'won', inquiry: String(d.status) === 'warning_closed', month: monthOf(now, await studioZone(m.siteId)), counted: counted > 0 });
        // lost is money gone and a Needs you line; won (or a question closed) is an update
        if (lost) await raiseNoticeDetailed({ siteId: m.siteId, clientId: p.studioClientId, kind: 'invoice_void_paid', period: returnPeriod('disputelost', m.dealId, disputeId, again), headline: copy.headline, body: copy.body });
        else await raiseNoticeDetailed({ siteId: m.siteId, clientId: p.studioClientId, kind: 'invoice_paid', period: returnPeriod('disputewon', m.dealId, disputeId, again), headline: copy.headline, body: copy.body });
        await historyLine(m, { dispute: lost ? 'lost' : String(d.status) === 'warning_closed' ? 'closed' : 'won', stripe_dispute: disputeId, amount_cents: amount, fee_cents: fee });
      }
    }
  }
  return { ...out, ok: true };
}

/** The deal's refunds and disputes as its page shows them: which invoice (none for a
 *  retainer charge), how much, what it came to, Stripe's fee, the deadline, and where to
 *  answer a dispute that can still be answered (never a bank payment's, which is final).
 *  [] when they can't be read (before APPLY-0233): the invoices still carry their own
 *  refunded_cents and dispute_status. */
export async function returnsForDeal(siteId: string, dealId: string): Promise<Array<Record<string, unknown>>> {
  if (!UUID_RE.test(siteId) || !UUID_RE.test(dealId)) return [];
  const r = await svc(`presence_money_returns?site_id=eq.${siteId}&deal_id=eq.${dealId}&select=id,invoice_id,kind,applies_to,stripe_id,amount_cents,counted_cents,fee_cents,status,stripe_status,method,due_by,happened_at,closed_at,client_emailed,livemode&order=happened_at.asc&limit=200`);
  if (!r.ok) return [];
  return rows(r).map((x: any) => ({
    id: x.id, invoice_id: x.invoice_id || null, kind: x.kind, applies_to: x.applies_to,
    amount_cents: n(x.amount_cents), counted_cents: n(x.counted_cents), fee_cents: n(x.fee_cents), status: x.status,
    inquiry: isInquiry(x.stripe_status), bank: x.method === 'bank', due_by: x.due_by || null, happened_at: x.happened_at, closed_at: x.closed_at || null,
    client_emailed: x.client_emailed === true,
    answer_url: x.kind === 'dispute' && x.status === 'open' && !(x.method === 'bank' && !x.due_by) ? stripeDisputeUrl(String(x.stripe_id), x.livemode) : null,
  }));
}

/** Both, for one charge: its refunds, and the dispute on it if there is one. For the
 *  daily check (sales item 130), which finds a paid invoice Stripe says was refunded
 *  or disputed. */
export async function syncCharge(chargeId: string): Promise<ReturnSync> {
  const a = await syncChargeRefunds(chargeId);
  if (!a.ok) return a;
  let disputes: any[] = [];
  try { disputes = await listChargeDisputes(chargeId); } catch (e) { console.error(`[charge-returns] ${chargeId}: disputes unread from Stripe (${String((e as Error)?.message || e)}), try again`); return { ...a, ok: false }; }
  let changed = a.changed;
  for (const d of disputes) {
    const b = await syncDispute(String(d?.id || ''));
    if (!b.ok) return { ...a, ok: false, changed };
    changed = changed || b.changed;
  }
  return { ...a, changed };
}
