// ── /connections/* — the connected-platform surface (L4.0, read-only) ───────
// The customer sees "your Google listing", "your reviews", "your appointments" —
// never APIs. This milestone lists what CAN be connected (edition-filtered, in
// plain words) and their state; it performs no live OAuth, no sync, no writes.
// Disconnect is defined now because ownership is a guarantee, not a feature:
// leaving is always available (Laws 3, 4).
//   GET  /connections                    — the customer surface + per-provider state
//   GET  /connections/:key               — one provider's single-page profile
//   POST /connections/:key/disconnect    — remove the link; account + data untouched
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { loadPlan } from '../commerce/enforce.ts';
import { providerByKey } from '../connected/providers.ts';
import { connectableFor, profileOf } from '../connected/inventory.ts';
import type { EditionKey } from '../connected/contract.ts';

const CATEGORY_LABEL: Record<string, string> = {
  search: 'Being found', local_listing: 'Your listings', analytics: 'Your numbers',
  social: 'Your social', reviews: 'Your reviews', scheduling: 'Your bookings',
  crm: 'Your customers', email_marketing: 'Your email', payments: 'Your sales',
};

export async function handleConnectionsList(site: SiteRow, cors: Record<string, string>) {
  const plan = (await loadPlan(site.client_id)) as EditionKey;
  const items = connectableFor(plan);
  const r = await svc(`presence_connections?site_id=eq.${site.id}&select=provider_key,status,health,last_sync_at,connected_at`);
  const states = new Map((r.ok && Array.isArray(r.json) ? r.json : []).map((c: any) => [c.provider_key, c]));

  // group by the customer's mental model, not the technical category
  const groups: Record<string, any[]> = {};
  for (const it of items) {
    const s = states.get(it.key);
    const entry = {
      key: it.key, label: it.label, purpose: it.purpose, reads: it.reads, approval: it.approval,
      availability: it.status, // 'Planned' | 'Read-only' | 'Read/Write'
      connection: s ? { status: s.status, health: s.health, last_sync_at: s.last_sync_at, connected_at: s.connected_at } : { status: 'disconnected', health: 'unknown', last_sync_at: null, connected_at: null },
    };
    const g = CATEGORY_LABEL[it.category] || it.category;
    (groups[g] ||= []).push(entry);
  }
  return json({ data: {
    edition: plan,
    note: 'These are the services Studio OS will connect for you — read-only first, always with your approval, and yours to disconnect any time.',
    groups,
  } }, 200, cors);
}

export async function handleConnectionProfile(site: SiteRow, key: string, cors: Record<string, string>) {
  const p = providerByKey(key);
  if (!p) return json({ error: 'not_found', message: 'There’s no such connection.' }, 404, cors);
  return json({ data: profileOf(p) }, 200, cors);
}

export async function handleConnectionDisconnect(site: SiteRow, key: string, principal: Principal, cors: Record<string, string>) {
  const p = providerByKey(key);
  if (!p) return json({ error: 'not_found', message: 'There’s no such connection.' }, 404, cors);
  // Foundation: remove the Studio OS record. With a live adapter this also
  // destroys the delegated token and revokes at the provider. Always safe,
  // always available — the customer's account and data at the provider are
  // untouched.
  await svc(`presence_connections?site_id=eq.${encodeURIComponent(site.id)}&provider_key=eq.${encodeURIComponent(key)}`, { method: 'DELETE' });
  await svc('presence_connection_events', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ site_id: site.id, provider_key: key, action: 'disconnect', detail: 'customer disconnected', actor_kind: principal.kind === 'staff' ? 'operator' : 'customer' }),
  });
  return json({ data: { disconnected: true, message: `Disconnected ${p.customerLabel}. Your account and everything in it are untouched.` } }, 200, cors);
}
