// ── Auto-expiring content — per-item show-from / show-until window ────────────
// A calm, opt-in scheduling window an owner can put on any home-page section: a
// holiday-hours notice, a limited-time special, a seasonal banner, an event post.
// The owner sets "show from → until" once and the section auto-appears and
// auto-retires — no manual publish at the boundary.
//
// This module is PURE (no I/O, no clock, no randomness): it validates/normalizes
// a window and answers "is this visible at instant T?". The render engine filters
// sections against snapshot.created_at (the deterministic publish clock — the exact
// same posture as the announcement bar's expiry, generalized to every block), and
// the boundary-republish sweep (ops/scheduler.ts) uses visibilityChanged to detect
// when a live site has a section crossing a boundary and needs re-emitting.
//
// Semantics (the ONE definition of "showing now"): from ≤ now < until.
//   • open-ended is allowed (only-from, or only-until, or neither = always show)
//   • an incoherent window (from > until) is REJECTED → treated as hidden (fail
//     safe: a fat-fingered schedule shows nothing rather than showing forever)
// Comparison is plain lexicographic string compare — safe because every bound is
// normalized here to a canonical UTC ISO instant, and snapshot.created_at is too.

export interface ContentWindow { show_from?: string; show_until?: string }

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Accept a date, or a date+time with optional seconds/millis and optional zone.
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/;

/** A plausible calendar date (rejects 2026-13-40). Pure. */
function plausibleDate(y: number, mo: number, d: number): boolean {
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 1970 && y <= 9999;
}

/** Normalize an owner-entered date/datetime to a canonical UTC ISO instant, or
 *  undefined when it isn't a usable date. Date-only inputs snap to a day boundary:
 *  a `from` date → that day's START (00:00:00.000Z); an `until` date → that day's
 *  END (23:59:59.999Z), so "show until Jul 14" keeps the section up THROUGH the
 *  14th (inclusive-day), which is what an owner picking a date means. Full
 *  datetimes are converted to their UTC instant. Pure. */
export function normalizeWindowBound(raw: unknown, edge: 'from' | 'until'): string | undefined {
  const v = String(raw ?? '').trim();
  if (!v) return undefined;
  const dm = DATE_RE.exec(v);
  if (dm) {
    if (!plausibleDate(Number(dm[1]), Number(dm[2]), Number(dm[3]))) return undefined;
    return edge === 'until' ? `${v}T23:59:59.999Z` : `${v}T00:00:00.000Z`;
  }
  if (DATETIME_RE.test(v)) {
    const t = Date.parse(v);
    if (Number.isNaN(t)) return undefined;
    return new Date(t).toISOString();
  }
  return undefined;
}

/** Parse a raw object's window fields → a normalized ContentWindow, or undefined
 *  when neither bound is usable (so a section with no/blank window carries NO
 *  window keys and renders byte-identically to before this feature). Pure. */
export function parseWindow(raw: unknown): ContentWindow | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const from = normalizeWindowBound((raw as any).show_from, 'from');
  const until = normalizeWindowBound((raw as any).show_until, 'until');
  const out: ContentWindow = {};
  if (from) out.show_from = from;
  if (until) out.show_until = until;
  return (out.show_from || out.show_until) ? out : undefined;
}

/** Is this item visible at instant `nowIso`?  from ≤ now < until (open-ended
 *  allowed; from > until rejected → hidden). `nowIso` and the item's bounds must
 *  be canonical ISO instants (parseWindow guarantees the bounds). Pure. */
export function isVisibleNow(item: { show_from?: string | null; show_until?: string | null } | null | undefined, nowIso: string): boolean {
  if (!item) return true;
  const from = item.show_from || undefined;
  const until = item.show_until || undefined;
  if (from && until && from > until) return false;   // incoherent → hidden (fail safe)
  if (from && nowIso < from) return false;            // not yet
  if (until && nowIso >= until) return false;          // expired (until is exclusive)
  return true;
}

/** Does the item's visibility differ between two instants? (True only when a
 *  show_from/show_until boundary lies between them.) Pure. */
export function visibilityChanged(item: { show_from?: string | null; show_until?: string | null }, aIso: string, bIso: string): boolean {
  return isVisibleNow(item, aIso) !== isVisibleNow(item, bIso);
}

/** Does any windowed section in a live snapshot's block list flip visibility
 *  between the time the live bytes were rendered (`liveIso`) and now (`nowIso`)?
 *  When true, the live site is stale and the boundary-republish sweep re-emits it.
 *  Ignores sections without a window (they never flip). Pure. */
export function blocksNeedRewindow(blocks: unknown, liveIso: string, nowIso: string): boolean {
  if (!Array.isArray(blocks)) return false;
  return blocks.some((b) => b && typeof b === 'object'
    && ((b as any).show_from || (b as any).show_until)
    && visibilityChanged(b as any, liveIso, nowIso));
}
