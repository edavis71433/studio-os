// ── Email infrastructure HTTP handlers: one-click unsubscribe + Resend webhook ─
// Deliverability is a system property, not copy: Gmail/Yahoo bulk-sender rules
// want a working one-click HTTPS unsubscribe, and a sender that KEEPS mailing
// bounced/complained addresses gets the whole domain junked. The CORE (tokens,
// suppression store, svix verify) lives in _shared/email_infra.ts and is used
// by BOTH functions' senders; only the two HTTP surfaces live here.
//
//   GET  /unsubscribe?e=<email>&t=<hmac>   — friendly confirm page (human click)
//   POST /unsubscribe?e=<email>&t=<hmac>   — RFC 8058 One-Click (and the form)
//   POST /unsubscribe?…&resume=1 (JSON)    — "Start emails again" (sales item 74)
//   POST /email/events                      — Resend webhook (svix-signed)
import { unsubscribeToken, suppress, verifySvix, suppressionDetail, resubscribe } from '../../_shared/email_infra.ts';
import { corsFor } from '../../_shared/cors.ts';
export { isSuppressed, maskEmail, maySend, suppressionOf, suppressionDetail, unsubscribeUrl, unsubscribePageUrl } from '../../_shared/email_infra.ts';

/** What still arrives after an unsubscribe, in the page's words (sales item 74: the mail
 *  commerce/account.ts sends as critical). */
export const STILL_ARRIVES = 'Receipts, documents, sign-in links, bookings, payment reminders and alerts about your own business still arrive.';

const page = (title: string, body: string) => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>body{font-family:system-ui,sans-serif;background:#faf9fc;color:#2a2438;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}main{max-width:420px;background:#fff;border:1px solid #e6e2f0;border-radius:14px;padding:32px;text-align:center}h1{font-size:20px;margin:0 0 10px}p{color:#5c5470;line-height:1.55;margin:0 0 18px}button{background:#5b3fa0;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-size:16px;cursor:pointer;min-height:44px}</style></head><body><main><h1>${title}</h1>${body}</main></body></html>`,
  { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
);

/** POST without a JSON ask = do it, answering with a page (RFC 8058 One-Click from a mail
 *  client). A person's click lands on unsubscribe.html on the app, because Supabase serves
 *  an HTML answer from this address as plain text: a GET here is sent on to that page, and
 *  the page asks with Accept: application/json (GET = is the link good and where things
 *  stand, POST = unsubscribe, POST with resume=1 = start emails again). Only the page can
 *  start emails again: a mail client's one-click POST never carries resume and never asks
 *  for JSON, and a bounce or spam complaint is never taken back. */
export async function handleUnsubscribe(req: Request, method: string): Promise<Response> {
  const u = new URL(req.url);
  const email = String(u.searchParams.get('e') || '').trim().toLowerCase();
  const token = String(u.searchParams.get('t') || '');
  const valid = !!email && !!token && token === await unsubscribeToken(email);
  const wantsJson = (req.headers.get('accept') || '').includes('application/json');
  if (method === 'GET' && !wantsJson) {
    const app = (Deno.env.get('APP_URL') || 'https://app.davisdigitalstudio.com').replace(/\/$/, '');
    return new Response(null, { status: 302, headers: { Location: `${app}/unsubscribe.html${u.search}`, 'Cache-Control': 'no-store' } });
  }
  if (wantsJson) {
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsFor(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    if (!valid) return reply({ error: 'bad_link', message: 'This unsubscribe link looks incomplete or expired. Email support@davisdigitalstudio.com and we’ll take care of it.' }, 400);
    if (method === 'POST' && u.searchParams.get('resume') === '1') {
      const now = await suppressionDetail(email);
      if (now && now.reason !== 'opt_out') return reply({ error: 'stopped', message: stoppedWords(now.reason) }, 409);
      if (!(await resubscribe(email))) return reply({ error: 'not_saved', message: 'That didn’t go through. Try again in a moment.' }, 502);
      return reply({ data: { unsubscribed: false } });
    }
    if (method === 'POST') { await suppress(email, 'opt_out', 'unsubscribe_page'); return reply({ data: { unsubscribed: true, still: STILL_ARRIVES } }); }
    // where things stand, so the page can offer "Start emails again" to someone already unsubscribed
    const now = await suppressionDetail(email);
    return reply({ data: { valid: true, unsubscribed: now?.reason === 'opt_out', since: now?.since || null, stopped: now && now.reason !== 'opt_out' ? now.reason : null, still: STILL_ARRIVES } });
  }
  if (!valid) return page('That link didn’t work', `<p>The unsubscribe link looks incomplete or expired. You can always email <a href="mailto:support@davisdigitalstudio.com">support@davisdigitalstudio.com</a> and we’ll take care of it.</p>`);
  await suppress(email, 'opt_out', 'one_click');
  return page('You’re unsubscribed', `<p>${email.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))} won’t get these emails anymore. ${STILL_ARRIVES}</p>`);
}

/** Why an address can't simply start again: it bounced, or someone marked an email as spam. */
export function stoppedWords(reason: string): string {
  return reason === 'complaint'
    ? 'Emails to this address stopped because one was marked as spam. Email support@davisdigitalstudio.com to turn them back on.'
    : 'Emails to this address stopped because they couldn’t be delivered. Email support@davisdigitalstudio.com to turn them back on.';
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
