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

/** Each retainer charge as a payment: { amount_cents, paid_at } per charge. A retainer
 *  charge settles in Stripe and writes only a deal event (`invoice_paid` with
 *  detail.retainer), never an invoice row, so anything that adds up invoices leaves it
 *  out unless it asks for these too: the record's Paid did (item 108, J4) and revenue by
 *  month did (sales item 120, code pass finding 54). Pure. */
export function retainerPayments(events: unknown): Array<{ amount_cents: number; paid_at: string }> {
  const out: Array<{ amount_cents: number; paid_at: string }> = [];
  for (const e of (Array.isArray(events) ? events : []) as any[]) {
    const d = e && typeof e.detail === 'object' && e.detail ? e.detail : null;
    if (!e || e.kind !== 'invoice_paid' || !d || d.retainer !== true) continue;
    const amt = Math.round(Number(d.amount_cents) || 0);
    if (amt <= 0) continue;
    out.push({ amount_cents: amt, paid_at: String(e.created_at || '') });
  }
  return out;
}

/** Retainer payments on a deal, for the record's Paid. Pure. */
export function retainerPaid(events: unknown): { cents: number; count: number; last_at: string | null } {
  let cents = 0, count = 0; let last: string | null = null;
  for (const p of retainerPayments(events)) {
    cents += p.amount_cents; count++;
    if (p.paid_at && (!last || p.paid_at > last)) last = p.paid_at;
  }
  return { cents, count, last_at: last };
}

/** A client's invoice rows with each part payment under the invoice it paid toward (sales
 *  item 120, code pass finding 56). A part payment is its own paid row (`payment_for`, item
 *  77) and the invoice's amount drops by it, so a list of rows showed a second paid
 *  "invoice" beside one that had shrunk. Each invoice with parts gets `parts` (oldest first),
 *  `paid_so_far_cents` and `total_cents` (what is left or was paid last, plus the parts). A
 *  part whose invoice isn't in the list (removed) stays a row of its own, so money paid is
 *  never hidden. Order is kept. Pure. */
export function nestPartPayments<T extends { id?: unknown; payment_for?: unknown; amount_cents?: unknown; paid_at?: unknown }>(list: T[]): Array<T & { parts?: T[]; paid_so_far_cents?: number; total_cents?: number }> {
  const rows = (Array.isArray(list) ? list : []).filter(Boolean);
  const ids = new Set(rows.map((i) => String(i.id)));
  const isPart = (i: T) => !!i.payment_for && String(i.payment_for) !== String(i.id) && ids.has(String(i.payment_for));
  const partsOf = new Map<string, T[]>();
  for (const i of rows) if (isPart(i)) { const k = String(i.payment_for); partsOf.set(k, [...(partsOf.get(k) || []), i]); }
  const cents = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));
  const out: Array<T & { parts?: T[]; paid_so_far_cents?: number; total_cents?: number }> = [];
  for (const i of rows) {
    if (isPart(i)) continue;
    const parts = (partsOf.get(String(i.id)) || []).slice().sort((a, b) => String(a.paid_at || '').localeCompare(String(b.paid_at || '')));
    if (!parts.length) { out.push(i); continue; }
    const paid = parts.reduce((a, p) => a + cents(p.amount_cents), 0);
    out.push({ ...i, parts, paid_so_far_cents: paid, total_cents: cents(i.amount_cents) + paid });
  }
  return out;
}

// ── Sales item 77: a payment that came in outside Stripe ─────────────────────
export const PAY_METHODS = ['check', 'cash', 'bank_transfer', 'zelle', 'other'] as const;
export type PayMethod = typeof PAY_METHODS[number];
export const PAY_METHOD_LABEL: Record<PayMethod, string> = { check: 'Check', cash: 'Cash', bank_transfer: 'Bank transfer', zelle: 'Zelle', other: 'Other' };
export interface RecordedPayment { amount_cents: number; paid_on: string; method: PayMethod; note: string; private_note: string; part: boolean; left_cents: number }
/** Check a payment the studio records by hand against the invoice it pays.
 *  Whole or part: never more than is due, never a day after today (the caller's
 *  day, so a check banked this evening in Los Angeles is "today"), one of the
 *  five ways. The note is printed on the client's receipt ("Check #1042"); the
 *  private note (sales item 118) is the studio's own and never is. Pure. */
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
  const tidy = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  return { ok: true, value: { amount_cents: amount, paid_on: on, method, note: tidy(b?.note), private_note: tidy(b?.private_note), part: amount < due, left_cents: due - amount } };
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
