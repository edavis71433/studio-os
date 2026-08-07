// ── Contract / proposal placeholders — the pure filler ───────────────────────
// A saved template may carry {{tokens}} that get filled from the deal when a
// document is drafted from it. This module is the PURE half: given the deal, its
// contact and the studio's name, it produces the value for every token and
// substitutes them. No DB, no network, no clock — routes/sales.ts does the two
// reads and passes the data in, so the wording and (much more importantly) the
// DEGRADATION rules are unit-testable.
//
// The degradation rules are the whole point. Whatever a client eventually reads
// and signs must never contain a literal {{token}}, and must never contain a
// number we invented. So a missing amount becomes an obvious bracketed
// fill-me-in — "[project fee]" — rather than "$0", which would be a lie about
// the price. A missing name falls back through company → name → "the client".

export interface PlaceholderInput {
  deal: { title?: string | null; expected_value_cents?: number | null } | null;
  contact: { name?: string | null; company?: string | null } | null;
  studioName?: string | null;
  now?: Date;
}

/** Every token this module fills. Kept beside the builder so a test can prove
 *  the two never drift, and so a caller can document what a template may use. */
export const PLACEHOLDER_TOKENS = [
  'client_name', 'client_company', 'deal_title', 'deal_value',
  'deposit_amount', 'balance_amount', 'today', 'studio_name',
] as const;

/** The studio's legal name — the last-resort fallback when presence_identity
 *  carries no business_name for the site. */
export const STUDIO_NAME_FALLBACK = 'Davis Digital Studio';

/** Money exactly as the app's money0() renders it: no cents when the amount is
 *  whole, two decimals when it isn't. `forceCents` pins the two-decimal form so
 *  a set of related figures agrees with itself. Pure. */
export function formatMoney(cents: number, forceCents = false): string {
  const v = cents / 100;
  return '$' + v.toLocaleString('en-US', (!forceCents && Number.isInteger(v))
    ? { minimumFractionDigits: 0 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Long-form US date, e.g. "August 7, 2026". Pure (the date is passed in). */
export function formatLongDate(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** The value for every placeholder, with honest fallbacks for missing data. Pure. */
export function buildPlaceholderValues(input: PlaceholderInput): Record<string, string> {
  const deal = input.deal || {};
  const contact = input.contact || null;
  const name = String(contact?.name || '').trim();
  const company = String(contact?.company || '').trim();
  const cents = Math.trunc(Number(deal.expected_value_cents)) || 0;
  // A 0/absent value must NOT print as "$0" in something a client signs — say
  // plainly that the number still has to be filled in.
  const hasValue = cents > 0;
  const deposit = Math.round(cents / 2);          // §2: 50% to begin, 50% before launch
  const balance = cents - deposit;                // the split never loses a cent
  // The three figures appear in ONE sentence of the agreement, so they must agree
  // with each other: an odd total ($1,000.01) would otherwise read
  // "$500.01 + $500", which looks like a typo in a document someone signs.
  const withCents = [cents, deposit, balance].some((c) => c % 100 !== 0);
  return {
    client_name: name || 'the client',
    client_company: company || name || 'the client',
    deal_title: String(deal.title || '').trim() || 'the project',
    deal_value: hasValue ? formatMoney(cents, withCents) : '[project fee]',
    deposit_amount: hasValue ? formatMoney(deposit, withCents) : '[50% deposit]',
    balance_amount: hasValue ? formatMoney(balance, withCents) : '[50% balance]',
    today: formatLongDate(input.now || new Date()),
    studio_name: String(input.studioName || '').trim() || STUDIO_NAME_FALLBACK,
  };
}

/** Replace every known {{token}} (whitespace inside the braces tolerated) with
 *  its value. An UNKNOWN token is left untouched — silently blanking something
 *  the operator typed would hide their own mistake from them. Pure. */
export function applyPlaceholders(text: string | null | undefined, values: Record<string, string>): string {
  let out = String(text ?? '');
  for (const token of Object.keys(values)) {
    const re = new RegExp(`\\{\\{\\s*${token}\\s*\\}\\}`, 'g');
    // a function replacement so a '$' inside the value is never read as $&/$1
    out = out.replace(re, () => values[token]);
  }
  return out;
}
