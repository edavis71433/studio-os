// ── Estimates (sales review item 47, Nov 2026) ───────────────────────────────
// A document beside proposals and agreements: a price before anything is
// agreed. Eric chose how it works on Nov 8 —
//   • the client gets an email, "Your estimate from <studio>", with one button
//     to a page listing each item and the total, saying nothing is charged,
//     with Approve or Not now and an optional note. Good for 30 days, one
//     reminder after 3 days (commerce/lifecycle.ts runSalesDocReminders),
//     printable (lib/documents.ts);
//   • approving puts a line in Needs you and fills the deal's value if it is
//     empty, but never moves the deal's stage;
//   • on the deal, an estimate can be turned into a proposal or billed as an
//     invoice, before or after the client answers. Each makes a DRAFT — nothing
//     reaches the client until the studio presses Send on it.
// It reuses the proposal's whole shape (line items, the reserved discount/tax
// element, the totals, the document renderer, the signed link and its page);
// only the storage (presence_estimates, migration 0145) and the answers differ.
// Studio-gated and site-scoped like every authed /sales/* route; the decide
// route is public, authorized only by the estimate's signed link.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { sendEmail } from '../commerce/account.ts';
import { loadEmailBrand } from '../lib/email_brand.ts';
import { raiseNotice, clearNotice } from '../lib/notice.ts';
import { rateAllow, clientIp, tooMany } from '../lib/ratelimit.ts';
import { normalizeLineItems, normalizeProposalMeta, splitLineItems, packLineItems, proposalTotals, type ProposalMeta } from '../lib/sales_lifecycle.ts';
import { canDecideEstimate, isEstimateDecision, estimateExpired, estimateExpiresAt, ESTIMATE_DEFAULT_TITLE, ESTIMATE_TTL_DAYS } from '../lib/estimates.ts';
import { linkSecret, signSalesToken, verifySalesToken, dealEvent, loadDeal, firstOpen } from './sales.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (s: unknown, max = 500) => String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const nowIso = () => new Date().toISOString();
const siteUrl = () => (Deno.env.get('SITE_URL') || 'https://davisdigitalstudio.com').replace(/\/$/, '');
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));
const usd = (cents: number) => '$' + (Math.round(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const totalOf = (e: { line_items?: unknown }) => proposalTotals(e?.line_items).total_cents;
const EST_COLS = 'id,deal_id,title,line_items,subtotal_cents,currency,terms,status,sent_at,expires_at,first_viewed_at,decided_at,decided_note,proposal_id,invoice_id,created_at';

/** Before APPLY-0145 the table isn't there. PostgREST answers 404 with PGRST205
 *  ("could not find the table") — or 42P01 from an older PostgREST. Pure. */
export function tableMissing(r: { status?: number; json?: unknown; text?: string } | null | undefined): boolean {
  if (!r) return false;
  const j = (r.json && typeof r.json === 'object') ? r.json as Record<string, unknown> : {};
  const code = String(j.code ?? '');
  return r.status === 404 || code === 'PGRST205' || code === '42P01' || /could not find the table|relation .* does not exist/i.test(String(j.message ?? r.text ?? ''));
}
const needsUpdate = (cors: Record<string, string>) => json({ error: 'unavailable', message: 'Estimates need a one-time database update before they can be made.' }, 503, cors);

async function loadEstimate(siteId: string, id: string): Promise<any | null> {
  if (!UUID_RE.test(id)) return null;
  return rows(await svc(`presence_estimates?id=eq.${id}&site_id=eq.${siteId}&deleted_at=is.null&select=${EST_COLS}&limit=1`))[0] || null;
}
/** The deal page's read: every live estimate on the deal, newest first, each
 *  with its total after discount and tax. [] before APPLY-0145 (or on any failed
 *  read) — the page then simply shows none. */
export async function estimatesForDeal(siteId: string, dealId: string): Promise<any[]> {
  try {
    const r = await svc(`presence_estimates?deal_id=eq.${dealId}&site_id=eq.${siteId}&deleted_at=is.null&select=${EST_COLS}&order=created_at.desc&limit=50`);
    return rows(r).map((e) => ({ ...e, total_cents: totalOf(e) }));
  } catch { return []; }
}

/** The client's link: sign.html with an `estimate` token naming this estimate.
 *  30 days, like the estimate itself. Null when no signing secret is configured. */
export async function estimateLink(siteId: string, id: string): Promise<string | null> {
  const secret = linkSecret();
  if (!secret || !UUID_RE.test(id)) return null;
  const token = await signSalesToken({ t: 'estimate', id, site_id: siteId, exp: Math.floor(Date.now() / 1000) + ESTIMATE_TTL_DAYS * 86400 }, secret);
  return `${siteUrl()}/sign.html?t=${token}`;
}

/** "Your estimate from <studio>" — to the deal's contact, on the studio's brand.
 *  Best-effort: false when the deal has no contact email. */
async function emailEstimate(siteId: string, dealId: string, url: string | null, totalCents: number): Promise<boolean> {
  if (!url) return false;
  try {
    const deal = rows(await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${siteId}&select=contact_id&limit=1`))[0];
    const email = deal?.contact_id ? rows(await svc(`presence_contacts?id=eq.${deal.contact_id}&site_id=eq.${siteId}&select=email&limit=1`))[0]?.email : '';
    if (!email) return false;
    const brand = await loadEmailBrand(siteId);
    const who = esc(brand.name);
    const btn = `<a href="${url}" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">See the estimate →</a>`;
    const html = `<p>${who} has put together an estimate for you${totalCents > 0 ? `: <strong>${usd(totalCents)}</strong>` : ''}. It’s a price before anything is agreed, and nothing is charged. You can approve it, or say not now, on the page.</p><p class="cta">${btn}</p>`;
    // a document they asked for = transactional; their answer lands in the Inbox
    return await sendEmail(String(email), `Your estimate from ${brand.name}`, html, brand, { critical: true, siteId });
  } catch { return false; }
}

// ═══ MAKE ═══
export async function handleEstimateCreate(req: Request, site: SiteRow, principal: Principal, dealId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(dealId)) return json({ error: 'bad_request' }, 400, cors);
  const deal = await loadDeal(site.id, dealId);
  if (!deal) return json({ error: 'not_found', message: 'That deal is no longer here.' }, 404, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const norm = normalizeLineItems(b.line_items);
  if (!norm.ok) return json({ error: 'validation', message: norm.error }, 422, cors);
  if (!norm.items.length) return json({ error: 'validation', message: 'Add at least one line — what it is and its price.' }, 422, cors);
  const m = normalizeProposalMeta(b);
  const meta: ProposalMeta = { discount: m.discount ?? null, tax_pct: m.tax_pct ?? null };
  const ins = await svc('presence_estimates', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, deal_id: dealId, title: clean(b.title, 200) || ESTIMATE_DEFAULT_TITLE,
      line_items: packLineItems(norm.items, meta), subtotal_cents: norm.subtotal_cents, currency: clean(b.currency, 8) || 'usd',
      terms: clean(b.terms, 5000), status: 'draft', created_by: principal.email || principal.userId || '' }) });
  if (!ins.ok && tableMissing(ins)) return needsUpdate(cors);
  const row = rows(ins)[0];
  if (!ins.ok || !row) return json({ error: 'write_failed', message: 'That estimate didn’t save — please try again.' }, 502, cors);
  return json({ data: { ...row, total_cents: totalOf(row) } }, 201, cors);
}

// ═══ SEND ═══
export async function handleEstimateSend(_req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const e = await loadEstimate(site.id, id);
  if (!e) return json({ error: 'not_found', message: 'That estimate isn’t here.' }, 404, cors);
  // already out: hand the link back for copying, email nobody twice
  if (e.status === 'sent') return json({ data: e, url: await estimateLink(site.id, id), emailed: false, already_sent: true }, 200, cors);
  if (e.status !== 'draft') return json({ error: 'bad_state', message: 'They already answered this estimate.' }, 409, cors);
  const up = await svc(`presence_estimates?id=eq.${id}&site_id=eq.${site.id}&status=eq.draft&deleted_at=is.null&select=${EST_COLS}`, { method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'sent', sent_at: nowIso(), expires_at: estimateExpiresAt(Date.now()) }) });
  const sent = rows(up)[0];
  if (!up.ok || !sent) return json({ error: 'conflict', message: 'This estimate changed while you were sending it — reload and take another look.' }, 409, cors);
  const total = totalOf(sent);
  const url = await estimateLink(site.id, id);
  const emailed = await emailEstimate(site.id, sent.deal_id, url, total);
  await dealEvent(site.id, sent.deal_id, 'estimate_sent', principal, { detail: { estimate_id: id, total_cents: total } });
  return json({ data: { ...sent, total_cents: total }, url, emailed }, 200, cors);
}

// ═══ THE CLIENT'S PAGE (token) — called by handleSalesPublicView ═══
export async function estimatePublicView(tok: { id: string; site_id: string }, brand: { name: string; accent: string } | null, cors: Record<string, string>): Promise<Response> {
  const e = rows(await svc(`presence_estimates?id=eq.${tok.id}&site_id=eq.${tok.site_id}&deleted_at=is.null&select=${EST_COLS}&limit=1`))[0];
  // a link is only ever minted when the estimate is sent, so a draft is "not here"
  if (!e || e.status === 'draft') return json({ error: 'not_found', message: 'This estimate is no longer available — ask your studio for a fresh one.' }, 404, cors);
  if (!e.first_viewed_at) await firstOpen('presence_estimates', e.id, tok.site_id, e.deal_id, 'estimate');   // "They opened your estimate"
  const out = { id: e.id, title: e.title, line_items: e.line_items, subtotal_cents: e.subtotal_cents, currency: e.currency, terms: e.terms, status: e.status, expires_at: e.expires_at, decided_at: e.decided_at, decided_note: e.decided_note };
  return json({ data: { kind: 'estimate', brand, expired: estimateExpired(e, nowIso()), ...out } }, 200, cors);
}

// ═══ APPROVE / NOT NOW (public, token) ═══
const ANSWER_SYS: Principal = { kind: 'public', userId: 'estimate-link', tenantId: null, role: null, email: null, jwt: null, requestId: 'estimate-decide' } as Principal;
export async function handleEstimateDecide(req: Request, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  if (!(await rateAllow(`sales_decide:${clientIp(req)}`, 20, 60))) return tooMany(cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  if (!isEstimateDecision(b.decision)) return json({ error: 'bad_decision' }, 422, cors);
  const decision = b.decision as 'approved' | 'declined';
  const secret = linkSecret();
  if (!secret) return json({ error: 'unavailable' }, 503, cors);
  const tok = await verifySalesToken(String(b.token || ''), secret, Math.floor(Date.now() / 1000));
  if (!tok || tok.t !== 'estimate' || tok.id !== id) return json({ error: 'invalid_link', message: 'This link isn’t valid or has expired.' }, 403, cors);
  const e = rows(await svc(`presence_estimates?id=eq.${id}&site_id=eq.${tok.site_id}&deleted_at=is.null&select=${EST_COLS}&limit=1`))[0];
  if (!e) return json({ error: 'not_found', message: 'This estimate is no longer available.' }, 404, cors);
  if (e.status === decision) return json({ data: { status: e.status }, already: true }, 200, cors);   // a second tap
  if (decision === 'approved' && estimateExpired(e, nowIso())) return json({ error: 'expired', message: 'This estimate has expired — ask your studio for an updated one. Nothing is lost.' }, 409, cors);
  if (!canDecideEstimate(e.status, decision)) return json({ error: 'bad_state', message: 'This estimate was already answered.' }, 409, cors);
  const note = clean(b.note, 500);
  const up = await svc(`presence_estimates?id=eq.${id}&site_id=eq.${tok.site_id}&status=eq.sent&select=id,deal_id`, { method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: decision, decided_at: nowIso(), decided_note: note }) });
  if (!up.ok || !rows(up)[0]) return json({ error: 'conflict', message: 'That didn’t go through — reload the page and try again.' }, 409, cors);
  const dealId = String(e.deal_id);
  const total = totalOf(e);
  // The price flows forward, as an accepted proposal's does: an approved estimate
  // fills a deal value that is still 0 (the eq.0 guard rides in the WHERE, so a
  // value the studio typed always wins). The stage never moves.
  let backfilled = 0;
  if (decision === 'approved' && total > 0) {
    try {
      const bf = await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${tok.site_id}&expected_value_cents=eq.0&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ expected_value_cents: Math.min(1_000_000_00, total) }) });
      if (rows(bf)[0]) backfilled = Math.min(1_000_000_00, total);
    } catch { /* the answer stands */ }
  }
  await dealEvent(tok.site_id, dealId, 'estimate_decided', ANSWER_SYS, { detail: { estimate_id: id, decision, total_cents: total, ...(note ? { note } : {}), ...(backfilled ? { value_backfilled_cents: backfilled } : {}) } });
  try {
    const st = rows(await svc(`presence_sites?id=eq.${tok.site_id}&select=client_id&limit=1`))[0];
    const title = String(rows(await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${tok.site_id}&select=title&limit=1`))[0]?.title || 'a deal');
    if (st?.client_id) {
      const said = note ? `: “${note.slice(0, 200)}”` : '';
      if (decision === 'approved') {
        // Needs you (agency/needs_you.ts reads estimate:<deal>:<estimate>); cleared once it becomes a proposal or an invoice
        await raiseNotice({ siteId: tok.site_id, clientId: st.client_id, kind: 'deal_signed', period: `estimate:${dealId}:${id}`, headline: `Estimate approved — ${title} (${usd(total)})`, body: `They approved your ${usd(total)} estimate${said}. Turn it into a proposal or bill it as an invoice — nothing goes out until you press Send.` });
      } else {
        await raiseNotice({ siteId: tok.site_id, clientId: st.client_id, kind: 'deal_followup', period: `estdeclined:${dealId}:${id}`, headline: `They passed on the estimate — ${title}`, body: `They chose Not now${said}. A quick follow-up often keeps the door open — or send an updated estimate.` });
      }
      // the reminder's silent ledger row (runSalesDocReminders) — belt and braces, as proposals do
      await clearNotice(st.client_id, 'deal_followup', `remind:${id}`);
    }
  } catch { /* the answer stands; the deal history has it */ }
  return json({ data: { status: decision } }, 200, cors);
}

// ═══ REMOVE A DRAFT ═══
// Only a draft goes, softly (deleted_at), with status=eq.draft in the PATCH's
// WHERE so a send that lands mid-flight wins. Once sent, it is the record.
export async function handleEstimateDelete(site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const e = await loadEstimate(site.id, id);
  if (!e) return json({ error: 'not_found', message: 'That estimate isn’t here.' }, 404, cors);
  if (e.status !== 'draft') return json({ error: 'already_sent', message: 'This was already sent — it stays on the record.' }, 409, cors);
  const up = await svc(`presence_estimates?id=eq.${id}&site_id=eq.${site.id}&status=eq.draft&deleted_at=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ deleted_at: nowIso() }) });
  if (!up.ok) return json({ error: 'conflict', message: 'Couldn’t remove it just now — nothing changed. Try again.' }, 409, cors);
  if (!rows(up)[0]) return json({ error: 'already_sent', message: 'This was already sent — it stays on the record.' }, 409, cors);
  await dealEvent(site.id, e.deal_id, 'estimate_deleted', principal, { detail: { estimate_id: id, title: String(e.title || '') } });
  return json({ data: { ok: true, id } }, 200, cors);
}

// ═══ TURN INTO A PROPOSAL ═══
// A proposal DRAFT with the estimate's items, discount, tax and notes. The studio
// checks it and sends it the usual way (with the agreement and the deposit).
// Safe to press twice: the estimate remembers its proposal, and a race between
// two presses keeps one and removes the other draft.
export async function handleEstimateToProposal(_req: Request, site: SiteRow, _principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const e = await loadEstimate(site.id, id);
  if (!e) return json({ error: 'not_found', message: 'That estimate isn’t here.' }, 404, cors);
  const existing = async (pid: unknown) => UUID_RE.test(String(pid || '')) ? rows(await svc(`presence_proposals?id=eq.${pid}&site_id=eq.${site.id}&deleted_at=is.null&select=*&limit=1`))[0] || null : null;
  const already = await existing(e.proposal_id);
  if (already) return json({ data: already, already: true }, 200, cors);
  const { items, meta } = splitLineItems(e.line_items);
  const title = e.title && e.title !== ESTIMATE_DEFAULT_TITLE ? String(e.title) : 'Proposal';
  const ins = await svc('presence_proposals', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, deal_id: e.deal_id, title, line_items: packLineItems(items, { discount: meta.discount ?? null, tax_pct: meta.tax_pct ?? null }),
      subtotal_cents: Number(e.subtotal_cents) || 0, currency: e.currency || 'usd', terms: String(e.terms || ''), status: 'draft' }) });
  const prop = rows(ins)[0];
  if (!ins.ok || !prop) return json({ error: 'write_failed', message: 'The proposal didn’t save — please try again.' }, 502, cors);
  const claim = await svc(`presence_estimates?id=eq.${id}&site_id=eq.${site.id}&proposal_id=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ proposal_id: prop.id }) });
  if (claim.ok && !rows(claim)[0]) {
    // a second press got there first: keep its proposal, take this draft back down
    await svc(`presence_proposals?id=eq.${prop.id}&site_id=eq.${site.id}&status=eq.draft`, { method: 'PATCH', body: JSON.stringify({ deleted_at: nowIso() }) }).catch(() => {});
    const winner = await existing(rows(await svc(`presence_estimates?id=eq.${id}&site_id=eq.${site.id}&select=proposal_id&limit=1`))[0]?.proposal_id);
    if (winner) return json({ data: winner, already: true }, 200, cors);
  }
  if (site.client_id) await clearNotice(site.client_id, 'deal_signed', `estimate:${e.deal_id}:${id}`);   // done: it became a proposal
  return json({ data: prop }, 201, cors);
}

// ═══ BILL IT AS AN INVOICE ═══
// An open invoice for the estimate's total, NOT sent: it shows on the deal's
// Invoice & deposit list with its Send button (handleSalesInvoiceSend makes the
// pay link and emails it). For small jobs that need no proposal or agreement.
export async function handleEstimateToInvoice(_req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const e = await loadEstimate(site.id, id);
  if (!e) return json({ error: 'not_found', message: 'That estimate isn’t here.' }, 404, cors);
  const existing = async (iid: unknown) => UUID_RE.test(String(iid || '')) ? rows(await svc(`presence_invoices?id=eq.${iid}&site_id=eq.${site.id}&deleted_at=is.null&status=neq.void&select=*&limit=1`))[0] || null : null;
  const already = await existing(e.invoice_id);
  if (already) return json({ data: already, already: true }, 200, cors);
  const total = totalOf(e);
  if (total < 50) return json({ error: 'validation', message: 'This estimate’s total is under $0.50, so there’s nothing to bill.' }, 422, cors);
  if (total > 100000000) return json({ error: 'validation', message: 'That total is over $1,000,000 — double-check the estimate and try again.' }, 422, cors);
  const deal = await loadDeal(site.id, e.deal_id);
  const title = e.title && e.title !== ESTIMATE_DEFAULT_TITLE ? String(e.title).slice(0, 200) : 'Invoice';
  const ins = await svc('presence_invoices', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, deal_id: e.deal_id, customer_client_id: deal?.converted_client_id || null, customer_site_id: deal?.converted_site_id || null,
      title, description: `${title} — ${deal?.title || 'project'}`, amount_cents: total, currency: 'usd', purpose: 'service', status: 'open', due_date: null, created_by: principal.email || principal.userId || 'system' }) });
  const inv = rows(ins)[0];
  if (!ins.ok || !inv) return json({ error: 'write_failed', message: 'The invoice didn’t save — please try again.' }, 502, cors);
  const claim = await svc(`presence_estimates?id=eq.${id}&site_id=eq.${site.id}&invoice_id=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ invoice_id: inv.id }) });
  if (claim.ok && !rows(claim)[0]) {
    // a second press got there first: this one was never sent, so it simply goes
    await svc(`presence_invoices?id=eq.${inv.id}&site_id=eq.${site.id}&stripe_url=is.null`, { method: 'PATCH', body: JSON.stringify({ deleted_at: nowIso() }) }).catch(() => {});
    const winner = await existing(rows(await svc(`presence_estimates?id=eq.${id}&site_id=eq.${site.id}&select=invoice_id&limit=1`))[0]?.invoice_id);
    if (winner) return json({ data: winner, already: true }, 200, cors);
  }
  if (site.client_id) await clearNotice(site.client_id, 'deal_signed', `estimate:${e.deal_id}:${id}`);   // done: it became an invoice
  return json({ data: inv }, 201, cors);
}
