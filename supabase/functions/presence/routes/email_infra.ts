// ── Email infrastructure HTTP handlers: one-click unsubscribe + Resend webhook ─
// Deliverability is a system property, not copy: Gmail/Yahoo bulk-sender rules
// want a working one-click HTTPS unsubscribe, and a sender that KEEPS mailing
// bounced/complained addresses gets the whole domain junked. The CORE (tokens,
// suppression store, svix verify) lives in _shared/email_infra.ts and is used
// by BOTH functions' senders; only the two HTTP surfaces live here.
//
//   GET  /unsubscribe?e=<email>&t=<hmac>   — friendly confirm page (human click)
//   POST /unsubscribe?e=<email>&t=<hmac>   — RFC 8058 One-Click (and the form)
//   POST /email/events                      — Resend webhook (svix-signed)
import { unsubscribeToken, suppress, verifySvix } from '../../_shared/email_infra.ts';
export { isSuppressed, maskEmail, maySend, suppressionOf, unsubscribeUrl } from '../../_shared/email_infra.ts';

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

// ── Resend event webhook ──────────────────────────────────────────────────────
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
  if (!(await verifySvix(id, ts, sigHeader, payload, secret))) return new Response('invalid signature', { status: 401 });

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
