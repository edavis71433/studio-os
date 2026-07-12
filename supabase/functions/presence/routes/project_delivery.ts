// ── Deliverables & Approvals routes (Presence CMS Phase 2, P2-D-2) ───────────
// Deliverables = a client-facing OVERLAY on the ONE media store (presence_media),
// downloaded via the existing signed-URL path (no second bucket). Approvals = ONE
// generic decision bound to the exact item + version (content_hash), reusing the
// contract version-integrity idiom. Site-scoped; studio manages; the client
// reviews. No parallel systems.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { signDownload, createUpload } from '../lib/media.ts';
import { isStudioSide, studioDenied, loadProject, projectEvent } from './projects.ts';
import { isDecision, isSubjectType, canDecideApproval, approvalHash } from '../lib/approvals.ts';
import { emailBridgedCustomer } from '../lib/service_bridge.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (s: unknown, max = 500) => String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
const nowIso = () => new Date().toISOString();
const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const actor = (p: Principal) => ({ by: p.email || p.userId || 'system', kind: p.kind });

// ═══ DELIVERABLES (overlay on presence_media) ═══
/** Mint a signed upload URL for a deliverable file, reusing the ONE hardened media
 *  store (createUpload = validation + quota + storage path). This is a
 *  RELATIONSHIP-gated entry point so a Business-OS customer with no website can
 *  still share files — same store, same bucket, NOT a second file system. The
 *  client then PUTs the bytes and calls POST …/deliverables with the media_id. */
export async function handleDeliverableUploadUrl(req: Request, jwt: string, site: SiteRow, principal: Principal, projectId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(projectId)) return json({ error: 'bad_request' }, 400, cors);
  if (!(await isStudioSide(jwt, site, principal))) return studioDenied(cors);
  const project = await loadProject(site.id, projectId);
  if (!project) return json({ error: 'not_found' }, 404, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const res = await createUpload(site.id, { mime: String(b?.mime || ''), bytes: Number(b?.bytes || 0), alt_text: clean(b?.alt_text, 200) || clean(b?.title, 200) || 'Deliverable file', width: b?.width, height: b?.height });
  if ('error' in res) return json(res, 422, cors);
  return json({ data: res }, 200, cors); // { media_id, upload_url, storage_path }
}

export async function handleDeliverablesCreate(req: Request, jwt: string, site: SiteRow, principal: Principal, projectId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(projectId)) return json({ error: 'bad_request' }, 400, cors);
  if (!(await isStudioSide(jwt, site, principal))) return studioDenied(cors);
  const project = await loadProject(site.id, projectId);
  if (!project) return json({ error: 'not_found' }, 404, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const mediaId = UUID_RE.test(b.media_id || '') ? b.media_id : null;
  if (!mediaId) return json({ error: 'validation', message: 'A deliverable needs a file (media_id).' }, 422, cors);
  const media = rows(await svc(`presence_media?id=eq.${mediaId}&site_id=eq.${site.id}&deleted_at=is.null&select=id,alt_text,mime&limit=1`))[0];
  if (!media) return json({ error: 'bad_media', message: 'That file isn’t in this workspace.' }, 422, cors);
  const status = b.status === 'draft' ? 'draft' : 'shared';
  const clientVisible = b.client_visible === false ? false : true;
  const ins = await svc('presence_deliverables', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, project_id: projectId, media_id: mediaId,
      title: clean(b.title, 200) || clean(media.alt_text, 200) || 'Deliverable', note: clean(b.note, 2000),
      status, client_visible: clientVisible }) });
  if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed', message: 'That deliverable didn’t save — please try again.' }, 502, cors);
  const d = rows(ins)[0];
  await projectEvent(site.id, projectId, 'deliverable_added', principal, d.client_visible && status === 'shared', { deliverable_id: d.id, title: d.title });
  return json({ data: d }, 201, cors);
}

export async function handleDeliverable(req: Request, jwt: string, site: SiteRow, principal: Principal, projectId: string, did: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(projectId) || !UUID_RE.test(did)) return json({ error: 'bad_request' }, 400, cors);
  if (!(await isStudioSide(jwt, site, principal))) return studioDenied(cors);
  const d = rows(await svc(`presence_deliverables?id=eq.${did}&project_id=eq.${projectId}&site_id=eq.${site.id}&deleted_at=is.null&select=*&limit=1`))[0];
  if (!d) return json({ error: 'not_found' }, 404, cors);
  if (req.method === 'PATCH') {
    let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const patch: Record<string, unknown> = {};
    if (b.title !== undefined) patch.title = clean(b.title, 200);
    if (b.note !== undefined) patch.note = clean(b.note, 2000);
    if (b.client_visible !== undefined) patch.client_visible = !!b.client_visible;
    if (b.status !== undefined) { if (b.status !== 'draft' && b.status !== 'shared') return json({ error: 'bad_status' }, 422, cors); patch.status = b.status; }
    if (!Object.keys(patch).length) return json({ error: 'empty_update' }, 400, cors);
    const up = await svc(`presence_deliverables?id=eq.${did}&site_id=eq.${site.id}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
    if (!up.ok || !rows(up)[0]) return json({ error: 'write_failed' }, 502, cors);
    // B2: a file shared after upload (draft→shared, still client-visible) → tell the client
    if (d.status !== 'shared' && rows(up)[0].status === 'shared' && rows(up)[0].client_visible === true) {
      await projectEvent(site.id, projectId, 'deliverable_added', principal, true, { deliverable_id: did, title: rows(up)[0].title });
    }
    return json({ data: rows(up)[0] }, 200, cors);
  }
  if (req.method === 'DELETE') { // soft-delete the OVERLAY only; the underlying media is untouched (delete-protection lives in lib/media.ts)
    const up = await svc(`presence_deliverables?id=eq.${did}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ deleted_at: nowIso() }) });
    return up.ok ? json({ data: { ok: true, message: 'Removed from the project. The file itself is kept.' } }, 200, cors) : json({ error: 'write_failed' }, 502, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

/** Signed download — studio always; the client only for a shared, client-visible deliverable. */
export async function handleDeliverableDownload(req: Request, jwt: string, site: SiteRow, principal: Principal, projectId: string, did: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(projectId) || !UUID_RE.test(did)) return json({ error: 'bad_request' }, 400, cors);
  const studio = await isStudioSide(jwt, site, principal);
  const d = rows(await svc(`presence_deliverables?id=eq.${did}&project_id=eq.${projectId}&site_id=eq.${site.id}&deleted_at=is.null&select=id,media_id,title,client_visible,status&limit=1`))[0];
  if (!d || (!studio && !(d.client_visible && d.status === 'shared'))) return json({ error: 'not_found', message: 'That file isn’t here.' }, 404, cors);
  if (!studio) { // B6: a non-studio caller must also be able to see the PARENT project
    const proj = await loadProject(site.id, projectId);
    if (!proj || !proj.client_visible) return json({ error: 'not_found', message: 'That file isn’t here.' }, 404, cors);
  }
  const media = rows(await svc(`presence_media?id=eq.${d.media_id}&site_id=eq.${site.id}&deleted_at=is.null&select=storage_path,mime,alt_text&limit=1`))[0];
  if (!media?.storage_path) return json({ error: 'not_found', message: 'That file is no longer available.' }, 404, cors);
  const ext = (media.mime === 'application/pdf') ? '.pdf' : '';
  const url = await signDownload(media.storage_path, (clean(d.title, 80) || 'download') + ext);
  if (!url) return json({ error: 'unavailable', message: 'We couldn’t prepare that download — please try again.' }, 502, cors);
  return json({ data: { url, title: d.title } }, 200, cors);
}

// ═══ APPROVALS (one generic decision bound to the exact item + version) ═══
async function subjectVersion(siteId: string, subjectType: string, subjectId: string | null, title: string, summary: string): Promise<{ ok: true; hash: string } | { ok: false }> {
  if (subjectType === 'custom') return { ok: true, hash: await approvalHash('custom', 'text', `${title}\n${summary}`) };
  if (!subjectId || !UUID_RE.test(subjectId)) return { ok: false };
  if (subjectType === 'deliverable') {
    const d = rows(await svc(`presence_deliverables?id=eq.${subjectId}&site_id=eq.${siteId}&deleted_at=is.null&select=media_id,updated_at&limit=1`))[0];
    if (!d) return { ok: false };
    const media = rows(await svc(`presence_media?id=eq.${d.media_id}&site_id=eq.${siteId}&select=storage_path&limit=1`))[0];
    return { ok: true, hash: await approvalHash('deliverable', subjectId, `${d.media_id}:${media?.storage_path || ''}`) };
  }
  const table = subjectType === 'task' ? 'presence_tasks' : 'presence_projects';
  const row = rows(await svc(`${table}?id=eq.${subjectId}&site_id=eq.${siteId}&deleted_at=is.null&select=updated_at&limit=1`))[0];
  if (!row) return { ok: false };
  return { ok: true, hash: await approvalHash(subjectType, subjectId, String(row.updated_at || '')) };
}

export async function handleApprovalsCreate(req: Request, jwt: string, site: SiteRow, principal: Principal, projectId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(projectId)) return json({ error: 'bad_request' }, 400, cors);
  if (!(await isStudioSide(jwt, site, principal))) return studioDenied(cors);
  const project = await loadProject(site.id, projectId);
  if (!project) return json({ error: 'not_found' }, 404, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  if (!isSubjectType(b.subject_type)) return json({ error: 'validation', message: 'Say what’s being approved (deliverable, task, project, or custom).' }, 422, cors);
  const title = clean(b.title, 200);
  if (!title) return json({ error: 'validation', message: 'An approval request needs a title.' }, 422, cors);
  const subjectId = UUID_RE.test(b.subject_id || '') ? b.subject_id : null;
  const ver = await subjectVersion(site.id, b.subject_type, subjectId, title, clean(b.summary, 2000));
  if (!ver.ok) return json({ error: 'bad_subject', message: 'That item isn’t in this workspace.' }, 422, cors);
  // supersede any prior PENDING approval for the same subject → only the latest is decidable
  if (subjectId) await svc(`presence_approvals?site_id=eq.${site.id}&subject_type=eq.${b.subject_type}&subject_id=eq.${subjectId}&status=eq.pending`, { method: 'PATCH', body: JSON.stringify({ status: 'superseded' }) }).catch(() => {});
  const { by, kind } = actor(principal);
  const ins = await svc('presence_approvals', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, project_id: projectId, subject_type: b.subject_type, subject_id: subjectId,
      title, summary: clean(b.summary, 2000), content_hash: ver.hash, status: 'pending',
      requested_by: by, requested_by_kind: kind, client_visible: b.client_visible === false ? false : true }) });
  if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed', message: 'That request didn’t save — please try again.' }, 502, cors);
  const a = rows(ins)[0];
  await projectEvent(site.id, projectId, 'approval_requested', principal, a.client_visible, { approval_id: a.id, title });
  // An approval that waits on the CLIENT must reach their email — otherwise it
  // can sit unseen until they happen to open the portal. Best-effort.
  if (a.client_visible) {
    emailBridgedCustomer(site.id, projectId, `Needs your OK — ${title}`,
      `<p>Your studio has something ready for your review: <strong>${title.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))}</strong>.</p><p>Nothing goes ahead without you — take a look when you have a minute.</p>`).catch(() => {});
  }
  return json({ data: a }, 201, cors);
}

/** Decide an approval. The client reviews; the studio may also decide. Guarded by
 *  status=pending AND content_hash — a superseded/edited version cannot be decided. */
export async function handleApprovalDecide(req: Request, jwt: string, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  if (!isDecision(b.decision)) return json({ error: 'bad_decision', message: 'Choose approve, reject, or request changes.' }, 422, cors);
  const a = rows(await svc(`presence_approvals?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=*&limit=1`))[0];
  // B4: an internal (client_visible=false) approval is never a dead-end — a studio role may decide it.
  if (!a || (!a.client_visible && !(await isStudioSide(jwt, site, principal)))) return json({ error: 'not_found', message: 'That request isn’t here.' }, 404, cors);
  if (a.status === b.decision) return json({ data: { status: a.status }, already: true }, 200, cors); // idempotent
  if (!canDecideApproval(a.status)) return json({ error: 'already_decided', message: 'This request has already been decided or replaced.' }, 409, cors);
  const presented = clean(b.presented_hash, 64);
  if (presented && presented !== a.content_hash) return json({ error: 'version_mismatch', message: 'This item was updated — please reload the latest version before deciding.' }, 409, cors);
  const { by, kind } = actor(principal);
  const up = await svc(`presence_approvals?id=eq.${id}&site_id=eq.${site.id}&status=eq.pending&content_hash=eq.${a.content_hash}&select=project_id,status`, { method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: b.decision, decided_by: by, decided_by_kind: kind, decided_at: nowIso(), decision_note: clean(b.note, 1000) }) });
  if (!up.ok || !rows(up)[0]) return json({ error: 'conflict', message: 'This request just changed — reload and try again.' }, 409, cors); // hash+status guard in WHERE
  await projectEvent(site.id, a.project_id, 'approval_decided', principal, true, { approval_id: id, decision: b.decision });
  return json({ data: { status: b.decision } }, 200, cors);
}
