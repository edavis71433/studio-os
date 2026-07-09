// ── Phase T · Launches (FD-T7) — routes ──────────────────────────────────────
// The named-release workflow: create/recapture (draft) → decide (review/approve)
// → schedule OR promote (atomic) → rollback. Every mutating step reuses an
// EXISTING system: serializeDraft (capture), runPipeline (publish/restore),
// presence_scheduled_publishes + the cron (schedule), the site-role `approve`
// capability + writeChangeEvent (approval + audit). No new pipeline/scheduler.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { getTemplate } from '../lib/render.ts';
import { serializeDraft } from '../lib/serializer.ts';
import { validateSnapshot } from '../lib/manifest_validate.ts';
import { runPipeline } from './publish.ts';
import { resolveSiteRole } from '../lib/workspace.ts';
import { siteCan } from '../lib/site_roles.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { PUBLISH_BLOCKED_STATES } from '../lib/lifecycle.ts';
import { cleanLaunchName, isValidSchedule, canApprove, canSchedule, canPromote, canRollback, canCancel, canRecapture, statusAfterRecapture, launchStatusLabel, type LaunchStatus } from '../lib/launches.ts';
import type { Snapshot } from '../lib/render_types.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const actorKind = (p: Principal) => (p.kind === 'staff' ? 'staff' : 'client');

/** Capture the current draft into a persisted (staged, unpublished) snapshot. */
async function captureDraft(site: SiteRow, principal: Principal): Promise<{ snapshotId: string; blockers: any[]; warnings: any[] } | { error: string; message: string; status: number }> {
  const t = getTemplate(site.template_slug, site.template_version);
  if (!t) return { error: 'template_missing', message: 'This site’s template isn’t available.', status: 500 };
  const now = new Date().toISOString();
  const { snapshot, mediaManifest } = await serializeDraft(site.id, t.manifest, { templateSlug: site.template_slug, templateVersion: site.template_version, now });
  const v = validateSnapshot(snapshot, t.manifest);
  const ins = await svc('presence_snapshots', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, content: snapshot.content, media_manifest: mediaManifest, content_contract_version: snapshot.content_contract_version, template_slug: snapshot.template_slug, template_version: snapshot.template_version, dev_customization: snapshot.dev_customization ?? null, created_by: principal.userId, created_by_kind: actorKind(principal) }),
  });
  if (!ins.ok || !ins.json?.[0]?.id) return { error: 'snapshot_failed', message: 'We couldn’t stage this launch just now.', status: 502 };
  return { snapshotId: ins.json[0].id as string, blockers: v.blockers, warnings: v.warnings };
}

async function loadStaged(snapshotId: string): Promise<{ snapshot: Snapshot; mediaManifest: any[] } | null> {
  const s = await svc(`presence_snapshots?id=eq.${snapshotId}&select=content,media_manifest,content_contract_version,template_slug,template_version,created_at,dev_customization`);
  const row = s.json?.[0]; if (!row) return null;
  return { snapshot: { content: row.content, content_contract_version: row.content_contract_version, template_slug: row.template_slug, template_version: row.template_version, created_at: row.created_at, dev_customization: row.dev_customization ?? null }, mediaManifest: row.media_manifest || [] };
}

async function getLaunch(site: SiteRow, id: string): Promise<any | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const r = await svc(`presence_launches?id=eq.${id}&site_id=eq.${site.id}&limit=1`);
  return (r.ok && r.json?.[0]) || null;
}
const shape = (l: any) => ({ id: l.id, name: l.name, status: l.status, status_label: launchStatusLabel(l.status as LaunchStatus), scheduled_for: l.scheduled_for ?? null, created_at: l.created_at, updated_at: l.updated_at, approved_at: l.approved_at ?? null });

async function patchLaunch(id: string, patch: Record<string, unknown>) {
  return svc(`presence_launches?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) });
}

// ── list (with lazy reconcile of scheduled → published) ──────────────────────
export async function handleLaunchList(site: SiteRow, cors: Record<string, string>) {
  const r = await svc(`presence_launches?site_id=eq.${site.id}&select=id,name,status,scheduled_for,scheduled_publish_id,created_at,updated_at,approved_at&order=created_at.desc&limit=50`);
  const rows: any[] = Array.isArray(r.json) ? r.json : [];
  // reconcile: a 'scheduled' launch whose scheduled_publishes row is done → published
  for (const l of rows) {
    if (l.status === 'scheduled' && l.scheduled_publish_id) {
      const sp = await svc(`presence_scheduled_publishes?id=eq.${l.scheduled_publish_id}&select=status&limit=1`);
      const st = sp.json?.[0]?.status;
      if (st === 'done') { await patchLaunch(l.id, { status: 'published' }); l.status = 'published'; }
      else if (st === 'failed') { await patchLaunch(l.id, { status: 'approved' }); l.status = 'approved'; }
    }
  }
  return json({ data: rows.map(shape) }, 200, cors);
}

export async function handleLaunchGet(site: SiteRow, id: string, cors: Record<string, string>) {
  const l = await getLaunch(site, id);
  if (!l) return json({ error: 'not_found', message: 'That launch isn’t here.' }, 404, cors);
  return json({ data: shape(l) }, 200, cors);
}

// ── create: stage the current draft as a named launch ───────────────────────
export async function handleLaunchCreate(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  if (PUBLISH_BLOCKED_STATES.includes(site.status)) return json({ error: 'lifecycle_blocked', message: 'This site can’t stage a launch right now.' }, 409, cors);
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const name = cleanLaunchName(body?.name);
  const cap = await captureDraft(site, principal);
  if ('error' in cap) return json({ error: cap.error, message: cap.message }, cap.status, cors);
  const ins = await svc('presence_launches', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, name, status: 'draft', snapshot_id: cap.snapshotId, created_by: principal.userId }),
  });
  if (!ins.ok || !ins.json?.[0]?.id) return json({ error: 'create_failed', message: 'We couldn’t create this launch.' }, 502, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'launch', entityId: ins.json[0].id, action: 'create', summary: `Staged a launch “${name}”`, principal, provenance: 'human' });
  return json({ data: { ...shape(ins.json[0]), blockers: cap.blockers, warnings: cap.warnings } }, 201, cors);
}

// ── recapture: refresh the staged snapshot from the current draft ────────────
export async function handleLaunchRecapture(site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  const l = await getLaunch(site, id);
  if (!l) return json({ error: 'not_found', message: 'That launch isn’t here.' }, 404, cors);
  if (!canRecapture(l.status)) return json({ error: 'bad_state', message: 'This launch can’t be updated from the current draft.' }, 409, cors);
  const cap = await captureDraft(site, principal);
  if ('error' in cap) return json({ error: cap.error, message: cap.message }, cap.status, cors);
  await patchLaunch(l.id, { snapshot_id: cap.snapshotId, status: statusAfterRecapture(l.status), approved_by: null, approved_at: null });
  await writeChangeEvent({ siteId: site.id, entityType: 'launch', entityId: l.id, action: 'update', summary: `Refreshed launch “${l.name}” from the current draft`, principal, provenance: 'human' });
  const g = await getLaunch(site, id);
  return json({ data: { ...shape(g), blockers: cap.blockers, warnings: cap.warnings } }, 200, cors);
}

// ── decide: review / approve (the site-role `approve` capability) ────────────
export async function handleLaunchDecide(req: Request, jwt: string, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  const l = await getLaunch(site, id);
  if (!l) return json({ error: 'not_found', message: 'That launch isn’t here.' }, 404, cors);
  const role = await resolveSiteRole(jwt, site.id, principal.kind);
  if (principal.kind !== 'staff' && !siteCan(role, 'approve')) return json({ error: 'forbidden', message: 'Only someone with approval rights can sign off a launch.' }, 403, cors);
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const decision = String(body?.decision || '').toLowerCase();
  if (decision === 'approve') {
    if (!canApprove(l.status)) return json({ error: 'bad_state', message: 'This launch isn’t awaiting approval.' }, 409, cors);
    await patchLaunch(l.id, { status: 'approved', approved_by: principal.userId || 'owner', approved_at: new Date().toISOString() });
    await writeChangeEvent({ siteId: site.id, entityType: 'launch', entityId: l.id, action: 'approve', summary: `Approved launch “${l.name}”`, principal, provenance: 'human' });
  } else if (decision === 'reject') {
    await patchLaunch(l.id, { status: 'draft', approved_by: null, approved_at: null });
    await writeChangeEvent({ siteId: site.id, entityType: 'launch', entityId: l.id, action: 'reject', summary: `Asked for changes on launch “${l.name}”`, principal, provenance: 'human' });
  } else {
    return json({ error: 'bad_request', message: 'Decision must be approve or reject.' }, 400, cors);
  }
  return json({ data: shape(await getLaunch(site, id)) }, 200, cors);
}

// ── schedule: reuse presence_scheduled_publishes + the existing cron ─────────
export async function handleLaunchSchedule(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  const l = await getLaunch(site, id);
  if (!l) return json({ error: 'not_found', message: 'That launch isn’t here.' }, 404, cors);
  if (!canSchedule(l.status)) return json({ error: 'bad_state', message: 'A launch must be approved before it can be scheduled.' }, 409, cors);
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const when = String(body?.scheduled_for || '');
  if (!isValidSchedule(when, new Date().toISOString())) return json({ error: 'bad_time', message: 'Choose a time in the future for the launch.' }, 422, cors);
  const sp = await svc('presence_scheduled_publishes', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, snapshot_id: l.snapshot_id, kind: 'publish', summary: `Launched “${l.name}”`, scheduled_for: when, status: 'pending' }),
  });
  if (!sp.ok || !sp.json?.[0]?.id) return json({ error: 'schedule_failed', message: 'We couldn’t schedule this launch.' }, 502, cors);
  await patchLaunch(l.id, { status: 'scheduled', scheduled_for: when, scheduled_publish_id: sp.json[0].id });
  await writeChangeEvent({ siteId: site.id, entityType: 'launch', entityId: l.id, action: 'schedule', summary: `Scheduled launch “${l.name}”`, principal, provenance: 'human' });
  return json({ data: shape(await getLaunch(site, id)) }, 200, cors);
}

// ── promote: atomic publish of the staged snapshot (runPipeline) ────────────
export async function handleLaunchPromote(site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  const l = await getLaunch(site, id);
  if (!l) return json({ error: 'not_found', message: 'That launch isn’t here.' }, 404, cors);
  if (!canPromote(l.status)) return json({ error: 'bad_state', message: 'A launch must be approved before it goes live.' }, 409, cors);
  if (!l.snapshot_id) return json({ error: 'no_snapshot', message: 'This launch has nothing staged.' }, 409, cors);
  const loaded = await loadStaged(l.snapshot_id);
  if (!loaded) return json({ error: 'not_restorable', message: 'The staged version is no longer available.' }, 410, cors);
  // remember the current live snapshot for one-tap rollback
  const live = await svc(`presence_publishes?site_id=eq.${site.id}&status=eq.live&select=snapshot_id&order=created_at.desc&limit=1`);
  const prevSnap = live.json?.[0]?.snapshot_id ?? null;
  const res = await runPipeline(site, principal, 'publish', { snapshot: loaded.snapshot, snapshotId: l.snapshot_id, mediaManifest: loaded.mediaManifest }, `Launched “${l.name}”`, cors);
  if (res.status === 200) {
    const latest = await svc(`presence_publishes?site_id=eq.${site.id}&select=id&order=created_at.desc&limit=1`);
    await patchLaunch(l.id, { status: 'published', prev_snapshot_id: prevSnap, published_publish_id: latest.json?.[0]?.id ?? null });
    await writeChangeEvent({ siteId: site.id, entityType: 'launch', entityId: l.id, action: 'publish', summary: `Launched “${l.name}”`, principal, provenance: 'human' });
  }
  return res;
}

// ── rollback: restore the pre-promote live snapshot (runPipeline restore) ────
export async function handleLaunchRollback(site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  const l = await getLaunch(site, id);
  if (!l) return json({ error: 'not_found', message: 'That launch isn’t here.' }, 404, cors);
  if (!canRollback(l.status)) return json({ error: 'bad_state', message: 'Only a launched release can be rolled back.' }, 409, cors);
  if (!l.prev_snapshot_id) return json({ error: 'no_previous', message: 'There’s no earlier version to roll back to.' }, 409, cors);
  const loaded = await loadStaged(l.prev_snapshot_id);
  if (!loaded) return json({ error: 'not_restorable', message: 'The earlier version is no longer available.' }, 410, cors);
  const res = await runPipeline(site, principal, 'restore', { snapshot: loaded.snapshot, snapshotId: l.prev_snapshot_id, mediaManifest: loaded.mediaManifest }, `Rolled back launch “${l.name}”`, cors);
  if (res.status === 200) {
    await patchLaunch(l.id, { status: 'rolled_back' });
    await writeChangeEvent({ siteId: site.id, entityType: 'launch', entityId: l.id, action: 'restore', summary: `Rolled back launch “${l.name}”`, principal, provenance: 'human' });
  }
  return res;
}

// ── cancel: drop a draft/approved/scheduled launch (also cancels its schedule) ─
export async function handleLaunchCancel(site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  const l = await getLaunch(site, id);
  if (!l) return json({ error: 'not_found', message: 'That launch isn’t here.' }, 404, cors);
  if (!canCancel(l.status)) return json({ error: 'bad_state', message: 'This launch can’t be canceled now.' }, 409, cors);
  if (l.scheduled_publish_id) await svc(`presence_scheduled_publishes?id=eq.${l.scheduled_publish_id}&status=eq.pending`, { method: 'PATCH', body: JSON.stringify({ status: 'canceled' }) });
  await patchLaunch(l.id, { status: 'canceled' });
  await writeChangeEvent({ siteId: site.id, entityType: 'launch', entityId: l.id, action: 'update', summary: `Canceled launch “${l.name}”`, principal, provenance: 'human' });
  return json({ data: shape(await getLaunch(site, id)) }, 200, cors);
}
