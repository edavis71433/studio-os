// ── Email infrastructure: one-click unsubscribe + Resend event webhook ───────
// Deliverability is a system property, not copy: Gmail/Yahoo bulk-sender rules
// want a working one-click HTTPS unsubscribe, and a sender that KEEPS mailing
// bounced/complained addresses gets the whole domain junked. Both land on the
// ONE suppression store (suppressed_emails, baseline table) which sendEmail
// checks before every send.
//
//   GET  /unsubscribe?e=<email>&t=<hmac>   — friendly confirm page (human click)
//   POST /unsubscribe?e=<email>&t=<hmac>   — RFC 8058 One-Click (and the form)
//   POST /email/events                      — Resend webhook (svix-signed)
//
// The token is an HMAC over the email with the service key — nothing guessable,
// nothing stored, no login needed (the recipient may have no account).
import { svc } from '../lib/db.ts';

const SIGNING_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const b64url = (b: ArrayBuffer | Uint8Array): string => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function hmac(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SIGNING_KEY) as unknown as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg) as unknown as BufferSource);
  return b64url(sig).slice(0, 32);
}

/** Token for a recipient's unsubscribe link (used in the List-Unsubscribe header). */
export async function unsubscribeToken(email: string): Promise<string> {
  return await hmac(`unsub:${email.trim().toLowerCase()}`);
}

/** The absolute one-click unsubscribe URL for a recipient. */
export async function unsubscribeUrl(email: string): Promise<string> {
  const base = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
  const t = await unsubscribeToken(email);
  return `${base}/functions/v1/presence/unsubscribe?e=${encodeURIComponent(email.trim().toLowerCase())}&t=${t}`;
}

/** Is this address suppressed (opt-out, bounce, complaint)? Fail-open: a store
 *  hiccup must never block a receipt or a security email. */
export async function isSuppressed(email: string): Promise<boolean> {
  try {
    const r = await svc(`suppressed_emails?email=eq.${encodeURIComponent(email.trim().toLowerCase())}&select=email&limit=1`);
    return r.ok && Array.isArray(r.json) && r.json.length > 0;
  } catch { return false; }
}

async function suppress(email: string, reason: string, source: string): Promise<void> {
  await svc('suppressed_emails?on_conflict=email', {
    method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ email: email.trim().toLowerCase(), reason, source }),
  }).catch(() => {});
}

const page = (title: string, body: string) => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>body{font-family:system-ui,sans-serif;background:#faf9fc;color:#2a2438;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}main{max-width:420px;background:#fff;border:1px solid #e6e2f0;border-radius:14px;padding:32px;text-align:center}h1{font-size:20px;margin:0 0 10px}p{color:#5c5470;line-height:1.55;margin:0 0 18px}button{background:#5b3fa0;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-size:16px;cursor:pointer;min-height:44px}</style></head><body><main><h1>${title}</h1>${body}</main></body></html>`,
  { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
);

/** GET = confirm page, POST = do it (covers RFC 8058 One-Click POSTs too). */
export async function handleUnsubscribe(req: Request, method: string): Promise<Response> {
  const u = new URL(req.url);
  const email = String(u.searchParams.get('e') || '').trim().toLowerCase();
  const token = String(u.searchParams.get('t') || '');
  const valid = !!email && !!token && token === await unsubscribeToken(email);
  if (!valid) return page('That link didn’t work', `<p>The unsubscribe link looks incomplete or expired. You can always email <a href="mailto:support@davisdigitalstudio.com">support@davisdigitalstudio.com</a> and we’ll take care of it.</p>`);
  if (method === 'POST') {
    await suppress(email, 'opt_out', 'one_click');
    return page('You’re unsubscribed', `<p>${email} won’t receive marketing or reminder emails from us anymore. Account-critical emails (receipts, security) may still arrive.</p>`);
  }
  return page('Unsubscribe?', `<p>Stop emails to <strong>${email}</strong>?</p><form method="post" action="${u.pathname}${u.search}"><button type="submit">Yes, unsubscribe</button></form>`);
}

// ── Resend event webhook (svix signature scheme) ─────────────────────────────
// Bounces and complaints auto-suppress the recipient — continuing to mail them
// is the fastest way to lose the domain's reputation. Gated on the secret:
// unset = 404 (surface doesn't exist).
export async function handleResendEvents(req: Request): Promise<Response> {
  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET') || '';
  if (!secret) return new Response('not found', { status: 404 });
  const id = req.headers.get('svix-id') || '';
  const ts = req.headers.get('svix-timestamp') || '';
  const sigHeader = req.headers.get('svix-signature') || '';
  const payload = await req.text();
  if (!id || !ts || !sigHeader) return new Response('bad request', { status: 400 });
  // svix: HMAC-SHA256 of "<id>.<ts>.<payload>" keyed on the base64 part of "whsec_..."
  const keyRaw = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyRaw as unknown as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${payload}`) as unknown as BufferSource);
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  const match = sigHeader.split(' ').some((part) => part.split(',')[1] === expected);
  if (!match) return new Response('invalid signature', { status: 401 });
  // replay window: 5 minutes
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return new Response('stale', { status: 401 });

  try {
    const evt = JSON.parse(payload);
    const type = String(evt?.type || '');
    const to: string[] = Array.isArray(evt?.data?.to) ? evt.data.to : [evt?.data?.to].filter(Boolean);
    if (type === 'email.bounced' || type === 'email.complained') {
      for (const addr of to) await suppress(String(addr), type === 'email.bounced' ? 'bounce' : 'complaint', 'resend_webhook');
      console.log(`[email] suppressed ${to.length} address(es) on ${type}`);
    }
  } catch { /* malformed body: acknowledged, nothing to do */ }
  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
