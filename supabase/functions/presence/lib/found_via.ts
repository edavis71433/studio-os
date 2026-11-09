// ── "How did they find you?" (sales review item 69, Nov 2026) ────────────────
// Salesforce's Lead Source: one pick on a logged enquiry, a deal and a customer.
// Website enquiries are "Website". It is a different question from a deal's
// `source` (how the deal was CREATED: website form, by hand, imported), and the
// Won report shows the two side by side. For a studio betting on local search,
// this is the number that says whether the bet is working.
export const FOUND_VIA = ['Google', 'Referral', 'Word of mouth', 'Social', 'Repeat client', 'Website', 'Other'] as const;

/** One of the picks (matched whatever the case), or '' for anything else. Pure. */
export function normalizeFoundVia(v: unknown): string {
  const t = String(v ?? '').trim().toLowerCase();
  return FOUND_VIA.find((x) => x.toLowerCase() === t) || '';
}
/** What a report or a page says for a stored value. Pure. */
export function foundViaLabel(v: unknown): string { return normalizeFoundVia(v) || 'Not recorded'; }
