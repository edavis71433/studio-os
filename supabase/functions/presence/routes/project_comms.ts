// ── Communication routes (Presence CMS Phase 2, P2-D-3) ──────────────────────
// A project-scoped thread (audience internal|client) + notifications DERIVED from
// the ONE activity log. The studio side sees internal + client; the client side
// sees only client messages and can reply. Notifications never become a second
// log — they're a view over presence_project_events + a per-reader last-seen mark.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { isStudioSide, loadProject, projectEvent } from './projects.ts';
import { clampLimit, clampOffset } from '../lib/service_delivery.ts';
import { isAudience, notifHref, notifLabel, isRead } from '../lib/notifications.ts';
import { emailBridgedCustomer } from '../lib/service_bridge.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (s: unknown, max = 500) => String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
const nowIso = () => new Date().toISOString();
const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const readerKey = (p: Principal) => String(p.userId || p.email || 'anon');

// ═══ PROJECT MESSAGES (one thread; audience internal|client) ═══
export async function handleMessages(req: Request, jwt: string, site: SiteRow, principal: Principal, projectId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(projectId)) return json({ error: 'bad_request' }, 400, cors);
  const studio = await isStudioSide(jwt, site, principal);
  const project = await loadProject(site.id, projectId);
  if (!project || (!studio && !project.client_visible)) return json({ error: 'not_found', message: 'That project isn’t here.' }, 404, cors);

  if (req.method === 'GET') {
    const u = new URL(req.url);
    const limit = clampLimit(u.searchParams.get('limit'));
    const offset = clampOffset(u.searchParams.get('offset'));
    let path = `presence_project_messages?project_id=eq.${projectId}&site_id=eq.${site.id}&deleted_at=is.null&select=id,audience,body,author,author_kind,attachment_media_id,created_at&order=created_at.desc&limit=${limit}&offset=${offset}`;
    if (!studio) path += `&audience=eq.client`;                     // the client never sees internal notes
    const r = await svc(path);
    if (!r.ok) return json({ error: 'read_failed', message: 'We couldn’t load messages just now.' }, 502, cors);
    return json({ data: rows(r), limit, offset, is_studio_view: studio }, 200, cors);
  }
  if (req.method === 'POST') {
    let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const body = clean(b.body, 5000);
    if (!body) return json({ error: 'validation', message: 'Write a message first.' }, 400, cors);
    // the client can only post to the shared (client) thread; the studio may post internal notes too
    const audience = studio && isAudience(b.audience) ? b.audience : 'client';
    let attachment: string | null = UUID_RE.test(b.attachment_media_id || '') ? b.attachment_media_id : null;
    if (attachment) { const m = rows(await svc(`presence_media?id=eq.${attachment}&site_id=eq.${site.id}&deleted_at=is.null&select=id&limit=1`))[0]; if (!m) attachment = null; }
    const ins = await svc('presence_project_messages', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ site_id: site.id, project_id: projectId, audience, body, author: readerKey(principal), author_kind: principal.kind, attachment_media_id: attachment }) });
    if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed', message: 'That message didn’t send — please try again.' }, 502, cors);
    // a client-audience message participates in the ONE activity log (feeds notifications)
    await projectEvent(site.id, projectId, 'message', principal, audience === 'client', { message_id: rows(ins)[0].id, from: studio ? 'studio' : 'client' });
    // A studio→client message must reach the client's EMAIL, not only a portal
    // they may not be watching. Throttled: if another client-audience message went
    // out in the last 15 minutes, the earlier email already carries them to the
    // full thread — don't stack one email per line of a conversation.
    if (studio && audience === 'client') {
      try {
        const prev = rows(await svc(`presence_project_messages?project_id=eq.${projectId}&site_id=eq.${site.id}&audience=eq.client&deleted_at=is.null&id=neq.${rows(ins)[0].id}&select=created_at,author_kind&order=created_at.desc&limit=1`))[0];
        const recent = prev && prev.author_kind !== 'client' && (Date.now() - Date.parse(String(prev.created_at))) < 15 * 60 * 1000;
        if (!recent) {
          const safe = body.slice(0, 500).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
          emailBridgedCustomer(site.id, projectId, 'A message from your studio',
            `<p>Your studio wrote to you about your project:</p><blockquote style="margin:8px 0;padding:8px 14px;border-left:3px solid #ccc">${safe}</blockquote>`).catch(() => {});
        }
      } catch { /* best-effort */ }
    }
    return json({ data: rows(ins)[0] }, 201, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

// ═══ A CUSTOMER'S GENERAL (project-less) MESSAGES ═══════════════════════════
// The studio-wide "Client messages" list shows every project-less support
// request. But the owner also expects a specific customer's general messages to
// live INSIDE that customer's delivery view. Resolve the open project → its
// Agency–Client Bridge → the customer, then return that customer's project-less
// support requests — matched by the same requester key their tickets are filed
// under (their auth user id, email, or contact email). Studio-side only; every
// query is scoped to the studio's OWN site (tenant isolation). Read-only: the
// operator still opens each request through the existing reply/resolve flow.
export async function handleProjectClientMessages(req: Request, jwt: string, site: SiteRow, principal: Principal, projectId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(projectId)) return json({ error: 'bad_request' }, 400, cors);
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, cors);
  const studio = await isStudioSide(jwt, site, principal);
  if (!studio) return json({ error: 'forbidden', message: 'Only your studio can see a customer’s messages.' }, 403, cors);
  const project = await loadProject(site.id, projectId);
  if (!project) return json({ error: 'not_found', message: 'That project isn’t here.' }, 404, cors);
  // project → bridge → customer. The link must live on THIS studio's site.
  const link = rows(await svc(`presence_service_links?project_id=eq.${projectId}&agency_site_id=eq.${site.id}&status=eq.active&select=customer_client_id&limit=1`))[0];
  const custId = link?.customer_client_id ? String(link.customer_client_id) : '';
  if (!custId) return json({ data: [], customer: null, is_studio_view: true }, 200, cors);
  const client = rows(await svc(`clients?id=eq.${custId}&select=id,name,email,contact_email,auth_user_id&limit=1`))[0];
  if (!client) return json({ data: [], customer: null, is_studio_view: true }, 200, cors);
  const customer = { id: client.id, name: client.name || client.email || null };
  // A customer's tickets are filed under readerKey(principal) = their auth user
  // id OR email — match every identity they could have used so none is missed.
  const keys = [client.auth_user_id, client.email, client.contact_email]
    .filter((k) => k != null && String(k).trim() !== '')
    .map((k) => encodeURIComponent(`"${String(k).replace(/"/g, '')}"`));
  if (!keys.length) return json({ data: [], customer, is_studio_view: true }, 200, cors);
  const r = await svc(`presence_support_requests?site_id=eq.${site.id}&project_id=is.null&deleted_at=is.null&requester=in.(${keys.join(',')})&select=id,subject,status,priority,project_id,requester,assigned_to,resolved_at,updated_at&order=updated_at.desc&limit=100`);
  if (!r.ok) return json({ error: 'read_failed', message: 'We couldn’t load that customer’s messages just now.' }, 502, cors);
  return json({ data: rows(r), customer, is_studio_view: true }, 200, cors);
}

// ═══ NOTIFICATIONS (derived view over the activity log + a per-reader last-seen) ═══
export async function handleNotifications(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  const studio = await isStudioSide(jwt, site, principal);
  const u = new URL(req.url);
  const limit = clampLimit(u.searchParams.get('limit'));

  // the client only sees events on client-visible projects
  let projectFilter = '';
  if (!studio) {
    const vis = rows(await svc(`presence_projects?site_id=eq.${site.id}&deleted_at=is.null&client_visible=is.true&select=id&limit=500`)).map((p) => p.id);
    if (!vis.length) return json({ data: [], unread_count: 0, is_studio_view: false }, 200, cors);
    projectFilter = `&project_id=in.(${vis.join(',')})&client_visible=is.true`;
  }
  const [evR, supR, seenR] = await Promise.all([
    svc(`presence_project_events?site_id=eq.${site.id}${projectFilter}&select=kind,detail,project_id,client_visible,created_at&order=created_at.desc&limit=${limit}`),
    // B3: support requests also notify (esp. project-less ones, which emit no project event).
    // Studio sees all open/active tickets; a client caller sees only its own.
    svc(`presence_support_requests?site_id=eq.${site.id}&deleted_at=is.null${studio ? '' : `&requester=eq.${encodeURIComponent(readerKey(principal))}`}&select=id,subject,status,project_id,updated_at&order=updated_at.desc&limit=25`),
    svc(`presence_activity_reads?site_id=eq.${site.id}&reader=eq.${encodeURIComponent(readerKey(principal))}&select=last_seen_at&limit=1`),
  ]);
  const lastSeen = rows(seenR)[0]?.last_seen_at || null;
  const items = [
    ...rows(evR).map((e) => ({ kind: e.kind, label: notifLabel(e.kind), href: notifHref(e.kind, e.project_id, e.detail || {}), project_id: e.project_id, created_at: e.created_at, read: isRead(e.created_at, lastSeen) })),
    // W5 (3rd copy): the /support#… page doesn't exist. A project-scoped request
    // deep-links to its project (inbox rewrites /projects/:id → projects.html?project=…,
    // where the studio now has a full support thread); project-less ones open the list.
    ...rows(supR).map((r) => ({ kind: 'support_message', label: `Support: ${String(r.subject || '').slice(0, 60)}`, href: r.project_id ? `/projects/${r.project_id}#support-${r.id}` : '/projects.html', project_id: r.project_id || null, created_at: r.updated_at, read: isRead(r.updated_at, lastSeen) })),
  ].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit);
  const unread_count = items.filter((i) => !i.read).length;
  return json({ data: items, unread_count, is_studio_view: studio }, 200, cors);
}

export async function handleNotificationsRead(req: Request, _jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  const up = await svc('presence_activity_reads?on_conflict=site_id,reader', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ site_id: site.id, reader: readerKey(principal), last_seen_at: nowIso() }) });
  return up.ok ? json({ data: { ok: true } }, 200, cors) : json({ error: 'write_failed' }, 502, cors);
}
