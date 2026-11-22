// ── The daily check against Stripe (sales item 130, Stripe review Nov 15 2026) ──
// Stripe tells Studio OS about every payment and retainer change with a message, and
// keeps trying for three days when our server doesn't answer. After that the message
// is gone, and nothing ever asked Stripe again (finding 4):
//   · an invoice paid in Stripe stayed unpaid here, and its reminders kept asking a
//     client who had paid;
//   · a retainer stayed "waiting for you to approve" after the client approved, or
//     missed a charge, or a failure, or its end;
//   · when the main server was down while the webhook worked, the invoice was marked
//     paid but the client's receipt never went out, and nothing sent it later.
// So every tick this asks Stripe about a few things, each at most once a day, oldest
// first: each open invoice with a pay link (presence_invoices.stripe_checked_at), each
// live retainer (presence_stripe_checks), and each online payment of the last three
// days whose receipt hasn't gone out. Once a day it also lists the refunds and disputes
// of the last week, and the disputes still open here, and hands each to
// commerce/charge_returns.ts (sales items 126, 127), which records only what is new. What it finds is put right through the same
// code the messages use, so the studio and the client hear exactly what they would
// have heard: the paid echo (routes/commerce.ts invoicePaidEcho) and the retainer sync
// (commerce/retainers.ts applyRetainerSync). Everything is safe to run twice.
//
// It never charges, refunds or changes anything in Stripe: every Stripe call is a read
// (commerce/stripe.ts). Stripe not answering is not our failure: it is counted as
// stripe_unanswered (informational, never a page) and that thing is asked again the next
// day, so a Stripe that keeps refusing is never asked every tick. Only our own writes
// failing count as errors, which mark the tick failed; those are tried again next tick.
import { svc } from '../lib/db.ts';
import { raiseNotice, clearNotice, clearNoticePrefix } from '../lib/notice.ts';
import { stripeConfigured, retrieveSubscription, searchInvoicePayments, listSubscriptionPaidInvoices, listLinkCompletedSessions, listRecentRefunds, listRecentDisputes } from './stripe.ts';
import { syncCharge, syncDispute } from './charge_returns.ts';
import { applyRetainerSync, recordRetainerCharge, retainerStatusNow, retainerStatusFromStripe, type RetainerState } from './retainers.ts';
import { subscriptionPeriodEnd } from './stripe_shape.ts';

const enc = encodeURIComponent;
const DAY_MS = 86_400_000;
/** Each thing is asked about once a day. 20 hours, so a tick's drift never skips a day. */
export const RECHECK_MS = 20 * 3600_000;
/** How far back a receipt that never went out is still sent. */
export const RECEIPT_DAYS = 3;
/** A receipt is the echo's to send first: the check leaves a payment of the last hour alone. */
const RECEIPT_GRACE_MS = 3600_000;
/** A retainer that ended is still checked this long for a charge whose message was lost. */
const ENDED_DAYS = 40;
/** How far back the daily list of refunds and disputes looks: Stripe tries a message for
 *  three days, and a week also covers a few days when this check couldn't run. */
export const RETURNS_DAYS = 7;
/** At most this many refunds, and this many disputes, are handed on in one day. */
const RETURNS_CAP = 50;

export interface StripeCheckResult {
  invoices_checked: number; invoices_paid: number;
  processing_checked: number; processing_bounced: number;   // stuck on Processing (sales item 159)
  retainers_checked: number; retainers_fixed: number; charges_found: number;
  receipts_sent: number;
  returns_checked: number; returns_found: number;   // refunds and disputes (sales items 126, 127)
  stripe_unanswered: number;   // Stripe didn't answer: asked again next tick, never a page
  errors: number;              // our own writes that failed: these mark the tick failed
  skipped_no_stripe?: true;    // no Stripe key here
  skipped_not_set_up?: true;   // before APPLY-0235
}
const zero = (): StripeCheckResult => ({ invoices_checked: 0, invoices_paid: 0, processing_checked: 0, processing_bounced: 0, retainers_checked: 0, retainers_fixed: 0, charges_found: 0, receipts_sent: 0, returns_checked: 0, returns_found: 0, stripe_unanswered: 0, errors: 0 });
const idOf = (v: unknown): string => String((typeof v === 'string' ? v : (v && typeof v === 'object' ? (v as { id?: unknown }).id : '')) || '');
const rowsOf = (r: { json?: unknown }) => (Array.isArray((r as any)?.json) ? (r as any).json : []) as any[];
const money = (c: unknown) => '$' + ((Number(c) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });

/** The things not asked about in the last day, oldest first, at most `n`. Pure. */
export function dueSubjects(subjects: string[], checked: Map<string, number>, n: number, nowMs: number): string[] {
  return subjects
    .filter((s) => { const t = checked.get(s); return t === undefined || !Number.isFinite(t) || nowMs - t >= RECHECK_MS; })
    .sort((a, b) => (checked.get(a) ?? 0) - (checked.get(b) ?? 0))
    .slice(0, Math.max(0, n));
}

/** Does Stripe's subscription say something different from the retainer we hold? The
 *  status, by the same rule the messages use (a live retainer never reads as waiting
 *  again), or the next charge date. Pure. */
export function retainerDrift(r: Partial<RetainerState>, sub: any): boolean {
  const mapped = sub?.status === 'canceled' || sub?.status === 'incomplete_expired' ? 'canceled' : retainerStatusNow('customer.subscription.updated', sub, retainerStatusFromStripe(String(sub?.status || '')));
  const now = (r.status === 'active' || r.status === 'past_due') && mapped === 'pending' ? r.status : mapped;
  if (now !== r.status) return true;
  const end = subscriptionPeriodEnd(sub);
  const iso = end ? new Date(end * 1000).toISOString() : null;
  return !!iso && iso !== (r.current_period_end || null);
}

/** Sales item 159 (Nov 22 2026 review): an invoice that has read Processing for days. Only
 *  Stripe's "failed" or "paid" message cleared it, and a lost "bounced" message left it stuck
 *  with Send, Void and Record a payment all refused and no Pay button for the client. What
 *  Stripe's payments for it say now, newest first: one that succeeded settles it (`pay`); the
 *  newest having failed (cancelled, or back to needing a payment method, or carrying a payment
 *  error) means a bounce; still processing, or nothing found, means wait. Pure. */
export const PROCESSING_DAYS = 4;
export function stuckPaymentVerdict(invoiceId: string, payments: any[]): { verdict: 'paid' | 'failed' | 'processing' | 'unknown'; pay: any | null } {
  const ours = (payments || []).filter((p) => p && String(p?.metadata?.presence_invoice_id || '') === invoiceId)
    .sort((a, b) => (Number(b.created) || 0) - (Number(a.created) || 0));
  const won = ours.filter((p) => p.status === 'succeeded').sort((a, b) => (Number(a.created) || 0) - (Number(b.created) || 0))[0];
  if (won) return { verdict: 'paid', pay: won };
  const newest = ours[0];
  if (!newest) return { verdict: 'unknown', pay: null };
  const st = String(newest.status || '');
  if (st === 'canceled' || st === 'requires_payment_method' || !!newest.last_payment_error) return { verdict: 'failed', pay: newest };
  return { verdict: st === 'processing' ? 'processing' : 'unknown', pay: newest };
}

/** Which of an invoice's payments settles it: the first one Stripe took, for this invoice. Pure. */
export function settlingPayment(invoiceId: string, payments: any[]): { first: any | null; extra: any[] } {
  const ours = (payments || []).filter((p) => p && p.status === 'succeeded' && String(p?.metadata?.presence_invoice_id || '') === invoiceId)
    .sort((a, b) => (Number(a.created) || 0) - (Number(b.created) || 0));
  return { first: ours[0] || null, extra: ours.slice(1) };
}

async function stamp(subject: string, outcome: 'same' | 'fixed' | 'unanswered', nowMs: number): Promise<boolean> {
  const r = await svc('presence_stripe_checks?on_conflict=subject', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ subject, checked_at: new Date(nowMs).toISOString(), outcome }) }).catch(() => ({ ok: false }));
  return (r as { ok?: boolean }).ok === true;
}
async function lastChecked(subjects: string[]): Promise<Map<string, number> | null> {
  const out = new Map<string, number>();
  if (!subjects.length) return out;
  const r = await svc(`presence_stripe_checks?subject=in.(${subjects.map((s) => `"${s}"`).join(',')})&select=subject,checked_at`).catch(() => ({ ok: false, json: null }));
  if (!r.ok) return null;
  for (const row of rowsOf(r)) out.set(String(row.subject), Date.parse(String(row.checked_at)));
  return out;
}
async function ownerOf(siteId: string): Promise<string> {
  return String(rowsOf(await svc(`presence_sites?id=eq.${enc(siteId)}&select=client_id&limit=1`).catch(() => ({ json: [] })))[0]?.client_id || '');
}

// ── 1. open invoices Stripe says are paid ────────────────────────────────────
/** An open invoice whose payment Stripe holds: settled the way the webhook settles one
 *  (stripe-webhook/index.ts markPresenceInvoicePaid, its twin): paid on the day Stripe
 *  took it, its reminders taken down, a wrong amount said, the deal's history line, then
 *  the paid echo (the studio's line and email, the client's receipt, a deposit's tick).
 *  'already': something else marked it paid first, which is fine. */
async function settleFoundPayment(inv: any, pay: any, nowMs: number): Promise<'paid' | 'already' | 'error'> {
  const at = new Date((Number(pay?.created) > 0 ? Number(pay.created) * 1000 : nowMs)).toISOString();
  const flip = await svc(`presence_invoices?id=eq.${enc(inv.id)}&status=eq.open`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'paid', paid_at: at, updated_at: new Date(nowMs).toISOString(), processing_since: null, paid_ref: String(pay.id || '') || null }),
  }).catch(() => ({ ok: false, json: null }));
  if (!flip.ok) return 'error';
  const flipped = rowsOf(flip)[0];
  if (!flipped) return 'already';
  const clientId = await ownerOf(String(inv.site_id));
  if (clientId) {
    // the "still unpaid" rows the reminder sweep raised come down, as a card payment takes them down
    await clearNotice(clientId, 'deal_followup', `invremind:${inv.id}`).catch(() => {});
    await clearNoticePrefix(clientId, 'deal_followup', `invremind:${inv.id}:`).catch(() => {});
    const owed = Math.round(Number(flipped.amount_cents ?? inv.amount_cents) || 0);
    const usd = String(pay?.currency || 'usd').toLowerCase() === 'usd';
    const got = usd && Number.isFinite(Number(pay?.amount_received ?? pay?.amount)) ? Math.round(Number(pay.amount_received ?? pay.amount)) : null;
    const what = String(inv.title || (inv.purpose === 'deposit' ? 'Deposit' : 'Invoice'));
    if (got !== null && got !== owed) {
      await raiseNotice({ siteId: String(inv.site_id), clientId, kind: 'invoice_void_paid', period: `payamount:${inv.id}:${pay.id}`,
        headline: got > owed ? `Paid too much, refund the difference: ${what}` : `Paid less than owed: ${what}`,
        body: got > owed ? `${money(got)} came in online for an invoice that was down to ${money(owed)}. It is marked paid. Refund ${money(got - owed)} in Stripe.`
          : `${money(got)} came in online for an invoice of ${money(owed)}. It is marked paid, so ${money(owed - got)} is not being asked for: raise an invoice for the rest if it is still owed.` }).catch(() => false);
    }
  }
  if (inv.deal_id) {
    const ev = await svc('presence_deal_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
      site_id: inv.site_id, deal_id: inv.deal_id, kind: 'invoice_paid', actor: 'stripe', actor_kind: 'system', created_at: at,
      detail: { invoice_id: inv.id, amount_cents: Number(inv.amount_cents) || 0, purpose: inv.purpose, found_by: 'daily_check' },
    }) }).catch(() => ({ ok: false }));
    if ((ev as { ok?: boolean }).ok !== true) console.warn(`[stripe-check] invoice ${inv.id} is paid, but its line on the deal's history didn't save`);
  }
  const { invoicePaidEcho } = await import('../routes/commerce.ts');
  await invoicePaidEcho(String(inv.id)).catch((e) => console.warn(`[stripe-check] paid echo for ${inv.id} failed: ${String((e as Error)?.message || e)}`));
  console.log(`[stripe-check] invoice ${inv.id} was paid in Stripe (${pay.id}) and its message never came; marked paid now`);
  return 'paid';
}

/** A second payment on the same invoice (two pay pages open): told as the webhook tells it. */
async function tellPaidTwice(inv: any, extra: any[]): Promise<void> {
  if (!extra.length) return;
  const clientId = await ownerOf(String(inv.site_id));
  if (!clientId) return;
  const what = String(inv.title || (inv.purpose === 'deposit' ? 'Deposit' : 'Invoice'));
  for (const p of extra) {
    const cents = String(p?.currency || 'usd').toLowerCase() === 'usd' ? Math.round(Number(p.amount_received ?? p.amount) || 0) : null;
    await raiseNotice({ siteId: String(inv.site_id), clientId, kind: 'invoice_void_paid', period: `paidtwice:${inv.id}:${p.id}`,
      headline: `Paid twice, refund one: ${what} (${money(inv.amount_cents)})`,
      body: `This invoice was already paid, and ${cents !== null ? money(cents) : 'another payment'} has now come in for it online. Refund the online one in Stripe.` }).catch(() => false);
  }
}

async function checkOpenInvoices(out: StripeCheckResult, n: number, nowMs: number): Promise<void> {
  if (n <= 0) return;
  const since = new Date(nowMs - RECHECK_MS).toISOString();
  const q = await svc(`presence_invoices?status=eq.open&stripe_payment_link_id=not.is.null&deleted_at=is.null&or=(stripe_checked_at.is.null,stripe_checked_at.lt.${enc(since)})&select=id,site_id,deal_id,title,amount_cents,currency,purpose,status&order=stripe_checked_at.asc.nullsfirst&limit=${n}`).catch(() => ({ ok: false, json: null }));
  if (!q.ok) { out.errors++; return; }
  for (const inv of rowsOf(q)) {
    out.invoices_checked++;
    let payments: any[] = [];
    try { payments = await searchInvoicePayments(String(inv.id)); } catch { out.stripe_unanswered++; }   // marked anyway: asked again tomorrow
    const { first, extra } = settlingPayment(String(inv.id), payments);
    if (first) {
      const r = await settleFoundPayment(inv, first, nowMs);
      if (r === 'error') { out.errors++; continue; }
      if (r === 'paid') { out.invoices_paid++; await tellPaidTwice(inv, extra); }
      continue;   // paid now: it leaves the open list, nothing to mark
    }
    const st = await svc(`presence_invoices?id=eq.${enc(inv.id)}&status=eq.open`, { method: 'PATCH', body: JSON.stringify({ stripe_checked_at: new Date(nowMs).toISOString() }) }).catch(() => ({ ok: false }));
    if ((st as { ok?: boolean }).ok !== true) out.errors++;
  }
}

// ── 1b. invoices stuck on Processing (sales item 159) ────────────────────────
async function checkStuckProcessing(out: StripeCheckResult, nowMs: number): Promise<void> {
  const before = new Date(nowMs - PROCESSING_DAYS * DAY_MS).toISOString();
  const q = await svc(`presence_invoices?status=eq.open&processing_since=not.is.null&processing_since=lt.${enc(before)}&deleted_at=is.null&select=id,site_id,deal_id,title,amount_cents,currency,purpose,status,processing_since,link_gen&order=processing_since.asc&limit=10`).catch(() => ({ ok: false, json: null }));
  if (!q.ok) { out.errors++; return; }
  for (const inv of rowsOf(q)) {
    out.processing_checked++;
    let payments: any[] = [];
    try { payments = await searchInvoicePayments(String(inv.id)); } catch { out.stripe_unanswered++; continue; }   // asked again next tick
    const { verdict, pay } = stuckPaymentVerdict(String(inv.id), payments);
    if (verdict === 'paid') {
      const r = await settleFoundPayment(inv, pay, nowMs);
      if (r === 'error') out.errors++; else if (r === 'paid') out.invoices_paid++;
      continue;
    }
    if (verdict !== 'failed') continue;   // still settling, or Stripe's search hasn't caught up: wait
    // the bounce, the way the webhook does it (stripe-webhook/index.ts bouncePresenceInvoice): open
    // again, the spent link off the row, the link number moved on, then the three things after it
    const gen = Math.max(0, Math.trunc(Number(inv.link_gen) || 0)) + 1;
    const moved = await svc(`presence_invoices?id=eq.${enc(inv.id)}&status=eq.open&processing_since=not.is.null&select=id`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ processing_since: null, stripe_url: null, stripe_payment_link_id: null, link_gen: gen, updated_at: new Date(nowMs).toISOString() }),
    }).catch(() => ({ ok: false, json: null }));
    if (!moved.ok) { out.errors++; continue; }
    if (!rowsOf(moved).length) continue;   // something else moved it first
    out.processing_bounced++;
    console.error(`[stripe-check] invoice ${inv.id} read Processing since ${inv.processing_since} and Stripe says its payment failed (${pay?.id || '?'}): open again, as a bounce`);
    const { tellBounced } = await import('../routes/invoice_bounced.ts');
    await tellBounced(String(inv.id)).catch((e) => { out.errors++; console.warn(`[stripe-check] after the bounce of ${inv.id}: ${String((e as Error)?.message || e)}`); });
  }
}

// ── 2. retainers whose state differs ─────────────────────────────────────────
/** A retainer worth asking Stripe about: waiting on its link, live, or ended lately (a
 *  charge just before the end can still be missing). Pure. */
export function retainerCheckable(r: Partial<RetainerState> | null | undefined, nowMs: number): boolean {
  if (!r || typeof r !== 'object') return false;
  if (r.status === 'pending') return !!r.stripe_payment_link_id && !r.stripe_subscription_id;
  if (r.status === 'active' || r.status === 'past_due') return !!r.stripe_subscription_id;
  if (r.status === 'canceled') return !!r.stripe_subscription_id && Date.parse(String(r.canceled_at || '')) > nowMs - ENDED_DAYS * DAY_MS;
  return false;
}

async function checkOneRetainer(deal: any, out: StripeCheckResult): Promise<'same' | 'fixed' | 'unanswered' | 'error'> {
  const r: Partial<RetainerState> = deal.retainer;
  let outcome: 'same' | 'fixed' = 'same';
  try {
    if (r.status === 'pending') {
      // approved, but the approval's message never came: the link's finished checkout says so
      const sessions = await listLinkCompletedSessions(String(r.stripe_payment_link_id));
      const s = sessions.find((x) => x && x.subscription && String(x?.metadata?.deal_id || '') === String(deal.id));
      if (!s) return 'same';
      const res = await applyRetainerSync('checkout.session.completed', s);
      if (res.retry) return 'error';
      return 'fixed';
    }
    const subId = String(r.stripe_subscription_id);
    const sub = await retrieveSubscription(subId);
    if (!sub || sub.id !== subId || typeof sub.status !== 'string') return 'unanswered';
    if (r.status !== 'canceled' && retainerDrift(r, sub)) {
      const ended = sub.status === 'canceled' || sub.status === 'incomplete_expired';
      const res = await applyRetainerSync(ended ? 'customer.subscription.deleted' : 'customer.subscription.updated', sub, { live: sub });
      if (res.retry) return 'error';
      if (res.synced) { outcome = 'fixed'; out.retainers_fixed++; }
    }
    // the charges Stripe took that the deal doesn't show (each recorded once, by its Stripe invoice)
    const since = Math.floor(Date.parse(String(r.created_at || deal.created_at || '')) / 1000) - 86400;
    const invoices = await listSubscriptionPaidInvoices(subId, Number.isFinite(since) ? since : 0);
    for (const inv of invoices) {
      const rec = await recordRetainerCharge(inv, { dealId: String(deal.id), siteId: String(deal.site_id), interval: r.interval, fallbackCents: r.amount_cents });
      if (!rec.ok) return 'error';
      if (rec.recorded) { out.charges_found++; outcome = 'fixed'; }
    }
    return outcome;
  } catch (e) {
    console.warn(`[stripe-check] Stripe didn't answer about the retainer on deal ${deal.id}: ${String((e as Error)?.message || e)}`);
    return 'unanswered';
  }
}

async function checkRetainers(out: StripeCheckResult, n: number, nowMs: number): Promise<void> {
  if (n <= 0) return;
  const q = await svc('presence_deals?retainer=not.is.null&deleted_at=is.null&select=id,site_id,title,retainer,created_at&order=created_at.asc&limit=100').catch(() => ({ ok: false, json: null }));
  if (!q.ok) { out.errors++; return; }
  const deals = rowsOf(q).filter((d) => retainerCheckable(d?.retainer, nowMs));
  const checked = await lastChecked(deals.map((d) => `retainer:${d.id}`));
  if (!checked) { out.errors++; return; }
  for (const subject of dueSubjects(deals.map((d) => `retainer:${d.id}`), checked, n, nowMs)) {
    const deal = deals.find((d) => `retainer:${d.id}` === subject);
    out.retainers_checked++;
    const was = deal.retainer.status;
    const outcome = await checkOneRetainer(deal, out);
    if (outcome === 'error') { out.errors++; continue; }   // not marked: tried again next tick
    if (outcome === 'unanswered') out.stripe_unanswered++;   // marked: asked again tomorrow
    if (outcome === 'fixed' && was === 'pending') out.retainers_fixed++;
    if (!(await stamp(subject, outcome, nowMs))) out.errors++;
  }
}

// ── 3. a receipt that didn't go out ──────────────────────────────────────────
async function sendMissedReceipts(out: StripeCheckResult, n: number, nowMs: number): Promise<void> {
  if (n <= 0) return;
  const from = new Date(nowMs - RECEIPT_DAYS * DAY_MS).toISOString(), to = new Date(nowMs - RECEIPT_GRACE_MS).toISOString();
  // online payments only: one recorded by hand has its own receipt, sent when it was recorded
  const q = await svc(`presence_invoices?status=eq.paid&paid_method=is.null&receipt_sent_at=is.null&deleted_at=is.null&paid_at=gte.${enc(from)}&paid_at=lte.${enc(to)}&select=id&order=paid_at.asc&limit=20`).catch(() => ({ ok: false, json: null }));
  if (!q.ok) { out.errors++; return; }
  const ids = rowsOf(q).map((x) => String(x.id));
  const checked = await lastChecked(ids.map((id) => `receipt:${id}`));
  if (!checked) { out.errors++; return; }
  const { invoicePaidEcho } = await import('../routes/commerce.ts');
  for (const subject of dueSubjects(ids.map((id) => `receipt:${id}`), checked, n, nowMs)) {
    const id = subject.slice('receipt:'.length);
    const echo = await invoicePaidEcho(id).catch(() => null) as { receipted?: unknown } | null;
    const sent = echo?.receipted === true;
    if (sent) { out.receipts_sent++; console.log(`[stripe-check] the receipt for invoice ${id} never went out; sent now`); }
    if (!(await stamp(subject, sent ? 'fixed' : 'same', nowMs))) out.errors++;
  }
}

// ── 4. refunds and disputes whose messages were lost ─────────────────────────
// Once a day ('returns:week'): every refund Stripe made and every dispute opened in the
// last week, and every dispute still open here (its ending can come months later). The
// recording is commerce/charge_returns.ts's (sales items 126, 127): it reads Stripe fresh,
// records only what is new, and tells nobody twice, so a refund the webhook already
// recorded costs a read and changes nothing.
async function checkReturns(out: StripeCheckResult, nowMs: number): Promise<void> {
  const checked = await lastChecked(['returns:week']);
  if (!checked) { out.errors++; return; }
  if (!dueSubjects(['returns:week'], checked, 1, nowMs).length) return;
  const since = Math.floor((nowMs - RETURNS_DAYS * DAY_MS) / 1000);
  let refunds: any[] = [], disputes: any[] = [];
  try {
    refunds = await listRecentRefunds(since);
    disputes = await listRecentDisputes(since);
  } catch (e) {
    console.warn(`[stripe-check] Stripe didn't list the week's refunds and disputes: ${String((e as Error)?.message || e)}`);
    out.stripe_unanswered++;
    if (!(await stamp('returns:week', 'unanswered', nowMs))) out.errors++;
    return;
  }
  const charges = [...new Set(refunds.map((r) => idOf(r?.charge)).filter(Boolean))].slice(0, RETURNS_CAP);
  const disputeIds = new Set(disputes.map((d) => String(d?.id || '')).filter(Boolean));
  const open = await svc('presence_money_returns?kind=eq.dispute&status=eq.open&select=stripe_id&order=happened_at.asc&limit=50').catch(() => ({ ok: false, json: null }));
  if (open.ok) for (const r of rowsOf(open)) disputeIds.add(String(r.stripe_id));
  let found = false;
  for (const c of charges) {
    const res = await syncCharge(c);
    out.returns_checked++;
    if (!res.ok) out.stripe_unanswered++; else if (res.changed) { out.returns_found++; found = true; }
  }
  for (const d of [...disputeIds].slice(0, RETURNS_CAP)) {
    const res = await syncDispute(d);
    out.returns_checked++;
    if (!res.ok) out.stripe_unanswered++; else if (res.changed) { out.returns_found++; found = true; }
  }
  if (found) console.log(`[stripe-check] ${out.returns_found} refund or dispute change(s) whose message never came, recorded now`);
  if (!(await stamp('returns:week', found ? 'fixed' : 'same', nowMs))) out.errors++;
}

/** Every tick: a few open invoices, a few retainers and a few missed receipts, each at
 *  most once a day, and the week's refunds and disputes once a day. Bounded so a tick
 *  stays quick; with nothing due it only reads. */
export async function runStripeCheck(limits: { invoices?: number; retainers?: number; receipts?: number; returns?: number; processing?: number } = {}, nowMs: number = Date.now()): Promise<StripeCheckResult> {
  const out = zero();
  if (!stripeConfigured()) return { ...out, skipped_no_stripe: true };
  // before APPLY-0235 the check has nowhere to keep what it asked: it does nothing
  const ready = await svc('presence_stripe_checks?select=subject&limit=1').catch(() => ({ ok: false }));
  if ((ready as { ok?: boolean }).ok !== true) return { ...out, skipped_not_set_up: true };
  await checkOpenInvoices(out, limits.invoices ?? 4, nowMs);
  if (limits.processing !== 0) await checkStuckProcessing(out, nowMs);   // sales item 159
  await checkRetainers(out, limits.retainers ?? 3, nowMs);
  await sendMissedReceipts(out, limits.receipts ?? 3, nowMs);
  if (limits.returns !== 0) await checkReturns(out, nowMs);
  return out;
}
