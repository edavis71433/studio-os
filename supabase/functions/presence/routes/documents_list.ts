// ═══ THE DOCUMENTS PAGE (sales item 180, Nov 22 2026 review) ═════════════════
//   GET  /sales/documents?today=YYYY-MM-DD   every proposal, estimate and agreement, newest first
//   POST /sales/documents/remind {kind, id}  re-sends the client's link, once (never twice)
// "Which proposals are still out?" meant opening deals one by one. This page lists every
// document with its customer, amount and where it stands, in one word (docState), so the page's
// chips (Out, Opened, Accepted, Signed, Expired) are filters over that word. Remind re-sends the
// link the client already has (the deal's one link for a proposal or an agreement, the
// estimate's own link), once per document: the guard rides the write (reminded_at=is.null).
// Studio-gated and site-scoped like every authed /sales/* route.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { UUID_RE } from '../lib/uuid.ts';
import { splitLineItems, proposalTotals, callerToday } from '../lib/sales_lifecycle.ts';
import { flowLink, emailSalesDoc, dealEvent } from './sales.ts';
import { estimateLink, emailEstimate } from './estimates.ts';

const rows = (r: { json?: unknown } | null | undefined) => (Array.isArray((r as any)?.json) ? (r as any).json : []) as any[];
const nowIso = () => new Date().toISOString();
export const DOCS_MAX = 1000;   // per kind; past it `partial` says the list is the newest only

export type DocKind = 'proposal' | 'estimate' | 'contract';
export type DocState = 'draft' | 'out' | 'opened' | 'accepted' | 'signed' | 'expired' | 'declined' | 'withdrawn' | 'replaced';
/** Where one document stands, in one word. Out and Opened are both still waiting on the client
 *  (Opened: they've looked); a proposal or an estimate past its date is Expired; one a newer
 *  version replaced is Replaced; one the studio took back is Withdrawn (an agreement's 'voided').
 *  `today` is the caller's day, so a date ends when their day does. Pure. */
export function docState(kind: DocKind, d: Record<string, unknown>, nowIsoStr: string): DocState {
  const s = String(d?.status || 'draft');
  if (s === 'draft') return 'draft';
  if (s === 'withdrawn' || (kind === 'contract' && s === 'voided')) return 'withdrawn';
  if (kind !== 'contract' && splitLineItems(d?.line_items).meta.superseded_by) return 'replaced';
  if (s === 'accepted' || s === 'approved') return 'accepted';
  if (s === 'signed') return 'signed';
  if (s === 'declined') return 'declined';
  if (kind !== 'contract' && d?.expires_at && String(d.expires_at) < nowIsoStr) return 'expired';
  return d?.first_viewed_at ? 'opened' : 'out';
}
/** May Remind re-send this one? Only while it waits on the client, and only once. Pure. */
export function canRemind(kind: DocKind, d: Record<string, unknown>, nowIsoStr: string): boolean {
  const st = docState(kind, d, nowIsoStr);
  return (st === 'out' || st === 'opened') && !d?.reminded_at;
}

const COLS: Record<DocKind, string> = {
  proposal: 'id,deal_id,title,line_items,status,version,sent_at,first_viewed_at,expires_at,decided_at,created_at,reminded_at',
  estimate: 'id,deal_id,title,line_items,status,sent_at,first_viewed_at,expires_at,decided_at,created_at,reminded_at',
  contract: 'id,deal_id,title,status,sent_at,first_viewed_at,signed_at,signer_name,created_at,reminded_at',
};
const TABLE: Record<DocKind, string> = { proposal: 'presence_proposals', estimate: 'presence_estimates', contract: 'presence_contracts' };

export async function handleDocumentsList(req: Request, site: SiteRow, cors: Record<string, string>): Promise<Response> {
  const today = callerToday(new URL(req.url).searchParams.get('today'), nowIso());
  const read = (k: DocKind) => svc(`${TABLE[k]}?site_id=eq.${site.id}&deleted_at=is.null&select=${COLS[k]}&order=created_at.desc&limit=${DOCS_MAX}`);
  const [p, e, c] = await Promise.all([read('proposal'), read('estimate'), read('contract')]);
  if (!p.ok || !c.ok) return json({ error: 'read_failed', message: 'Your documents couldn’t load just now.' }, 502, cors);
  const props = rows(p), ests = e.ok ? rows(e) : [], cons = rows(c);   // estimates: [] if that read fails, as the deal page does
  const dealIds = [...new Set([...props, ...ests, ...cons].map((x) => String(x.deal_id || '')).filter((x) => UUID_RE.test(x)))];
  const chunks: string[][] = []; for (let i = 0; i < dealIds.length; i += 100) chunks.push(dealIds.slice(i, i + 100));
  const deals = (await Promise.all(chunks.map((ids) => svc(`presence_deals?id=in.(${ids.join(',')})&site_id=eq.${site.id}&select=id,title,contact_id,stage,expected_value_cents,deleted_at`).then(rows).catch(() => [] as any[])))).flat();
  const contactIds = [...new Set(deals.map((d: any) => String(d.contact_id || '')).filter((x: string) => UUID_RE.test(x)))];
  const cchunks: string[][] = []; for (let i = 0; i < contactIds.length; i += 100) cchunks.push(contactIds.slice(i, i + 100));
  const people = (await Promise.all(cchunks.map((ids) => svc(`presence_contacts?id=in.(${ids.join(',')})&site_id=eq.${site.id}&select=id,name,company`).then(rows).catch(() => [] as any[])))).flat();
  const dealBy = new Map(deals.map((d: any) => [String(d.id), d])), personBy = new Map(people.map((x: any) => [String(x.id), x]));
  // an agreement carries no price of its own: the deal's accepted proposal, else its open one, else the deal's value
  const priceOf = (dealId: string) => {
    const mine = props.filter((x) => String(x.deal_id) === dealId && !splitLineItems(x.line_items).meta.superseded_by);
    const pick = mine.find((x) => x.status === 'accepted') || mine.find((x) => x.status === 'sent');
    return pick ? proposalTotals(pick.line_items).total_cents : Math.max(0, Number(dealBy.get(dealId)?.expected_value_cents) || 0);
  };
  const now = nowIso();
  const one = (kind: DocKind, x: any) => {
    const d = dealBy.get(String(x.deal_id || '')), who = d ? personBy.get(String(d.contact_id || '')) : null;
    return {
      kind, id: x.id, deal_id: x.deal_id, deal_title: String(d?.title || ''), deal_gone: !d || !!d.deleted_at,
      title: String(x.title || (kind === 'contract' ? 'Agreement' : kind === 'estimate' ? 'Estimate' : 'Proposal')), version: Number(x.version) || 1,
      business: String(who?.company || ''), person: String(who?.name || ''),
      amount_cents: kind === 'contract' ? priceOf(String(x.deal_id || '')) : proposalTotals(x.line_items).total_cents,
      state: docState(kind, x, now), sent_at: x.sent_at || null, opened_at: x.first_viewed_at || null, expires_at: x.expires_at || null,
      decided_at: x.decided_at || x.signed_at || null, created_at: x.created_at, reminded_at: x.reminded_at || null, can_remind: canRemind(kind, x, now),
    };
  };
  const items = [...props.map((x) => one('proposal', x)), ...ests.map((x) => one('estimate', x)), ...cons.map((x) => one('contract', x))]
    .filter((x) => !x.deal_gone)
    .sort((a, b) => String(b.sent_at || b.created_at || '').localeCompare(String(a.sent_at || a.created_at || '')));
  return json({ data: { items, today, partial: props.length >= DOCS_MAX || ests.length >= DOCS_MAX || cons.length >= DOCS_MAX } }, 200, cors);
}

// ═══ REMIND, once ═══
export async function handleDocumentRemind(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const kind = (['proposal', 'estimate', 'contract'] as const).find((k) => k === b.kind);
  const id = String(b.id || '');
  if (!kind || !UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const d = rows(await svc(`${TABLE[kind]}?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=${COLS[kind]}&limit=1`))[0];
  if (!d) return json({ error: 'not_found', message: 'That document isn’t here.' }, 404, cors);
  const st = docState(kind, d, nowIso());
  if (d.reminded_at) return json({ error: 'already_reminded', reminded_at: d.reminded_at, message: 'You reminded them already. One reminder per document, so it never nags.' }, 409, cors);
  if (st === 'expired') return json({ error: 'expired', message: 'It has expired. Revise it to send them a fresh one.' }, 409, cors);
  if (st !== 'out' && st !== 'opened') return json({ error: 'not_waiting', message: 'They aren’t waiting on this one any more, so there’s nothing to remind them of.' }, 409, cors);
  // the once-guard: only the press that sets reminded_at sends
  const stamp = await svc(`${TABLE[kind]}?id=eq.${id}&site_id=eq.${site.id}&status=eq.sent&reminded_at=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ reminded_at: nowIso() }) });
  if (!stamp.ok) return json({ error: 'conflict', message: 'That didn’t go through just now. Nothing was sent. Try again.' }, 409, cors);
  if (!rows(stamp)[0]) return json({ error: 'already_reminded', message: 'You reminded them already. One reminder per document, so it never nags.' }, 409, cors);
  const dealId = String(d.deal_id || '');
  let emailed = false;
  try {
    if (kind === 'estimate') emailed = await emailEstimate(site.id, dealId, await estimateLink(site.id, id), proposalTotals(d.line_items).total_cents);
    else emailed = await emailSalesDoc(site.id, dealId, kind, await flowLink(site.id, dealId));
  } catch { emailed = false; }
  if (!emailed) {
    // nothing reached them, so the one reminder isn't spent: put the mark back
    await svc(`${TABLE[kind]}?id=eq.${id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ reminded_at: null }) }).catch(() => {});
    return json({ error: 'not_sent', message: 'There’s no email for them on this deal, so nothing was sent. Add one to the deal, then press Remind.' }, 409, cors);
  }
  if (UUID_RE.test(dealId)) await dealEvent(site.id, dealId, 'note', principal, { detail: { change: 'reminded', what: kind, doc_id: id } });
  return json({ data: { ok: true, kind, id, reminded_at: nowIso() } }, 200, cors);
}
