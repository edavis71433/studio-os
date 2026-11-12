// ═══ EMAIL A PERSON FROM THEIR RECORD OR DEAL (sales item 80, Nov 2026) ═══════
//   POST /sales/email { deal_id? | contact_id? | client_id?, subject, body }
// Salesforce's Email tab on a record: write, send, and it is on the timeline. Before this a person
// with no project could only be emailed from your own mail app, and nothing was recorded.
//   to       the address on file for that deal's person, that person, or that customer: never
//            one typed here, so this can't mail a stranger
//   as       the studio (sendEmail asBusiness), from the studio's sending address; one person,
//            words the studio wrote, so it is critical (no unsubscribe link, like the Inbox's
//            reply to an enquiry) and a bounced or spam-reported address is refused up front
//   replies  go to the studio's inbound address (opts.siteId), so an answer lands in the Inbox
//   logged   on the deal when there is one (a deal event: activity_kind email, via 'app'), else on
//            the person or the customer (presence_person_events, APPLY-0173). The email still goes
//            before that update; the answer then says it couldn't be kept on the timeline.
//   GET /sales/email?deal_id= | contact_id= | client_id= is what the Email box reads before it
//            draws: who it goes to, whether that address still takes email, who it goes out as
//            and where a reply comes back. A missing or stopped address is said up front.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { UUID_RE } from '../lib/uuid.ts';
import { sendEmail, replyToFor } from '../commerce/account.ts';
import { loadEmailBrand } from '../lib/email_brand.ts';
import { rateAllow } from '../lib/ratelimit.ts';
import { leadReplyHtml } from './commercial.ts';
import { customerOfThisStudio } from './crm.ts';
import { loggedEmailBody } from '../lib/email_log.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any)?.json) ? (r as any).json : []) as any[];
const clean = (s: unknown, max = 500) => String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]{2,}$/;
export const RECORD_EMAIL_MAX = 8000;

/** Who the email goes to, from what the studio has on file. */
export async function recipientFor(siteId: string, b: any): Promise<{ email: string; name: string; deal_id: string | null; contact_id: string | null; client_id: string | null } | { status: number; error: string; message: string }> {
  const id = (k: string) => (UUID_RE.test(String(b?.[k] || '')) ? String(b[k]) : null);
  const dealId = id('deal_id'), contactId = id('contact_id'), clientId = id('client_id');
  if (dealId) {
    const d = rows(await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${siteId}&deleted_at=is.null&select=id,contact_id,converted_client_id&limit=1`))[0];
    if (!d) return { status: 404, error: 'not_found', message: 'That deal is no longer here.' };
    const c = d.contact_id ? rows(await svc(`presence_contacts?id=eq.${d.contact_id}&site_id=eq.${siteId}&select=id,name,email&limit=1`))[0] : null;
    let email = String((c && c.email) || '').trim(), name = String((c && c.name) || '');
    if (!email && d.converted_client_id) { const k = rows(await svc(`clients?id=eq.${d.converted_client_id}&select=name,email,contact_email&limit=1`))[0]; email = String((k && (k.contact_email || k.email)) || '').trim(); name = name || String((k && k.name) || ''); }
    return { email, name, deal_id: dealId, contact_id: c ? String(c.id) : null, client_id: d.converted_client_id ? String(d.converted_client_id) : null };
  }
  if (contactId) {
    const c = rows(await svc(`presence_contacts?id=eq.${contactId}&site_id=eq.${siteId}&deleted_at=is.null&select=id,name,email,client_id&limit=1`))[0];
    if (!c) return { status: 404, error: 'not_found', message: 'That person isn’t in this workspace.' };
    return { email: String(c.email || '').trim(), name: String(c.name || ''), deal_id: null, contact_id: contactId, client_id: c.client_id ? String(c.client_id) : null };
  }
  if (clientId) {
    if (!(await customerOfThisStudio(siteId, clientId)).ok) return { status: 404, error: 'not_found', message: 'That customer isn’t one of yours.' };
    const k = rows(await svc(`clients?id=eq.${clientId}&select=name,email,contact_email&limit=1`))[0];
    return { email: String((k && (k.contact_email || k.email)) || '').trim(), name: String((k && k.name) || ''), deal_id: null, contact_id: null, client_id: clientId };
  }
  return { status: 422, error: 'validation', message: 'Who is it to? Open their record and write it there.' };
}

/** GET /sales/email → { to: { name, email }, stopped, unsubscribed, as, from, replies, reply_to } */
export async function handleRecordEmailInfo(req: Request, site: SiteRow, cors: Record<string, string>): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const to = await recipientFor(site.id, { deal_id: q.get('deal_id'), contact_id: q.get('contact_id'), client_id: q.get('client_id') });
  if ('status' in to) return json({ error: to.error, message: to.message }, to.status, cors);
  const has = EMAIL_RE.test(to.email);
  const { suppressionDetail } = await import('./email_infra.ts');
  const sup = has ? await suppressionDetail(to.email).catch(() => null) : null;
  const brand = await loadEmailBrand(site.id);
  const { sendingFrom } = await import('./email_sending.ts');
  // the Reply-To the send will carry: the studio's inbound address (its Inbox) when that is set up
  const replyTo = replyToFor({ siteId: site.id });
  return json({ data: {
    to: { name: to.name, email: has ? to.email : '' },
    // what the send refuses (a bounce or a spam report); an unsubscribe still lets one written email through
    stopped: sup && sup.reason !== 'opt_out' ? String(sup.reason) : null,
    unsubscribed: !!(sup && sup.reason === 'opt_out'),
    as: brand.name, from: sendingFrom(),
    replies: replyTo.toLowerCase().startsWith(`${site.id}@`) ? 'inbox' : 'mailbox', reply_to: replyTo,
  } }, 200, cors);
}

export async function handleRecordEmail(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const subject = clean(b.subject, 200);
  const body = typeof b.body === 'string' ? b.body.replace(/\r\n?/g, '\n').trim() : '';
  if (!subject) return json({ error: 'validation', message: 'Give the email a subject.' }, 422, cors);
  if (!body) return json({ error: 'validation', message: 'Write your message first.' }, 422, cors);
  if (body.length > RECORD_EMAIL_MAX) return json({ error: 'too_long', message: 'That message is too long to send. Keep it under 8,000 characters.' }, 422, cors);
  const to = await recipientFor(site.id, b);
  if ('status' in to) return json({ error: to.error, message: to.message }, to.status, cors);
  if (!EMAIL_RE.test(to.email)) return json({ error: 'no_email', message: 'There’s no email address on file for them. Add one on their details first.' }, 422, cors);
  // a bounced or spam-reported address is never mailed again (it would hurt every email you send)
  const { suppressionDetail } = await import('./email_infra.ts');
  const sup = await suppressionDetail(to.email).catch(() => null);
  if (sup && sup.reason !== 'opt_out') return json({ error: 'stopped', message: sup.reason === 'complaint' ? 'They marked an earlier email as spam, so no more email goes to them from here.' : 'Email to that address bounced, so it can’t be sent there. Check the address on their details.' }, 409, cors);
  // a studio writes a handful a day; this only stops a runaway loop
  if (!(await rateAllow(`record-email:${site.id}`, 60, 3600))) return json({ error: 'rate_limited', message: 'That’s a lot of emails in an hour. Try again in a little while.' }, 429, cors);
  const brand = await loadEmailBrand(site.id);
  const sent = await sendEmail(to.email, subject, leadReplyHtml(body, ''), brand, { critical: true, asBusiness: true, siteId: site.id });
  if (!sent) return json({ error: 'not_sent', message: 'We couldn’t send that just now. Nothing went out. Try again in a moment, or use your email app.' }, 503, cors);
  const at = new Date().toISOString();
  const actor = principal.email || principal.userId || 'system';
  let logged = false;
  if (to.deal_id) {
    const ins = await svc('presence_deal_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
      deal_id: to.deal_id, site_id: site.id, kind: 'note', actor, actor_kind: principal.kind,
      detail: { activity_kind: 'email', body: loggedEmailBody(subject, body), occurred_at: at, via: 'app', subject },
    }) }).catch(() => null);
    logged = !!(ins && ins.ok);
    await svc(`presence_deals?id=eq.${to.deal_id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ updated_at: at }) }).catch(() => {});
  } else {
    const ins = await svc('presence_person_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
      site_id: site.id, contact_id: to.contact_id, client_id: to.client_id, kind: 'email', body: body.slice(0, 2000), subject, occurred_at: at, via: 'app',
      actor, actor_kind: principal.kind,
    }) }).catch(() => null);
    logged = !!(ins && ins.ok);
  }
  return json({ data: { sent: true, at, to: to.email, name: to.name, logged, ...(logged ? {} : { message: 'Sent. It couldn’t be kept on their timeline just now.' }) } }, 200, cors);
}
