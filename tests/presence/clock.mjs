// ── Pin the clock: the one helper every dated suite uses (builder item 421) ───────
//   import { pinClock, PINNED_NOW, daysFrom } from './clock.mjs';
//   const restore = pinClock('2026-11-22T18:00:00Z');   // or pinClock() for PINNED_NOW
//   try { …the dated checks… } finally { restore(); }
//
// Tests tied to today's date broke main three times in November 2026: a fixture dated
// Nov 15 went stale at midnight, a "six days ago" label flipped between 15:00 and 16:00
// UTC, and three suites read the real clock beside code that waits for 9 am Pacific. A
// suite that holds a calendar date and reads the clock must hold the clock still too, so
// its checks mean the same thing on every day it runs. tests/presence/clock_rule_test.mjs
// enforces it: a suite with a date in it reads the clock only through this file.
//
// pinClock swaps the global Date for one whose "now" stands still (new Date(), Date.now()
// and Date() all answer the pinned moment; every other use of Date is unchanged), so the
// code under test sees the same moment without being changed for the test. It returns
// the function that puts the real clock back. withClock runs a function on the pinned
// clock and puts it back even when the function throws.

/** The moment dated suites use unless they need another: a Sunday afternoon, Pacific. */
export const PINNED_NOW = '2026-11-22T18:00:00Z';

const RealDate = globalThis.Date;
let pins = 0;

/** Pins "now" at `at` (an ISO string, a Date or milliseconds). Returns the undo.
 *  With { ticking: true } "now" starts at `at` and moves on with the real clock: for a suite
 *  that waits on Date.now(), where a clock standing still would turn a missed wait into a hang. */
export function pinClock(at = PINNED_NOW, { ticking = false } = {}) {
  const ms = at instanceof RealDate ? at.getTime() : typeof at === 'number' ? at : RealDate.parse(at);
  if (!Number.isFinite(ms)) throw new Error(`pinClock: "${at}" isn't a moment`);
  const started = RealDate.now();
  const now = () => (ticking ? ms + (RealDate.now() - started) : ms);
  const Previous = globalThis.Date;
  class PinnedDate extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(now()); }
    static now() { return now(); }
    // A date made before the pin (or by the real Date) is still a Date to the code under test.
    static [Symbol.hasInstance](x) { return x instanceof RealDate; }
  }
  // Date() called without new gives a string, as the real one does.
  const Pinned = new Proxy(PinnedDate, { apply: () => new RealDate(now()).toString() });
  globalThis.Date = Pinned;
  pins++;
  let undone = false;
  return function restore() {
    if (undone) return;
    undone = true;
    pins--;
    globalThis.Date = Previous;
  };
}

/** Runs fn on a pinned clock; the real clock comes back even if fn throws. */
export async function withClock(at, fn) {
  const restore = pinClock(at);
  try { return await fn(); } finally { restore(); }
}

/** The ISO moment `days` after `from` (negative for before): fixtures say "3 days ago" with this. */
export function daysFrom(from, days) {
  const base = from instanceof RealDate ? from.getTime() : typeof from === 'number' ? from : RealDate.parse(from);
  return new RealDate(base + days * 86_400_000).toISOString();
}

/** True while some suite holds the clock (for the rule test's own checks). */
export const clockPinned = () => pins > 0;
