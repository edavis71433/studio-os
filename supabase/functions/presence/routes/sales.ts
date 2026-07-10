// ── Sales & Customer Lifecycle routes (Presence CMS Phase 2, P2-C) ───────────
// One coherent /sales/* resource surface (NOT the legacy 185-route RPC shape):
//   contacts · deals(+stage) · proposals(+send/decide) · contracts(+send/sign)
//   · convert. Every query is site_id-scoped (tenant isolation); send/decide/
//   sign/convert are idempotent. Convert bridges to the existing, idempotent
//   provisionForSignup — no second provisioning path, no legacy data.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { sendEmail, findClientByEmail, createAuthUser, createContactAndClient, deleteAuthUser, generateSetPasswordLink } from '../commerce/account.ts';
import { provisionForSignup } from '../commerce/provision.ts';
import { rateAllow, clientIp, tooMany } from '../lib/ratelimit.ts';
import { resolveAgencyMember } from '../agency/auth.ts';
import { ensureProjectForDeal } from '../lib/service_bridge.ts';
import type { PlanKey } from '../commerce/catalog.ts';
import { hmacHex, timingSafeEqual } from '../../_shared/hmac.ts';
import {
  canTransition, isStage, normalizeLineItems, canDecideProposal, contractHash,
  canSignContract, convertOutcome, clampLimit, type Stage,
} from '../lib/sales_lifecycle.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;                       // expected_close: ISO date only
const CONVERT_PLANS = new Set(['presence', 'cms_only', 'business_os_only', 'presence_monitor', 'presence_managed']);
const pickPlan = (p: unknown): PlanKey => (typeof p === 'string' && CONVERT_PLANS.has(p) ? p : 'presence') as PlanKey;
const clean = (s: unknown, max = 500) => String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
const nowIso = () => new Date().toISOString();
const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const actorOf = (p: Principal) => ({ actor: p.email || p.userId || 'system', actor_kind: p.kind });
const siteUrl = () => (Deno.env.get('SITE_URL') || 'https://davisdigitalstudio.com').replace(/\/$/, '');
const fnBase = () => (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');

// ── signed accept/sign links (reuse the house HMAC idiom; new sales scope) ──
function linkSecret(): string | null {
  return Deno.env.get('APPROVAL_SECRET') || Deno.env.get('STATE_SIGNING_SECRET') || Deno.env.get('SCHEDULER_SECRET') || null;
}
function b64url(s: string): string { return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64url(s: string): string { const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : ''; return atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad); }
async function signSalesToken(payload: { t: 'proposal' | 'contract'; id: string; site_id: string; exp: number }, secret: string): Promise<string> {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${await hmacHex(secret, body)}`;
}
async function verifySalesToken(token: string, secret: string, nowSec: number): Promise<{ t: string; id: string; site_id: string; exp: number } | null> {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!timingSafeEqual(parts[1], await hmacHex(secret, parts[0]))) return null;
  let p: any; try { p = JSON.parse(unb64url(parts[0])); } catch { return null; }
  if (!p || (p.t !== 'proposal' && p.t !== 'contract') || !UUID_RE.test(p.id || '') || !UUID_RE.test(p.site_id || '') || typeof p.exp !== 'number') return null;
  if (p.exp < nowSec) return null;
  return p;
}

// ── deal events (sales audit) + provenance mirror ──
async function dealEvent(siteId: string, dealId: string, kind: string, principal: Principal, extra: Record<string, unknown> = {}) {
  const { actor, actor_kind } = actorOf(principal);
  await svc('presence_deal_events', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ deal_id: dealId, site_id: siteId, kind, actor, actor_kind, ...extra }) }).catch(() => {});
}

// ═══ CONTACTS ═══
export async function handleSalesContacts(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  if (req.method === 'GET') {
    const u = new URL(req.url);
    const q = clean(u.searchParams.get('q'), 80);
    const limit = clampLimit(u.searchParams.get('limit'));
    const offset = Math.max(0, Math.trunc(Number(u.searchParams.get('offset'))) || 0);
    let path = `presence_contacts?site_id=eq.${site.id}&deleted_at=is.null&select=id,name,email,phone,company,updated_at&order=updated_at.desc&limit=${limit}&offset=${offset}`;
    if (q) path += `&or=(name.ilike.*${encodeURIComponent(q)}*,email.ilike.*${encodeURIComponent(q)}*,company.ilike.*${encodeURIComponent(q)}*)`;
    const r = await svc(path);
    if (!r.ok) return json({ error: 'read_failed', message: 'We couldn’t load your contacts just now.' }, 502, cors);
    return json({ data: rows(r), limit, offset }, 200, cors);
  }
  if (req.method === 'POST') {
    let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const email = clean(b.email, 160).toLowerCase();
    const name = clean(b.name, 120);
    if (!name && !email) return json({ error: 'validation', message: 'A contact needs a name or an email.' }, 422, cors);
    // duplicate protection: reuse an existing contact for this (site, email)
    if (email) {
      const existing = await svc(`presence_contacts?site_id=eq.${site.id}&email=eq.${encodeURIComponent(email)}&deleted_at=is.null&select=id,name,email,phone,company&limit=1`);
      if (existing.ok && rows(existing)[0]) return json({ data: rows(existing)[0], deduped: true }, 200, cors);
    }
    const ins = await svc('presence_contacts', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ site_id: site.id, name, email, phone: clean(b.phone, 40), company: clean(b.company, 120), notes: clean(b.notes, 2000) }) });
    if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed', message: 'That contact didn’t save — please try again.' }, 502, cors);
    return json({ data: rows(ins)[0] }, 201, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

// ═══ DEALS ═══
export async function handleSalesDeals(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  if (req.method === 'GET') {
    const u = new URL(req.url);
    const stage = u.searchParams.get('stage');
    const q = clean(u.searchParams.get('q'), 80);
    const limit = clampLimit(u.searchParams.get('limit'));
    const offset = Math.max(0, Math.trunc(Number(u.searchParams.get('offset'))) || 0);
    let path = `presence_deals?site_id=eq.${site.id}&deleted_at=is.null&select=id,title,stage,source,expected_value_cents,expected_close,contact_id,converted_client_id,updated_at&order=updated_at.desc&limit=${limit}&offset=${offset}`;
    if (stage && isStage(stage)) path += `&stage=eq.${stage}`;
    if (q) path += `&title.ilike.*${encodeURIComponent(q)}*`;
    const r = await svc(path);
    if (!r.ok) return json({ error: 'read_failed', message: 'We couldn’t load your pipeline just now.' }, 502, cors);
    return json({ data: rows(r), limit, offset }, 200, cors);
  }
  if (req.method === 'POST') {
    let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const title = clean(b.title, 200);
    if (!title) return json({ error: 'validation', message: 'A deal needs a title.' }, 422, cors);
    let contactId: string | null = UUID_RE.test(b.contact_id || '') ? b.contact_id : null;
    if (contactId) { // tenant guard: the contact must belong to this site
      const c = await svc(`presence_contacts?id=eq.${contactId}&site_id=eq.${site.id}&select=id&limit=1`);
      if (!rows(c)[0]) return json({ error: 'bad_contact', message: 'That contact isn’t in this workspace.' }, 422, cors);
    }
    let srcSub: string | null = UUID_RE.test(b.source_submission_id || '') ? b.source_submission_id : null;
    if (srcSub) { const s = await svc(`presence_form_submissions?id=eq.${srcSub}&site_id=eq.${site.id}&select=id&limit=1`); if (!rows(s)[0]) srcSub = null; }
    const closeDate = b.expected_close ? clean(b.expected_close, 10) : '';
    if (closeDate && !DATE_RE.test(closeDate)) return json({ error: 'validation', message: 'Expected close must be a date (YYYY-MM-DD).' }, 422, cors);
    const ins = await svc('presence_deals', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ site_id: site.id, contact_id: contactId, title, stage: 'lead',
        source: clean(b.source, 40) || (srcSub ? 'website_form' : 'manual'), source_submission_id: srcSub,
        expected_value_cents: Math.max(0, Math.trunc(Number(b.expected_value_cents)) || 0),
        expected_close: closeDate || null, notes: clean(b.notes, 2000) }) });
    if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed', message: 'That deal didn’t save — please try again.' }, 502, cors);
    const deal = rows(ins)[0];
    await dealEvent(site.id, deal.id, 'created', principal, { to_stage: 'lead' });
    return json({ data: deal }, 201, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

async function loadDeal(siteId: string, id: string) {
  const r = await svc(`presence_deals?id=eq.${id}&site_id=eq.${siteId}&deleted_at=is.null&select=*&limit=1`);
  return rows(r)[0] || null;
}

export async function handleSalesDeal(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const deal = await loadDeal(site.id, id);
  if (!deal) return json({ error: 'not_found', message: 'That deal is no longer here.' }, 404, cors);
  if (req.method === 'GET') {
    const [contact, proposals, contracts, events] = await Promise.all([
      deal.contact_id ? svc(`presence_contacts?id=eq.${deal.contact_id}&site_id=eq.${site.id}&select=id,name,email,phone,company,notes&limit=1`) : Promise.resolve({ json: [] }),
      svc(`presence_proposals?deal_id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id,title,subtotal_cents,currency,status,version,sent_at,decided_at&order=created_at.desc`),
      svc(`presence_contracts?deal_id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id,title,status,signer_name,signed_at,version&order=created_at.desc`),
      svc(`presence_deal_events?deal_id=eq.${id}&site_id=eq.${site.id}&select=kind,from_stage,to_stage,detail,actor,created_at&order=created_at.desc&limit=50`),
    ]);
    return json({ data: { deal, contact: rows(contact)[0] || null, proposals: rows(proposals), contracts: rows(contracts), events: rows(events) } }, 200, cors);
  }
  if (req.method === 'PATCH') {
    let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const patch: Record<string, unknown> = {};
    if (b.title !== undefined) patch.title = clean(b.title, 200);
    if (b.notes !== undefined) patch.notes = clean(b.notes, 2000);
    if (b.expected_value_cents !== undefined) patch.expected_value_cents = Math.max(0, Math.trunc(Number(b.expected_value_cents)) || 0);
    if (b.expected_close !== undefined) { const cd = b.expected_close ? clean(b.expected_close, 10) : ''; if (cd && !DATE_RE.test(cd)) return json({ error: 'validation', message: 'Expected close must be a date (YYYY-MM-DD).' }, 422, cors); patch.expected_close = cd || null; }
    if (b.assigned_to !== undefined) patch.assigned_to = UUID_RE.test(b.assigned_to || '') ? b.assigned_to : null;
    if (!Object.keys(patch).length) return json({ error: 'empty_update' }, 400, cors);
    const up = await svc(`presence_deals?id=eq.${id}&site_id=eq.${site.id}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
    if (!up.ok || !rows(up)[0]) return json({ error: 'write_failed' }, 502, cors);
    return json({ data: rows(up)[0] }, 200, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

export async function handleSalesDealStage(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const to = b.to as Stage;
  if (!isStage(to)) return json({ error: 'bad_stage' }, 422, cors);
  const deal = await loadDeal(site.id, id);
  if (!deal) return json({ error: 'not_found' }, 404, cors);
  if (deal.stage === to) return json({ data: deal }, 200, cors); // idempotent no-op
  if (!canTransition(deal.stage, to)) return json({ error: 'invalid_transition', message: `A deal can’t move from ${deal.stage} to ${to}.` }, 409, cors);
  const patch: Record<string, unknown> = { stage: to };
  if (to === 'lost') patch.lost_reason = clean(b.reason, 200);
  const up = await svc(`presence_deals?id=eq.${id}&site_id=eq.${site.id}&stage=eq.${deal.stage}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!up.ok || !rows(up)[0]) return json({ error: 'conflict', message: 'That deal just changed — refresh and try again.' }, 409, cors); // optimistic: stage guard in WHERE
  await dealEvent(site.id, id, 'stage_change', principal, { from_stage: deal.stage, to_stage: to });
  return json({ data: rows(up)[0] }, 200, cors);
}

// ═══ PROPOSALS ═══
export async function handleSalesProposalCreate(req: Request, site: SiteRow, principal: Principal, dealId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(dealId)) return json({ error: 'bad_request' }, 400, cors);
  const deal = await loadDeal(site.id, dealId);
  if (!deal) return json({ error: 'not_found' }, 404, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const norm = normalizeLineItems(b.line_items);
  if (!norm.ok) return json({ error: 'validation', message: norm.error }, 422, cors);
  const ins = await svc('presence_proposals', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, deal_id: dealId, title: clean(b.title, 200) || 'Proposal',
      line_items: norm.items, subtotal_cents: norm.subtotal_cents, currency: clean(b.currency, 8) || 'usd',
      terms: clean(b.terms, 5000), status: 'draft' }) });
  if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed' }, 502, cors);
  return json({ data: rows(ins)[0] }, 201, cors);
}

export async function handleSalesProposalSend(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const r = await svc(`presence_proposals?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=*&limit=1`);
  const p = rows(r)[0];
  if (!p) return json({ error: 'not_found' }, 404, cors);
  if (p.status === 'sent') { // idempotent: already sent → return the existing link
    const secret = linkSecret();
    const link = secret ? `${fnBase()}/functions/v1/presence/sales/p/${await signSalesToken({ t: 'proposal', id, site_id: site.id, exp: Math.floor(Date.now() / 1000) + 30 * 86400 }, secret)}` : null;
    return json({ data: p, url: link, already_sent: true }, 200, cors);
  }
  if (p.status !== 'draft') return json({ error: 'bad_state', message: 'Only a draft proposal can be sent.' }, 409, cors);
  const up = await svc(`presence_proposals?id=eq.${id}&site_id=eq.${site.id}&status=eq.draft&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'sent', sent_at: nowIso() }) });
  if (!up.ok || !rows(up)[0]) return json({ error: 'conflict' }, 409, cors);
  const secret = linkSecret();
  const token = secret ? await signSalesToken({ t: 'proposal', id, site_id: site.id, exp: Math.floor(Date.now() / 1000) + 30 * 86400 }, secret) : null;
  const url = token ? `${fnBase()}/functions/v1/presence/sales/p/${token}` : null;
  await dealEvent(site.id, p.deal_id, 'proposal_sent', principal, { detail: { proposal_id: id } });
  // move the deal to 'proposal' if it's earlier (best-effort, guarded)
  await svc(`presence_deals?id=eq.${p.deal_id}&site_id=eq.${site.id}&stage=in.(lead,qualified)`, { method: 'PATCH', body: JSON.stringify({ stage: 'proposal' }) }).catch(() => {});
  return json({ data: rows(up)[0], url }, 200, cors);
}

/** Public (token) OR authed proposal decision. */
export async function handleSalesProposalDecide(req: Request, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  if (!(await rateAllow(`sales_decide:${clientIp(req)}`, 20, 60))) return tooMany(cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const decision = b.decision === 'accepted' ? 'accepted' : b.decision === 'declined' ? 'declined' : null;
  if (!decision) return json({ error: 'bad_decision' }, 422, cors);
  const secret = linkSecret();
  if (!secret) return json({ error: 'unavailable' }, 503, cors);
  const tok = await verifySalesToken(String(b.token || ''), secret, Math.floor(Date.now() / 1000));
  if (!tok || tok.t !== 'proposal' || tok.id !== id) return json({ error: 'invalid_link', message: 'This link isn’t valid or has expired.' }, 403, cors);
  const r = await svc(`presence_proposals?id=eq.${id}&site_id=eq.${tok.site_id}&select=*&limit=1`);
  const p = rows(r)[0];
  if (!p) return json({ error: 'not_found' }, 404, cors);
  if (p.status === decision) return json({ data: { status: p.status }, already: true }, 200, cors); // idempotent
  if (!canDecideProposal(p.status, decision)) return json({ error: 'bad_state', message: 'This proposal can’t be updated.' }, 409, cors);
  const up = await svc(`presence_proposals?id=eq.${id}&site_id=eq.${tok.site_id}&status=eq.sent&select=deal_id,status`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: decision, decided_at: nowIso(), decided_note: clean(b.note, 500) }) });
  if (!up.ok || !rows(up)[0]) return json({ error: 'conflict' }, 409, cors);
  const dealId = rows(up)[0].deal_id;
  const sys: Principal = { kind: 'public', userId: 'proposal-link', tenantId: null, role: null, email: null, jwt: null, requestId: 'proposal-decide' } as Principal;
  await dealEvent(tok.site_id, dealId, 'proposal_decided', sys, { detail: { proposal_id: id, decision } });
  if (decision === 'accepted') await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${tok.site_id}&stage=in.(lead,qualified,proposal)`, { method: 'PATCH', body: JSON.stringify({ stage: 'contract' }) }).catch(() => {});
  return json({ data: { status: decision } }, 200, cors);
}

// ═══ CONTRACTS ═══
export async function handleSalesContractCreate(req: Request, site: SiteRow, principal: Principal, dealId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(dealId)) return json({ error: 'bad_request' }, 400, cors);
  const deal = await loadDeal(site.id, dealId);
  if (!deal) return json({ error: 'not_found' }, 404, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const body = clean(b.body, 50000);
  if (!body) return json({ error: 'validation', message: 'A contract needs a body.' }, 422, cors);
  const terms = (b.terms_snapshot && typeof b.terms_snapshot === 'object') ? b.terms_snapshot : {};
  const hash = await contractHash(body, terms);
  let proposalId: string | null = UUID_RE.test(b.proposal_id || '') ? b.proposal_id : null;
  if (proposalId) { const pp = await svc(`presence_proposals?id=eq.${proposalId}&site_id=eq.${site.id}&deal_id=eq.${dealId}&select=id&limit=1`); if (!rows(pp)[0]) proposalId = null; }
  const ins = await svc('presence_contracts', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, deal_id: dealId, proposal_id: proposalId, title: clean(b.title, 200) || 'Service agreement', body, content_hash: hash, terms_snapshot: terms, status: 'draft' }) });
  if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed' }, 502, cors);
  return json({ data: { ...rows(ins)[0], content_hash: hash } }, 201, cors);
}

export async function handleSalesContractSend(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const r = await svc(`presence_contracts?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=*&limit=1`);
  const c = rows(r)[0];
  if (!c) return json({ error: 'not_found' }, 404, cors);
  const secret = linkSecret();
  const mkLink = async () => secret ? `${fnBase()}/functions/v1/presence/sales/c/${await signSalesToken({ t: 'contract', id, site_id: site.id, exp: Math.floor(Date.now() / 1000) + 30 * 86400 }, secret)}` : null;
  if (c.status === 'signed') return json({ error: 'already_signed' }, 409, cors);
  if (c.status === 'sent') return json({ data: c, url: await mkLink(), content_hash: c.content_hash, already_sent: true }, 200, cors);
  const up = await svc(`presence_contracts?id=eq.${id}&site_id=eq.${site.id}&status=eq.draft&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'sent', sent_at: nowIso() }) });
  if (!up.ok || !rows(up)[0]) return json({ error: 'conflict' }, 409, cors);
  await dealEvent(site.id, c.deal_id, 'contract_sent', principal, { detail: { contract_id: id } });
  return json({ data: rows(up)[0], url: await mkLink(), content_hash: c.content_hash }, 200, cors);
}

/** Public (token) contract signing — version-integrity enforced. */
export async function handleSalesContractSign(req: Request, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  if (!(await rateAllow(`sales_sign:${clientIp(req)}`, 20, 60))) return tooMany(cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const secret = linkSecret();
  if (!secret) return json({ error: 'unavailable' }, 503, cors);
  const tok = await verifySalesToken(String(b.token || ''), secret, Math.floor(Date.now() / 1000));
  if (!tok || tok.t !== 'contract' || tok.id !== id) return json({ error: 'invalid_link', message: 'This link isn’t valid or has expired.' }, 403, cors);
  const r = await svc(`presence_contracts?id=eq.${id}&site_id=eq.${tok.site_id}&select=*&limit=1`);
  const c = rows(r)[0];
  if (!c) return json({ error: 'not_found' }, 404, cors);
  if (c.status === 'signed') return json({ data: { status: 'signed', signed_at: c.signed_at }, already: true }, 200, cors); // idempotent
  const presented = clean(b.presented_hash, 64);
  const chk = canSignContract(c.status, c.content_hash, presented);
  if (!chk.ok) return json({ error: chk.reason, message: chk.reason === 'version_mismatch' ? 'This agreement was updated — please reload the latest version before signing.' : 'This agreement can’t be signed right now.' }, 409, cors);
  const signerName = clean(b.signer_name, 120);
  const signerEmail = clean(b.signer_email, 160).toLowerCase();
  if (!signerName) return json({ error: 'validation', message: 'Please type your name to sign.' }, 422, cors);
  const evidence = { hash: c.content_hash, at: nowIso(), token_exp: tok.exp };
  const up = await svc(`presence_contracts?id=eq.${id}&site_id=eq.${tok.site_id}&status=eq.sent&content_hash=eq.${c.content_hash}&select=deal_id`, { method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'signed', signer_name: signerName, signer_email: signerEmail, signed_at: nowIso(), signed_evidence: evidence }) });
  if (!up.ok || !rows(up)[0]) return json({ error: 'conflict', message: 'This agreement changed — reload and sign again.' }, 409, cors); // hash guard in WHERE = version integrity
  const dealId = rows(up)[0].deal_id;
  const sys: Principal = { kind: 'public', userId: 'contract-link', tenantId: null, role: null, email: null, jwt: null, requestId: 'contract-sign' } as Principal;
  await dealEvent(tok.site_id, dealId, 'contract_signed', sys, { detail: { contract_id: id, signer: signerName } });
  await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${tok.site_id}&stage=in.(lead,qualified,proposal)`, { method: 'PATCH', body: JSON.stringify({ stage: 'contract' }) }).catch(() => {});
  return json({ data: { status: 'signed' } }, 200, cors);
}

// ═══ PUBLIC VIEW (token) — a prospect reviews the proposal/contract before acting ═══
export async function handleSalesPublicView(req: Request, token: string, cors: Record<string, string>): Promise<Response> {
  if (!(await rateAllow(`sales_view:${clientIp(req)}`, 60, 60))) return tooMany(cors);
  const secret = linkSecret();
  if (!secret) return json({ error: 'unavailable' }, 503, cors);
  const tok = await verifySalesToken(token, secret, Math.floor(Date.now() / 1000));
  if (!tok) return json({ error: 'invalid_link', message: 'This link isn’t valid or has expired.' }, 403, cors);
  if (tok.t === 'proposal') {
    const p = rows(await svc(`presence_proposals?id=eq.${tok.id}&site_id=eq.${tok.site_id}&deleted_at=is.null&select=id,title,line_items,subtotal_cents,currency,terms,status&limit=1`))[0];
    if (!p) return json({ error: 'not_found' }, 404, cors);
    return json({ data: { kind: 'proposal', ...p } }, 200, cors);
  }
  const c = rows(await svc(`presence_contracts?id=eq.${tok.id}&site_id=eq.${tok.site_id}&deleted_at=is.null&select=id,title,body,content_hash,status,signed_at&limit=1`))[0];
  if (!c) return json({ error: 'not_found' }, 404, cors);
  return json({ data: { kind: 'contract', ...c } }, 200, cors); // content_hash is presented back on sign (version integrity)
}

// ═══ CONVERT TO CUSTOMER (idempotent) ═══
export async function handleSalesConvert(req: Request, site: SiteRow, principal: Principal, dealId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(dealId)) return json({ error: 'bad_request' }, 400, cors);
  let cb: any = {}; try { cb = await req.json(); } catch { /* body optional */ }
  const deal = await loadDeal(site.id, dealId);
  if (!deal) return json({ error: 'not_found' }, 404, cors);
  const outcome = convertOutcome({ stage: deal.stage, converted_client_id: deal.converted_client_id });
  if (outcome === 'already_converted') { // idempotent: return the existing customer/workspace (+ ensure the project handoff)
    const { actor, actor_kind } = actorOf(principal);
    const ph = await ensureProjectForDeal({ agencySiteId: site.id, deal, clientId: deal.converted_client_id, customerSiteId: deal.converted_site_id, actor, actorKind: actor_kind });
    return json({ data: { converted: true, client_id: deal.converted_client_id, site_id: deal.converted_site_id, project_id: ph.project?.id || deal.created_project_id || null, onboarding: '/get-started.html', idempotent: true } }, 200, cors);
  }
  if (outcome === 'blocked_lost') return json({ error: 'lost', message: 'A lost deal can’t be converted.' }, 409, cors);
  if (outcome === 'blocked_stage') return json({ error: 'not_ready', message: 'Sign the agreement before converting this deal to a customer.' }, 409, cors);

  // CLAIM the deal atomically BEFORE any account/provisioning work, so two
  // concurrent converts can NEVER double-create a customer or workspace. A prior
  // claim that never finished (>5 min stale) is reclaimable → a failed attempt
  // self-heals. `converted_at` is the claim marker; `converted_client_id` is the
  // completion marker (checked by convertOutcome above).
  const claimBody = () => JSON.stringify({ converted_at: nowIso() });
  let claim = await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${site.id}&converted_client_id=is.null&converted_at=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: claimBody() });
  if (!rows(claim)[0]) {
    const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
    claim = await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${site.id}&converted_client_id=is.null&converted_at=lt.${encodeURIComponent(staleBefore)}&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: claimBody() });
  }
  if (!rows(claim)[0]) { // another convert holds the claim (or it just finished)
    const fresh = await loadDeal(site.id, dealId);
    if (fresh?.converted_client_id) return json({ data: { converted: true, client_id: fresh.converted_client_id, site_id: fresh.converted_site_id, idempotent: true } }, 200, cors);
    return json({ error: 'conversion_in_progress', message: 'This deal is already being converted — refresh in a moment.' }, 409, cors);
  }
  const unclaim = () => svc(`presence_deals?id=eq.${dealId}&site_id=eq.${site.id}&converted_client_id=is.null`, { method: 'PATCH', body: JSON.stringify({ converted_at: null }) }).catch(() => {});

  // resolve the customer's business name + email (from the contact, or the deal)
  const contact = deal.contact_id ? rows(await svc(`presence_contacts?id=eq.${deal.contact_id}&site_id=eq.${site.id}&select=name,email,company&limit=1`))[0] : null;
  const businessName = clean((contact?.company || contact?.name || deal.title), 120) || 'New customer';
  const email = clean(contact?.email, 160).toLowerCase();
  const plan = pickPlan(cb.plan); // selectable edition (default 'presence'); billing formalized in P2-E (active access, unbilled — a deliberate P2-C decision)

  // 1) resolve/create the customer ACCOUNT so they can actually LOG IN. When we
  //    create a fresh login the customer never chose a password, so we email a
  //    signed set-password link (below). Track what WE created for clean rollback.
  let clientId: string | null = null;
  // `createdClient` = WE inserted the clients row on THIS convert (any of the three
  // creation paths below) → safe to delete on rollback. It is NEVER set for a REUSED
  // existing customer (findClientByEmail hit), so rollback can never delete someone
  // else's account. `createdAuthId` separately gates deleting a login we minted.
  let createdAuthId: string | null = null, createdClient = false, isNewLogin = false;
  if (email) {
    const existing = await findClientByEmail(email);
    if (existing) { clientId = existing.id; }                       // reuse — never duplicate a customer
    else {
      const auth = await createAuthUser(email, crypto.randomUUID() + 'Aa1!');
      if ('id' in auth) {
        createdAuthId = auth.id;
        const chain = await createContactAndClient(auth.id, email, businessName);
        if ('error' in chain) { await deleteAuthUser(auth.id); await unclaim(); return json({ error: 'client_failed', message: 'We couldn’t create the customer account — please try again.' }, 502, cors); }
        clientId = chain.clientId; createdClient = true; isNewLogin = true;
      } else if (auth.error === 'account_exists') {                 // they already sign in; link a client by email if missing
        clientId = (await findClientByEmail(email))?.id || null;
        if (!clientId) { const ci = await svc('clients', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name: businessName, email, contact_email: email, status: 'active' }) }); clientId = rows(ci)[0]?.id || null; if (clientId) createdClient = true; }
      } else { await unclaim(); return json({ error: 'auth_failed', message: 'We couldn’t set up the customer’s login — please try again.' }, 502, cors); }
    }
  } else {
    // no email on the deal → a studio-managed workspace (no self-serve login yet; invite later)
    const ci = await svc('clients', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name: businessName, status: 'active' }) });
    clientId = rows(ci)[0]?.id || null; if (clientId) createdClient = true;
  }
  if (!clientId) { await unclaim(); return json({ error: 'client_failed', message: 'We couldn’t create the customer account — please try again.' }, 502, cors); }

  // 2) reuse the ONE idempotent provisioning path (entitlement + site + hosting + seeds + first-run)
  const prov = await provisionForSignup({ clientId, businessName, plan, patch: { status: 'active' } as any, actorEmail: principal.email });
  if (!prov.ok) {
    if (createdClient) { await svc(`clients?id=eq.${clientId}`, { method: 'DELETE' }).catch(() => {}); if (createdAuthId) await deleteAuthUser(createdAuthId); } // roll back only what WE created (cascade drops site+entitlement)
    await unclaim();
    const msg = prov.error === 'hosting_unconfigured' ? 'The account was created but hosting isn’t available in this environment.' : 'We created the account but hit a snag provisioning the workspace.';
    return json({ error: 'provision_incomplete', message: msg }, 502, cors);
  }

  // 3) stamp the chain onto the deal (we hold the claim; converted_client_id UNIQUE
  //    also blocks a client already converted from ANOTHER deal).
  const up = await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${site.id}&converted_client_id=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ converted_client_id: clientId, converted_site_id: prov.siteId, stage: 'won' }) });
  if (!up.ok || !rows(up)[0]) {
    // stamp failed (e.g. this customer is already linked to another deal). Roll back
    // ONLY what WE created (never a reused existing customer); release the claim.
    if (createdClient) { await svc(`clients?id=eq.${clientId}`, { method: 'DELETE' }).catch(() => {}); if (createdAuthId) await deleteAuthUser(createdAuthId); }
    await unclaim();
    const fresh = await loadDeal(site.id, dealId);
    if (fresh?.converted_client_id) return json({ data: { converted: true, client_id: fresh.converted_client_id, site_id: fresh.converted_site_id, idempotent: true } }, 200, cors);
    return json({ error: 'convert_conflict', message: 'That customer is already linked to another deal.' }, 409, cors);
  }
  await dealEvent(site.id, dealId, 'converted', principal, { to_stage: 'won', detail: { client_id: clientId, site_id: prov.siteId } });
  await writeChangeEvent({ siteId: site.id, entityType: 'deal', entityId: dealId, action: 'convert', summary: `Converted “${deal.title}” to a customer`, principal, provenance: 'human' }).catch(() => {});

  // Seam 1: if the converting operator runs an AGENCY, add the new customer to
  // their managed portfolio (presence_agency_clients) so the Studio App can
  // service it via scope-switching — completing the Studio→Client loop. Idempotent
  // (site_id PK). Best-effort; a solo (non-agency) owner simply skips this.
  let managed = false;
  try {
    if (principal.jwt) {
      const am = await resolveAgencyMember(principal.jwt);
      if (am) {
        const link = await svc('presence_agency_clients?on_conflict=site_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ site_id: prov.siteId, agency_id: am.agency_id, status: 'active', owner_email: email || am.email }) });
        managed = link.ok;
      }
    }
  } catch { /* portfolio link is best-effort */ }

  // 4) ACCESS + onboarding handoff. A brand-new login gets a signed set-password
  //    link (they never chose a password) that lands them straight in the EXISTING
  //    guided first-run (via ?next=); an existing login gets a welcome. Best-effort.
  let invited = false;
  if (email) {
    if (isNewLogin) {
      const link = await generateSetPasswordLink(email, `${siteUrl()}/set-password.html?next=/get-started.html`);
      invited = !!link;
      sendEmail(email, 'Welcome to Studio OS — set up your login',
        `<p>Welcome! Your workspace is set up and ready.</p><p><a href="${link || `${siteUrl()}/portal.html`}">Set your password</a> to sign in — you’ll land straight in your guided setup. You can always sign in at <a href="${siteUrl()}/portal.html">your portal</a>.</p>`,
      ).catch(() => {});
    } else {
      sendEmail(email, 'Your workspace is ready — welcome to Studio OS',
        `<p>Welcome! Your workspace is set up and ready.</p><p>Sign in at <a href="${siteUrl()}/portal.html">your portal</a>, then open <a href="${siteUrl()}/get-started.html">your guided setup</a>.</p>`,
      ).catch(() => {});
    }
  }

  // 5) SERVICE-DELIVERY HANDOFF (Agency–Client Bridge): create the authoritative
  //    project on THIS (agency) site for the new customer + link the tenant-safe
  //    bridge to their own workspace, so post-sale delivery is connected with no
  //    manual step. Idempotent (deal.created_project_id UNIQUE + bridge UNIQUE).
  const handoff = await ensureProjectForDeal({ agencySiteId: site.id, deal, clientId, customerSiteId: prov.siteId || null, actor: actorOf(principal).actor, actorKind: actorOf(principal).actor_kind });
  return json({ data: { converted: true, client_id: clientId, site_id: prov.siteId, project_id: handoff.project?.id || null, hosted: prov.hosted, invited, managed, plan, onboarding: '/get-started.html' } }, 200, cors);
}
