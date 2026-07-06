// ── HTTP response helper ──
// Extracted verbatim from clever-api/index.ts (M1 _shared extraction).
// Deliberately NOT a response envelope: payload shapes are the callers'
// business and were ruled out of normalization scope at M0.
import { cors } from './cors.ts';

export function json(payload: unknown, status = 200, corsHeaders: Record<string, string> = cors) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}
