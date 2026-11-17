// ── POST /commerce/charge-event: a refund or a dispute Stripe reported (sales items 126, 127) ──
// Called by the stripe-webhook function, secret-gated like /commerce/invoice-paid and
// /commerce/invoice-bounced. The body names a charge ({ charge }) or a dispute
// ({ dispute }) by its Stripe id and nothing else: commerce/charge_returns.ts reads
// it fresh from Stripe, so a leaked secret can't assert an amount or an outcome.
// 200 when it is recorded (or isn't ours); 502 when Stripe or the database didn't
// answer, so the webhook answers 500 and Stripe sends the event again.
import { json } from '../../_shared/http.ts';

export async function handleChargeEvent(req: Request, secret: string, cors: Record<string, string>): Promise<Response> {
  if (!secret || req.headers.get('x-commerce-secret') !== secret) return json({ error: 'forbidden' }, 403, cors);
  let body: { charge?: unknown; dispute?: unknown } | null = null;
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const { stripeIdOk, syncChargeRefunds, syncDispute } = await import('../commerce/charge_returns.ts');
  const dispute = String(body?.dispute || ''), charge = String(body?.charge || '');
  if (!stripeIdOk(dispute) && !stripeIdOk(charge)) return json({ error: 'bad_request' }, 400, cors);
  const r = stripeIdOk(dispute) ? await syncDispute(dispute) : await syncChargeRefunds(charge);
  return json(r.ok ? { data: r } : { error: 'try_again', data: r }, r.ok ? 200 : 502, cors);
}
