// ── The client's own view of a retainer (sales item 117, Nov 12 2026 review) ──
// The retainer email says "you can cancel any time", and the portal showed no
// retainer and no way to cancel. Here the client sees each retainer their studio
// set up for them (how much, how often, where it stands, every charge so far)
// and can cancel one. Cancelling stops future charges at Stripe, the same call
// the studio's own Cancel makes; it never refunds, and the studio is told at once.
//
// Scoped like every /client/* route: the caller is on THEIR OWN site, and a
// retainer is theirs only when its deal was converted into their client account
// (presence_deals.converted_client_id). Nothing from Stripe's side (subscription,
// customer or link ids) leaves the server; the one address that does is the
// approval link of a retainer still waiting for them.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { cancelSubscription } from '../commerce/stripe.ts';
import { mergeRetainerState, retainerPortalView, retainerSubscriptionIds, retainerNoticePeriodPrefix, type RetainerCharge, type RetainerState } from '../commerce/retainers.ts';
import { raiseNotice } from '../lib/notice.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { UUID_RE } from '../lib/uuid.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any)?.json) ? (r as any).json : []) as any[];
const usd = (c: unknown) => '$' + ((Number(c) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The retainers of one client account, newest first, each with its charges. [] on any
 *  failed read: the invoices above it must never blank because this did. */
export async function clientRetainers(clientId: string): Promise<Array<Record<string, unknown>>> {
  try {
    if (!UUID_RE.test(clientId)) return [];
    const dr = await svc(`presence_deals?converted_client_id=eq.${clientId}&retainer=not.is.null&deleted_at=is.null&select=id,site_id,title,retainer&order=created_at.desc&limit=20`);
    const deals = dr.ok ? rows(dr) : [];
    if (!deals.length) return [];
    const er = await svc(`presence_deal_events?deal_id=in.(${deals.map((d) => d.id).join(',')})&kind=eq.invoice_paid&select=deal_id,detail,created_at&order=created_at.desc&limit=500`);
    const charges = new Map<string, RetainerCharge[]>();
    for (const e of er.ok ? rows(er) : []) {
      if (e?.detail?.retainer !== true) continue;
      const list = charges.get(String(e.deal_id)) || [];
      list.push({ at: String(e.created_at || ''), amount: (Number(e.detail.amount_cents) || 0) / 100 });
      charges.set(String(e.deal_id), list);
    }
    return deals.map((d) => retainerPortalView(d, charges.get(String(d.id)) || [])).filter((x): x is Record<string, unknown> => !!x);
  } catch { return []; }
}

/** POST /client/retainers/:deal/cancel — the client stops their own retainer. */
export async function handleClientRetainerCancel(_req: Request, site: SiteRow, principal: Principal, dealId: string, cors: Record<string, string>): Promise<Response> {
  const me = site.client_id ? String(site.client_id) : '';
  if (!UUID_RE.test(dealId) || !me) return json({ error: 'not_found', message: 'That retainer isn’t here.' }, 404, cors);
  // theirs only: the deal that became THIS client account
  const deal = rows(await svc(`presence_deals?id=eq.${dealId}&converted_client_id=eq.${me}&deleted_at=is.null&select=id,site_id,title,retainer&limit=1`))[0];
  const prior: Partial<RetainerState> | null = deal?.retainer && typeof deal.retainer === 'object' ? deal.retainer : null;
  if (!deal || !prior) return json({ error: 'not_found', message: 'That retainer isn’t here.' }, 404, cors);
  if (prior.status === 'canceled') return json({ data: { canceled: true, already: true } }, 200, cors);
  if (prior.status !== 'active' && prior.status !== 'past_due') return json({ error: 'bad_state', message: 'This retainer hasn’t started, so there is nothing to cancel.' }, 409, cors);
  // every subscription it has (one approved twice has two), or nothing is marked cancelled
  for (const id of retainerSubscriptionIds(prior)) {
    const r = await cancelSubscription(id);
    if (!r.ok) return json({ error: 'cancel_failed', message: 'We couldn’t cancel it just now, so nothing changed. Please try again, or message your studio.' }, 502, cors);
  }
  const now = new Date().toISOString();
  const next = { ...mergeRetainerState(prior, { status: 'canceled', canceled_at: now }, now), extra_subscription_ids: [] };
  const up = await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${deal.site_id}&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ retainer: next }) });
  if (!up.ok || !rows(up)[0]) return json({ error: 'write_failed', message: 'It is cancelled with Stripe, but we couldn’t save that here. Please message your studio so they can check.' }, 502, cors);
  // the studio hears it from us, in words that say WHO cancelled (Stripe's own "ended"
  // event finds the retainer already cancelled here and stays quiet)
  try {
    const studioClient = String(rows(await svc(`presence_sites?id=eq.${deal.site_id}&select=client_id&limit=1`))[0]?.client_id || '');
    if (studioClient) {
      const name = String(deal.title || 'a retainer client').slice(0, 80);
      const per = prior.interval === 'year' ? 'year' : 'month';
      const headline = `The client cancelled their retainer: ${name}`;
      const body = `They cancelled the ${usd(prior.amount_cents)} a ${per} retainer from their portal. It won’t charge again. Nothing was refunded. If that’s a surprise, a quick message to them is the next step.`;
      const fresh = await raiseNotice({ siteId: String(deal.site_id), clientId: studioClient, kind: 'retainer_status', period: `${retainerNoticePeriodPrefix(dealId)}clientcancel:${now.slice(0, 10)}`, headline, body });
      if (fresh) {
        const { emailOperator } = await import('../lib/service_bridge.ts');
        const base = (Deno.env.get('SITE_URL') || 'https://davisdigitalstudio.com').replace(/\/$/, '');
        await emailOperator(String(deal.site_id), headline, `<p>${body.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string))}</p>`, 'retainer_status', { label: 'Open the deal', href: `${base}/pipeline.html?deal=${dealId}` }).catch(() => false);
      }
    }
  } catch { /* it is cancelled either way */ }
  return json({ data: { canceled: true, by: principal.email || null } }, 200, cors);
}
