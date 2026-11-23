// ── CORS: allowlist real origins instead of '*' ──
// Extracted verbatim from clever-api/index.ts (M1 _shared extraction).
// Config-only variance (Build Brief 2.8): the allowlist comes from the
// ALLOWED_ORIGINS env var (comma-separated) so staging can add its Netlify
// preview/staging origin WITHOUT a code edit. If the var is unset we fall back
// to the two production origins, so production behavior is byte-identical to
// before this change. Example staging value:
//   ALLOWED_ORIGINS=https://staging--studio-os.netlify.app,https://davisdigitalstudio.com
const DEFAULT_ORIGINS = [
  'https://davisdigitalstudio.com',
  'https://www.davisdigitalstudio.com',
];
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '')
  .split(',').map((o) => o.trim()).filter(Boolean);
export const CORS_ORIGINS = ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : DEFAULT_ORIGINS;

// Speed (Nov 10 2026): the app and this server are on different addresses, so the
// browser asks "may I?" (a preflight OPTIONS) before each call. With no max-age the
// browser keeps that answer for 5 seconds, so nearly every call was made twice.
// 24 hours here; browsers cap it lower themselves (Chrome 2 hours, Safari 10 minutes).
// It only matters on the OPTIONS answer and is ignored on the others.
export const PREFLIGHT_MAX_AGE = '86400';

// Speed (Nov 15 2026): the database lives in Oregon (us-west-2), but Supabase runs this
// code in the region nearest the visitor, so from the east coast each of the dozen small
// database calls behind one answer crossed the country: about 1 s an answer, 0.4 s when
// run beside the database. A page asks for that with the x-region header (Supabase's
// regional invocation), and the browser may only send a header this list allows.
// An address setting (?forceFunctionRegion=) would need no change here, but it alters
// every address the pages call. Allowing a header grants nothing by itself.
// Builder item 397 (review file 07, finding 20): the operator's and the scheduler's secret
// headers (x-operator-secret, x-system-secret) and the old admin header (x-dds-admin, whose
// check was deleted) are no longer on the list. No page sends them, and only a browser asks
// this list: the watchdog and the jobs call server to server, so a browser that holds either
// secret now can't use it from a page.
const ALLOWED_HEADERS = 'authorization, x-client-info, apikey, content-type, x-dds-user-jwt, x-dds-scope-site, if-match, x-region, x-dds-preview';   // builder list item 232: a studio's preview of a client's portal (read-only, refused writes)

export function corsFor(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allow = CORS_ORIGINS.includes(origin) ? origin : CORS_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    // PUT/PATCH/DELETE are not CORS-safelisted; the presence REST routes (M7)
    // need them listed or every browser preflight fails. Additive for the
    // POST-only monolith (extra names in this header grant nothing by themselves).
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': PREFLIGHT_MAX_AGE,
    'Vary': 'Origin',
  };
}

// Builder list item 131: a client's published site lives at its own address (its
// domain, or its netlify.app name), so the routes its visitors call from the page (a
// form, booking) answer any origin. On the list above, every one of those calls was
// refused by the browser: booking couldn't load on any client site. These routes
// answer to anyone already (a plain form post needs no permission), carry no sign-in,
// and say nothing a stranger couldn't learn by posting, so "*" opens nothing new.
export function visitorCors(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type, accept',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': PREFLIGHT_MAX_AGE,
  };
}

// Kept for the email/notification helpers that reference `cors` directly.
// Uses the canonical origin; per-request CORS is applied at the response layer.
export const cors = {
  'Access-Control-Allow-Origin': CORS_ORIGINS[0],
  'Access-Control-Allow-Headers': ALLOWED_HEADERS,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': PREFLIGHT_MAX_AGE,
  'Vary': 'Origin',
};
