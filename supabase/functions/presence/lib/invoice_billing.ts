// ── Invoice billing rules the record and the deal page share (sales items 107, 108) ──
// Pure: no I/O, no clock beyond what the caller passes. routes/sales.ts reads
// the rows and asks these; tests/presence/invoice_billing_test.mjs pins them.

/** What the accepted proposal still has to bill: its total, less every invoice
 *  already raised on the deal (open or paid, any purpose: a deposit is part of
 *  the price). Voided, removed and recurring ones don't count; a recurring
 *  invoice is a separate bill on a schedule, never a piece of the proposal.
 *  Item 107 (J2): "+ Invoice" left blank bills THIS, not the whole total again. */
export function leftToBill(proposalTotalCents: unknown, invoices: unknown): { total_cents: number; billed_cents: number; left_cents: number } {
  const total = Math.max(0, Math.round(Number(proposalTotalCents) || 0));
  let billed = 0;
  for (const i of (Array.isArray(invoices) ? invoices : []) as any[]) {
    if (!i || i.deleted_at || i.recurring_id) continue;
    const s = String(i.status || 'open');
    if (s !== 'open' && s !== 'paid') continue;
    billed += Math.max(0, Math.round(Number(i.amount_cents) || 0));
  }
  return { total_cents: total, billed_cents: billed, left_cents: Math.max(0, total - billed) };
}

/** When "+ Invoice" finds an OPEN invoice of the same kind on the deal, what
 *  happens — the old rule re-sent it whatever the page asked for:
 *    mismatch    a different amount (typed, or what's left of the proposal):
 *                never send the old amount; let the operator choose
 *    repair      same amount, never sent (its payment link failed): finish it
 *    double_tap  same amount, sent under two minutes ago: no second email
 *    ask         same amount, already sent: re-sending it is the operator's
 *                call, never an unasked side effect of "+ Invoice" (J2)
 *  Pure. */
export type ReuseDecision = 'mismatch' | 'repair' | 'double_tap' | 'ask';
export const DOUBLE_TAP_MS = 120_000;
export function reuseDecision(open: { amount_cents?: unknown; stripe_url?: unknown; updated_at?: unknown; created_at?: unknown }, wantCents: number, nowMs: number): ReuseDecision {
  if (Math.round(Number(open?.amount_cents) || 0) !== Math.round(Number(wantCents) || 0)) return 'mismatch';
  if (!open?.stripe_url) return 'repair';
  const lastTouch = Date.parse(String(open?.updated_at || open?.created_at || '')) || 0;
  return (nowMs - lastTouch) < DOUBLE_TAP_MS ? 'double_tap' : 'ask';
}

/** Retainer payments on a deal. A retainer charge settles in Stripe and writes
 *  only a deal event (`invoice_paid` with detail.retainer), never an invoice row,
 *  so the record's Paid left it out (item 108, J4). Pure. */
export function retainerPaid(events: unknown): { cents: number; count: number; last_at: string | null } {
  let cents = 0, count = 0; let last: string | null = null;
  for (const e of (Array.isArray(events) ? events : []) as any[]) {
    const d = e && typeof e.detail === 'object' && e.detail ? e.detail : null;
    if (!e || e.kind !== 'invoice_paid' || !d || d.retainer !== true) continue;
    const amt = Math.round(Number(d.amount_cents) || 0);
    if (amt <= 0) continue;
    cents += amt; count++;
    const at = String(e.created_at || '');
    if (at && (!last || at > last)) last = at;
  }
  return { cents, count, last_at: last };
}

// ── Sales item 77: a payment that came in outside Stripe ─────────────────────
export const PAY_METHODS = ['check', 'cash', 'bank_transfer', 'zelle', 'other'] as const;
export type PayMethod = typeof PAY_METHODS[number];
export const PAY_METHOD_LABEL: Record<PayMethod, string> = { check: 'Check', cash: 'Cash', bank_transfer: 'Bank transfer', zelle: 'Zelle', other: 'Other' };
export interface RecordedPayment { amount_cents: number; paid_on: string; method: PayMethod; note: string; part: boolean; left_cents: number }
/** Check a payment the studio records by hand against the invoice it pays.
 *  Whole or part: never more than is due, never a day after today (the caller's
 *  day, so a check banked this evening in Los Angeles is "today"), one of the
 *  five ways. The note is the studio's own words ("Check #1042"). Pure. */
export function validatePayment(b: any, inv: { status?: unknown; amount_cents?: unknown; processing_since?: unknown; payment_for?: unknown } | null, todayYmd: string): { ok: true; value: RecordedPayment } | { ok: false; error: string; message: string } {
  if (!inv) return { ok: false, error: 'not_found', message: 'That invoice is no longer here.' };
  if (inv.payment_for) return { ok: false, error: 'bad_state', message: 'That’s a payment, not an invoice.' };
  if (inv.status === 'paid') return { ok: false, error: 'already_paid', message: 'This invoice is already paid.' };
  if (inv.status !== 'open') return { ok: false, error: 'bad_state', message: 'This invoice was voided, so it can’t take a payment.' };
  if (inv.processing_since) return { ok: false, error: 'processing', message: 'The client already paid this online, and the payment is on its way. Nothing to record.' };
  const due = Math.round(Number(inv.amount_cents) || 0);
  const raw = b?.amount_cents;
  const amount = raw === undefined || raw === null || raw === '' ? due : Math.round(Number(raw));
  if (!Number.isFinite(amount) || amount < 1) return { ok: false, error: 'validation', message: 'Enter the amount you received.' };
  if (amount > due) return { ok: false, error: 'more_than_due', message: `That’s more than the ${'$' + (due / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} due on this invoice. Record what’s due here.` };
  const on = String(b?.paid_on || todayYmd).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || !Number.isFinite(Date.parse(on + 'T12:00:00Z')) || on < '2000-01-01') return { ok: false, error: 'validation', message: 'Enter the day you were paid.' };
  if (on > todayYmd) return { ok: false, error: 'validation', message: 'The day you were paid can’t be in the future.' };
  const method = String(b?.method || '') as PayMethod;
  if (!(PAY_METHODS as readonly string[]).includes(method)) return { ok: false, error: 'validation', message: 'Pick how they paid: check, cash, bank transfer, Zelle or other.' };
  const note = String(b?.note ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  return { ok: true, value: { amount_cents: amount, paid_on: on, method, note, part: amount < due, left_cents: due - amount } };
}
/** The moment a recorded day is stored as: its noon in UTC, which is that same
 *  day from Hawaii to New Zealand, so the money reports file it on the right day. Pure. */
export const paidAtOf = (ymd: string) => `${ymd}T12:00:00.000Z`;

/** Sales item 81: the lines an invoice billed from the accepted proposal carries —
 *  the proposal's own lines, its discount and tax, then everything already billed
 *  on the deal coming off ("Less deposit #0012"), so the lines add up to exactly
 *  what this invoice asks for. Items with no quantity are left out. Pure. */
export function linesFromProposal(
  items: Array<{ label: string; qty: number; unit_cents: number }>,
  totals: { discount_cents: number; tax_cents: number },
  meta: { discount?: { mode: string; value: number } | null; tax_pct?: number | null },
  billed: Array<{ label: string; amount_cents: number }>,
): Array<{ label: string; qty: number; amount_cents: number }> {
  const out: Array<{ label: string; qty: number; amount_cents: number }> = [];
  for (const i of items || []) {
    const qty = Math.max(0, Math.trunc(Number(i.qty) || 0));
    if (!qty) continue;
    out.push({ label: String(i.label || '').slice(0, 200), qty, amount_cents: qty * Math.max(0, Math.trunc(Number(i.unit_cents) || 0)) });
  }
  if (totals.discount_cents > 0) out.push({ label: meta?.discount?.mode === 'percent' ? `Discount (${Number(meta.discount.value)}%)` : 'Discount', qty: 1, amount_cents: -totals.discount_cents });
  if (totals.tax_cents > 0) out.push({ label: meta?.tax_pct != null ? `Tax (${Number(meta.tax_pct)}%)` : 'Tax', qty: 1, amount_cents: totals.tax_cents });
  for (const b of billed || []) if (b.amount_cents > 0) out.push({ label: `Less ${b.label}`, qty: 1, amount_cents: -b.amount_cents });
  return out;
}
