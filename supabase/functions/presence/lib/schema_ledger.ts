// ── Which database changes this code needs (builder list item 420) ──────────────
// Database changes reach production by hand, from an apply pack. From migration 0260 on,
// each one writes its number into presence_change_ledger when it runs, so the database
// can say which it has. This is the other half: the newest change THIS code was written
// with, which is the newest file in supabase/migrations. The health answer and the Health
// page compare the two, and the release refuses to go out while production's ledger
// doesn't have it (deploy.yml, "Database changes are in place").
//
// Adding a migration? Raise this number to the migration's own number in the same pull
// request; tests/presence/change_ledger_420_test.mjs fails until it is at least the newest
// file, and until the migration and its apply pack both end by writing their number down.
// It may name a change whose file is still in another pull request when that change is
// already on production and in APPLY-0260's backfill list: 0265 to 0267 ran before the
// ledger existed (Nov 22 2026).

export const CODE_NEWEST_CHANGE = 270;

/** The Health page's "Database changes" area, from the ledger's newest number. Pure. */
export function changesArea(newest: number | null | undefined, expected = CODE_NEWEST_CHANGE): { state: 'ok' | 'attention' | 'off'; detail: string } {
  const pad = (n: number) => String(n).padStart(4, '0');
  if (newest === null || newest === undefined) {
    return { state: 'attention', detail: `This database doesn't say which changes it has yet. Run APPLY-0260 (the ledger) and every pack after it, in order.` };
  }
  if (newest < expected) {
    return { state: 'attention', detail: `The newest database change here is ${pad(newest)}; this code needs ${pad(expected)}. Run the apply packs after ${pad(newest)}, in order, then release.` };
  }
  if (newest > expected) {
    return { state: 'ok', detail: `The newest database change here is ${pad(newest)}, ahead of this code's ${pad(expected)}: a change went in before its release.` };
  }
  return { state: 'ok', detail: `Every database change this code needs is in, up to ${pad(newest)}.` };
}
