// ── Native reviews / reputation loop — pure cores (Phase RV / MVP) ───────────
// THE MOAT: a small business collects REAL customer reviews on its own site —
// propose-then-approve (never shown until the owner approves), structured + safe
// (a public submission exactly like a form/booking submit — honeypot + rate-limit
// + validation + escaping live in the route), calm. Native: the GBP/Yelp/Trustpilot
// connectors stay dormant; a native collect + display is the MVP.
//
// This module is PURE (no I/O, no clock, no randomness): the public-submit
// validator (mirrors lib/commercial.validateSubmission + lib/booking.validateBookingInput),
// the HONEST aggregate-rating math (only approved rows, real counts — never
// fabricated), and the display shaping. The route (routes/reviews.ts) adds the DB,
// the honeypot/rate-limit/ip_hash, the request email, the CRM contact, and the owner
// notice — reusing the ONE of each (no parallel systems). The serializer bakes the
// approved rows + aggregate into the reviews_wall block so the render (pure) can emit
// the visible reviews + the correct schema.org (AggregateRating + Review) JSON-LD.
//
// DEFERRED (reserved, NOT half-built): importing reviews from Google/Yelp/Trustpilot
// (the connectors exist but stay dormant for MVP), photo/media in a review, verified-
// purchase badges, review reminders via the sweep. None are stubbed here.

// ── caps (bounded, never unbounded) ──────────────────────────────────────────
const CAP = { name: 120, body: 2000, email: 200, reply: 1000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const RATING_MIN = 1;
export const RATING_MAX = 5;
const MIN_BODY = 3;

/** Control-char-stripped, whitespace-collapsed, length-capped string (mirrors the
 *  booking/commercial `s` sanitizer). HTML-escaping happens at the render/email
 *  boundary via esc(); this only sanitizes control chars + caps length so nothing
 *  unbounded/raw ever reaches storage. */
const s = (x: unknown, n: number): string => {
  let o = ''; for (const ch of String(x ?? '')) { const c = ch.codePointAt(0)!; o += (c < 0x20 || c === 0x7f) ? ' ' : ch; }
  return o.replace(/\s+/g, ' ').trim().slice(0, n);
};

// ═════════ validateReviewInput — the runtime gate for a public review ═════════
// Mirrors lib/commercial.validateSubmission / lib/booking.validateBookingInput:
// bounds the rating to [1,5], requires a name + a real written review, sanitizes +
// caps every field, and validates an optional email. The honeypot + rate-limit +
// ip_hash stay in the route (impure). Returns a cleaned, storage-safe review.
export interface CleanReview { rating: number; name: string; body: string; email: string }
export function validateReviewInput(body: any):
  { ok: true; review: CleanReview } | { ok: false; error: string } {
  const rating = Math.trunc(Number(body?.rating));
  if (!Number.isFinite(rating) || rating < RATING_MIN || rating > RATING_MAX) return { ok: false, error: 'bad_rating' };
  const name = s(body?.name ?? body?.reviewer_name, CAP.name);
  if (!name) return { ok: false, error: 'need_name' };
  const reviewBody = s(body?.body ?? body?.review ?? body?.message, CAP.body);
  if (reviewBody.length < MIN_BODY) return { ok: false, error: 'need_body' };
  const email = s(body?.email ?? body?.reviewer_email, CAP.email).toLowerCase();
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: 'bad_email' };
  return { ok: true, review: { rating, name, body: reviewBody, email } };
}

/** Sanitize an owner's optional public reply (same posture; caps at CAP.reply). */
export function cleanOwnerReply(x: unknown): string { return s(x, CAP.reply); }

// ═════════ aggregateApproved — the HONEST rating summary ═════════
// The rich-results SEO win depends on this being TRUE: count = number of approved
// reviews with a valid 1–5 rating; average = their mean, rounded to one decimal.
// Never fabricated, never counts pending/hidden rows. Zero approved → {0, 0}.
export interface ReviewAggregate { count: number; average: number }
export function aggregateApproved(reviews: ReadonlyArray<{ rating: number; status?: string }>): ReviewAggregate {
  const valid = reviews.filter((r) =>
    (r.status === undefined || r.status === 'approved') &&
    Number.isFinite(r.rating) && r.rating >= RATING_MIN && r.rating <= RATING_MAX);
  const count = valid.length;
  if (count === 0) return { count: 0, average: 0 };
  const sum = valid.reduce((acc, r) => acc + r.rating, 0);
  return { count, average: Math.round((sum / count) * 10) / 10 };
}

// ═════════ shapeReviewsForDisplay — DB rows → render-ready items (approved only) ═══
// Pure: filters to approved + valid, orders newest first (stable), caps to `max`,
// and shapes each into the render-facing item. `date` (if present) is passed straight
// through for datePublished in the Review JSON-LD.
export interface DisplayReview { author: string; rating: number; body: string; reply?: string; date?: string }
export interface ReviewRow {
  reviewer_name?: string; rating?: number; body?: string; status?: string;
  owner_reply?: string; approved_at?: string | null; created_at?: string | null;
}
export function shapeReviewsForDisplay(rows: ReadonlyArray<ReviewRow>, max = 24): DisplayReview[] {
  const approved = rows.filter((r) =>
    r.status === 'approved' &&
    Number.isFinite(Number(r.rating)) && Number(r.rating) >= RATING_MIN && Number(r.rating) <= RATING_MAX &&
    s(r.body, CAP.body).length >= MIN_BODY);
  approved.sort((a, b) => String(b.approved_at || b.created_at || '').localeCompare(String(a.approved_at || a.created_at || '')));
  const limit = Math.min(Math.max(1, Math.trunc(max) || 24), 50);
  return approved.slice(0, limit).map((r) => {
    const item: DisplayReview = { author: s(r.reviewer_name, CAP.name) || 'A customer', rating: Math.trunc(Number(r.rating)), body: s(r.body, CAP.body) };
    const reply = s(r.owner_reply, CAP.reply); if (reply) item.reply = reply;
    const date = String(r.approved_at || r.created_at || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) item.date = date;
    return item;
  });
}

// ═════════ star display helper (pure; used by render + email) ═════════
/** "★★★★☆" for a rating (bounded 0–5). Rounds to the nearest whole star. */
export function starString(rating: number): string {
  const full = Math.min(RATING_MAX, Math.max(0, Math.round(Number(rating) || 0)));
  return '★'.repeat(full) + '☆'.repeat(RATING_MAX - full);
}

/** "4.8 out of 5" / "4.8 out of 5 · 23 reviews" (honest; pure). */
export function aggregateText(agg: ReviewAggregate): string {
  if (!agg.count) return '';
  const avg = agg.average % 1 === 0 ? String(agg.average) : agg.average.toFixed(1);
  return `${avg} out of 5 · ${agg.count} review${agg.count === 1 ? '' : 's'}`;
}
