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

export function corsFor(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allow = CORS_ORIGINS.includes(origin) ? origin : CORS_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dds-admin, x-dds-user-jwt',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

// Kept for the email/notification helpers that reference `cors` directly.
// Uses the canonical origin; per-request CORS is applied at the response layer.
export const cors = {
  'Access-Control-Allow-Origin': CORS_ORIGINS[0],
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dds-admin, x-dds-user-jwt',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};
