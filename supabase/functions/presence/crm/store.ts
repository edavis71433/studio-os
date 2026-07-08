// ── CRM store (Phase C) — aggregators over EXISTING data + relationship notes ─
// Every read here (except notes) hits a table the platform already maintains.
// The CRM adds a lens, not a datastore. svc (service role) reads system-wide
// counts the way the room/agency already do; the route decides audience.
import { svc } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';
import { CONNECTED_PROVIDERS } from '../connected/providers.ts';
import {
  type TimelineItem, type ClientProfileSummary, type Audience,
  mapPublish, mapChange, mapConnected, mapMoment, mapApproval, mapNote, mergeTimeline, deriveClientHealth,
} from './contract.ts';

const PROVIDER_LABEL: Record<string, string> = Object.fromEntries(CONNECTED_PROVIDERS.map((p: any) => [p.key, p.name]));
const arr = (r: { json: unknown }): any[] => (Array.isArray(r.json) ? r.json : []);

/** Aggregate the relationship profile + calm health from existing signals. */
export async function loadProfile(site: SiteRow, nowIso: string): Promise<ClientProfileSummary> {
  const [ident, members, conns, moments, infra, writes] = await Promise.all([
    svc(`presence_identity?site_id=eq.${site.id}&select=business_name&limit=1`),
    svc(`presence_site_members?site_id=eq.${site.id}&status=eq.active&select=id`),
    svc(`presence_connections?site_id=eq.${site.id}&select=status,health`),
    svc(`presence_moments?site_id=eq.${site.id}&status=eq.active&select=id`),
    svc(`presence_infra_plans?site_id=eq.${site.id}&status=eq.proposed&select=id`),
    svc(`presence_connection_writes?site_id=eq.${site.id}&status=eq.proposed&select=id`),
  ]);
  const connRows = arr(conns);
  const connected = connRows.filter((c) => c.status === 'connected').length;
  const needing = connRows.filter((c) => ['error', 'expired', 'revoked'].includes(c.status) || ['attention', 'down'].includes(c.health)).length;
  const base = {
    business_name: arr(ident)[0]?.business_name || '',
    edition: site.edition,
    status: site.status,
    live: site.status === 'live',
    last_published_at: site.last_published_at || null,
    members: arr(members).length,
    connected,
    connected_needing_attention: needing,
    active_moments: arr(moments).length,
    pending_approvals: arr(infra).length + arr(writes).length,
  };
  return { ...base, health: deriveClientHealth(base, nowIso) };
}

/** Aggregate the unified activity timeline from every existing event source
 *  plus relationship notes. Returns ALL items (internal + shared); the caller
 *  filters by audience. */
export async function loadTimeline(site: SiteRow, opts: { includeInternalNotes: boolean; limit?: number }): Promise<TimelineItem[]> {
  const [pubs, changes, connEvents, moments, infra, writes, notes] = await Promise.all([
    svc(`presence_publishes?site_id=eq.${site.id}&select=id,kind,status,change_summary,created_at,completed_at&order=created_at.desc&limit=25`),
    svc(`presence_change_events?site_id=eq.${site.id}&select=id,entity_type,action,summary,created_at,provenance&order=created_at.desc&limit=40`),
    svc(`presence_connection_events?site_id=eq.${site.id}&select=id,provider_key,action,created_at&order=created_at.desc&limit=20`),
    svc(`presence_moments?site_id=eq.${site.id}&select=id,headline,summary,created_at,first_seen_at&order=created_at.desc&limit=15`),
    svc(`presence_infra_plans?site_id=eq.${site.id}&select=id,title,summary,status,created_at&order=created_at.desc&limit=15`),
    svc(`presence_connection_writes?site_id=eq.${site.id}&select=id,title,summary,status,provider_key,created_at&order=created_at.desc&limit=15`),
    svc(`presence_relationship_notes?site_id=eq.${site.id}&deleted_at=is.null&select=id,audience,body,author,pinned,created_at&order=created_at.desc&limit=30`),
  ]);
  const noteRows = arr(notes).filter((n) => opts.includeInternalNotes || n.audience === 'shared');
  const groups: TimelineItem[][] = [
    arr(pubs).map(mapPublish),
    arr(changes).map(mapChange),
    arr(connEvents).map((r) => mapConnected(r, PROVIDER_LABEL[r.provider_key])),
    arr(moments).map(mapMoment),
    arr(infra).map((r) => mapApproval(r, 'infrastructure')),
    arr(writes).map((r) => mapApproval(r, 'connected')),
    noteRows.map((r) => mapNote(r as any)),
  ];
  return mergeTimeline(groups, opts.limit ?? 60);
}

// ── relationship notes CRUD (the one new datastore) ──────────────────────────
export async function listNotes(siteId: string, includeInternal: boolean): Promise<any[]> {
  const filter = includeInternal ? '' : '&audience=eq.shared';
  const r = await svc(`presence_relationship_notes?site_id=eq.${siteId}&deleted_at=is.null${filter}&select=id,audience,body,pinned,author,created_at,updated_at&order=pinned.desc,created_at.desc&limit=100`);
  return arr(r);
}

export async function addNote(siteId: string, audience: Audience, body: string, author: string, authorKind: string): Promise<{ ok: boolean; id?: string }> {
  const r = await svc('presence_relationship_notes', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: siteId, audience, body, author, author_kind: authorKind }),
  });
  return r.ok && r.json?.[0]?.id ? { ok: true, id: r.json[0].id } : { ok: false };
}

export async function setNotePinned(siteId: string, noteId: string, pinned: boolean): Promise<boolean> {
  const r = await svc(`presence_relationship_notes?id=eq.${noteId}&site_id=eq.${siteId}&deleted_at=is.null`, {
    method: 'PATCH', body: JSON.stringify({ pinned }),
  });
  return r.ok;
}

export async function deleteNote(siteId: string, noteId: string): Promise<boolean> {
  const r = await svc(`presence_relationship_notes?id=eq.${noteId}&site_id=eq.${siteId}&deleted_at=is.null`, {
    method: 'PATCH', body: JSON.stringify({ deleted_at: new Date().toISOString() }),
  });
  return r.ok;
}
