// ── HTTP response helper ──
// Extracted verbatim from clever-api/index.ts (M1 _shared extraction).
// Not a response envelope: payload shapes are the callers' business and were
// ruled out of normalization scope at M0. One exception since Nov 9 2026
// (builder list item 97, Eric's call): an ERROR reply (status 400 and up) whose
// payload names an `error` code but carries no `message` gets a plain sentence
// for that code, so a page never has to show a code or invent its own words.
// About 290 replies were bare. A caller's own message always wins.
import { cors } from './cors.ts';

/** Plain words for the error codes the functions answer with no sentence of their own. */
export const ERROR_SENTENCES: Record<string, string> = {
  bad_request: 'Something in that request wasn’t right, so nothing changed.',
  bad_json: 'That wasn’t sent in a form the server could read, so nothing changed.',
  not_found: 'We couldn’t find that. It may have been removed, or the link is old.',
  method_not_allowed: 'That isn’t something this address does.',
  write_failed: 'That didn’t save. Nothing was lost; try again in a moment.',
  read_failed: 'We couldn’t read that just now. Try again in a moment.',
  fetch_failed: 'We couldn’t reach that just now. Try again in a moment.',
  empty_update: 'There was nothing to change in that request.',
  forbidden: 'Your sign-in can’t do that here.',
  unauthorized: 'Please sign in and try again.',
  bad_status: 'That isn’t a state this can move to from where it is.',
  conflict: 'That clashed with a change made a moment ago. Load the latest and try again.',
  unavailable: 'That part isn’t switched on for this site yet.',
  rate_limited: 'Too many tries in a short time. Wait a minute and try again.',
  too_large: 'That’s too big for this request.',
};
const FALLBACK_SENTENCE = 'That didn’t go through. Nothing was lost; try again in a moment.';

/** The payload with a sentence added when an error reply has none. Pure; exported for the tests. */
export function withSentence(payload: unknown, status: number): unknown {
  if (status < 400 || !payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const p = payload as Record<string, unknown>;
  if (typeof p.error !== 'string' || typeof p.message === 'string') return payload;
  return { ...p, message: ERROR_SENTENCES[p.error] || FALLBACK_SENTENCE };
}

export function json(payload: unknown, status = 200, corsHeaders: Record<string, string> = cors) {
  return new Response(JSON.stringify(withSentence(payload, status)), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}
