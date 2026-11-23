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
import { appBase } from '../../_shared/app_url.ts';   // builder item 388: every link starts at the app's address
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { sendEmail } from '../commerce/account.ts';
import { loadEmailBrand } from '../lib/email_brand.ts';
import { raiseNotice, clearNotice } from '../lib/notice.ts';
import { rateAllow, clientIp, tooMany } from '../lib/ratelimit.ts';
import { normalizeLineItems, normalizeProposalMeta, splitLineItems, packLineItems, proposalTotals, computeProposalTotals, type ProposalMeta } from '../lib/sales_lifecycle.ts';
import { linesFromProposal } from '../lib/invoice_billing.ts';   // sales item 81
import { missingInsertColumns } from '../lib/inbound_email.ts';
import { canDecideEstimate, canReviseEstimate, isEstimateDecision, estimateExpired, estimateExpiresAt, ESTIMATE_DEFAULT_TITLE, ESTIMATE_TTL_DAYS } from '../lib/estimates.ts';
import { linkSecret, signSalesToken, verifySalesToken, dealEvent, loadDeal, firstOpen, keepEvidence, supersededByNewer } from './sales.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { UUID_RE } from '../lib/uuid.ts';

const clean = (s: unknown, max = 500) => String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const nowIso = () => new Date().toISOString();
const siteUrl = () => appBase();
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));
const usd = (cents: number) => '$' + (Math.round(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const totalOf = (e: { line_items?: unknown }) => proposalTotals(e?.line_items).total_cents;
// sales items 182, 183 (APPLY-0290): the version, the typed name on a yes, and when it was withdrawn
const EST_COLS = 'id,deal_id,title,line_items,subtotal_cents,currency,terms,status,sent_at,expires_at,first_viewed_at,decided_at,decided_note,proposal_id,invoice_id,created_at,version,decided_name,withdrawn_at';

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
export async function emailEstimate(siteId: string, dealId: string, url: string | null, totalCents: number): Promise<boolean> {
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
    return await sendEmail(String(email), `Your estimate from ${brand.name}`, html, brand, { critical: true, asBusiness: true, siteId, keep: 'money' });
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
  // sales item 183: its version, whether a newer one replaced it, and the name typed on a yes
  const out = { id: e.id, title: e.title, line_items: e.line_items, subtotal_cents: e.subtotal_cents, currency: e.currency, terms: e.terms, status: e.status, expires_at: e.expires_at, decided_at: e.decided_at, decided_note: e.decided_note, version: e.version || 1, decided_name: e.decided_name || '', superseded: !!splitLineItems(e.line_items).meta.superseded_by };
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
  // sales item 182: withdrawn when its deal closed; sales item 183: replaced by a newer version (its
  // own mark, or the newer one naming it, as proposals check)
  if (e.status === 'withdrawn') return json({ error: 'withdrawn', message: 'Your studio withdrew this estimate, so it can’t be answered. Ask them if you have questions.' }, 409, cors);
  if (splitLineItems(e.line_items).meta.superseded_by) return json({ error: 'superseded', message: 'Your studio sent a newer version of this estimate. Use the latest link they sent you.' }, 409, cors);
  if (decision === 'approved') {
    const later = await svc(`presence_estimates?deal_id=eq.${e.deal_id}&site_id=eq.${tok.site_id}&deleted_at=is.null&id=neq.${id}&select=id,line_items&limit=50`);
    if (!later.ok) return json({ error: 'unavailable', message: 'We couldn’t check this estimate just now. Try again in a moment.' }, 503, cors);
    if (supersededByNewer(id, rows(later))) return json({ error: 'superseded', message: 'Your studio sent a newer version of this estimate. Use the latest link they sent you.' }, 409, cors);
  }
  if (decision === 'approved' && estimateExpired(e, nowIso())) return json({ error: 'expired', message: 'This estimate has expired — ask your studio for a new one. Nothing is lost.' }, 409, cors);
  if (!canDecideEstimate(e.status, decision)) return json({ error: 'bad_state', message: 'This estimate was already answered.' }, 409, cors);
  // sales item 183: Approve takes the name they type (kept with where it came from, item 184)
  const yesName = decision === 'approved' ? clean(b.name, 120) : '';
  if (decision === 'approved' && !yesName) return json({ error: 'name_needed', message: 'Type your full name to approve.' }, 422, cors);
  const note = clean(b.note, 500);
  const fromWas = String(e.status);
  const up = await svc(`presence_estimates?id=eq.${id}&site_id=eq.${tok.site_id}&status=${decision === 'approved' ? 'in.(sent,declined)' : 'eq.sent'}&select=id,deal_id`, { method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: decision, decided_at: nowIso(), decided_note: note, ...(yesName ? { decided_name: yesName } : {}) }) });
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
  await dealEvent(tok.site_id, dealId, 'estimate_decided', ANSWER_SYS, { detail: { estimate_id: id, decision, total_cents: total, ...(yesName ? { name: yesName } : {}), ...(fromWas === 'declined' ? { after_not_now: true } : {}), ...(note ? { note } : {}), ...(backfilled ? { value_backfilled_cents: backfilled } : {}) } });
  if (yesName) await keepEvidence(tok.site_id, dealId, 'estimate', id, yesName, req);   // sales item 184
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
      if (decision === 'approved' && fromWas === 'declined') await clearNotice(st.client_id, 'deal_followup', `estdeclined:${dealId}:${id}`);   // item 183: the Not now line is over
    }
  } catch { /* the answer stands; the deal history has it */ }
  // sales item 179: an approved Extra work estimate adds the to-do and the draft invoice, once
  if (decision === 'approved') await extraWorkApproved(tok.site_id, id).catch(() => {});
  return json({ data: { status: decision } }, 200, cors);
}

// ═══ EDIT A DRAFT (sales item 183) ═══
// A draft that was never sent can be changed in place: its lines, discount, tax, title and notes.
// Once sent it is the record, and Revise makes the next version. The guard rides the write.
export async function handleEstimateEdit(req: Request, site: SiteRow, _principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const e = await loadEstimate(site.id, id);
  if (!e) return json({ error: 'not_found', message: 'That estimate isn’t here.' }, 404, cors);
  if (e.status !== 'draft') return json({ error: 'already_sent', message: 'This was already sent, so it stays as it went out. Revise it to send a new version.' }, 409, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const prior = splitLineItems(e.line_items);
  const norm = normalizeLineItems(b.line_items !== undefined ? b.line_items : prior.items);
  if (!norm.ok) return json({ error: 'validation', message: norm.error }, 422, cors);
  if (!norm.items.length) return json({ error: 'validation', message: 'Keep at least one line.' }, 422, cors);
  const m = normalizeProposalMeta(b);
  const meta: ProposalMeta = { discount: b.discount !== undefined ? (m.discount ?? null) : (prior.meta.discount ?? null), tax_pct: b.tax_pct !== undefined ? (m.tax_pct ?? null) : (prior.meta.tax_pct ?? null), revised_from: prior.meta.revised_from ?? null };
  const patch: Record<string, unknown> = { line_items: packLineItems(norm.items, meta), subtotal_cents: norm.subtotal_cents };
  if (b.title !== undefined) patch.title = clean(b.title, 200) || ESTIMATE_DEFAULT_TITLE;
  if (b.terms !== undefined) patch.terms = clean(b.terms, 5000);
  const up = await svc(`presence_estimates?id=eq.${id}&site_id=eq.${site.id}&status=eq.draft&deleted_at=is.null&select=${EST_COLS}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!up.ok) return json({ error: 'conflict', message: 'That didn’t save just now. Nothing changed. Try again.' }, 409, cors);
  const row = rows(up)[0];
  if (!row) return json({ error: 'already_sent', message: 'This was sent while you were editing it. Revise it to send a new version.' }, 409, cors);
  return json({ data: { ...row, total_cents: totalOf(row) } }, 200, cors);
}

// ═══ REVISE (sales item 183) ═══
// A sent estimate (also one past its date), one they said Not now to, or one withdrawn when its
// deal closed becomes the next version: a new draft with its lines (or the editor's), sent the
// usual way, while the old one is marked replaced so its link can no longer be approved. Like a
// proposal's Revise. An approved one is settled: it becomes a proposal or an invoice instead.
export async function handleEstimateRevise(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const e = await loadEstimate(site.id, id);
  if (!e) return json({ error: 'not_found', message: 'That estimate isn’t here.' }, 404, cors);
  if (!canReviseEstimate(e.status)) return json({ error: 'bad_state', message: e.status === 'draft' ? 'This is still a draft. Edit it instead.' : 'They approved this estimate, so it is settled. Turn it into a proposal or bill it instead.' }, 409, cors);
  const prior = splitLineItems(e.line_items);
  if (prior.meta.superseded_by) return json({ error: 'already_revised', message: 'This estimate was already revised. Change the newest version instead.' }, 409, cors);
  let b: any = {}; try { b = await req.json(); } catch { /* optional: a blank body copies it as it is */ }
  const norm = normalizeLineItems(b.line_items !== undefined ? b.line_items : prior.items);
  if (!norm.ok) return json({ error: 'validation', message: norm.error }, 422, cors);
  if (!norm.items.length) return json({ error: 'validation', message: 'Keep at least one line.' }, 422, cors);
  const m = normalizeProposalMeta(b);
  const meta: ProposalMeta = { discount: b.discount !== undefined ? (m.discount ?? null) : (prior.meta.discount ?? null), tax_pct: b.tax_pct !== undefined ? (m.tax_pct ?? null) : (prior.meta.tax_pct ?? null), revised_from: id };
  const version = (Math.trunc(Number(e.version)) || 1) + 1;
  const ins = await svc('presence_estimates', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, deal_id: e.deal_id, title: b.title !== undefined ? (clean(b.title, 200) || ESTIMATE_DEFAULT_TITLE) : (String(e.title || '') || ESTIMATE_DEFAULT_TITLE),
      line_items: packLineItems(norm.items, meta), subtotal_cents: norm.subtotal_cents, currency: e.currency || 'usd',
      terms: b.terms !== undefined ? clean(b.terms, 5000) : String(e.terms || ''), status: 'draft', version, created_by: principal.email || principal.userId || '' }) });
  const row = rows(ins)[0];
  if (!ins.ok || !row) return json({ error: 'write_failed', message: 'The new version didn’t save. Please try again.' }, 502, cors);
  // mark the old one replaced (in its own meta, keeping its lines); the approve step also checks
  // the new one's trail, so a missed mark can't let the old link be approved
  await svc(`presence_estimates?id=eq.${id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ line_items: packLineItems(prior.items, { ...prior.meta, superseded_by: row.id }) }) }).catch(() => {});
  return json({ data: { ...row, total_cents: totalOf(row) }, revised_from: id, version }, 201, cors);
}

// ═══ EXTRA WORK (sales item 179) ═══
// A change request past the deal's included rounds becomes an estimate marked "Extra work": a
// draft on the deal titled for what they asked to change, one line with their words at $0 for
// the studio to price, the request kept in its notes. One per request (approval_id is unique).
export async function draftExtraWork(siteId: string, deal: { id: string; title?: string }, projectId: string, approval: { id: string; title?: string }, note: string): Promise<string | null> {
  const had = rows(await svc(`presence_estimates?approval_id=eq.${approval.id}&site_id=eq.${siteId}&deleted_at=is.null&select=id&limit=1`))[0];
  if (had) return String(had.id);
  const title = `Extra work: ${clean(approval.title, 150) || 'the changes they asked for'}`;
  const ins = await svc('presence_estimates', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: siteId, deal_id: deal.id, title, line_items: [{ label: clean(note, 200) || 'The changes they asked for', qty: 1, unit_cents: 0 }], subtotal_cents: 0, currency: 'usd',
      terms: note ? `What they asked for: ${clean(note, 1000)}` : '', status: 'draft', extra_work: true, approval_id: approval.id, project_id: projectId, created_by: 'client-request' }) });
  const row = rows(ins)[0];
  if (!ins.ok || !row) return null;   // a second request that raced this one made it (the unique index)
  await dealEvent(siteId, deal.id, 'note', ANSWER_SYS, { detail: { change: 'extra_work', title, estimate_id: row.id } });
  try {
    const st = rows(await svc(`presence_sites?id=eq.${siteId}&select=client_id&limit=1`))[0];
    if (st?.client_id) await raiseNotice({ siteId, clientId: st.client_id, kind: 'deal_followup', period: `extrawork:${approval.id}`, headline: `Extra work to price — ${deal.title || 'a deal'}`, body: 'They asked for changes beyond the rounds included. An Extra work estimate is drafted on the deal with their words: price it and send it. Nothing reaches them until you do.' });
  } catch { /* the estimate is on the deal either way */ }
  return String(row.id);
}
/** Once an Extra work estimate is approved: a to-do on the project and a draft invoice (the
 *  estimate's own Bill it as an invoice, which makes one once and never sends it). */
export async function extraWorkApproved(siteId: string, estId: string): Promise<void> {
  const e = rows(await svc(`presence_estimates?id=eq.${estId}&site_id=eq.${siteId}&select=id,deal_id,title,line_items,status,extra_work,project_id&limit=1`))[0];
  if (!e || !e.extra_work || e.status !== 'approved') return;
  if (UUID_RE.test(String(e.project_id || ''))) {
    const source = `extra_work:${estId}`;
    const has = rows(await svc(`presence_tasks?project_id=eq.${e.project_id}&site_id=eq.${siteId}&source=eq.${encodeURIComponent(source)}&deleted_at=is.null&select=id&limit=1`))[0];
    if (!has) await svc('presence_tasks', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ site_id: siteId, project_id: e.project_id, title: String(e.title || 'Extra work').slice(0, 200), status: 'todo', priority: 'normal', client_visible: false, source }) }).catch(() => {});
  }
  const st = rows(await svc(`presence_sites?id=eq.${siteId}&select=id,client_id&limit=1`))[0];
  await handleEstimateToInvoice(new Request('https://estimate.local/'), { id: siteId, client_id: st?.client_id || null } as SiteRow, ANSWER_SYS, estId, {}).catch(() => null);
  if (st?.client_id) await raiseNotice({ siteId, clientId: st.client_id, kind: 'deal_followup', period: `extradone:${estId}`, headline: `Extra work approved — ${String(e.title || '').replace(/^Extra work: /, '')} (${usd(totalOf(e))})`, body: 'They approved it. A to-do is on the project and a draft invoice is ready: press Send on it when the work is done.' }).catch(() => false);
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
  // The claim also wins when the estimate still points at a proposal that was since
  // deleted: otherwise the new one is taken back down and "created" answers with nothing.
  const stalePid = UUID_RE.test(String(e.proposal_id || '')) ? `proposal_id=eq.${e.proposal_id}` : 'proposal_id=is.null';
  const claim = await svc(`presence_estimates?id=eq.${id}&site_id=eq.${site.id}&${stalePid}&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ proposal_id: prop.id }) });
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
  const newRow: Record<string, unknown> = { site_id: site.id, deal_id: e.deal_id, customer_client_id: deal?.converted_client_id || null, customer_site_id: deal?.converted_site_id || null,
    title, description: `${title} — ${deal?.title || 'project'}`, amount_cents: total, currency: 'usd', purpose: 'service', status: 'open', due_date: null, created_by: principal.email || principal.userId || 'system' };
  // sales item 81: the invoice carries the estimate's lines, its discount and tax (when they add up)
  const { items, meta } = splitLineItems(e.line_items);
  const lines = linesFromProposal(items, computeProposalTotals(items, meta), meta, []);
  if (lines.length > 1 && lines.reduce((n, l) => n + l.amount_cents, 0) === total) newRow.lines = lines;
  let ins = await svc('presence_invoices', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(newRow) });
  if (!ins.ok && 'lines' in newRow && missingInsertColumns(ins.json, ins.text, ['lines']).length) {   // before APPLY-0167
    delete newRow.lines;
    ins = await svc('presence_invoices', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(newRow) });
  }
  const inv = rows(ins)[0];
  if (!ins.ok || !inv) return json({ error: 'write_failed', message: 'The invoice didn’t save — please try again.' }, 502, cors);
  const staleIid = UUID_RE.test(String(e.invoice_id || '')) ? `invoice_id=eq.${e.invoice_id}` : 'invoice_id=is.null';   // same as the proposal: a voided or deleted first invoice must not block the second
  const claim = await svc(`presence_estimates?id=eq.${id}&site_id=eq.${site.id}&${staleIid}&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ invoice_id: inv.id }) });
  if (claim.ok && !rows(claim)[0]) {
    // a second press got there first: this one was never sent, so it simply goes
    await svc(`presence_invoices?id=eq.${inv.id}&site_id=eq.${site.id}&stripe_url=is.null`, { method: 'PATCH', body: JSON.stringify({ deleted_at: nowIso() }) }).catch(() => {});
    const winner = await existing(rows(await svc(`presence_estimates?id=eq.${id}&site_id=eq.${site.id}&select=invoice_id&limit=1`))[0]?.invoice_id);
    if (winner) return json({ data: winner, already: true }, 200, cors);
  }
  if (site.client_id) await clearNotice(site.client_id, 'deal_signed', `estimate:${e.deal_id}:${id}`);   // done: it became an invoice
  return json({ data: inv }, 201, cors);
}
