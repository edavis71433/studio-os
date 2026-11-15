// ── /push/* — Web Push subscription management + the owner-notify helper ──────
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { resolveSite } from '../lib/site.ts';
import { sendPush, pushConfigured, type PushSub } from '../lib/webpush.ts';
import type { Principal } from '../../_shared/auth.ts';
import { assertPublicHttpUrl } from '../../_shared/tools/url_guard.ts';   // builder item 204

const clean = (s: unknown, max = 2000) => String(s ?? '').replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, max);

export async function handlePushSubscribe(req: Request, principal: Principal, cors: Record<string, string>): Promise<Response> {
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const sub = b.subscription || b;
  const endpoint = clean(sub.endpoint, 1000);
  const keys = sub.keys || {};
  const p256dh = clean(keys.p256dh, 200);
  const auth = clean(keys.auth, 200);
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) return json({ error: 'validation', message: 'Invalid push subscription.' }, 422, cors);
  // builder item 204: a browser hands us this address, and we post to it later, so it must be a public one
  try { await assertPublicHttpUrl(endpoint); } catch { return json({ error: 'validation', message: 'Invalid push subscription.' }, 422, cors); }
  const jwt = principal.jwt || '';
  const site = jwt ? await resolveSite(jwt) : null;
  await svc('presence_push_subscriptions?on_conflict=endpoint', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      endpoint, p256dh, auth,
      user_id: /^[0-9a-f-]{36}$/i.test(principal.userId || '') ? principal.userId : null,
      email: (principal.email || '').toLowerCase(),
      site_id: site?.id || null,
      user_agent: clean(req.headers.get('user-agent') || '', 300),
      failures: 0, last_used_at: new Date().toISOString(),
    }),
  });
  return json({ data: { ok: true, enabled: pushConfigured() } }, 200, cors);
}

export async function handlePushUnsubscribe(req: Request, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const endpoint = clean(b.endpoint, 1000);
  if (endpoint) await svc(`presence_push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE' }).catch(() => {});
  return json({ data: { ok: true } }, 200, cors);
}

/** Notify a site's opted-in owners with a push (best-effort; prunes dead subs).
 *  Called from the notice/attention paths — never blocks or throws on the caller. */
export async function pushToSite(siteId: string, msg: { title?: string; body?: string; url?: string; tag?: string }): Promise<void> {
  if (!pushConfigured() || !siteId) return;
  try {
    const rows = ((await svc(`presence_push_subscriptions?site_id=eq.${siteId}&select=id,endpoint,p256dh,auth,failures&limit=20`)).json as any[]) || [];
    for (const r of rows) {
      const sub: PushSub = { endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth };
      let status = 0;
      try { status = await sendPush(sub, msg); } catch { status = 0; }
      if (status === 404 || status === 410) {
        // gone/expired at the push service — prune immediately
        await svc(`presence_push_subscriptions?id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {});
      } else if (status >= 400 || status === 0) {
        // the 0090 contract: CONSECUTIVE failures prune at 5 — a transient 429/
        // network blip increments, it never kills the subscription outright
        await svc(`presence_push_subscriptions?id=eq.${r.id}`, { method: 'PATCH', body: JSON.stringify({ failures: (Number(r.failures) || 0) + 1 }) }).catch(() => {});
      } else {
        await svc(`presence_push_subscriptions?id=eq.${r.id}`, { method: 'PATCH', body: JSON.stringify({ last_used_at: new Date().toISOString(), failures: 0 }) }).catch(() => {});
      }
    }
    await svc(`presence_push_subscriptions?site_id=eq.${siteId}&failures=gte.5`, { method: 'DELETE' }).catch(() => {});
  } catch { /* push is best-effort */ }
}
