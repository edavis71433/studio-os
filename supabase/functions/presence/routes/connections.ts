// ── /connections/* — the connected-platform surface (L4.1, read-only) ───────
// The customer sees "your Google listing", "your reviews", "your appointments" —
// never APIs. Connect (OAuth or a read-only key), reconnect, refresh (an on-
// demand READ — no background jobs), and disconnect (revoke + destroy). Every
// provider flows through the SAME handlers; the registry + auth map is all that
// differs. Nothing is ever written back to a provider.
//   GET  /connections                    — the surface + per-provider state + data
//   GET  /connections/:key               — one provider's single-page profile
//   POST /connections/:key/connect       — start OAuth (returns consent URL) or store an API key
//   POST /connections/:key/callback      — finish OAuth (exchange the code)
//   POST /connections/:key/refresh       — pull fresh data now (on-demand read)
//   POST /connections/:key/disconnect    — revoke + destroy; account + data untouched
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { loadPlan } from '../commerce/enforce.ts';
import { providerByKey } from '../connected/providers.ts';
import { connectableFor, profileOf } from '../connected/inventory.ts';
import type { EditionKey } from '../connected/contract.ts';
import { isOAuth, oauthConfigured, authorizeUrl, exchangeCode, revokeToken } from '../connected/auth.ts';
import { saveTokens, loadTokens, disconnect as storeDisconnect } from '../connected/store.ts';
import { readProvider } from '../connected/adapters.ts';
import { encryptionConfigured } from '../connected/crypto.ts';

const CATEGORY_LABEL: Record<string, string> = {
  search: 'Being found', local_listing: 'Your listings', analytics: 'Your numbers',
  social: 'Your social', reviews: 'Your reviews', scheduling: 'Your bookings',
  crm: 'Your customers', email_marketing: 'Your email', payments: 'Your sales',
};

export async function handleConnectionsList(site: SiteRow, cors: Record<string, string>) {
  const plan = (await loadPlan(site.client_id)) as EditionKey;
  const items = connectableFor(plan);
  const [connQ, dataQ] = await Promise.all([
    svc(`presence_connections?site_id=eq.${site.id}&select=provider_key,status,health,last_sync_at,connected_at`),
    svc(`presence_connected_data?site_id=eq.${site.id}&select=provider_key,data,fetched_at`),
  ]);
  const states = new Map((connQ.ok && Array.isArray(connQ.json) ? connQ.json : []).map((c: any) => [c.provider_key, c]));
  const dataMap = new Map((dataQ.ok && Array.isArray(dataQ.json) ? dataQ.json : []).map((d: any) => [d.provider_key, d]));

  const groups: Record<string, any[]> = {};
  for (const it of items) {
    const s = states.get(it.key); const d = dataMap.get(it.key);
    const entry = {
      key: it.key, label: it.label, purpose: it.purpose, reads: it.reads, approval: it.approval, availability: it.status,
      connection: s ? { status: s.status, health: s.health, last_sync_at: s.last_sync_at, connected_at: s.connected_at } : { status: 'disconnected', health: 'unknown', last_sync_at: null, connected_at: null },
      data: d ? { ...d.data, as_of: d.fetched_at } : null, // the customer's own numbers, plain
    };
    const g = CATEGORY_LABEL[it.category] || it.category;
    (groups[g] ||= []).push(entry);
  }
  return json({ data: {
    edition: plan,
    note: 'Connect the services you already use — read-only, always with your approval, and yours to disconnect any time.',
    groups,
  } }, 200, cors);
}

export async function handleConnectionProfile(site: SiteRow, key: string, cors: Record<string, string>) {
  const p = providerByKey(key);
  if (!p) return json({ error: 'not_found', message: 'There’s no such connection.' }, 404, cors);
  return json({ data: profileOf(p) }, 200, cors);
}

export async function handleConnectionConnect(req: Request, site: SiteRow, key: string, principal: Principal, cors: Record<string, string>) {
  const p = providerByKey(key);
  if (!p) return json({ error: 'not_found', message: 'There’s no such connection.' }, 404, cors);
  if (!encryptionConfigured()) return json({ error: 'not_available', message: `Secure connection storage isn’t set up on this environment yet.` }, 503, cors);

  if (isOAuth(key)) {
    if (!oauthConfigured(key)) return json({ error: 'not_available', message: `Connecting ${p.customerLabel} isn’t available on this environment yet.` }, 503, cors);
    const state = `${key}:${crypto.randomUUID()}`;
    const url = authorizeUrl(key, state);
    return json({ data: { mode: 'oauth', authorize_url: url, state, message: `You’ll approve access to ${p.customerLabel} on ${p.name}’s own screen — read-only, and you can disconnect any time.` } }, 200, cors);
  }
  if (p.auth === 'api_key') {
    let body: any = {}; try { body = await req.json(); } catch { /* */ }
    const apiKey = String(body?.api_key || '').trim();
    if (!apiKey) return json({ error: 'bad_request', message: 'Paste your read-only key to connect.' }, 422, cors);
    const ok = await saveTokens(site.id, key, { access_token: apiKey }, p.scopes);
    if (!ok) return json({ error: 'storage', message: 'We couldn’t store that securely — please try again.' }, 502, cors);
    await svc('presence_connection_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ site_id: site.id, provider_key: key, action: 'connect', detail: 'api key connected', actor_kind: principal.kind === 'staff' ? 'operator' : 'customer' }) });
    readProvider(site.id, key, p.customerLabel).catch(() => {}); // an initial read, on-demand
    return json({ data: { mode: 'api_key', connected: true, message: `Connected ${p.customerLabel}.` } }, 200, cors);
  }
  return json({ error: 'not_available', message: `${p.customerLabel} connects a different way that isn’t available yet.` }, 503, cors);
}

export async function handleConnectionCallback(req: Request, site: SiteRow, key: string, principal: Principal, cors: Record<string, string>) {
  const p = providerByKey(key);
  if (!p) return json({ error: 'not_found', message: 'There’s no such connection.' }, 404, cors);
  if (!oauthConfigured(key)) return json({ error: 'not_available', message: 'That connection isn’t available on this environment yet.' }, 503, cors);
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const code = String(body?.code || '');
  if (!code) return json({ error: 'bad_request', message: 'The connection didn’t return a code — please try again.' }, 422, cors);
  try {
    const tokens = await exchangeCode(key, code);
    const ok = await saveTokens(site.id, key, tokens, p.scopes);
    if (!ok) return json({ error: 'storage', message: 'We couldn’t store the connection securely — please try again.' }, 502, cors);
    await svc('presence_connection_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ site_id: site.id, provider_key: key, action: 'connect', detail: 'oauth connected', actor_kind: principal.kind === 'staff' ? 'operator' : 'customer' }) });
    readProvider(site.id, key, p.customerLabel).catch(() => {});
    return json({ data: { connected: true, message: `Connected ${p.customerLabel}.` } }, 200, cors);
  } catch (_e) {
    return json({ error: 'connect_failed', message: 'That connection didn’t complete. Nothing changed — please try again.' }, 502, cors);
  }
}

export async function handleConnectionRefresh(site: SiteRow, key: string, cors: Record<string, string>) {
  const p = providerByKey(key);
  if (!p) return json({ error: 'not_found', message: 'There’s no such connection.' }, 404, cors);
  const data = await readProvider(site.id, key, p.customerLabel);
  if (!data) return json({ error: 'read_failed', message: `We couldn’t read from ${p.customerLabel} just now — it may need a quick reconnect.` }, 502, cors);
  return json({ data: { refreshed: true, data } }, 200, cors);
}

export async function handleConnectionDisconnect(site: SiteRow, key: string, principal: Principal, cors: Record<string, string>) {
  const p = providerByKey(key);
  if (!p) return json({ error: 'not_found', message: 'There’s no such connection.' }, 404, cors);
  const tokens = await loadTokens(site.id, key);
  if (tokens?.access_token) revokeToken(key, tokens.access_token).catch(() => {}); // best-effort revoke at the provider
  await storeDisconnect(site.id, key, principal.kind === 'staff' ? 'operator' : 'customer');
  return json({ data: { disconnected: true, message: `Disconnected ${p.customerLabel}. Your account and everything in it are untouched.` } }, 200, cors);
}
