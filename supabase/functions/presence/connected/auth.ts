// ── Connected Platform auth (L4.1) — one flow for every provider ────────────
// OAuth and API-key connections, config-driven. NO provider-specific flow: the
// provider registry + this endpoint map is all that differs. App credentials are
// edge-function env secrets (CONNECTED_<KEY>_CLIENT_ID / _SECRET), registered by
// the owner per provider; until they exist a connection is honestly "not
// available on this environment yet" — never a fake success.
import type { TokenBundle } from './store.ts';
import { providerByKey } from './providers.ts';
import { seal, open, encryptionConfigured } from './crypto.ts';

const SITE_URL = (Deno.env.get('SITE_URL') || 'https://davisdigitalstudio.com').replace(/\/$/, '');
export const REDIRECT_URI = `${SITE_URL}/connections-callback.html`;

interface OAuthEndpoints { authorize: string; token: string; revoke?: string; extraAuth?: Record<string, string>; }
// One entry per OAuth provider; API-key providers are absent (they connect by key).
const OAUTH: Record<string, OAuthEndpoints> = {
  // Google family — one set of endpoints, many products
  google_search_console: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', revoke: 'https://oauth2.googleapis.com/revoke', extraAuth: { access_type: 'offline', prompt: 'consent' } },
  google_business_profile: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', revoke: 'https://oauth2.googleapis.com/revoke', extraAuth: { access_type: 'offline', prompt: 'consent' } },
  google_analytics: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', revoke: 'https://oauth2.googleapis.com/revoke', extraAuth: { access_type: 'offline', prompt: 'consent' } },
  google_tag_manager: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', revoke: 'https://oauth2.googleapis.com/revoke', extraAuth: { access_type: 'offline', prompt: 'consent' } },
  google_calendar: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', revoke: 'https://oauth2.googleapis.com/revoke', extraAuth: { access_type: 'offline', prompt: 'consent' } },
  youtube: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', revoke: 'https://oauth2.googleapis.com/revoke', extraAuth: { access_type: 'offline', prompt: 'consent' } },
  // Meta family
  meta_business: { authorize: 'https://www.facebook.com/v19.0/dialog/oauth', token: 'https://graph.facebook.com/v19.0/oauth/access_token' },
  facebook_page: { authorize: 'https://www.facebook.com/v19.0/dialog/oauth', token: 'https://graph.facebook.com/v19.0/oauth/access_token' },
  instagram: { authorize: 'https://www.facebook.com/v19.0/dialog/oauth', token: 'https://graph.facebook.com/v19.0/oauth/access_token' },
  // Others
  linkedin: { authorize: 'https://www.linkedin.com/oauth/v2/authorization', token: 'https://www.linkedin.com/oauth/v2/accessToken' },
  apple_business_connect: { authorize: 'https://businessconnect.apple.com/oauth/authorize', token: 'https://businessconnect.apple.com/oauth/token' },
  hubspot: { authorize: 'https://app.hubspot.com/oauth/authorize', token: 'https://api.hubapi.com/oauth/v1/token' },
  salesforce: { authorize: 'https://login.salesforce.com/services/oauth2/authorize', token: 'https://login.salesforce.com/services/oauth2/token', revoke: 'https://login.salesforce.com/services/oauth2/revoke' },
  mailchimp: { authorize: 'https://login.mailchimp.com/oauth2/authorize', token: 'https://login.mailchimp.com/oauth2/token' },
  calendly: { authorize: 'https://auth.calendly.com/oauth/authorize', token: 'https://auth.calendly.com/oauth/token' },
  stripe_connect: { authorize: 'https://connect.stripe.com/oauth/authorize', token: 'https://connect.stripe.com/oauth/token', revoke: 'https://connect.stripe.com/oauth/deauthorize' },
  square: { authorize: 'https://connect.squareup.com/oauth2/authorize', token: 'https://connect.squareup.com/oauth2/token', revoke: 'https://connect.squareup.com/oauth2/revoke' },
};

const ENVKEY = (k: string) => k.toUpperCase();
function creds(providerKey: string): { id: string; secret: string } {
  return {
    id: Deno.env.get(`CONNECTED_${ENVKEY(providerKey)}_CLIENT_ID`) || '',
    secret: Deno.env.get(`CONNECTED_${ENVKEY(providerKey)}_CLIENT_SECRET`) || '',
  };
}

export function isOAuth(providerKey: string): boolean { return !!OAUTH[providerKey]; }
export function oauthConfigured(providerKey: string): boolean {
  const c = creds(providerKey); return !!(OAUTH[providerKey] && c.id && c.secret);
}
// API-key providers are "configured" as soon as the customer supplies a key.
export function apiKeyConfigured(providerKey: string): boolean {
  const p = providerByKey(providerKey); return !!p && p.auth === 'api_key';
}

// ── L4.4 hardening: signed, site-bound, short-lived OAuth state ──────────────
// The state parameter defends the callback against replay/CSRF/mismatched-code:
// it is a sealed (AES-GCM, unforgeable) token binding the exact site + provider +
// a timestamp, verified server-side before any code is exchanged. A replayed or
// cross-site callback fails to verify and is refused — nothing is connected.
const STATE_TTL_MS = 10 * 60 * 1000; // a consent flow that takes >10 min is stale, not an attack we honor
const urlsafe = (s: string) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unurlsafe = (s: string) => { const t = s.replace(/-/g, '+').replace(/_/g, '/'); return t + '='.repeat((4 - (t.length % 4)) % 4); };

/** A signed state for the consent redirect. Falls back to an opaque nonce only
 *  when encryption isn't configured (dev) — never a fake sense of security. */
export async function signState(siteId: string, providerKey: string): Promise<string> {
  const sealed = await seal(JSON.stringify({ s: siteId, k: providerKey, t: Date.now() }));
  if (!sealed) return `${providerKey}:${crypto.randomUUID()}`;
  return `${urlsafe(sealed.ciphertext)}.${urlsafe(sealed.iv)}`;
}

/** Verify a returned state binds THIS site + provider and is fresh. When
 *  encryption isn't configured we cannot verify — accept (dev-only path). */
export async function verifyState(state: string, siteId: string, providerKey: string): Promise<boolean> {
  if (!encryptionConfigured()) return true;
  if (!state || !state.includes('.')) return false;
  const [ct, iv] = state.split('.');
  const plain = await open({ ciphertext: unurlsafe(ct), iv: unurlsafe(iv) });
  if (!plain) return false;
  try {
    const p = JSON.parse(plain);
    return p.s === siteId && p.k === providerKey && typeof p.t === 'number' && (Date.now() - p.t) < STATE_TTL_MS;
  } catch { return false; }
}

// Build the provider's own consent URL. `state` ties the callback back to the
// site + provider (signed by signState(), verified by verifyState()).
export function authorizeUrl(providerKey: string, state: string): string | null {
  const ep = OAUTH[providerKey]; const p = providerByKey(providerKey); const c = creds(providerKey);
  if (!ep || !p || !c.id) return null;
  const params = new URLSearchParams({
    client_id: c.id, redirect_uri: REDIRECT_URI, response_type: 'code',
    scope: p.scopes.join(' '), state, ...(ep.extraAuth || {}),
  });
  return `${ep.authorize}?${params.toString()}`;
}

async function tokenPost(url: string, body: Record<string, string>): Promise<any> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(body).toString() });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && (j.error_description || j.error)) || `token ${r.status}`);
  return j;
}
function toBundle(j: any): TokenBundle {
  const expires = Number(j.expires_in);
  return {
    access_token: String(j.access_token || ''),
    refresh_token: j.refresh_token ? String(j.refresh_token) : undefined,
    expires_at: isFinite(expires) && expires > 0 ? new Date(Date.now() + expires * 1000).toISOString() : null,
    token_type: j.token_type, scope: j.scope,
  };
}

export async function exchangeCode(providerKey: string, code: string): Promise<TokenBundle> {
  const ep = OAUTH[providerKey]; const c = creds(providerKey);
  if (!ep) throw new Error('not_oauth');
  return toBundle(await tokenPost(ep.token, { grant_type: 'authorization_code', code, client_id: c.id, client_secret: c.secret, redirect_uri: REDIRECT_URI }));
}

export async function refreshTokens(providerKey: string, refreshToken: string): Promise<TokenBundle> {
  const ep = OAUTH[providerKey]; const c = creds(providerKey);
  if (!ep) throw new Error('not_oauth');
  const b = await tokenPost(ep.token, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: c.id, client_secret: c.secret });
  const bundle = toBundle(b);
  if (!bundle.refresh_token) bundle.refresh_token = refreshToken; // most providers keep the same refresh token
  return bundle;
}

// Best-effort revoke at the provider (never throws — disconnect proceeds regardless).
export async function revokeToken(providerKey: string, token: string): Promise<void> {
  const ep = OAUTH[providerKey];
  if (!ep?.revoke) return;
  try { await fetch(ep.revoke, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString() }); } catch { /* best-effort */ }
}
