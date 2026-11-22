import type { Page } from '@playwright/test';

// ── Pin the page's clock: the one helper every dated spec uses (builder item 421) ──
//   await pinClock(page);                          // PINNED_NOW, held still
//   await pinClock(page, '2026-11-15T18:00:00Z');  // another moment
//   await pinClock(page, at, { ticking: true });   // starts at `at` and runs on (timers fire)
//
// Tests tied to today's date broke main three times in November 2026: a fixture dated
// Nov 15 went stale at midnight, a "six days ago" day label flipped between 15:00 and 16:00
// UTC, and a sales fixture went past its date. A spec that holds a calendar date must hold
// the page's clock too, so it means the same thing on every day it runs. Call it before
// page.goto. tests/presence/clock_rule_test.mjs checks that specs set the clock only
// through here. The suite's browsers run in UTC (playwright.config.ts).

/** The moment dated specs use unless they need another: a Sunday afternoon, Pacific. */
export const PINNED_NOW = '2026-11-22T18:00:00Z';

export async function pinClock(page: Page, at: string | number | Date = PINNED_NOW, opts: { ticking?: boolean } = {}): Promise<void> {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) throw new Error(`pinClock: "${String(at)}" isn't a moment`);
  if (opts.ticking) await page.clock.install({ time: when });
  else await page.clock.setFixedTime(when);
}

/** The ISO moment `days` after `from` (negative for before): fixtures say "3 days ago" with this. */
export function daysFrom(from: string | number | Date, days: number): string {
  return new Date(new Date(from).getTime() + days * 86_400_000).toISOString();
}
