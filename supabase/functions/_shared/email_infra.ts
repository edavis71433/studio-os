// ── Shared email infrastructure core (pure-ish, both functions) ──────────────
// The suppression store, unsubscribe tokens, and webhook signature verification
// used by EVERY Resend send site in presence AND clever-api. Lives in _shared/
// (like auth.ts/hmac.ts) so neither function reaches into the other's modules;
// the HTTP handlers stay in presence/routes/email_infra.ts. Self-contained REST
// access (same pattern as _shared/auth.ts) — no presence/lib imports.

const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SB_SERVICE = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const svcHeaders = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' };

export const b64url = (b: ArrayBuffer | Uint8Array): string => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function hmacB64url(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SB_SERVICE) as unknown as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg) as unknown as BufferSource);
  return b64url(sig).slice(0, 32);
}

/** Token for a recipient's unsubscribe link (used in the List-Unsubscribe header). */
export async function unsubscribeToken(email: string): Promise<string> {
  return await hmacB64url(`unsub:${email.trim().toLowerCase()}`);
}

/** The absolute one-click unsubscribe URL for a recipient. */
export async function unsubscribeUrl(email: string): Promise<string> {
  const base = SB_URL.replace(/\/$/, '');
  const t = await unsubscribeToken(email);
  return `${base}/functions/v1/presence/unsubscribe?e=${encodeURIComponent(email.trim().toLowerCase())}&t=${t}`;
}

/** Why is this address suppressed — 'opt_out' | 'bounce' | 'complaint' | null.
 *  Fail-open: a store hiccup must never block a receipt or a security email. */
export async function suppressionOf(email: string): Promise<string | null> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/suppressed_emails?email=eq.${encodeURIComponent(email.trim().toLowerCase())}&select=reason&limit=1`, { headers: svcHeaders });
    const rows = r.ok ? await r.json() : [];
    return Array.isArray(rows) && rows.length ? String(rows[0].reason || 'opt_out') : null;
  } catch { return null; }
}

/** Is this address suppressed at all (any reason)? */
export async function isSuppressed(email: string): Promise<boolean> {
  return (await suppressionOf(email)) !== null;
}

/** Add an address to the ONE suppression store. Idempotent. Best-effort. */
export async function suppress(email: string, reason: string, source: string): Promise<void> {
  await fetch(`${SB_URL}/rest/v1/suppressed_emails?on_conflict=email`, {
    method: 'POST', headers: { ...svcHeaders, Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ email: email.trim().toLowerCase(), reason, source }),
  }).catch(() => {});
}

/** May we send this email? Transactional/critical mail (receipts, security,
 *  deletion confirmations) survives an OPT-OUT — exactly what the unsubscribe
 *  page and privacy policy promise — but NEVER a bounce/complaint (the address
 *  is dead or hostile; sending again only burns domain reputation). */
export async function maySend(email: string, opts?: { critical?: boolean }): Promise<{ ok: boolean; reason: string | null }> {
  const reason = await suppressionOf(email);
  if (!reason) return { ok: true, reason: null };
  if (opts?.critical && reason === 'opt_out') return { ok: true, reason };
  return { ok: false, reason };
}

/** Mask a recipient for logs — edge logs are operator-visible and provider-
 *  retained, so raw addresses don't belong there. e***@domain.com */
export function maskEmail(email: string): string {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at <= 0) return '***';
  return `${s[0]}***@${s.slice(at + 1)}`;
}

/** Verify a svix-signed webhook (Resend events). Constant-time comparison.
 *  Returns true only for a fresh (≤5 min), correctly signed payload. */
export async function verifySvix(id: string, ts: string, sigHeader: string, payload: string, secret: string): Promise<boolean> {
  if (!id || !ts || !sigHeader || !secret) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const keyRaw = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyRaw as unknown as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${payload}`) as unknown as BufferSource);
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  const constEq = (a: string, b: string): boolean => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  };
  return sigHeader.split(' ').some((part) => constEq(part.split(',')[1] || '', expected));
}
