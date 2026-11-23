// ── Changing an unpaid invoice, and giving money back by hand (sales items 162, 165) ──
// Pure rules, no I/O: routes/invoice_changes.ts reads the rows and asks these, and
// tests/presence/money_polish_nov22_test.mjs pins them.
//
// 162  An invoice could only be sent, voided or paid: a wrong due date, a typo or a missing
//      line meant void it and make a new one with a new number. Now the title, the note
//      and the due date can change while it is unpaid, and the amount and the lines while
//      nothing has been paid toward it. The number is kept. A changed amount gets a fresh pay
//      link (the old one was for the old amount), the deal's history keeps each change, and
//      one that was already sent is sent again as corrected.
// 165  A payment taken by hand could only be undone whole. "Give money back" records an
//      amount, a day, how and a note against a paid invoice: it reads "Paid, $100 refunded",
//      comes off the month it went back, and shows on the receipt.
import { PAY_METHODS, type PayMethod } from './invoice_billing.ts';
import { quarterQty } from './sales_lifecycle.ts';   // sales item 185

export interface InvoiceLineIn { label: string; qty: number; amount_cents: number }
export interface InvoiceEdit { title?: string; description?: string; due_date?: string | null; amount_cents?: number; lines?: InvoiceLineIn[] | null }
export interface InvoiceChange { field: 'title' | 'description' | 'due_date' | 'amount_cents' | 'lines'; from: unknown; to: unknown }

const tidy = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const okYmd = (s: string) => YMD.test(s) && Number.isFinite(Date.parse(s + 'T12:00:00Z')) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s;
export const MAX_INVOICE_CENTS = 100_000_000;
export const MIN_INVOICE_CENTS = 50;

/** The lines as the invoice will store them, or a sentence about what's wrong. Labels 1 to
 *  200 characters, a quantity from 0.25 to 999 in whole numbers, halves or quarters (sales item 185), whole cents (a minus line is allowed: a
 *  discount, "Less deposit"), up to 40 lines, and they must add up to more than nothing. Pure. */
export function cleanLines(raw: unknown): { ok: true; lines: InvoiceLineIn[] } | { ok: false; message: string } {
  if (!Array.isArray(raw)) return { ok: false, message: 'The lines didn’t come through. Try again.' };
  if (raw.length > 40) return { ok: false, message: 'An invoice can have up to 40 lines.' };
  const lines: InvoiceLineIn[] = [];
  for (const l of raw) {
    const label = tidy(l?.label, 200);
    if (!label) return { ok: false, message: 'Every line needs a few words saying what it is for.' };
    const qty = quarterQty(l?.qty ?? 1);
    if (qty === null || qty < 0.25 || qty > 999) return { ok: false, message: `The quantity on “${label}” must be from 0.25 to 999: a whole number, a half or a quarter, like 2, 2.5 or 0.25.` };
    const cents = Math.round(Number(l?.amount_cents));
    if (!Number.isFinite(cents) || Math.abs(cents) > MAX_INVOICE_CENTS) return { ok: false, message: `The amount on “${label}” isn’t a number we can use.` };
    lines.push({ label, qty, amount_cents: cents });
  }
  if (!lines.length) return { ok: false, message: 'Keep at least one line.' };
  return { ok: true, lines };
}

/** What may change on this invoice, and what it changes to. `inv` is the row as stored;
 *  `partsPaidCents` is what has been paid toward it in parts (0 = nothing). Pure.
 *    not open, settling, or a part payment's own row  → refused (bad_state)
 *    amount or lines while something was paid toward it → refused (part_paid)
 *    nothing different                                 → ok with no changes */
export function validateInvoiceEdit(b: any, inv: { status?: unknown; processing_since?: unknown; payment_for?: unknown; title?: unknown; description?: unknown; due_date?: unknown; amount_cents?: unknown; lines?: unknown } | null, partsPaidCents: number, todayYmd: string): { ok: true; patch: Record<string, unknown>; changes: InvoiceChange[] } | { ok: false; error: string; message: string } {
  if (!inv) return { ok: false, error: 'not_found', message: 'That invoice is no longer here.' };
  if (inv.payment_for) return { ok: false, error: 'bad_state', message: 'That’s a payment, not an invoice. Undo it and record it again if it was wrong.' };
  const s = String(inv.status || 'open');
  if (s === 'paid') return { ok: false, error: 'already_paid', message: 'A paid invoice is a record and stays as it is. To correct it, give money back on it or send a new one.' };
  if (s !== 'open') return { ok: false, error: 'bad_state', message: 'This invoice was voided, so there is nothing to change. Send a new one.' };
  if (inv.processing_since) return { ok: false, error: 'processing', message: 'The client has already paid this and the payment is on its way, so it can’t change now.' };
  const patch: Record<string, unknown> = {};
  const changes: InvoiceChange[] = [];
  if (b?.title !== undefined) {
    const title = tidy(b.title, 200);
    if (!title) return { ok: false, error: 'validation', message: 'Give the invoice a title.' };
    if (title !== String(inv.title || '')) { patch.title = title; changes.push({ field: 'title', from: String(inv.title || ''), to: title }); }
  }
  if (b?.description !== undefined) {
    const d = tidy(b.description, 1000);
    if (d !== String(inv.description || '')) { patch.description = d; changes.push({ field: 'description', from: String(inv.description || ''), to: d }); }
  }
  if (b?.due_date !== undefined) {
    const raw = b.due_date === null ? '' : String(b.due_date || '').trim();
    if (raw && !okYmd(raw)) return { ok: false, error: 'validation', message: 'Enter the due date as a day (YYYY-MM-DD), or leave it blank for “on receipt”.' };
    if (raw && todayYmd && raw < '2000-01-01') return { ok: false, error: 'validation', message: 'That due date is too far back.' };
    const was = /^\d{4}-\d{2}-\d{2}/.test(String(inv.due_date || '')) ? String(inv.due_date).slice(0, 10) : '';
    if (raw !== was) { patch.due_date = raw || null; changes.push({ field: 'due_date', from: was || null, to: raw || null }); }
  }
  let lines: InvoiceLineIn[] | null | undefined = undefined;
  if (b?.lines !== undefined) {
    if (b.lines === null) lines = null;
    else { const c = cleanLines(b.lines); if (!c.ok) return { ok: false, error: 'validation', message: c.message }; lines = c.lines; }
  }
  let amount: number | undefined = undefined;
  if (b?.amount_cents !== undefined && b.amount_cents !== null && b.amount_cents !== '') {
    amount = Math.round(Number(b.amount_cents));
    if (!Number.isFinite(amount)) return { ok: false, error: 'validation', message: 'Enter the amount to invoice.' };
  }
  if (lines && lines.length) {
    const sum = lines.reduce((n, l) => n + l.amount_cents, 0);
    if (amount === undefined) amount = sum;
    else if (amount !== sum) return { ok: false, error: 'validation', message: 'The lines don’t add up to the amount. Fix one or the other.' };
  }
  if (amount !== undefined) {
    if (amount < MIN_INVOICE_CENTS) return { ok: false, error: 'validation', message: 'An invoice is at least $0.50.' };
    if (amount > MAX_INVOICE_CENTS) return { ok: false, error: 'validation', message: 'That amount is over $1,000,000. Double-check it and try again.' };
  }
  const was = Math.round(Number(inv.amount_cents) || 0);
  const wasLines = JSON.stringify(Array.isArray(inv.lines) ? inv.lines : null);
  const amountChanges = amount !== undefined && amount !== was;
  const linesChange = lines !== undefined && JSON.stringify(lines) !== wasLines;
  if ((amountChanges || linesChange) && partsPaidCents > 0) return { ok: false, error: 'part_paid', message: 'Something has already been paid toward this invoice, so its amount and lines can’t change. The title, the note and the due date still can.' };
  if (amountChanges) { patch.amount_cents = amount; changes.push({ field: 'amount_cents', from: was, to: amount }); }
  if (linesChange) { patch.lines = lines; changes.push({ field: 'lines', from: Array.isArray(inv.lines) ? inv.lines : null, to: lines }); }
  return { ok: true, patch, changes };
}

/** Each change in words, for the deal's history and the corrected email. Pure. */
export function changeWords(changes: InvoiceChange[], currency = 'usd'): string[] {
  const money = (c: unknown) => '$' + ((Number(c) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  void currency;
  return changes.map((c) => {
    if (c.field === 'title') return `title: “${c.from}” to “${c.to}”`;
    if (c.field === 'description') return c.to ? `note changed` : 'note removed';
    if (c.field === 'due_date') return `due ${c.from ? c.from : 'on receipt'} to ${c.to ? c.to : 'on receipt'}`;
    if (c.field === 'amount_cents') return `amount ${money(c.from)} to ${money(c.to)}`;
    return 'lines changed';
  });
}

export interface MoneyBack { amount_cents: number; on: string; method: PayMethod; note: string }
/** Money given back by hand on a paid invoice (sales item 165): the invoice must be paid by
 *  hand (an online payment is refunded in Stripe, which reaches here by itself), the amount
 *  more than nothing and no more than what is still kept, the day not in the future, one of
 *  the five ways. Pure. */
export function validateMoneyBack(b: any, inv: { status?: unknown; paid_method?: unknown; payment_for?: unknown; amount_cents?: unknown; refunded_cents?: unknown } | null, partsPaidCents: number, todayYmd: string): { ok: true; value: MoneyBack; kept_cents: number } | { ok: false; error: string; message: string } {
  if (!inv) return { ok: false, error: 'not_found', message: 'That invoice is no longer here.' };
  if (inv.payment_for) return { ok: false, error: 'bad_state', message: 'Give money back on the invoice itself, not on a part payment.' };
  if (String(inv.status || '') !== 'paid') return { ok: false, error: 'bad_state', message: 'Only a paid invoice can have money given back.' };
  if (!String(inv.paid_method || '')) return { ok: false, error: 'online', message: 'This was paid online. Refund it in Stripe and the invoice will show it by itself.' };
  const paid = Math.round(Number(inv.amount_cents) || 0) + Math.max(0, Math.round(partsPaidCents) || 0);
  const back = Math.max(0, Math.round(Number(inv.refunded_cents) || 0));
  const kept = paid - back;
  const amount = Math.round(Number(b?.amount_cents));
  const usd = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!Number.isFinite(amount) || amount < 1) return { ok: false, error: 'validation', message: 'Enter the amount you gave back.' };
  if (amount > kept) return { ok: false, error: 'validation', message: kept > 0 ? `That’s more than the ${usd(kept)} still kept from this invoice.` : 'Everything paid on this invoice has already gone back.' };
  const on = String(b?.on || b?.paid_on || todayYmd).trim();
  if (!okYmd(on) || on < '2000-01-01') return { ok: false, error: 'validation', message: 'Enter the day you gave it back.' };
  if (on > todayYmd) return { ok: false, error: 'validation', message: 'The day can’t be in the future.' };
  const method = String(b?.method || '') as PayMethod;
  if (!(PAY_METHODS as readonly string[]).includes(method)) return { ok: false, error: 'validation', message: 'Pick how you gave it back: check, cash, bank transfer, Zelle or other.' };
  return { ok: true, value: { amount_cents: amount, on, method, note: tidy(b?.note, 300) }, kept_cents: kept };
}

/** Which reminder words Remind now uses: overdue → the gentle "still open" nudge, due today →
 *  "due today", not yet due → "coming up". Pure. */
export function remindNowSlot(dueYmd: unknown, todayYmd: string): 'before' | 'due' | 'after' {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(dueYmd || ''));
  if (!m) return 'after';
  return m[1] < todayYmd ? 'after' : m[1] === todayYmd ? 'due' : 'before';
}
