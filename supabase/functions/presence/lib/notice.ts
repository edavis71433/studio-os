// ── Website-attention notices — ONE model, reused (P2-F G3) ──────────────────
// The workspace already has a single notice model: presence_plan_notices, keyed
// unique (client_id, kind, period), rendered by the calm notice card + counted
// by the bell. This helper is the one way to raise a website-attention item
// (publish failed, connection expired, …) onto that SAME model — so there is no
// second notification system. Idempotent by the unique key: the `period` is the
// dedupe scope (use a stable id like `pub:<id>` for once-per-event, or a month
// bucket for once-per-month). Best-effort; never throws.
import { svc } from './db.ts';

export interface NoticeInput {
  siteId: string;
  clientId: string;
  kind: string;      // e.g. 'publish_failed' | 'connection_expired' | 'website_enquiry'
  period: string;    // dedupe scope: a stable event id or a 'YYYY-MM' bucket
  headline: string;
  body: string;
}

/** Raise (or no-op if already present for this client/kind/period) a notice.
 *  Returns true only when a NEW row was inserted — so callers can send an email
 *  or bump a counter exactly once. */
export async function raiseNotice(n: NoticeInput): Promise<boolean> {
  try {
    const ins = await svc('presence_plan_notices?on_conflict=client_id,kind,period', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({
        site_id: n.siteId, client_id: n.clientId, kind: n.kind, period: n.period,
        headline: n.headline.slice(0, 200), body: n.body.slice(0, 1000), status: 'active',
      }),
    });
    return ins.ok && Array.isArray(ins.json) && ins.json.length > 0;
  } catch (e) {
    console.error(`[notice] failed to raise ${n.kind} for ${n.clientId}: ${String((e as Error)?.message || e)} (non-fatal)`);
    return false;
  }
}

/** Clear an active notice of a kind for a client (e.g. once a publish recovers).
 *  Optional `period` narrows to one event. Best-effort. */
export async function clearNotice(clientId: string, kind: string, period?: string): Promise<void> {
  const scope = `client_id=eq.${encodeURIComponent(clientId)}&kind=eq.${encodeURIComponent(kind)}&status=eq.active${period ? `&period=eq.${encodeURIComponent(period)}` : ''}`;
  await svc(`presence_plan_notices?${scope}`, { method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }) }).catch(() => {});
}
