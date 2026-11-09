// ── Recurring invoices: the schedule, pure (sales review item 47, Nov 2026) ──
// A recurring invoice is a fresh invoice — its own Stripe pay link — sent on a
// schedule. Eric chose the shape on Nov 8: every month, every 3 months or every
// year; on the day of the month the first one goes out (the 31st becomes the
// last day of a shorter month); around 9 am in the studio's own time zone; due
// 14 days after it goes out; named for its month ("Website care — December
// 2026"). The client pays each one themselves. It is NOT a retainer
// (commerce/retainers.ts): a retainer charges a card automatically, this sends
// a bill. Both stay.
//
// Pure: no I/O and no clock. Callers pass the studio's local day and hour, so
// the dates, the names and the pause rule are tested exhaustively
// (tests/presence/recurring_invoices_test.mjs). routes/recurring_invoices.ts
// does the reading, writing and sending.

export type RecurringEvery = 'month' | 'quarter' | 'year';
export type RecurringStatus = 'active' | 'paused' | 'stopped' | 'finished';
export type PauseReason = 'manual' | 'unpaid' | 'no_email' | 'no_stripe';

export const RECURRING_EVERY: readonly RecurringEvery[] = ['month', 'quarter', 'year'];
const MONTHS_OF: Record<RecurringEvery, number> = { month: 1, quarter: 3, year: 12 };
export const RECURRING_DUE_DAYS = 14;          // due this many days after it goes out
export const RECURRING_HEADS_UP_DAYS = 3;      // the Updates line comes this many days before
export const RECURRING_SEND_HOUR = 9;          // around 9 in the morning, the studio's time
export const RECURRING_MAX_TIMES = 120;
export const RECURRING_MAX_AHEAD_DAYS = 366;   // a first date more than a year out is a typo
export const RECURRING_MIN_CENTS = 50;         // Stripe's floor
export const RECURRING_MAX_CENTS = 100_000_000;
export const RECURRING_DEFAULT_TZ = 'America/Los_Angeles';   // the same default daytimeIn uses

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, '0');
const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}
/** A real calendar date written YYYY-MM-DD (2026-02-30 is not one). */
export function isYmd(s: unknown): s is string {
  const m = YMD_RE.exec(String(s ?? ''));
  if (!m) return false;
  const mo = Number(m[2]), d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(Number(m[1]), mo);
}
export function addDays(ymd: string, n: number): string {
  return new Date(Date.parse(ymd + 'T00:00:00Z') + Math.trunc(n) * 86400_000).toISOString().slice(0, 10);
}
/** The date `months` after `ymd`'s month, on `anchorDay` — or on that month's
 *  last day when the month is shorter (the 31st → Feb 28 → Mar 31). */
export function shiftMonths(ymd: string, months: number, anchorDay: number): string {
  const m = YMD_RE.exec(ymd);
  if (!m) return ymd;
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + Math.trunc(months);
  const y = Math.floor(total / 12), mo = (total % 12) + 1;
  const d = Math.min(Math.max(1, Math.trunc(anchorDay) || 1), daysInMonth(y, mo));
  return `${y}-${pad(mo)}-${pad(d)}`;
}
/** The send date after `ymd`. */
export function nextOccurrence(ymd: string, anchorDay: number, every: RecurringEvery): string {
  return shiftMonths(ymd, MONTHS_OF[every] || 1, anchorDay);
}
export const dayOf = (ymd: string): number => Number(String(ymd).slice(8, 10)) || 1;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_SHORT = MONTH_NAMES.map((n) => n.slice(0, 3));
/** "December 2026" — the month an invoice is for (the month it goes out). */
export function monthLabel(ymd: string): string {
  const m = YMD_RE.exec(String(ymd || ''));
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : '';
}
/** "Dec 1, 2026". */
export function dayLabel(ymd: string): string {
  const m = YMD_RE.exec(String(ymd || ''));
  return m ? `${MONTH_SHORT[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : '';
}
/** Each invoice is named for its month: "Website care — December 2026". */
export function recurringInvoiceTitle(title: string, ymd: string): string {
  const what = clean(title, 120) || 'Invoice';
  const month = monthLabel(ymd);
  return month ? `${what} — ${month}` : what;
}
export function everyLabel(every: unknown): string {
  return every === 'quarter' ? 'every 3 months' : every === 'year' ? 'every year' : 'every month';
}
const usd = (cents: number) => '$' + (Math.round(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The studio's own day and hour. A bad or missing zone falls back to Pacific. */
export function localClock(timezone: string | null | undefined, nowMs: number): { ymd: string; hour: number } {
  const parts = (tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(nowMs));
  let p: Intl.DateTimeFormatPart[];
  try { p = parts(String(timezone || '') || RECURRING_DEFAULT_TZ); } catch { p = parts(RECURRING_DEFAULT_TZ); }
  const get = (t: string) => p.find((x) => x.type === t)?.value || '';
  return { ymd: `${get('year')}-${get('month')}-${get('day')}`, hour: (Number(get('hour')) || 0) % 24 };
}

/** Does this schedule send now? On its day once it's 9 am the studio's time; a
 *  day that was missed (the sweep was down, or it was resumed) goes at once. */
export function sendDue(s: { status?: unknown; next_on?: unknown }, local: { ymd: string; hour: number }): boolean {
  if (s.status !== 'active' || !isYmd(s.next_on)) return false;
  if (s.next_on > local.ymd) return false;
  return s.next_on < local.ymd || local.hour >= RECURRING_SEND_HOUR;
}
/** Is it time for the heads-up under Updates ("Goes out Dec 1 …")? From three
 *  days before the send date until the day itself. */
export function headsUpDue(s: { status?: unknown; next_on?: unknown }, localYmd: string): boolean {
  if (s.status !== 'active' || !isYmd(s.next_on)) return false;
  return localYmd < s.next_on && addDays(s.next_on, -RECURRING_HEADS_UP_DAYS) <= localYmd;
}

/** "Two in a row unpaid": the schedule's two newest invoices (a voided one isn't
 *  owed, so it doesn't count either way) are both still waiting and past their
 *  due date. Invoices sent before the last Resume don't count: pressing Resume
 *  means "I know, keep going", so the next one goes out. */
export function twoUnpaidInARow(
  invoices: Array<{ status?: unknown; processing_since?: unknown; due_date?: unknown; recurring_on?: unknown; created_at?: unknown }>,
  localYmd: string, resumedAt?: string | null,
): boolean {
  const counted = (invoices || [])
    .filter((v) => v && v.status !== 'void' && (!resumedAt || String(v.created_at || '') > String(resumedAt)))
    .sort((a, b) => String(b.recurring_on || '').localeCompare(String(a.recurring_on || '')));
  if (counted.length < 2) return false;
  return counted.slice(0, 2).every((v) => v.status === 'open' && !v.processing_since && isYmd(v.due_date) && v.due_date < localYmd);
}

/** What happens next after one invoice goes out: the next date, or finished
 *  once it has gone out the number of times asked for. */
export function afterSend(s: { next_on: string; anchor_day: number; every: RecurringEvery; times: number | null; sent_count: number }): { next_on: string | null; sent_count: number; status: RecurringStatus } {
  const sent = (Math.trunc(Number(s.sent_count)) || 0) + 1;
  if (s.times != null && sent >= s.times) return { next_on: null, sent_count: sent, status: 'finished' };
  return { next_on: nextOccurrence(s.next_on, s.anchor_day, s.every), sent_count: sent, status: 'active' };
}
/** Resume: a date still ahead stays; a date that went by without sending goes
 *  out today (the anchor day keeps the schedule on its usual day after that). */
export function resumeOn(nextOn: string | null | undefined, localYmd: string): string {
  return isYmd(nextOn) && nextOn >= localYmd ? nextOn : localYmd;
}

// ── checking what the studio typed ───────────────────────────────────────────
export interface RecurringStart { title: string; amount_cents: number; every: RecurringEvery; first_on: string; anchor_day: number; times: number | null; due_days: number }
type Check<T> = { ok: true; value: T } | { ok: false; error: string };

function checkAmount(v: unknown): Check<number> {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < RECURRING_MIN_CENTS) return { ok: false, error: 'Enter an amount of at least $0.50.' };
  if (n > RECURRING_MAX_CENTS) return { ok: false, error: 'That amount is over $1,000,000 — double-check it and try again.' };
  return { ok: true, value: n };
}
function checkDate(v: unknown, localYmd: string, what: 'first' | 'next'): Check<string> {
  if (!isYmd(v)) return { ok: false, error: what === 'first' ? 'Pick the date the first one goes out.' : 'Pick the date the next one goes out.' };
  if (v < localYmd) return { ok: false, error: `Pick a ${what} date from today on.` };
  if (v > addDays(localYmd, RECURRING_MAX_AHEAD_DAYS)) return { ok: false, error: `Pick a ${what} date within the next year.` };
  return { ok: true, value: v };
}
function checkTimes(v: unknown): Check<number | null> {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > RECURRING_MAX_TIMES) return { ok: false, error: 'How many times can be 1 to 120 — or leave it blank to keep going until you stop it.' };
  return { ok: true, value: n };
}

/** The Start form. Pure; `localYmd` is the studio's today. */
export function validateRecurringStart(b: Record<string, unknown> | null | undefined, localYmd: string): Check<RecurringStart> {
  const x = b && typeof b === 'object' ? b : {};
  const title = clean(x.title, 120);
  if (!title) return { ok: false, error: 'Say what it’s for — for example, Website care.' };
  const amount = checkAmount(x.amount_cents);
  if (!amount.ok) return amount;
  if (!RECURRING_EVERY.includes(x.every as RecurringEvery)) return { ok: false, error: 'Choose every month, every 3 months or every year.' };
  const first = checkDate(x.first_on, localYmd, 'first');
  if (!first.ok) return first;
  const times = checkTimes(x.times);
  if (!times.ok) return times;
  return { ok: true, value: { title, amount_cents: amount.value, every: x.every as RecurringEvery, first_on: first.value, anchor_day: dayOf(first.value), times: times.value, due_days: RECURRING_DUE_DAYS } };
}

/** The Change form: any of the name, the amount, the next date, how many times.
 *  A new next date moves the schedule's day with it. */
export function validateRecurringChange(b: Record<string, unknown> | null | undefined, cur: { sent_count?: unknown }, localYmd: string): Check<Record<string, unknown>> {
  const x = b && typeof b === 'object' ? b : {};
  const patch: Record<string, unknown> = {};
  if (x.title !== undefined) {
    const title = clean(x.title, 120);
    if (!title) return { ok: false, error: 'Say what it’s for — for example, Website care.' };
    patch.title = title;
  }
  if (x.amount_cents !== undefined) { const a = checkAmount(x.amount_cents); if (!a.ok) return a; patch.amount_cents = a.value; }
  if (x.next_on !== undefined) { const d = checkDate(x.next_on, localYmd, 'next'); if (!d.ok) return d; patch.next_on = d.value; patch.anchor_day = dayOf(d.value); }
  if (x.times !== undefined) {
    const t = checkTimes(x.times);
    if (!t.ok) return t;
    const sent = Math.trunc(Number(cur?.sent_count)) || 0;
    if (t.value !== null && t.value <= sent) return { ok: false, error: `It has already gone out ${sent === 1 ? 'once' : sent + ' times'} — pick a bigger number, or press Stop.` };
    patch.times = t.value;
  }
  if (!Object.keys(patch).length) return { ok: false, error: 'Nothing to change.' };
  return { ok: true, value: patch };
}

// ── the words ────────────────────────────────────────────────────────────────
/** The deal history line for a schedule event. Pure; mirrored by hand in
 *  pipeline.html's evtLabel, like every other kind. */
export function recurringEventLine(d: Record<string, unknown> | null | undefined): string {
  const x = d && typeof d === 'object' ? d : {};
  const amount = Number(x.amount_cents) > 0 ? usd(Number(x.amount_cents)) : '';
  const what = clean(x.title, 120);
  const on = isYmd(x.on) ? dayLabel(x.on as string) : '';
  switch (x.action) {
    case 'started': return `Recurring invoice started${what ? ` — ${what}` : ''}${amount ? `, ${amount} ${everyLabel(x.every)}` : ''}${on ? ` from ${on}` : ''}`;
    case 'changed': return `Recurring invoice changed${amount ? ` — ${amount}` : ''}${on ? `${amount ? ',' : ' —'} next on ${on}` : ''}`;
    case 'skipped': return `Recurring invoice: skipped ${on || 'one'}`;
    case 'paused': return x.reason === 'manual' || !x.reason ? 'Recurring invoice paused' : `Recurring invoice paused — ${pauseWords(x.reason as PauseReason)}`;
    case 'resumed': return `Recurring invoice resumed${on ? ` — next on ${on}` : ''}`;
    case 'stopped': return 'Recurring invoice stopped';
    case 'finished': return 'Recurring invoice finished — the last one went out';
    default: return 'Recurring invoice';
  }
}
/** Why it paused itself, in a few words. */
export function pauseWords(reason: PauseReason | string | null | undefined): string {
  if (reason === 'unpaid') return 'the last two invoices are still unpaid';
  if (reason === 'no_email') return 'there’s no client email on this deal';
  if (reason === 'no_stripe') return 'Stripe isn’t connected';
  return 'you paused it';
}
/** The Needs-you notice when it pauses itself. */
export function pauseNoticeCopy(reason: PauseReason, dealTitle: string): { headline: string; body: string } {
  const t = clean(dealTitle, 120) || 'a deal';
  const fix = reason === 'no_email' ? 'Add their email to the contact, then resume it on the deal.'
    : reason === 'no_stripe' ? 'Connect Stripe, then resume it on the deal.'
      : 'Resume it on the deal when you’re ready, or stop it.';
  const why = reason === 'unpaid' ? 'The last two invoices are still unpaid, so the next one didn’t go out.'
    : reason === 'no_email' ? 'There’s no client email on this deal, so the invoice couldn’t go out.'
      : 'Stripe isn’t connected, so the invoice couldn’t go out.';
  return { headline: `Recurring invoice paused — ${t}`, body: `${why} ${fix}` };
}
/** The Updates line three days before one goes out. */
export function headsUpCopy(o: { title: string; on: string; amount_cents: number; who: string }): { headline: string; body: string } {
  const on = dayLabel(o.on).replace(/, \d{4}$/, '');
  const who = clean(o.who, 120);
  return {
    headline: `Goes out ${on}: ${recurringInvoiceTitle(o.title, o.on)}${who ? ` to ${who}` : ''} (${usd(o.amount_cents)})`,
    body: 'This recurring invoice sends itself that morning. To skip this one, change it or stop it, open the deal.',
  };
}
