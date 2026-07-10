// ── Signed preview links (Presence CMS Phase 1, M8) ──────────────────────────
// A stateless, time-limited, cryptographically-signed share token for the public
// preview. Same authorization model as the one-tap approval links (HMAC-SHA256
// over a base64url payload; verify is timing-safe and FAILS CLOSED on a bad
// signature, tampered payload, or expiry) — not a second auth system. The token
// carries the site id, so a link can only ever reach its own site's preview;
// there is no ambient authority and nothing outside the preview scope is exposed.
//
// It reuses the existing pinned preview snapshot (presence_site_preview): a link
// is a signed, expiring pointer to "this site's current preview", exactly like
// the opaque /p/:token — it just also expires. No new snapshot, no DB column.

import { hmacHex, timingSafeEqual } from '../../_shared/hmac.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PreviewLinkPayload { site_id: string; exp: number; scope: 'preview'; }

/** Resolve the signing secret from existing config — no NEW required secret.
 *  Fail-closed: null when none is set (minting + verifying both refuse). */
export function previewLinkSecret(): string | null {
  return Deno.env.get('PREVIEW_LINK_SECRET')
    || Deno.env.get('APPROVAL_SECRET')
    || Deno.env.get('STATE_SIGNING_SECRET')
    || Deno.env.get('SCHEDULER_SECRET')
    || null;
}

export const PREVIEW_LINK_DEFAULT_TTL_S = 24 * 3600;   // 24h
export const PREVIEW_LINK_MAX_TTL_S = 7 * 24 * 3600;   // 7 days ceiling
export const PREVIEW_LINK_MIN_TTL_S = 60;              // 1 min floor
/** Clamp a requested TTL into [min, max]; non-finite/absent → the default. Pure. */
export function clampTtlSeconds(ttl: unknown): number {
  const n = Number(ttl);
  if (!Number.isFinite(n) || n <= 0) return PREVIEW_LINK_DEFAULT_TTL_S;
  return Math.min(PREVIEW_LINK_MAX_TTL_S, Math.max(PREVIEW_LINK_MIN_TTL_S, Math.floor(n)));
}

// base64url over ASCII JSON (payload is a UUID + number + 'preview' → ASCII).
function b64url(s: string): string { return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64url(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
}

/** Sign `{site_id, exp}` → `body.sig`. */
export async function signPreviewToken(payload: PreviewLinkPayload, secret: string): Promise<string> {
  const body = b64url(JSON.stringify(payload));
  const sig = await hmacHex(secret, body);
  return `${body}.${sig}`;
}

/** Verify a signed preview token. FAILS CLOSED at every step (malformed / bad
 *  signature / bad payload / expired). Timing-safe signature compare. */
export async function verifyPreviewToken(token: string, secret: string, nowSec: number):
  Promise<{ ok: true; payload: PreviewLinkPayload } | { ok: false; error: 'malformed' | 'bad_signature' | 'expired' }> {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, error: 'malformed' };
  const [body, sig] = parts;
  const expected = await hmacHex(secret, body);
  if (!timingSafeEqual(sig, expected)) return { ok: false, error: 'bad_signature' };
  let payload: PreviewLinkPayload;
  try { payload = JSON.parse(unb64url(body)); } catch { return { ok: false, error: 'malformed' }; }
  if (!payload || payload.scope !== 'preview' || typeof payload.site_id !== 'string' || !UUID_RE.test(payload.site_id) || typeof payload.exp !== 'number') {
    return { ok: false, error: 'malformed' };
  }
  if (payload.exp < nowSec) return { ok: false, error: 'expired' };
  return { ok: true, payload };
}
