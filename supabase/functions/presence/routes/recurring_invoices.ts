// ── Recurring invoices (sales review item 47, Nov 2026) ─────────────────────
// A fresh invoice — its own Stripe pay link — on a schedule, which the client
// pays themselves. NOT a retainer: a retainer (routes/sales.ts handleSalesRetainer)
// has Stripe charge a card automatically; this sends a bill. Both stay.
//
// How it works, as Eric chose it on Nov 8:
//   • Start (on the deal's Billing tab): what it's for, the amount, every month /
//     3 months / year, the first date, and how many times if not "until I stop
//     it". A first date of today goes out right away.
//   • Each one goes out on its own, around 9 am in the studio's time zone, due 14
//     days later, named for its month. Three days before, a news line under the
//     bell's Updates says what's going out (kind invoice_upcoming).
//   • Pause, Resume, Skip this one, Change and Stop any time. A stopped one never
//     starts again by itself.
//   • It pauses itself, with a Needs-you line, when the last two are unpaid, the
//     contact has no email, or Stripe isn't connected.
//   • Every invoice it sends is an ordinary presence_invoices row: on the deal,
//     in the client's portal, chased by the unpaid reminders if they're on,
//     settled by the one webhook, voidable like any other.
// The schedule math is pure (lib/recurring_invoices.ts); this file reads,
// writes and sends. Studio-gated and site-scoped like every authed /sales/* route.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { raiseNotice, clearNotice, clearNoticePrefix } from '../lib/notice.ts';
import { stripeConfigured, createServicePaymentLink } from '../commerce/stripe.ts';
import {
  localClock, sendDue, headsUpDue, twoUnpaidInARow, afterSend, resumeOn, nextOccurrence,
  validateRecurringStart, validateRecurringChange, recurringInvoiceTitle, monthLabel, dayLabel, addDays,
  pauseNoticeCopy, headsUpCopy, everyLabel, type PauseReason, type RecurringEvery,
} from '../lib/recurring_invoices.ts';
import { dealEvent, loadDeal, emailInvoice } from './sales.ts';
import { tableMissing } from './estimates.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const nowIso = () => new Date().toISOString();
const COLS = 'id,site_id,deal_id,title,amount_cents,currency,every,anchor_day,next_on,due_days,times,sent_count,status,paused_reason,resumed_at,created_at,updated_at';
const SYS: Principal = { kind: 'system', userId: 'recurring-invoice', tenantId: null, role: null, email: null, jwt: null, requestId: 'recurring-invoice' } as Principal;
const needsUpdate = (cors: Record<string, string>) => json({ error: 'unavailable', message: 'Recurring invoices need a one-time database update before they can be set up.' }, 503, cors);

// The notice keys. Each names the deal (so the bell can open it) and the date,
// so a later occurrence gets a key of its own.
export const headsUpPeriod = (dealId: string, id: string, on: string) => `recurnext:${dealId}:${id}:${on}`;
export const pausePeriod = (dealId: string, id: string, on: string) => `recurpause:${dealId}:${id}:${on}`;
export const pausePeriodPrefix = (dealId: string, id: string) => `recurpause:${dealId}:${id}:`;

async function loadSchedule(siteId: string, id: string): Promise<any | null> {
  if (!UUID_RE.test(id)) return null;
  return rows(await svc(`presence_recurring_invoices?id=eq.${id}&site_id=eq.${siteId}&deleted_at=is.null&select=${COLS}&limit=1`))[0] || null;
}
/** The deal page's read: every schedule on the deal that hasn't ended, plus
 *  the ended ones from the last 60 days, newest first. [] before APPLY-0145. */
export async function recurringForDeal(siteId: string, dealId: string): Promise<any[]> {
  try {
    return rows(await svc(`presence_recurring_invoices?deal_id=eq.${dealId}&site_id=eq.${siteId}&deleted_at=is.null&select=${COLS}&order=created_at.desc&limit=20`))
      .filter((s) => s.status === 'active' || s.status === 'paused' || Date.parse(String(s.updated_at || '')) > Date.now() - 60 * 86400_000);
  } catch { return []; }
}
/** The studio's time zone (the site's location, else Pacific — localClock's default). */
async function zoneOf(siteId: string): Promise<string> {
  try { return String(rows(await svc(`presence_locations?site_id=eq.${siteId}&select=timezone&limit=1`))[0]?.timezone || ''); } catch { return ''; }
}
async function contactOf(siteId: string, deal: any): Promise<{ email: string; who: string }> {
  try {
    const c = deal?.contact_id ? rows(await svc(`presence_contacts?id=eq.${deal.contact_id}&site_id=eq.${siteId}&select=name,email,company&limit=1`))[0] : null;
    return { email: String(c?.email || ''), who: String(c?.company || c?.name || deal?.title || '') };
  } catch { return { email: '', who: String(deal?.title || '') }; }
}
async function clearHeadsUp(clientId: string | null, s: any): Promise<void> {
  if (clientId && s?.next_on) await clearNotice(clientId, 'invoice_upcoming', headsUpPeriod(s.deal_id, s.id, s.next_on));
}

// ═══ SEND ONE (the sweep, and Start with a first date of today) ═══
// Order, so a crash anywhere leaves something the next tick finishes and nothing
// is ever billed or emailed twice:
//   1. the checks that pause it (no Stripe, no email, the last two unpaid);
//   2. the invoice for THIS date — the unique (recurring_id, recurring_on) index
//      means a second attempt finds the first one instead of making another;
//   3. its pay link, claimed with stripe_url=is.null so only one attempt emails;
//   4. the schedule moves to its next date, guarded on the date it was on.
type SendOutcome = { result: 'sent' | 'paused' | 'stopped' | 'failed' | 'skipped'; invoice_id?: string; emailed?: boolean; reason?: PauseReason };
export async function sendRecurringNow(s: any, ctx: { localYmd: string; clientId: string | null }): Promise<SendOutcome> {
  const deal = await loadDeal(s.site_id, s.deal_id);
  if (!deal) {
    // the deal was removed: nothing left to bill for, so the schedule ends
    const up = await svc(`presence_recurring_invoices?id=eq.${s.id}&site_id=eq.${s.site_id}&status=eq.active&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'stopped', next_on: null }) });
    if (rows(up)[0]) await clearHeadsUp(ctx.clientId, s);
    return { result: 'stopped' };
  }
  const pause = async (reason: PauseReason): Promise<SendOutcome> => {
    const up = await svc(`presence_recurring_invoices?id=eq.${s.id}&site_id=eq.${s.site_id}&status=eq.active&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'paused', paused_reason: reason }) });
    if (!rows(up)[0]) return { result: 'skipped' };   // someone paused or stopped it a moment ago
    const copy = pauseNoticeCopy(reason, String(deal.title || ''));
    if (ctx.clientId) await raiseNotice({ siteId: s.site_id, clientId: ctx.clientId, kind: 'deal_followup', period: pausePeriod(s.deal_id, s.id, s.next_on), headline: copy.headline, body: copy.body });
    await clearHeadsUp(ctx.clientId, s);
    await dealEvent(s.site_id, s.deal_id, 'recurring_invoice', SYS, { detail: { action: 'paused', reason, recurring_id: s.id, title: s.title } });
    return { result: 'paused', reason };
  };
  if (!stripeConfigured()) return pause('no_stripe');
  const { email } = await contactOf(s.site_id, deal);
  if (!email) return pause('no_email');

  // 2. the invoice for this date (a retry finds the one already made)
  const mine = await svc(`presence_invoices?recurring_id=eq.${s.id}&site_id=eq.${s.site_id}&deleted_at=is.null&select=id,title,description,amount_cents,status,processing_since,due_date,recurring_on,stripe_url,created_at&order=recurring_on.desc&limit=6`);
  if (!mine.ok) return { result: 'failed' };
  let inv = rows(mine).find((v) => v.recurring_on === s.next_on) || null;
  if (!inv && twoUnpaidInARow(rows(mine), ctx.localYmd, s.resumed_at)) return pause('unpaid');
  if (!inv) {
    const title = recurringInvoiceTitle(s.title, s.next_on);
    const ins = await svc('presence_invoices', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ site_id: s.site_id, deal_id: s.deal_id, customer_client_id: deal.converted_client_id || null, customer_site_id: deal.converted_site_id || null,
        title, description: `${title} — ${deal.title || 'ongoing work'}`, amount_cents: Number(s.amount_cents), currency: s.currency || 'usd', purpose: 'service', status: 'open',
        due_date: addDays(ctx.localYmd, Number(s.due_days ?? 14)), created_by: 'recurring', recurring_id: s.id, recurring_on: s.next_on }) });
    inv = rows(ins)[0] || null;
    if (!inv && ins.status === 409) inv = rows(await svc(`presence_invoices?recurring_id=eq.${s.id}&recurring_on=eq.${s.next_on}&site_id=eq.${s.site_id}&select=id,title,description,amount_cents,status,due_date,recurring_on,stripe_url&limit=1`))[0] || null;
    if (!inv) return { result: 'failed' };
  }

  // 3. its pay link and the email, exactly once
  let emailed = false;
  if (!inv.stripe_url && inv.status === 'open') {
    let link: { url: string; id: string };
    try {
      link = await createServicePaymentLink({ amountCents: Number(inv.amount_cents), currency: 'usd', description: String(inv.description || inv.title), invoiceId: inv.id });
    } catch { return { result: 'failed', invoice_id: inv.id }; }   // the row stands; the next tick finishes it under the same idempotency key
    const claim = await svc(`presence_invoices?id=eq.${inv.id}&site_id=eq.${s.site_id}&stripe_url=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ stripe_url: link.url, stripe_payment_link_id: link.id }) });
    if (rows(claim)[0]) {
      const kind = s.every === 'year' ? 'yearly' : s.every === 'quarter' ? 'quarterly' : 'monthly';
      const due = inv.due_date ? ` It’s due ${dayLabel(String(inv.due_date))}.` : '';
      emailed = await emailInvoice(s.site_id, s.deal_id, String(inv.title), link.url, Number(inv.amount_cents), inv.id, `This is your ${kind} invoice for ${s.title}.${due}`);
      await dealEvent(s.site_id, s.deal_id, 'invoice_sent', SYS, { detail: { invoice_id: inv.id, amount_cents: Number(inv.amount_cents), purpose: 'service', recurring_id: s.id, period: monthLabel(s.next_on) } });
    }
  }

  // 4. the next date (guarded on this one, so a racing tick can't move it twice)
  const next = afterSend({ next_on: s.next_on, anchor_day: Number(s.anchor_day), every: s.every as RecurringEvery, times: s.times == null ? null : Number(s.times), sent_count: Number(s.sent_count) || 0 });
  const adv = await svc(`presence_recurring_invoices?id=eq.${s.id}&site_id=eq.${s.site_id}&next_on=eq.${s.next_on}&status=eq.active&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(next) });
  if (rows(adv)[0]) {
    await clearHeadsUp(ctx.clientId, s);
    if (next.status === 'finished') await dealEvent(s.site_id, s.deal_id, 'recurring_invoice', SYS, { detail: { action: 'finished', recurring_id: s.id, title: s.title } });
  }
  return { result: 'sent', invoice_id: inv.id, emailed };
}

// ═══ THE SWEEP (routes/system.ts, every tick) ═══
// Reads the schedules due within the next few days, works out each studio's own
// day and hour, raises the heads-up three days out, and sends the ones that are
// due. Before APPLY-0145 the read fails and this is a clean no-op.
export async function runRecurringInvoices(limit = 20): Promise<{ sent: number; paused: number; heads_up: number; failed: number }> {
  const out = { sent: 0, paused: 0, heads_up: 0, failed: 0 };
  const horizon = addDays(new Date().toISOString().slice(0, 10), 4);   // 3 days of heads-up, plus a day for time zones
  const q = await svc(`presence_recurring_invoices?status=eq.active&deleted_at=is.null&next_on=lte.${horizon}&select=${COLS}&order=next_on.asc&limit=${limit * 5}`);
  if (!q.ok) return out;
  const due = rows(q);
  if (!due.length) return out;
  const siteIds = [...new Set(due.map((s) => String(s.site_id)))].filter((x) => UUID_RE.test(x));
  const [sitesQ, zonesQ] = await Promise.all([
    svc(`presence_sites?id=in.(${siteIds.join(',')})&select=id,client_id`),
    svc(`presence_locations?site_id=in.(${siteIds.join(',')})&select=site_id,timezone`),
  ]);
  const clientOf = new Map(rows(sitesQ).map((r) => [String(r.id), r.client_id || null]));
  const zone = new Map(rows(zonesQ).map((r) => [String(r.site_id), String(r.timezone || '')]));
  const nowMs = Date.now();
  let sends = 0;
  for (const s of due) {
    const local = localClock(zone.get(String(s.site_id)), nowMs);
    const clientId = clientOf.get(String(s.site_id)) || null;
    if (headsUpDue(s, local.ymd) && clientId) {
      try {
        const deal = await loadDeal(s.site_id, s.deal_id);
        if (!deal) continue;   // a removed deal: its schedule ends on the day instead
        const { who } = await contactOf(s.site_id, deal);
        const copy = headsUpCopy({ title: s.title, on: s.next_on, amount_cents: Number(s.amount_cents), who });
        // news, not an ask (UPDATE_NOTICE_KINDS); one per date, cleared once it goes, is skipped or changes
        const fresh = await raiseNotice({ siteId: s.site_id, clientId, kind: 'invoice_upcoming', period: headsUpPeriod(s.deal_id, s.id, s.next_on), headline: copy.headline, body: copy.body, push: false });
        if (fresh) out.heads_up++;
      } catch { /* the send itself never depends on the heads-up */ }
      continue;
    }
    if (!sendDue(s, local) || sends >= limit) continue;
    sends++;
    try {
      const r = await sendRecurringNow(s, { localYmd: local.ymd, clientId });
      if (r.result === 'sent') out.sent++; else if (r.result === 'paused') out.paused++; else if (r.result === 'failed') out.failed++;
    } catch { out.failed++; }
  }
  return out;
}

// ═══ START ═══
export async function handleRecurringStart(req: Request, site: SiteRow, principal: Principal, dealId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(dealId)) return json({ error: 'bad_request' }, 400, cors);
  if (!stripeConfigured()) return json({ error: 'unavailable', message: 'Connect Stripe before setting up a recurring invoice.' }, 503, cors);
  const deal = await loadDeal(site.id, dealId);
  if (!deal) return json({ error: 'not_found', message: 'That deal is no longer here.' }, 404, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const local = localClock(await zoneOf(site.id), Date.now());
  const v = validateRecurringStart(b, local.ymd);
  if (!v.ok) return json({ error: 'validation', message: v.error }, 422, cors);
  const { email } = await contactOf(site.id, deal);
  if (!email) return json({ error: 'no_email', message: 'Add the client’s email to this deal first — each invoice goes to them by email.' }, 422, cors);
  // a double-tap must never start two of the same schedule
  const same = await svc(`presence_recurring_invoices?deal_id=eq.${dealId}&site_id=eq.${site.id}&status=in.(active,paused)&deleted_at=is.null&select=${COLS}&limit=20`);
  if (!same.ok && tableMissing(same)) return needsUpdate(cors);
  const twin = rows(same).find((s) => s.title === v.value.title && Number(s.amount_cents) === v.value.amount_cents && s.every === v.value.every);
  if (twin) return json({ error: 'exists', recurring: twin, message: 'This deal already has that recurring invoice. Change it, or stop it first.' }, 409, cors);
  const ins = await svc('presence_recurring_invoices', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, deal_id: dealId, title: v.value.title, amount_cents: v.value.amount_cents, currency: 'usd', every: v.value.every,
      anchor_day: v.value.anchor_day, next_on: v.value.first_on, due_days: v.value.due_days, times: v.value.times, sent_count: 0, status: 'active', paused_reason: '',
      created_by: principal.email || principal.userId || '' }) });
  if (!ins.ok && tableMissing(ins)) return needsUpdate(cors);
  let s = rows(ins)[0];
  if (!ins.ok || !s) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
  await dealEvent(site.id, dealId, 'recurring_invoice', principal, { detail: { action: 'started', recurring_id: s.id, title: s.title, amount_cents: s.amount_cents, every: s.every, on: s.next_on, times: s.times } });
  // "If the first date is today, it goes out right away" — whatever the hour
  let sent: SendOutcome | null = null;
  if (s.next_on === local.ymd) {
    sent = await sendRecurringNow(s, { localYmd: local.ymd, clientId: site.client_id || null });
    s = (await loadSchedule(site.id, s.id)) || s;
  }
  return json({ data: { recurring: s, sent } }, 201, cors);
}

// ═══ CHANGE ═══
export async function handleRecurringChange(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const s = await loadSchedule(site.id, id);
  if (!s) return json({ error: 'not_found', message: 'That recurring invoice isn’t here.' }, 404, cors);
  if (s.status === 'stopped' || s.status === 'finished') return json({ error: 'ended', message: 'This recurring invoice has ended — start a new one instead.' }, 409, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const local = localClock(await zoneOf(site.id), Date.now());
  const v = validateRecurringChange(b, s, local.ymd);
  if (!v.ok) return json({ error: 'validation', message: v.error }, 422, cors);
  const up = await svc(`presence_recurring_invoices?id=eq.${id}&site_id=eq.${site.id}&status=in.(active,paused)&select=${COLS}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(v.value) });
  const row = rows(up)[0];
  if (!up.ok || !row) return json({ error: 'conflict', message: 'This recurring invoice changed while you were editing it — reload and take another look.' }, 409, cors);
  await clearHeadsUp(site.client_id || null, s);   // the heads-up said the old name, amount or date
  await dealEvent(site.id, s.deal_id, 'recurring_invoice', principal, { detail: { action: 'changed', recurring_id: id, title: row.title, amount_cents: row.amount_cents, ...(v.value.next_on ? { on: row.next_on } : {}) } });
  return json({ data: row }, 200, cors);
}

// ═══ PAUSE · RESUME · SKIP THIS ONE · STOP ═══
export async function handleRecurringAction(_req: Request, site: SiteRow, principal: Principal, id: string, action: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const s = await loadSchedule(site.id, id);
  if (!s) return json({ error: 'not_found', message: 'That recurring invoice isn’t here.' }, 404, cors);
  const clientId = site.client_id || null;
  const ended = s.status === 'stopped' || s.status === 'finished';
  const write = async (where: string, patch: Record<string, unknown>) => rows(await svc(`presence_recurring_invoices?id=eq.${id}&site_id=eq.${site.id}&${where}&select=${COLS}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) }))[0] || null;
  const conflict = () => json({ error: 'conflict', message: 'This recurring invoice changed a moment ago — reload and take another look.' }, 409, cors);
  if (action === 'stop') {
    if (ended) return json({ data: s, already: true }, 200, cors);
    const row = await write('status=in.(active,paused)', { status: 'stopped', next_on: null, paused_reason: '' });
    if (!row) return conflict();
    await clearHeadsUp(clientId, s);
    if (clientId) await clearNoticePrefix(clientId, 'deal_followup', pausePeriodPrefix(s.deal_id, id));
    await dealEvent(site.id, s.deal_id, 'recurring_invoice', principal, { detail: { action: 'stopped', recurring_id: id, title: s.title } });
    return json({ data: row }, 200, cors);
  }
  if (ended) return json({ error: 'ended', message: 'This recurring invoice has ended — start a new one instead.' }, 409, cors);
  if (action === 'pause') {
    if (s.status === 'paused') return json({ data: s, already: true }, 200, cors);
    const row = await write('status=eq.active', { status: 'paused', paused_reason: 'manual' });
    if (!row) return conflict();
    await clearHeadsUp(clientId, s);
    await dealEvent(site.id, s.deal_id, 'recurring_invoice', principal, { detail: { action: 'paused', reason: 'manual', recurring_id: id, title: s.title } });
    return json({ data: row }, 200, cors);
  }
  if (action === 'resume') {
    if (s.status === 'active') return json({ data: s, already: true }, 200, cors);
    // never resume into an instant re-pause: say what's missing instead
    if (!stripeConfigured()) return json({ error: 'unavailable', message: 'Connect Stripe first — then resume it.' }, 503, cors);
    const deal = await loadDeal(site.id, s.deal_id);
    if (!(await contactOf(site.id, deal)).email) return json({ error: 'no_email', message: 'Add the client’s email to this deal first — then resume it.' }, 422, cors);
    const local = localClock(await zoneOf(site.id), Date.now());
    const row = await write('status=eq.paused', { status: 'active', paused_reason: '', resumed_at: nowIso(), next_on: resumeOn(s.next_on, local.ymd) });
    if (!row) return conflict();
    if (clientId) await clearNoticePrefix(clientId, 'deal_followup', pausePeriodPrefix(s.deal_id, id));
    await dealEvent(site.id, s.deal_id, 'recurring_invoice', principal, { detail: { action: 'resumed', recurring_id: id, title: s.title, on: row.next_on } });
    return json({ data: row }, 200, cors);
  }
  if (action === 'skip') {
    if (!s.next_on) return conflict();
    const nextOn = nextOccurrence(s.next_on, Number(s.anchor_day), s.every as RecurringEvery);
    const row = await write(`status=in.(active,paused)&next_on=eq.${s.next_on}`, { next_on: nextOn });
    if (!row) return conflict();
    await clearHeadsUp(clientId, s);
    await dealEvent(site.id, s.deal_id, 'recurring_invoice', principal, { detail: { action: 'skipped', recurring_id: id, title: s.title, on: s.next_on } });
    return json({ data: row, skipped: s.next_on, next_on: nextOn, every: everyLabel(s.every) }, 200, cors);
  }
  return json({ error: 'bad_request' }, 400, cors);
}
