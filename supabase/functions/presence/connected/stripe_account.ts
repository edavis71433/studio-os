// ── A client's own Stripe: the numbers it shows (sales item 134) ──────────────
// The Nov 15 2026 Stripe review (finding 8) found the first reader of a business's own
// Stripe asking for charges?limit=100: the last hundred charges of any kind and any
// date, failed and refunded ones included, shown as a payment count, and a `total`
// Stripe never sends, so revenue was always blank. Before a client can connect their
// own Stripe, it reads the right numbers:
//   payments   charges that went through in the last 30 days (not failed, not just held)
//   revenue    what those took, less what was refunded of them
//   paid_out   what Stripe sent to the business's bank in those days, and how many payouts
// Money is in the currency most of the payments were in; any in other currencies are
// counted apart, never added in. Pure: connected/adapters.ts readStripeAccount reads.

export const STRIPE_WINDOW_DAYS = 30;

// Stripe sends amounts in the smallest unit; these currencies have none below the unit
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);
/** An amount from Stripe in the currency's own units (cents → dollars). Pure. */
export const majorUnits = (minor: number, currency: string): number =>
  ZERO_DECIMAL.has(String(currency).toLowerCase()) ? minor : Math.round(minor) / 100;

export interface StripeAccountNumbers {
  payments: number; revenue: number; refunded: number;
  paid_out: number; payouts: number;
  currency: string; window_days: number;
  other_currency_payments: number;   // went through, but in another currency, so not in the money above
}

const n = (v: unknown) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? x : 0; };
const cur = (v: unknown) => String(v || '').toLowerCase();

/** The numbers from the charges and payouts Stripe listed. `nowSec` is unix seconds. Pure. */
export function stripeAccountNumbers(charges: unknown, payouts: unknown, nowSec: number, days = STRIPE_WINDOW_DAYS): StripeAccountNumbers {
  const since = nowSec - days * 86400;
  // went through: succeeded and paid, and not merely held on the card (captured false)
  const paid = ((Array.isArray(charges) ? charges : []) as any[]).filter((c) =>
    c && c.status === 'succeeded' && c.paid !== false && c.captured !== false && n(c.created) >= since && n(c.created) <= nowSec);
  const byCurrency = new Map<string, { count: number; gross: number }>();
  for (const c of paid) {
    const k = cur(c.currency); const g = byCurrency.get(k) || { count: 0, gross: 0 };
    g.count++; g.gross += n(c.amount_captured ?? c.amount); byCurrency.set(k, g);
  }
  const main = [...byCurrency.entries()].sort((a, b) => b[1].count - a[1].count || b[1].gross - a[1].gross)[0]?.[0] || 'usd';
  let gross = 0, refunded = 0, count = 0;
  for (const c of paid) {
    if (cur(c.currency) !== main) continue;
    count++; gross += n(c.amount_captured ?? c.amount); refunded += Math.max(0, n(c.amount_refunded));
  }
  // what reached the bank: payouts that arrived in these days (one still on its way hasn't)
  let outCents = 0, outs = 0;
  for (const p of (Array.isArray(payouts) ? payouts : []) as any[]) {
    if (!p || p.status !== 'paid' || cur(p.currency) !== main) continue;
    const at = n(p.arrival_date);
    if (at < since || at > nowSec) continue;
    outCents += n(p.amount); outs++;
  }
  return {
    payments: count, revenue: majorUnits(gross - refunded, main), refunded: majorUnits(refunded, main),
    paid_out: majorUnits(outCents, main), payouts: outs,
    currency: main, window_days: days, other_currency_payments: paid.length - count,
  };
}
