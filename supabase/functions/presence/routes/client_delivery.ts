// ── Client-App service delivery (Presence CMS Phase 2, P2-D hardening) ───────
// The customer's scoped, client-visible view of delivery — served through the
// Agency–Client Bridge. The caller is the customer on THEIR OWN workspace; every
// action resolves their clients.id (site.client_id) and verifies a service_link
// to the target project BEFORE reading agency-site data. No membership in the
// agency workspace; a customer can only ever reach their own linked, client-
// visible records. Internal notes/tasks/files/approvals never appear here.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { signDownload, createUpload, BUCKET, MIME_ALLOW, MAX_BYTES, MAX_DOC_BYTES, isDocMime } from '../lib/media.ts';
import { linksForCustomer, linkForCustomerProject, linkForCustomerVia, emailCustomerByClient } from '../lib/service_bridge.ts';
import { csatRatingsForProject } from '../lib/csat.ts';
import { deriveTaskState, compareOrder, clampLimit, clampOffset, progressOf, reportSummary } from '../lib/service_delivery.ts';
import { canDecideApproval, isDecision } from '../lib/approvals.ts';
import { normalizeAnswers, isSupportPriority, composeServiceBrief } from '../lib/intake.ts';
import { notifHref, notifLabel, isRead } from '../lib/notifications.ts';
import { isStudioSide, studioDenied } from './projects.ts';
import { signDocToken, type DocKind } from '../lib/documents.ts';
import { linkSecret, docViewerUrl } from './sales.ts';
import { readGsc, readSearchTerms } from './analytics.ts';
import { aggregateVisits, type VisitRow } from '../lib/visits.ts';
import { dashRange, weeklyVisitors, sourceShares, DASH_WEEKS } from '../lib/analytics_dashboard.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const fnBase = () => (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (s: unknown, max = 500) => String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
const nowIso = () => new Date().toISOString();
const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const readerKey = (p: Principal) => String(p.userId || p.email || 'anon');
/** The customer this caller IS (their own site's client). */
const customerOf = (site: SiteRow): string | null => (site.client_id ? String(site.client_id) : null);
const noCustomer = (cors: Record<string, string>) => json({ data: [], message: 'No service delivery is linked to your account yet.' }, 200, cors);

async function clientEvent(agencySiteId: string, projectId: string, kind: string, principal: Principal, detail: Record<string, unknown> = {}) {
  // detail.from='client' marks events from the CLIENT DOOR (this file is the only
  // one) — principal.kind can't tell a customer from the studio owner (both are
  // 'client'), and the studio's bell must never ring for its own actions.
  await svc('presence_project_events', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ project_id: projectId, site_id: agencySiteId, kind, actor: readerKey(principal), actor_kind: principal.kind, client_visible: true, detail: { from: 'client', ...detail } }) }).catch(() => {});
}

// ═══ SERVICE BILLING (the customer's invoices FROM the agency) ═══
// This is billed SEPARATELY from the Studio OS software subscription (which is
// /commerce/subscription): these invoices are the agency's project/service work.
// Read-only here; scoped to the caller's own client_id. No numbers are hidden —
// service invoices DO show amounts (unlike the AI usage surface), because they
// are explicit human-agreed charges the customer must be able to see and pay.
export async function handleClientBilling(_req: Request, site: SiteRow, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  const me = customerOf(site);
  if (!me) return json({ data: { billing_type: 'service', invoices: [], summary: { open_count: 0, paid_count: 0 } }, message: 'No service billing is linked to your account yet.' }, 200, cors);
  const r = await svc(`presence_invoices?customer_client_id=eq.${me}&deleted_at=is.null&select=id,title,description,amount_cents,status,due_date,paid_at,stripe_url,created_at&order=created_at.desc&limit=200`);
  const list = rows(r).map((i) => ({
    id: i.id, name: clean(i.title, 200), description: clean(i.description, 1000),
    amount: (Number(i.amount_cents) || 0) / 100, status: i.status, due_date: i.due_date, paid_at: i.paid_at,
    // only expose a pay link for something that isn't already paid
    pay_url: (i.status !== 'paid' && i.stripe_url) ? i.stripe_url : null,
    created_at: i.created_at,
  }));
  const open = list.filter((i) => i.status !== 'paid' && i.status !== 'void' && i.status !== 'canceled');
  const paid = list.filter((i) => i.status === 'paid');
  return json({ data: {
    billing_type: 'service',   // agency project work — SEPARATE from the software subscription
    note: 'These are invoices from your studio for project and service work. Your website subscription is billed separately.',
    invoices: list,
    summary: { open_count: open.length, paid_count: paid.length },
  } }, 200, cors);
}

// ═══ TASK DONE — let the client mark a to-do assigned to them complete ═══
// Client to-dos were read-only (a client saw "N things for you" but couldn't act).
// Only a client_action_required, client_visible task on their OWN linked project can
// be marked done here; a client_visible event lets the studio see they acted.
export async function handleClientTaskDone(_req: Request, site: SiteRow, principal: Principal, projectId: string, taskId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(projectId) || !UUID_RE.test(taskId)) return json({ error: 'bad_request' }, 400, cors);
  const me = customerOf(site);
  if (!me) return json({ error: 'forbidden' }, 403, cors);
  const link = await linkForCustomerProject(me, projectId);
  if (!link) return json({ error: 'not_found', message: 'That project isn’t here.' }, 404, cors);
  const s = link.agency_site_id;
  const t = rows(await svc(`presence_tasks?id=eq.${taskId}&project_id=eq.${projectId}&site_id=eq.${s}&deleted_at=is.null&client_visible=is.true&client_action_required=is.true&select=id,title,status&limit=1`))[0];
  if (!t) return json({ error: 'not_found', message: 'That to-do isn’t here.' }, 404, cors);
  if (t.status === 'done') return json({ data: { ok: true } }, 200, cors);
  const up = await svc(`presence_tasks?id=eq.${taskId}&site_id=eq.${s}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'done', completed_at: nowIso() }) });
  if (!up.ok) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
  await svc('presence_project_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ project_id: projectId, site_id: s, kind: 'task_done', actor: readerKey(principal), actor_kind: principal.kind, client_visible: true, detail: { from: 'client', title: String(t.title || 'A to-do') } }) }).catch(() => {});
  return json({ data: { ok: true } }, 200, cors);
}

// ═══ BOOK A CALL — resolve the client's studio so they can self-schedule ═══
// The #1 forgotten portal gap. The booking engine (/book/:site/*) is public and keyed
// by site id; this hands the client their studio's site id so the portal widget can
// list services, read open slots, and book — all through the existing public flow.
export async function handleClientBook(_req: Request, site: SiteRow, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  const me = customerOf(site);
  const links = me ? await linksForCustomer(me) : [];
  const agencySite = links[0]?.agency_site_id ? String(links[0].agency_site_id) : '';
  return json({ data: { site_id: agencySite || null } }, 200, cors);
}

// ═══ CLIENT FILE UPLOAD — the client can send the studio a file ═══
// The #1 client-portal gap (and the Terms already promise it). Reuses the ONE hardened
// media store (createUpload = mime/size/quota validation + a signed upload URL) on the
// AGENCY site the project lives on, gated by the bridge. Recorded as a client-visible
// deliverable + a client-visible event, so it lands in the studio's project Files and
// the client's own Files, and the studio sees that the client sent it.
export async function handleClientUploadUrl(req: Request, site: SiteRow, principal: Principal, projectId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(projectId)) return json({ error: 'bad_request' }, 400, cors);
  const me = customerOf(site);
  if (!me) return json({ error: 'forbidden' }, 403, cors);
  const link = await linkForCustomerProject(me, projectId);
  if (!link) return json({ error: 'not_found', message: 'That project isn’t here.' }, 404, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const res = await createUpload(link.agency_site_id, { mime: String(b?.mime || ''), bytes: Number(b?.bytes || 0), alt_text: clean(b?.title, 200) || 'Client upload' });
  if ('error' in (res as any)) return json(res, 422, cors);
  // Provenance: stamp the MEDIA row itself as a client upload — the deliverable's
  // note (handleClientUploadCreate below) never reaches the media row, and the
  // studio's Files roster reads THIS row through /assets' present(). Same metadata
  // convention as lib/media.ts importImage (a post-create PATCH); the explicit
  // boolean + the human note are exactly what the frontend detection reads.
  // Best-effort: a failed stamp must never block the upload.
  await svc(`presence_media?id=eq.${(res as { media_id: string }).media_id}&site_id=eq.${link.agency_site_id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ metadata: { client_upload: true, note: 'Uploaded by the client.' } }) }).catch(() => {});
  return json({ data: res }, 200, cors); // { media_id, upload_url, storage_path }
}
// ── Post-verification of a client upload (the declared-bytes bypass) ─────────
// createUpload (the upload-url step) validates only what the client DECLARED
// (mime/bytes); the bytes then travel browser→storage directly, so nothing yet
// proves the stored object matches the declaration — a hostile client can
// declare a 1KB PDF and PUT something else entirely. Before recording the
// deliverable, HEAD the object through the storage API (service role) and
// enforce the same mime allow-list + the cap the declaration was validated
// against, this time on the object's ACTUAL metadata. A mismatch is a clean
// 422 plus best-effort cleanup (object + media row — nothing orphaned, nothing
// recorded). Anything short of positive metadata (network failure, non-2xx,
// missing headers — storage API quirks / older builds) FAILS OPEN: this check
// must never break honest uploads. Zero schema change.
const storageEnv = () => ({
  url: (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, ''),
  key: Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
});
async function verifyStoredUpload(storagePath: string, declaredMime: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { url, key } = storageEnv();
  if (!url || !key || !storagePath) return { ok: true };   // nothing to check against — fail open
  const objectPath = storagePath.replace(`${BUCKET}/`, '');
  let res: Response;
  try {
    res = await fetch(`${url}/storage/v1/object/authenticated/${BUCKET}/${objectPath}`, {
      method: 'HEAD', headers: { Authorization: `Bearer ${key}`, apikey: key },
    });
  } catch { return { ok: true }; }                          // storage unreachable — fail open
  if (!res.ok) return { ok: true };                         // no metadata (404 / older storage builds / HEAD quirks) — fail open
  try { await res.body?.cancel(); } catch { /* HEAD carries no body */ }
  // actual content-type: must stay inside the ONE store's allow-list. An absent
  // or generic octet-stream type carries no information — skipped (fail open).
  const ctype = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (ctype && ctype !== 'application/octet-stream' && !MIME_ALLOW.has(ctype)) {
    return { ok: false, message: 'Files must be an image (JPEG, PNG, WebP) or a PDF document.' };
  }
  // actual size vs the ENFORCED cap (the one the declared mime was validated
  // against — declaring a PDF earns the 25MB cap, images 10MB). Content-Length
  // is storage's own count of what landed, not the client's claim.
  const size = Number(res.headers.get('content-length'));
  if (Number.isFinite(size) && size > 0) {
    const cap = isDocMime(declaredMime) ? MAX_DOC_BYTES : MAX_BYTES;
    if (size > cap) return { ok: false, message: 'That file is bigger than we can accept — images up to 10MB, PDFs up to 25MB.' };
  }
  return { ok: true };
}
async function discardRejectedUpload(siteId: string, mediaId: string, storagePath: string): Promise<void> {
  // best-effort, object first (frees the real bytes), then the row
  try {
    const { url, key } = storageEnv();
    if (url && key && storagePath) {
      const objectPath = storagePath.replace(`${BUCKET}/`, '');
      await fetch(`${url}/storage/v1/object/${BUCKET}/${objectPath}`, { method: 'DELETE', headers: { Authorization: `Bearer ${key}`, apikey: key } });
    }
  } catch { /* best-effort */ }
  await svc(`presence_media?id=eq.${mediaId}&site_id=eq.${siteId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ deleted_at: nowIso() }) }).catch(() => {});
}
export async function handleClientUploadCreate(req: Request, site: SiteRow, principal: Principal, projectId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(projectId)) return json({ error: 'bad_request' }, 400, cors);
  const me = customerOf(site);
  if (!me) return json({ error: 'forbidden' }, 403, cors);
  const link = await linkForCustomerProject(me, projectId);
  if (!link) return json({ error: 'not_found', message: 'That project isn’t here.' }, 404, cors);
  const s = link.agency_site_id;
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const mediaId = UUID_RE.test(b.media_id || '') ? b.media_id : null;
  if (!mediaId) return json({ error: 'validation', message: 'Pick a file to upload.' }, 422, cors);
  const media = rows(await svc(`presence_media?id=eq.${mediaId}&site_id=eq.${s}&deleted_at=is.null&select=id,alt_text,mime,storage_path&limit=1`))[0];
  if (!media) return json({ error: 'bad_media', message: 'That file isn’t here.' }, 422, cors);
  const verdict = await verifyStoredUpload(String(media.storage_path || ''), String(media.mime || ''));
  if (!verdict.ok) {
    await discardRejectedUpload(s, mediaId, String(media.storage_path || ''));
    return json({ error: 'upload_mismatch', message: verdict.message }, 422, cors);
  }
  const title = clean(b.title, 200) || clean(media.alt_text, 200) || 'Client upload';
  const ins = await svc('presence_deliverables', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: s, project_id: projectId, media_id: mediaId, title, note: 'Uploaded by the client.', status: 'shared', client_visible: true }) });
  if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
  await svc('presence_project_events', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ project_id: projectId, site_id: s, kind: 'client_upload', actor: readerKey(principal), actor_kind: principal.kind, client_visible: true, detail: { from: 'client', title } }) }).catch(() => {});
  return json({ data: rows(ins)[0] }, 201, cors);
}

// ═══ DOCUMENTS (the client's proposals & agreements, findable in-portal) ═══
// A top client-portal gap: signing worked ONLY via an emailed link, so a client who
// lost the email couldn't find their proposal/contract again. This lists every
// document on the deals that made them a customer, with a branded view link (a short-
// lived signed doc token → the read-only Document of Record). Read-only; drafts are
// never exposed; scoped to the caller's own client id.
export async function handleClientDocuments(_req: Request, site: SiteRow, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  const me = customerOf(site);
  if (!me) return json({ data: { documents: [] } }, 200, cors);
  const deals = rows(await svc(`presence_deals?converted_client_id=eq.${me}&deleted_at=is.null&select=id&limit=50`));
  if (!deals.length) return json({ data: { documents: [] } }, 200, cors);
  const ids = deals.map((d) => d.id).join(',');
  const [props, cons] = await Promise.all([
    svc(`presence_proposals?deal_id=in.(${ids})&status=in.(sent,accepted,declined,superseded)&deleted_at=is.null&select=id,title,status,subtotal_cents,created_at,site_id&order=created_at.desc&limit=100`),
    svc(`presence_contracts?deal_id=in.(${ids})&status=in.(sent,signed)&deleted_at=is.null&select=id,title,status,signed_at,created_at,site_id&order=created_at.desc&limit=100`),
  ]);
  const secret = linkSecret();
  const mk = async (kind: DocKind, id: string, siteId: string) => secret ? docViewerUrl(await signDocToken({ t: 'doc', k: kind, id, site_id: String(siteId), exp: Math.floor(Date.now() / 1000) + 30 * 86400 }, secret)) : null;
  const documents: any[] = [];
  for (const p of rows(props)) documents.push({ kind: 'proposal', id: p.id, title: clean(p.title, 200) || 'Proposal', status: p.status, amount: (Number(p.subtotal_cents) || 0) / 100, created_at: p.created_at, view_url: await mk('proposal', p.id, p.site_id) });
  for (const c of rows(cons)) documents.push({ kind: 'contract', id: c.id, title: clean(c.title, 200) || 'Agreement', status: c.status, signed_at: c.signed_at, created_at: c.created_at, view_url: await mk('contract', c.id, c.site_id) });
  documents.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return json({ data: { documents } }, 200, cors);
}

// ═══ PROJECTS (list + bundle + report) ═══
export async function handleClientProjects(_req: Request, site: SiteRow, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  const me = customerOf(site);
  if (!me) return noCustomer(cors);
  const links = await linksForCustomer(me);
  if (!links.length) return json({ data: [] }, 200, cors);
  const ids = links.map((l) => l.project_id);
  const r = await svc(`presence_projects?id=in.(${ids.join(',')})&deleted_at=is.null&client_visible=is.true&select=id,name,status,start_date,target_date,updated_at&order=updated_at.desc&limit=200`);
  return r.ok ? json({ data: rows(r) }, 200, cors) : json({ error: 'read_failed' }, 502, cors);
}

async function clientBundleFor(me: string, projectId: string) {
  const link = await linkForCustomerProject(me, projectId);
  if (!link) return null;
  const s = link.agency_site_id;
  const project = rows(await svc(`presence_projects?id=eq.${projectId}&site_id=eq.${s}&deleted_at=is.null&client_visible=is.true&select=id,name,status,start_date,target_date&limit=1`))[0];
  if (!project) return null;
  return { link, siteId: s, project };
}

export async function handleClientProject(_req: Request, site: SiteRow, _principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const me = customerOf(site);
  if (!me) return json({ error: 'not_found' }, 404, cors);
  const ctx = await clientBundleFor(me, id);
  if (!ctx) return json({ error: 'not_found', message: 'That project isn’t here.' }, 404, cors);
  const s = ctx.siteId; const now = nowIso();
  const [ms, ts, ev, dl, ap, sv] = await Promise.all([
    svc(`presence_milestones?project_id=eq.${id}&site_id=eq.${s}&deleted_at=is.null&client_visible=is.true&select=id,title,status,due_date,sort_order,completed_at&order=sort_order.asc`),
    svc(`presence_tasks?project_id=eq.${id}&site_id=eq.${s}&deleted_at=is.null&client_visible=is.true&select=id,title,detail,status,priority,client_action_required,due_date,sort_order,completed_at&order=sort_order.asc&limit=500`),
    svc(`presence_project_events?project_id=eq.${id}&site_id=eq.${s}&client_visible=is.true&select=kind,detail,created_at&order=created_at.desc&limit=50`),
    svc(`presence_deliverables?project_id=eq.${id}&site_id=eq.${s}&deleted_at=is.null&client_visible=is.true&status=eq.shared&select=id,title,note,created_at&order=created_at.desc&limit=200`),
    svc(`presence_approvals?project_id=eq.${id}&site_id=eq.${s}&deleted_at=is.null&client_visible=is.true&select=id,subject_type,title,summary,content_hash,status,decided_at&order=created_at.desc&limit=100`),
    svc(`presence_surveys?project_id=eq.${id}&site_id=eq.${s}&deleted_at=is.null&client_visible=is.true&status=eq.active&select=id,title,created_at&order=created_at.desc&limit=50`),
  ]);
  const tasks = rows(ts).sort(compareOrder).map((t) => ({ ...t, derived: deriveTaskState(t, now) }));
  return json({ data: { project: ctx.project, milestones: rows(ms).sort(compareOrder), tasks, events: rows(ev), deliverables: rows(dl), approvals: rows(ap), surveys: rows(sv), progress: progressOf(rows(ts)) } }, 200, cors);
}

export async function handleClientReport(_req: Request, site: SiteRow, _principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const me = customerOf(site);
  if (!me) return json({ error: 'not_found' }, 404, cors);
  const ctx = await clientBundleFor(me, id);
  if (!ctx) return json({ error: 'not_found' }, 404, cors);
  const s = ctx.siteId;
  const [ts, ms, dl, ap, ev] = await Promise.all([
    svc(`presence_tasks?project_id=eq.${id}&site_id=eq.${s}&deleted_at=is.null&client_visible=is.true&select=status,client_action_required,due_date&limit=1000`),
    svc(`presence_milestones?project_id=eq.${id}&site_id=eq.${s}&deleted_at=is.null&client_visible=is.true&select=status`),
    svc(`presence_deliverables?project_id=eq.${id}&site_id=eq.${s}&deleted_at=is.null&client_visible=is.true&status=eq.shared&select=status`),
    svc(`presence_approvals?project_id=eq.${id}&site_id=eq.${s}&deleted_at=is.null&client_visible=is.true&select=status`),
    svc(`presence_project_events?project_id=eq.${id}&site_id=eq.${s}&client_visible=is.true&select=created_at&order=created_at.desc&limit=1`),
  ]);
  const csatRatings = await csatRatingsForProject(s, id);   // service edge #1: computed CSAT average
  const summary = reportSummary({ tasks: rows(ts), milestones: rows(ms), deliverables: rows(dl), approvals: rows(ap), lastActivityAt: rows(ev)[0]?.created_at || null, csatRatings }, nowIso());
  return json({ data: { project: ctx.project, summary, generated_at: nowIso() } }, 200, cors);
}

// ═══ MESSAGES (client posts to the shared thread) ═══
export async function handleClientMessages(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const me = customerOf(site);
  if (!me) return json({ error: 'not_found' }, 404, cors);
  const link = await linkForCustomerProject(me, id);
  if (!link) return json({ error: 'not_found' }, 404, cors);
  const s = link.agency_site_id;
  if (req.method === 'GET') {
    const u = new URL(req.url);
    const r = await svc(`presence_project_messages?project_id=eq.${id}&site_id=eq.${s}&deleted_at=is.null&audience=eq.client&select=id,body,author_kind,created_at&order=created_at.desc&limit=${clampLimit(u.searchParams.get('limit'))}&offset=${clampOffset(u.searchParams.get('offset'))}`);
    return r.ok ? json({ data: rows(r) }, 200, cors) : json({ error: 'read_failed' }, 502, cors);
  }
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const body = clean(b.body, 5000);
  if (!body) return json({ error: 'validation', message: 'Write a message first.' }, 400, cors);
  const ins = await svc('presence_project_messages', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: s, project_id: id, audience: 'client', body, author: readerKey(principal), author_kind: principal.kind }) });
  if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed' }, 502, cors);
  await clientEvent(s, id, 'message', principal, { message_id: rows(ins)[0].id, from: 'client' });
  return json({ data: rows(ins)[0] }, 201, cors);
}

// ═══ DELIVERABLE DOWNLOAD ═══
export async function handleClientDeliverableDownload(_req: Request, site: SiteRow, _principal: Principal, did: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(did)) return json({ error: 'bad_request' }, 400, cors);
  const me = customerOf(site);
  if (!me) return json({ error: 'not_found' }, 404, cors);
  const found = await linkForCustomerVia(me, 'presence_deliverables', did);
  if (!found) return json({ error: 'not_found', message: 'That file isn’t here.' }, 404, cors);
  const d = rows(await svc(`presence_deliverables?id=eq.${did}&site_id=eq.${found.link.agency_site_id}&deleted_at=is.null&client_visible=is.true&status=eq.shared&select=media_id,title&limit=1`))[0];
  if (!d) return json({ error: 'not_found' }, 404, cors);
  const media = rows(await svc(`presence_media?id=eq.${d.media_id}&site_id=eq.${found.link.agency_site_id}&deleted_at=is.null&select=storage_path,mime&limit=1`))[0];
  if (!media?.storage_path) return json({ error: 'not_found' }, 404, cors);
  const url = await signDownload(media.storage_path, (clean(d.title, 80) || 'download') + (media.mime === 'application/pdf' ? '.pdf' : ''));
  return url ? json({ data: { url, title: d.title } }, 200, cors) : json({ error: 'unavailable' }, 502, cors);
}

// ═══ APPROVAL DECIDE (client) ═══
export async function handleClientApprovalDecide(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const me = customerOf(site);
  if (!me) return json({ error: 'not_found' }, 404, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  if (!isDecision(b.decision)) return json({ error: 'bad_decision', message: 'Choose approve, reject, or request changes.' }, 422, cors);
  const found = await linkForCustomerVia(me, 'presence_approvals', id);
  if (!found) return json({ error: 'not_found', message: 'That request isn’t here.' }, 404, cors);
  const s = found.link.agency_site_id;
  const a = rows(await svc(`presence_approvals?id=eq.${id}&site_id=eq.${s}&deleted_at=is.null&client_visible=is.true&select=*&limit=1`))[0];
  if (!a) return json({ error: 'not_found' }, 404, cors);
  if (a.status === b.decision) return json({ data: { status: a.status }, already: true }, 200, cors);
  if (!canDecideApproval(a.status)) return json({ error: 'already_decided', message: 'This request has already been decided or replaced.' }, 409, cors);
  const presented = clean(b.presented_hash, 64);
  if (presented && presented !== a.content_hash) return json({ error: 'version_mismatch', message: 'This item was updated — reload the latest version before deciding.' }, 409, cors);
  const up = await svc(`presence_approvals?id=eq.${id}&site_id=eq.${s}&status=eq.pending&content_hash=eq.${a.content_hash}&select=project_id`, { method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: b.decision, decided_by: readerKey(principal), decided_by_kind: principal.kind, decided_at: nowIso(), decision_note: clean(b.note, 1000) }) });
  if (!up.ok || !rows(up)[0]) return json({ error: 'conflict' }, 409, cors);
  await clientEvent(s, a.project_id, 'approval_decided', principal, { approval_id: id, decision: b.decision });
  return json({ data: { status: b.decision } }, 200, cors);
}

// ═══ SURVEY view (client fetches the questions to fill) ═══
export async function handleClientSurvey(_req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const me = customerOf(site);
  if (!me) return json({ error: 'not_found' }, 404, cors);
  const found = await linkForCustomerVia(me, 'presence_surveys', id);
  if (!found) return json({ error: 'not_found' }, 404, cors);
  const s = found.link.agency_site_id;
  const survey = rows(await svc(`presence_surveys?id=eq.${id}&site_id=eq.${s}&deleted_at=is.null&client_visible=is.true&status=eq.active&select=id,title,questions&limit=1`))[0];
  if (!survey) return json({ error: 'not_found', message: 'That survey isn’t open.' }, 404, cors);
  const mine = rows(await svc(`presence_survey_responses?survey_id=eq.${id}&site_id=eq.${s}&respondent=eq.${encodeURIComponent(readerKey(principal))}&deleted_at=is.null&select=id,status&limit=1`))[0] || null;
  return json({ data: { survey, my_response: mine } }, 200, cors);
}

// ═══ SURVEY RESPOND (client) ═══
export async function handleClientSurveyRespond(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const me = customerOf(site);
  if (!me) return json({ error: 'not_found' }, 404, cors);
  const found = await linkForCustomerVia(me, 'presence_surveys', id);
  if (!found) return json({ error: 'not_found' }, 404, cors);
  const s = found.link.agency_site_id;
  const survey = rows(await svc(`presence_surveys?id=eq.${id}&site_id=eq.${s}&deleted_at=is.null&client_visible=is.true&status=eq.active&select=id,project_id,questions&limit=1`))[0];
  if (!survey) return json({ error: 'not_found', message: 'That survey isn’t open.' }, 404, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const norm = normalizeAnswers(b.answers, survey.questions || []);
  if (!norm.ok) return json({ error: 'validation', message: norm.error }, 422, cors);
  const respondent = readerKey(principal);
  const existing = rows(await svc(`presence_survey_responses?survey_id=eq.${id}&site_id=eq.${s}&respondent=eq.${encodeURIComponent(respondent)}&status=eq.submitted&select=id&limit=1`))[0];
  if (existing) return json({ data: { id: existing.id, status: 'submitted' }, already: true }, 200, cors);
  const ins = await svc('presence_survey_responses', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: s, survey_id: id, project_id: survey.project_id, respondent, answers: norm.answers, status: 'submitted', submitted_at: nowIso() }) });
  if (!ins.ok || !rows(ins)[0]) {
    const race = rows(await svc(`presence_survey_responses?survey_id=eq.${id}&site_id=eq.${s}&respondent=eq.${encodeURIComponent(respondent)}&status=eq.submitted&select=id&limit=1`))[0];
    if (race) return json({ data: { id: race.id, status: 'submitted' }, already: true }, 200, cors);
    return json({ error: 'write_failed' }, 502, cors);
  }
  if (survey.project_id) await clientEvent(s, survey.project_id, 'survey_submitted', principal, { survey_id: id });
  return json({ data: { id: rows(ins)[0].id, status: 'submitted' } }, 201, cors);
}

// ═══ NOTIFICATIONS (derived over the customer's linked projects + their support) ═══
export async function handleClientNotifications(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  const me = customerOf(site);
  if (!me) return json({ data: [], unread_count: 0 }, 200, cors);
  const links = await linksForCustomer(me);
  if (!links.length) return json({ data: [], unread_count: 0 }, 200, cors);
  const s = links[0].agency_site_id; // a customer's delivery lives on their converting agency's site
  const ids = links.filter((l) => l.agency_site_id === s).map((l) => l.project_id);
  const limit = clampLimit(new URL(req.url).searchParams.get('limit'));
  const [evR, supR, seenR] = await Promise.all([
    ids.length ? svc(`presence_project_events?site_id=eq.${s}&project_id=in.(${ids.join(',')})&client_visible=is.true&select=kind,detail,project_id,created_at&order=created_at.desc&limit=${limit}`) : Promise.resolve({ json: [] }),
    svc(`presence_support_requests?site_id=eq.${s}&requester=eq.${encodeURIComponent(readerKey(principal))}&deleted_at=is.null&select=id,subject,status,updated_at&order=updated_at.desc&limit=25`),
    svc(`presence_activity_reads?site_id=eq.${s}&reader=eq.${encodeURIComponent('client:' + me)}&select=last_seen_at&limit=1`),
  ]);
  const lastSeen = rows(seenR)[0]?.last_seen_at || null;
  const items = [
    // The reader's OWN message sends (kind='message' events stamped
    // detail.from='client' by the client door, the only writer of that stamp)
    // are not news TO them — deriving them lit false "the studio replied" dots
    // after every reload. Only that pairing is excluded; other own-action kinds
    // keep their existing derivations.
    ...rows(evR).filter((e) => !(e.kind === 'message' && (e.detail || {}).from === 'client'))
      .map((e) => ({ kind: e.kind, label: notifLabel(e.kind), href: notifHref(e.kind, e.project_id, e.detail || {}), created_at: e.created_at, read: isRead(e.created_at, lastSeen) })),
    // Residual gap (named, accepted): these derived support rows key on the
    // caller's OWN requests' updated_at — a request the client just opened can
    // still self-notify here until the bell's read cursor passes it.
    ...rows(supR).map((r) => ({ kind: 'support_message', label: `Support: ${clean(r.subject, 60)}`, href: `/client.html?support=${r.id}`, created_at: r.updated_at, read: isRead(r.updated_at, lastSeen) })),
  ].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit);
  return json({ data: items, unread_count: items.filter((i) => !i.read).length }, 200, cors);
}

export async function handleClientNotificationsRead(_req: Request, site: SiteRow, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  const me = customerOf(site);
  if (!me) return json({ data: { ok: true } }, 200, cors);
  const links = await linksForCustomer(me);
  if (!links.length) return json({ data: { ok: true } }, 200, cors);
  const up = await svc('presence_activity_reads?on_conflict=site_id,reader', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ site_id: links[0].agency_site_id, reader: 'client:' + me, last_seen_at: nowIso() }) });
  return up.ok ? json({ data: { ok: true } }, 200, cors) : json({ error: 'write_failed' }, 502, cors);
}

// ═══ SERVICES (the studio's visible offerings — the catalog a client requests FROM) ═══
// Read-only projection of the agency's presence_offerings, scoped to the caller's
// linked agency site (SAME resolution as handleClientSupport). Only VISIBLE, non-
// deleted offerings. Empty array when the studio has listed none (or the caller has
// no active service-link, e.g. a reviewer) → the portal shows a calm empty state.
export async function handleClientServices(_req: Request, site: SiteRow, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  const me = customerOf(site);
  if (!me) return json({ data: [] }, 200, cors);
  const links = await linksForCustomer(me);
  if (!links.length) return json({ data: [] }, 200, cors);
  const s = links[0].agency_site_id;                 // a customer's delivery lives on their converting agency's site
  // A studio may keep its services in EITHER place: website Offerings (rich —
  // name + description + price) OR the proposal "Manage services" catalog (name +
  // price, stored as line_items on a reserved sales template). Merge BOTH so the
  // client sees the studio's services wherever they were listed, then ALWAYS add a
  // "Custom" option. Any id that isn't a real offering UUID degrades in POST
  // /client/support to a plain named request — nothing is charged either way.
  const [offR, salesR] = await Promise.all([
    svc(`presence_offerings?site_id=eq.${s}&deleted_at=is.null&is_visible=is.true&select=id,name,category,description,price_text&order=sort_order.asc,created_at.asc&limit=200`),
    svc(`presence_sales_templates?site_id=eq.${s}&kind=eq.proposal&name=eq.${encodeURIComponent('__services_catalog__')}&deleted_at=is.null&select=line_items&limit=1`),
  ]);
  if (!offR.ok) return json({ error: 'read_failed' }, 502, cors);
  const list: Array<{ id: string; name: string; category: string; description: string; price: string }> = [];
  const seen = new Set<string>();
  for (const o of rows(offR)) {
    const name = clean(o.name, 120); if (!name) continue;
    seen.add(name.toLowerCase());
    list.push({ id: o.id, name, category: clean(o.category, 60), description: clean(o.description, 500), price: clean(o.price_text, 40) });
  }
  const salesItems = rows(salesR)[0]?.line_items;
  if (Array.isArray(salesItems)) {
    salesItems.forEach((it: any, i: number) => {
      const name = clean(it?.label, 120);
      if (!name || seen.has(name.toLowerCase())) return;
      seen.add(name.toLowerCase());
      const cents = Math.max(0, Math.trunc(Number(it?.unit_cents)) || 0);
      const price = cents > 0 ? '$' + (cents / 100).toFixed(2).replace(/\.00$/, '') : '';
      list.push({ id: `svc:${i}`, name, category: '', description: '', price });
    });
  }
  // Always offer a Custom request so a client can ask for anything not listed.
  list.push({ id: 'custom', name: 'Custom request', category: '', description: 'Something else in mind? Tell your studio exactly what you’d like and they’ll follow up.', price: '' });
  return json({ data: list }, 200, cors);
}

// ═══ SUPPORT (client submits/replies; the studio triages via /support on the agency site) ═══
export async function handleClientSupport(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  const me = customerOf(site);
  if (!me) return noCustomer(cors);
  const links = await linksForCustomer(me);
  if (!links.length) return json({ data: [] , message: 'No agency is linked to your account yet.' }, 200, cors);
  const s = links[0].agency_site_id;
  if (req.method === 'GET') {
    const u = new URL(req.url);
    const r = await svc(`presence_support_requests?site_id=eq.${s}&requester=eq.${encodeURIComponent(readerKey(principal))}&deleted_at=is.null&select=id,subject,status,priority,project_id,resolved_at,updated_at&order=updated_at.desc&limit=${clampLimit(u.searchParams.get('limit'))}&offset=${clampOffset(u.searchParams.get('offset'))}`);
    if (!r.ok) return json({ error: 'read_failed' }, 502, cors);
    const list = rows(r);
    // Additive `last_activity_at` = max(updated_at, the newest reply's created_at):
    // replies only INSERT into presence_support_messages and never bump the
    // request's updated_at, so sorting on updated_at misses every reply after the
    // first (the studio side fixed the same gap in workspace.ts, slice 2). ONE
    // batched, site-scoped read for the listed request ids; strictly best-effort —
    // on any failure the field is simply omitted and the portal falls back to
    // updated_at (deploy-order tolerant in both directions: old portals ignore
    // the extra field, new portals tolerate its absence).
    if (list.length) {
      try {
        const mr = await svc(`presence_support_messages?site_id=eq.${s}&request_id=in.(${list.map((x) => String(x.id)).join(',')})&deleted_at=is.null&select=request_id,created_at&order=created_at.desc&limit=300`);
        if (mr.ok && Array.isArray(mr.json)) {
          const newest: Record<string, string> = {};
          for (const m of mr.json as any[]) { const rid = String(m.request_id || ''); if (rid && !newest[rid]) newest[rid] = String(m.created_at || ''); } // created_at.desc → first seen per request is its newest
          for (const row of list) { const n = newest[String(row.id)] || ''; const upd = String(row.updated_at || ''); row.last_activity_at = n > upd ? n : upd; }
        }
      } catch { /* omit the field — callers fall back to updated_at */ }
    }
    return json({ data: list }, 200, cors);
  }
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const subject = clean(b.subject, 200);
  if (!subject) return json({ error: 'validation', message: 'A support request needs a subject.' }, 422, cors);
  let projectId: string | null = UUID_RE.test(b.project_id || '') ? b.project_id : null;
  if (projectId && !(await linkForCustomerProject(me, projectId))) projectId = null; // only a linked project
  const priority = isSupportPriority(b.priority) ? b.priority : 'normal';
  // R2 service request: an optional reference to one of THIS studio's visible
  // offerings + a structured brief. The offering is verified to live on THIS
  // agency site (tenant-safe) before its name is used; the brief is folded into
  // the request body as clean, plain, escaped text (there is no jsonb column).
  // It is still just a PENDING support request the studio confirms + quotes by
  // hand — NOTHING is charged and no paid order is created (the moat).
  let serviceName: string | null = null;
  if (UUID_RE.test(b.service || '')) {
    const off = rows(await svc(`presence_offerings?id=eq.${b.service}&site_id=eq.${s}&deleted_at=is.null&is_visible=is.true&select=name&limit=1`))[0];
    serviceName = off ? (clean(off.name, 120) || null) : null;
  }
  const hasBrief = b.brief && typeof b.brief === 'object';
  const body = (serviceName || hasBrief)
    ? composeServiceBrief(serviceName, hasBrief ? b.brief : null, b.body)
    : clean(b.body, 5000);
  const ins = await svc('presence_support_requests', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: s, project_id: projectId, subject, body, status: 'open', priority, requester: readerKey(principal), requester_kind: principal.kind }) });
  if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed' }, 502, cors);
  if (projectId) await clientEvent(s, projectId, 'support_opened', principal, { request_id: rows(ins)[0].id, subject });
  // service edge #2: auto-acknowledge the customer — a submitted ticket used to
  // email no one. Best-effort, transactional, on the agency's brand.
  await emailCustomerByClient(s, me, 'We’ve got your request',
    `<p>Thanks — we’ve got your request and it’s in our queue. Nothing more is needed right now; we’ll follow up here, and you can add details or reply any time from your workspace.</p>`).catch(() => {});
  return json({ data: rows(ins)[0] }, 201, cors);
}

async function clientSupportRow(me: string, agencySiteId: string, id: string, principal: Principal) {
  const r = rows(await svc(`presence_support_requests?id=eq.${id}&site_id=eq.${agencySiteId}&deleted_at=is.null&select=*&limit=1`))[0];
  if (!r || r.requester !== readerKey(principal)) return null; // the customer sees only its OWN requests
  return r;
}

export async function handleClientSupportOne(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const me = customerOf(site);
  if (!me) return json({ error: 'not_found' }, 404, cors);
  const links = await linksForCustomer(me);
  if (!links.length) return json({ error: 'not_found' }, 404, cors);
  const s = links[0].agency_site_id;
  const reqRow = await clientSupportRow(me, s, id, principal);
  if (!reqRow) return json({ error: 'not_found' }, 404, cors);
  if (req.method === 'GET') {
    // author_kind can't tell the studio from the requester (BOTH resolve to
    // principal.kind 'client'; only platform staff are 'staff'/'system'), so read
    // the stored `author` key and derive an additive `from` per message: 'client'
    // = the request's own requester, 'studio' = anyone else. The raw author key
    // (a user id / email) is NOT echoed — only the derived side. Old portal
    // builds simply ignore `from` (additive, deploy-order tolerant both ways).
    const msgs = rows(await svc(`presence_support_messages?request_id=eq.${id}&site_id=eq.${s}&deleted_at=is.null&select=id,body,author,author_kind,created_at&order=created_at.asc&limit=200`))
      .map(({ author, ...m }) => ({ ...m, from: author === reqRow.requester ? 'client' : 'studio' }));
    return json({ data: { request: reqRow, messages: msgs } }, 200, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

export async function handleClientSupportMessage(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const me = customerOf(site);
  if (!me) return json({ error: 'not_found' }, 404, cors);
  const links = await linksForCustomer(me);
  if (!links.length) return json({ error: 'not_found' }, 404, cors);
  const s = links[0].agency_site_id;
  const reqRow = await clientSupportRow(me, s, id, principal);
  if (!reqRow) return json({ error: 'not_found' }, 404, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const body = clean(b.body, 5000);
  if (!body) return json({ error: 'validation', message: 'Write a message first.' }, 400, cors);
  const ins = await svc('presence_support_messages', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: s, request_id: id, body, author: readerKey(principal), author_kind: principal.kind }) });
  if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed' }, 502, cors);
  if (reqRow.project_id) await clientEvent(s, reqRow.project_id, 'support_message', principal, { request_id: id });
  return json({ data: rows(ins)[0] }, 201, cors);
}

// ═══ WEBSITE STATS (slice 8b) — the customer's own website, in plain numbers ═══
// The portal Home's "Your website" card. Unlike every handler above, this needs
// NO bridge link: the subject is the caller's OWN site (site.id — the website
// the first-party collector beacons to), exactly the scope the rest of /client/*
// resolves from. It reuses the SAME pure helpers + read patterns as the studio's
// GET /analytics/dashboard (dashRange · aggregateVisits · weeklyVisitors ·
// sourceShares · readGsc · readSearchTerms) so portal and studio numbers always
// agree. Digestible subset ONLY — nothing operator-internal (no deals, no
// invoices, no support queues). Tolerant: a failed read yields null for that
// section (the card degrades), never a 500; an unpublished site returns
// published:false and the portal hides the card entirely. Zero schema change.
export async function handleClientWebsiteStats(_req: Request, site: SiteRow, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  const published = site.status === 'live' || !!site.last_published_at;
  if (!published) return json({ data: { published: false, month: null, search: null } }, 200, cors);
  const statNowIso = nowIso();
  const nowMs = Date.parse(statNowIso);
  const { startMs, days } = dashRange('this_month', nowMs);
  // one visits fetch serves the this-month numbers AND the 12-week line (the
  // same shape handleAnalyticsDashboard uses)
  const visitStartIso = new Date(Math.min(startMs, nowMs - DASH_WEEKS * 7 * 86_400_000)).toISOString();
  const safe = async <T>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };
  const [visitsR, gsc] = await Promise.all([
    safe(svc(`presence_visits?site_id=eq.${site.id}&ts=gte.${visitStartIso}&select=ts,kind,path,ref_host,utm_source,device,country,visitor_hash&order=ts.desc&limit=5000`)),
    safe(readGsc(site.client_id)),
  ]);
  let month: unknown = null;
  const vRows = (visitsR && (visitsR as { ok?: boolean }).ok && Array.isArray((visitsR as { json?: unknown }).json))
    ? (visitsR as { json: VisitRow[] }).json : null;
  if (vRows) {
    // EXACT calendar boundary (same fix as handleAnalyticsDashboard): intersect
    // with the true month start before aggregating, so the ceil'd days window
    // never bleeds prior-month rows into "this month" (worst on the 1st).
    const periodRows = vRows.filter((v) => { const ms = Date.parse(String(v.ts || '')); return Number.isFinite(ms) && ms >= startMs; });
    const agg = aggregateVisits(periodRows, nowMs, days);
    const sources = sourceShares(agg.topSources, agg.visitors);   // already ≤5, largest first
    month = {
      visitors: agg.visitors, pageviews: agg.pageviews,
      actions: agg.events.phone + agg.events.email + agg.events.cta,
      top_source: sources[0] || null,
      weekly: weeklyVisitors(vRows, nowMs),   // 12 buckets, oldest first
      top_pages: agg.topPages,                // ≤5
      sources,
      has_data: agg.hasData,
      truncated: vRows.length >= 5000,        // hit the fetch cap → "based on recent activity"
    };
  }
  // search: null = genuinely not connected; { unavailable: true } = the signals
  // read failed — the portal drops the Google tile/section silently either way,
  // but the states stay distinguishable (and mirror the studio dashboard's).
  let search: unknown = null;
  if (!gsc || !gsc.ok) search = { unavailable: true };
  else if (gsc.hasData) {
    const terms = await safe(readSearchTerms(site.client_id || '', gsc.period));
    search = {
      clicks: gsc.clicks, impressions: gsc.impressions, period: gsc.period,   // period: same string the studio shows
      top_terms: (terms?.queries || []).map((q: any) => ({ term: String(q.key || ''), clicks: Number(q.clicks) || 0, impressions: Number(q.impressions) || 0 })),   // ≤5
    };
  }
  return json({ data: { published: true, month, search } }, 200, cors);
}

// ═══ STUDIO ROSTER (operator side): THIS studio's customers ═══
// FIX 6: the operator's LIST of the customers they serve — the roster the primary
// "Customers" nav needs. Resolved from the ACTIVE service-links on the operator's
// OWN site (agency_site_id = this site), so it is strictly tenant-safe: only
// customers linked to THIS studio are returned, and the global `clients` table is
// read ONLY for ids already proven to belong here via the bridge. Studio-side only
// (a client_reviewer never reaches the workspace). One row per customer, carrying
// enough to render a roster + route straight to that customer's delivery project.
export async function handleStudioCustomers(_req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  if (!(await isStudioSide(jwt, site, principal))) return studioDenied(cors);
  const links = rows(await svc(`presence_service_links?agency_site_id=eq.${site.id}&status=eq.active&select=project_id,customer_client_id,customer_site_id,created_at&order=created_at.desc&limit=500`));
  if (!links.length) return json({ data: [] }, 200, cors);
  const clientIds = [...new Set(links.map((l) => l.customer_client_id).filter(Boolean).map(String))];
  const projectIds = [...new Set(links.map((l) => l.project_id).filter(Boolean).map(String))];
  const [clientsR, projectsR, supR] = await Promise.all([
    clientIds.length ? svc(`clients?id=in.(${clientIds.join(',')})&select=id,name,email`) : Promise.resolve({ json: [] }),
    projectIds.length ? svc(`presence_projects?id=in.(${projectIds.join(',')})&site_id=eq.${site.id}&deleted_at=is.null&select=id,name,status`) : Promise.resolve({ json: [] }),
    svc(`presence_support_requests?site_id=eq.${site.id}&status=in.(open,in_progress)&deleted_at=is.null&select=id,project_id&limit=500`),
  ]);
  const clientById: Record<string, any> = {}; for (const c of rows(clientsR)) clientById[String(c.id)] = c;
  const projectById: Record<string, any> = {}; for (const p of rows(projectsR)) projectById[String(p.id)] = p;
  const supportByProject: Record<string, number> = {};
  for (const sreq of rows(supR)) { const pid = sreq.project_id ? String(sreq.project_id) : ''; if (pid) supportByProject[pid] = (supportByProject[pid] || 0) + 1; }
  // group by customer — the newest link is the primary project; sum open support
  // across ALL their projects so the roster shows one honest "needs you" count.
  const byCustomer = new Map<string, any>();
  for (const l of links) {
    const cid = l.customer_client_id ? String(l.customer_client_id) : '';
    if (!cid) continue;
    if (!byCustomer.has(cid)) {
      const c = clientById[cid] || {};
      const proj = projectById[String(l.project_id)] || null;
      byCustomer.set(cid, {
        client_id: cid,
        name: clean(c.name, 200) || 'Customer',
        email: clean(c.email, 200),
        project_id: l.project_id || null,
        project_name: proj ? clean(proj.name, 200) : '',
        status: proj ? proj.status : 'active',
        customer_site_id: l.customer_site_id || null,
        open_support: 0,
        project_count: 0,
      });
    }
    const row = byCustomer.get(cid);
    row.project_count += 1;
    row.open_support += supportByProject[String(l.project_id)] || 0;
  }
  return json({ data: [...byCustomer.values()] }, 200, cors);
}
