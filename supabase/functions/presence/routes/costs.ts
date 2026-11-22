// ── Costs paid for a customer (sales item 176, Nov 22 2026 review) ─────────────
// A domain renewal, stock photos, a plugin: money the studio paid out for a customer had no
// place. presence_customer_costs (migration 0250) holds each one: what, how much, the day, a
// receipt from Files, whether it goes on the next invoice, and the invoice it went on.
//   GET    /sales/deals/:id/costs       the deal's costs, newest first
//   POST   /sales/deals/:id/costs       { label, amount_cents, spent_on, bill?, receipt_media_id?, note? }
//   PATCH  /sales/costs/:id             the same fields; bill: false takes it off the next invoice
//   DELETE /sales/costs/:id             a soft delete (never one already billed)
// "+ Invoice" on the deal adds every unbilled cost as a line (routes/sales.ts, unbilledCosts +
// costLines) and marks them billed; the bookkeeper file lists them (costs.csv). Studio-gated
// and site-scoped like every authed /sales/* route; before APPLY-0250 every call answers 503.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { UUID_RE } from '../lib/uuid.ts';
import { callerToday } from '../lib/sales_lifecycle.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any)?.json) ? (r as any).json : []) as any[];
const COLS = 'id,site_id,deal_id,customer_client_id,label,amount_cents,spent_on,receipt_media_id,bill,invoice_id,note,created_at,updated_at';
const unavailable = (cors: Record<string, string>) => json({ error: 'unavailable', message: 'Costs need a quick database update first. Nothing changed.' }, 503, cors);
const tidy = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export interface CostRow { id: string; label: string; amount_cents: number; spent_on: string }
/** The deal's costs waiting for the next invoice (bill on, no invoice yet). [] before the table exists. */
export async function unbilledCosts(siteId: string, dealId: string): Promise<CostRow[]> {
  if (!UUID_RE.test(dealId)) return [];
  const r = await svc(`presence_customer_costs?site_id=eq.${siteId}&deal_id=eq.${dealId}&bill=eq.true&invoice_id=is.null&deleted_at=is.null&select=id,label,amount_cents,spent_on&order=spent_on.asc,created_at.asc&limit=50`).catch(() => ({ ok: false, json: null }));
  return r.ok ? rows(r).map((c) => ({ id: String(c.id), label: String(c.label || 'Cost'), amount_cents: Math.round(Number(c.amount_cents) || 0), spent_on: String(c.spent_on || '').slice(0, 10) })).filter((c) => c.amount_cents > 0) : [];
}
/** Each cost as an invoice line, named as a cost. Pure. */
export function costLines(costs: CostRow[]): Array<{ label: string; qty: number; amount_cents: number }> {
  return costs.map((c) => ({ label: `Cost: ${c.label}`.slice(0, 200), qty: 1, amount_cents: c.amount_cents }));
}
/** The costs an invoice now carries. Best-effort. */
export async function markCostsBilled(siteId: string, ids: string[], invoiceId: string): Promise<void> {
  if (!ids.length) return;
  await svc(`presence_customer_costs?site_id=eq.${siteId}&id=in.(${ids.join(',')})&invoice_id=is.null`, { method: 'PATCH', body: JSON.stringify({ invoice_id: invoiceId, updated_at: new Date().toISOString() }) }).catch(() => {});
}

/** The fields a cost takes, checked. Pure. */
export function validateCost(b: any, todayYmd: string, partial = false): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  const out: Record<string, unknown> = {};
  if (b?.label !== undefined || !partial) { const label = tidy(b?.label, 200); if (!label) return { ok: false, message: 'Say what the cost was for.' }; out.label = label; }
  if (b?.amount_cents !== undefined || !partial) { const c = Math.round(Number(b?.amount_cents)); if (!Number.isFinite(c) || c < 1) return { ok: false, message: 'Enter what it cost.' }; if (c > 100_000_000) return { ok: false, message: 'That amount is over $1,000,000. Double-check it.' }; out.amount_cents = c; }
  if (b?.spent_on !== undefined || !partial) { const on = String(b?.spent_on || todayYmd).trim(); if (!YMD.test(on) || !Number.isFinite(Date.parse(on + 'T12:00:00Z'))) return { ok: false, message: 'Enter the day you paid it.' }; if (on > todayYmd) return { ok: false, message: 'The day can’t be in the future.' }; out.spent_on = on; }
  if (b?.bill !== undefined) out.bill = b.bill !== false;
  if (b?.receipt_media_id !== undefined) { const m = b.receipt_media_id === null || b.receipt_media_id === '' ? null : String(b.receipt_media_id); if (m && !UUID_RE.test(m)) return { ok: false, message: 'That receipt isn’t one of your files.' }; out.receipt_media_id = m; }
  if (b?.note !== undefined) out.note = tidy(b.note, 300);
  return { ok: true, value: out };
}

export async function handleDealCosts(req: Request, site: SiteRow, principal: Principal, dealId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(dealId)) return json({ error: 'bad_request' }, 400, cors);
  if (req.method === 'GET') {
    const r = await svc(`presence_customer_costs?site_id=eq.${site.id}&deal_id=eq.${dealId}&deleted_at=is.null&select=${COLS}&order=spent_on.desc,created_at.desc&limit=200`).catch(() => ({ ok: false, json: null }));
    if (!r.ok) return unavailable(cors);
    return json({ data: { items: rows(r), unbilled_cents: rows(r).filter((c) => c.bill && !c.invoice_id).reduce((n: number, c: any) => n + (Number(c.amount_cents) || 0), 0) } }, 200, cors);
  }
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const deal = rows(await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${site.id}&deleted_at=is.null&select=id,converted_client_id&limit=1`))[0];
  if (!deal) return json({ error: 'not_found', message: 'That deal is no longer here.' }, 404, cors);
  const today = callerToday(new URL(req.url).searchParams.get('today'), new Date().toISOString());
  const v = validateCost(b, today);
  if (!v.ok) return json({ error: 'validation', message: v.message }, 422, cors);
  if (v.value.receipt_media_id) {
    const m = rows(await svc(`presence_media?id=eq.${v.value.receipt_media_id}&site_id=eq.${site.id}&deleted_at=is.null&select=id&limit=1`).catch(() => ({ json: [] })))[0];
    if (!m) return json({ error: 'validation', message: 'That receipt isn’t one of your files.' }, 422, cors);
  }
  const ins = await svc('presence_customer_costs', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ site_id: site.id, deal_id: dealId, customer_client_id: deal.converted_client_id || null, bill: true, note: '', ...v.value, created_by: principal.email || principal.userId || '' }) });
  const row = rows(ins)[0];
  if (!ins.ok || !row) return (ins as any).status === 404 || /presence_customer_costs/.test(String((ins as any).text || '')) ? unavailable(cors) : json({ error: 'write_failed', message: 'That cost didn’t save. Nothing changed. Try again.' }, 502, cors);
  return json({ data: row }, 201, cors);
}

export async function handleCost(req: Request, site: SiteRow, _principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const got = await svc(`presence_customer_costs?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=${COLS}&limit=1`).catch(() => ({ ok: false, json: null }));
  if (!got.ok) return unavailable(cors);
  const row = rows(got)[0];
  if (!row) return json({ error: 'not_found', message: 'That cost is no longer here.' }, 404, cors);
  if (req.method === 'DELETE') {
    if (row.invoice_id) return json({ error: 'billed', message: 'This cost is already on an invoice, so it stays. Change the invoice instead.' }, 409, cors);
    const del = await svc(`presence_customer_costs?id=eq.${id}&site_id=eq.${site.id}&invoice_id=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ deleted_at: new Date().toISOString() }) });
    if (!del.ok || !rows(del)[0]) return json({ error: 'conflict', message: 'That changed just now. Reload and take another look.' }, 409, cors);
    return json({ data: { ok: true, deleted: true } }, 200, cors);
  }
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const today = callerToday(new URL(req.url).searchParams.get('today'), new Date().toISOString());
  const v = validateCost(b, today, true);
  if (!v.ok) return json({ error: 'validation', message: v.message }, 422, cors);
  if (row.invoice_id && ('amount_cents' in v.value || 'bill' in v.value)) return json({ error: 'billed', message: 'This cost is already on an invoice, so its amount stays. Change the invoice instead.' }, 409, cors);
  if (!Object.keys(v.value).length) return json({ data: row }, 200, cors);
  const up = await svc(`presence_customer_costs?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=${COLS}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...v.value, updated_at: new Date().toISOString() }) });
  if (!up.ok || !rows(up)[0]) return json({ error: 'write_failed', message: 'That didn’t save. Nothing changed. Try again.' }, 502, cors);
  return json({ data: rows(up)[0] }, 200, cors);
}
