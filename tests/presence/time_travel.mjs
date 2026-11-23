// ── Time travel: the pure suites with the clock moved ahead (builder item 433) ────────
// A suite whose fixed dates meet code that reads the real clock passes the day it lands and
// breaks every pull request on a later day: tick_calls_402 did on Nov 23 2026, 24 hours after
// its fixture, and running the suites 1, 8, 32 and 400 days ahead then found six more. The
// clock rule (clock_rule_test.mjs) can't see that by reading the code, so
// .github/workflows/time-travel.yml runs every pure suite again 32 and 400 days ahead, and a
// suite that fails only there gets its clock pinned (clock.mjs).
//   TIME_TRAVEL_DAYS=32 bash scripts/ci-pure-tests.sh
// scripts/ci-pure-tests.sh preloads this file into every suite when TIME_TRAVEL_DAYS is set.
// new Date(), Date.now() and Date() move; a date made from given numbers or text doesn't.

/** Moves "now" `days` ahead for everything that reads the clock from here on. Returns the undo. */
export function travel(days) {
  const Before = globalThis.Date;
  const shift = days * 86_400_000;
  const now = () => Before.now() + shift;
  globalThis.Date = new Proxy(Before, {
    construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [now()], newTarget),
    apply: () => new Before(now()).toString(),
    get: (target, prop, receiver) => (prop === 'now' ? now : Reflect.get(target, prop, receiver)),
  });
  return () => { globalThis.Date = Before; };
}

const days = Number(Deno.env.get('TIME_TRAVEL_DAYS') || 0);
if (days) travel(days);
