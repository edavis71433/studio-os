// ── Answers from the proposal and agreement page (sales item 88) ─────────────
// File 07 finding 8: the client's page offered Accept and Decline and nothing else,
// so a client with one question had to dig out the original email and reply.
// POST /sales/ask { token, body, key }: a PUBLIC route, authorized only by the
// page's own signed link (like decide and sign), that lands the question in the
// studio's Inbox as a support request from the deal's person — the same spine an
// emailed reply from them lands on, with the same subject-matched thread, so the
// studio answers it from the Inbox by email and the reply threads back. The
// deal's history gets a line ("Sam asked a question") and the studio is told
// like any client message (notifyStudioOfClientAction).
//
// Also here: who signs for the studio (studioSigner), read by the sign route for
// the automatic countersignature and by the page to show it before they sign.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { rateAllow, clientIp, tooMany } from '../lib/ratelimit.ts';
import { notifyStudioOfClientAction } from '../lib/service_bridge.ts';
import { isUniqueViolation } from '../lib/contact_email.ts';
import { normalizeSubject } from '../lib/inbound_email.ts';
import { askSubject, studioSignerOf } from '../lib/agreement_layout.ts';
import { UUID_RE } from '../lib/uuid.ts';
import type { Principal } from '../../_shared/auth.ts';

const rows = (r: { json?: unknown }) => (Array.isArray(r?.json) ? r.json : []) as any[];
const ASK_MAX = 2000;

/** Who signs agreements for this studio, and its business name (lib/agreement_layout.ts). */
export async function studioSigner(siteId: string): Promise<{ name: string; title: string; business: string }> {
  const [set, ident, site] = await Promise.all([
    svc(`presence_settings?site_id=eq.${siteId}&select=signs_as_name,signs_as_title&limit=1`).catch(() => ({ ok: false, json: null })),
    svc(`presence_identity?site_id=eq.${siteId}&select=business_name&limit=1`).catch(() => ({ ok: false, json: null })),
    svc(`presence_sites?id=eq.${siteId}&select=client_id&limit=1`).catch(() => ({ ok: false, json: null })),
  ]);
  const s = (set.ok && rows(set)[0]) || {};   // before 0176 the columns aren't there: the owner's name, else the business
  const clientId = rows(site)[0]?.client_id;
  let ownerName = '';
  if (!s.signs_as_name && clientId) { try { ownerName = String(rows(await svc(`clients?id=eq.${clientId}&select=name&limit=1`))[0]?.name || ''); } catch { /* the business name */ } }
  return studioSignerOf({ signsAsName: s.signs_as_name, signsAsTitle: s.signs_as_title, ownerName, business: rows(ident)[0]?.business_name });
}

/** The deal a page's link is about, and which document the question is on. */
async function dealForToken(tok: { t: string; id: string; site_id: string }, kind: unknown): Promise<{ dealId: string; docKind: 'proposal' | 'contract' | 'estimate'; title: string } | null> {
  if (tok.t === 'flow') {
    const deal = rows(await svc(`presence_deals?id=eq.${tok.id}&site_id=eq.${tok.site_id}&deleted_at=is.null&select=id,title&limit=1`))[0];
    if (!deal) return null;
    return { dealId: deal.id, docKind: kind === 'contract' ? 'contract' : 'proposal', title: String(deal.title || '') };
  }
  const table = tok.t === 'contract' ? 'presence_contracts' : tok.t === 'estimate' ? 'presence_estimates' : tok.t === 'proposal' ? 'presence_proposals' : '';
  if (!table) return null;
  const doc = rows(await svc(`${table}?id=eq.${tok.id}&site_id=eq.${tok.site_id}&deleted_at=is.null&select=deal_id,title&limit=1`))[0];
  if (!doc || !UUID_RE.test(String(doc.deal_id || ''))) return null;
  return { dealId: String(doc.deal_id), docKind: tok.t as 'proposal' | 'contract' | 'estimate', title: String(doc.title || '') };
}

export async function handleSalesAsk(req: Request, cors: Record<string, string>): Promise<Response> {
  if (!(await rateAllow(`sales_ask:${clientIp(req)}`, 6, 600))) return tooMany(cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const body = String(b.body ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim().slice(0, ASK_MAX);
  if (!body) return json({ error: 'validation', message: 'Write your question first.' }, 422, cors);
  const key = String(b.key ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  const { linkSecret, verifySalesToken, dealEvent } = await import('./sales.ts');
  const secret = linkSecret();
  if (!secret) return json({ error: 'unavailable' }, 503, cors);
  const tok = await verifySalesToken(String(b.token || ''), secret, Math.floor(Date.now() / 1000));
  if (!tok) return json({ error: 'invalid_link', message: 'This link isn’t valid or has expired.' }, 403, cors);
  const about = await dealForToken(tok, b.kind);
  if (!about) return json({ error: 'not_found', message: 'This document isn’t here any more. Reply to the email it came in.' }, 404, cors);
  if (!(await rateAllow(`sales_ask_deal:${about.dealId}`, 12, 86400))) return tooMany(cors);
  const siteId = tok.site_id;
  const deal = rows(await svc(`presence_deals?id=eq.${about.dealId}&site_id=eq.${siteId}&select=id,title,contact_id&limit=1`))[0];
  const contact = deal?.contact_id ? rows(await svc(`presence_contacts?id=eq.${deal.contact_id}&site_id=eq.${siteId}&deleted_at=is.null&select=id,name,email,client_id&limit=1`))[0] : null;
  // the answer goes by email: with no address on the deal, the page asks for one
  let email = String(contact?.email || '').trim();
  if (!email) {
    const typed = String(b.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed) || typed.length > 160) return json({ error: 'email_needed', message: 'Add your email so the answer can reach you.' }, 422, cors);
    email = typed;
  }
  const name = String(contact?.name || '').trim();
  const subject = askSubject(about.docKind, about.title || deal?.title);
  const externalId = key ? `ask:${about.dealId}:${key}` : null;
  // the person's open thread with this subject takes it; otherwise a new request
  const open = rows(await svc(`presence_support_requests?site_id=eq.${siteId}&status=in.(open,in_progress)&deleted_at=is.null&requester=eq.${encodeURIComponent(email)}&select=id,subject,requester&order=created_at.desc&limit=20`));
  const thread = open.find((t) => normalizeSubject(t.subject) === normalizeSubject(subject));
  let requestId = '';
  if (thread) {
    const ins = await svc('presence_support_messages', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ site_id: siteId, request_id: thread.id, body, author: thread.requester, author_kind: 'client', ...(externalId ? { external_id: externalId } : {}) }) });
    if (!ins.ok && isUniqueViolation(ins)) return json({ data: { sent: true, already: true } }, 200, cors);   // a double tap: it is already there
    if (!ins.ok) return json({ error: 'write_failed', message: 'That didn’t send. Try again in a moment.' }, 502, cors);
    await svc(`presence_support_requests?id=eq.${thread.id}&site_id=eq.${siteId}`, { method: 'PATCH', body: JSON.stringify({ updated_at: new Date().toISOString() }) }).catch(() => {});
    requestId = String(thread.id);
  } else {
    const ins = await svc('presence_support_requests', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ site_id: siteId, project_id: null, subject, body, status: 'open', priority: 'normal', requester: email, requester_kind: 'client',
        ...(contact?.client_id ? { client_id: contact.client_id } : {}), ...(externalId ? { external_id: externalId } : {}) }) });
    if (!ins.ok && isUniqueViolation(ins)) return json({ data: { sent: true, already: true } }, 200, cors);
    if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed', message: 'That didn’t send. Try again in a moment.' }, 502, cors);
    requestId = String(rows(ins)[0].id);
  }
  const sys = { kind: 'public', userId: 'client-question', tenantId: null, role: null, email: null, jwt: null, requestId: 'sales-ask' } as unknown as Principal;
  await dealEvent(siteId, about.dealId, 'client_question', sys, { detail: { request_id: requestId, on: about.docKind, text: body.slice(0, 500), from: name || email } }).catch(() => {});
  await notifyStudioOfClientAction({
    agencySiteId: siteId, kind: 'client_request', threadKey: `req:${requestId}`,
    customerClientId: contact?.client_id || null, actorName: name || email, projectId: null,
    subject, excerpt: body.slice(0, 400), href: `/projects.html?support=${requestId}`,
  }).catch(() => {});
  return json({ data: { sent: true } }, 200, cors);
}
