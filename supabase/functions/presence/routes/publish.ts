// ── POST /publish · POST /restore · GET /publishes ───────────────────────────
// The permanent publishing pipeline (⟐1 status-driven):
//   entitlement (boundary, done) → in-flight check → validate → snapshot →
//   publish record → render → variants → Deploy API → brief poll → record/site
// Restore (business recovery) is the SAME pipeline fed a retained historical
// snapshot with kind=restore. History never lies; clients get plain language.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { getTemplate } from '../lib/render.ts';
import { serializeDraft } from '../lib/serializer.ts';
import { validateSnapshot } from '../lib/manifest_validate.ts';
import { fetchVariants } from '../lib/media.ts';
import { deployFileMap, deployState, netlifyConfigured } from '../lib/netlify.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import type { Snapshot } from '../lib/render_types.ts';
import { PUBLISH_BLOCKED_STATES } from '../lib/lifecycle.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

export const CALM = 'We hit a snag updating your site and we’re on it — nothing changed on your live site.';

export async function changeSummary(siteId: string): Promise<string> {
  const lastLive = await svc(`presence_publishes?site_id=eq.${siteId}&status=eq.live&select=created_at&order=created_at.desc&limit=1`);
  const since = lastLive.json?.[0]?.created_at;
  const ev = await svc(`presence_change_events?site_id=eq.${siteId}${since ? `&created_at=gt.${encodeURIComponent(since)}` : ''}&select=entity_type,action&limit=200`);
  const rows: Array<{ entity_type: string; action: string }> = Array.isArray(ev.json) ? ev.json : [];
  if (!rows.length) return 'Publishing your site';
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.entity_type] = (counts[r.entity_type] || 0) + 1;
  const label: Record<string, string> = { identity: 'business details', location: 'hours & location', offering: 'menu items', testimonial: 'testimonials', faq: 'FAQs', post: 'updates', media: 'photos', redirect: 'links', voice: 'voice profile', settings: 'settings' };
  const parts = Object.entries(counts).map(([k, n]) => `${n} ${label[k] || k} change${n > 1 ? 's' : ''}`);
  const deletions = rows.filter((r) => r.action === 'delete').length;
  return parts.join(', ') + (deletions ? ` (including ${deletions} deletion${deletions > 1 ? 's' : ''})` : '');
}

/** Core pipeline shared by publish and restore — ONE path, ever.
 *  Exported for the admin operations (force publish / retry / restore-snapshot),
 *  which are the SAME pipeline with a staff actor — never a second path. */
export async function runPipeline(site: SiteRow, principal: Principal, kind: 'publish' | 'restore', snapshotArg: { snapshot: Snapshot; snapshotId?: string; mediaManifest: any[] }, summary: string, cors: Record<string, string>) {
  const actorKind = principal.kind === 'staff' ? 'staff' : 'client';
  let snapshotId = snapshotArg.snapshotId;

  // persist snapshot (publish only; restore reuses the retained one)
  if (!snapshotId) {
    const ins = await svc('presence_snapshots', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        site_id: site.id, content: snapshotArg.snapshot.content, media_manifest: snapshotArg.mediaManifest,
        content_contract_version: snapshotArg.snapshot.content_contract_version,
        template_slug: snapshotArg.snapshot.template_slug, template_version: snapshotArg.snapshot.template_version,
        created_by: principal.userId, created_by_kind: actorKind,
      }),
    });
    if (!ins.ok || !ins.json?.[0]?.id) return json({ error: 'snapshot_failed', message: CALM }, 502, cors);
    snapshotId = ins.json[0].id as string;
  }

  // publish record — the partial unique index IS the race-safe one-in-flight gate
  const rec = await svc('presence_publishes', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, snapshot_id: snapshotId, kind, actor: principal.userId, actor_kind: actorKind, change_summary: summary }),
  });
  if (rec.status === 409) return json({ error: 'publish_in_progress', message: 'A publish is already in progress — give it a moment to finish.' }, 409, cors);
  if (!rec.ok || !rec.json?.[0]?.id) return json({ error: 'record_failed', message: CALM }, 502, cors);
  const pubId = rec.json[0].id as string;
  const fail = async (stage: string, detail: string) => {
    await svc(`presence_publishes?id=eq.${pubId}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed', error_text: `${stage}: ${detail}`.slice(0, 1000), completed_at: new Date().toISOString() }) });
    return json({ error: 'publish_failed', message: CALM }, 502, cors);
  };

  if (!site.netlify_site_id) return await fail('config', 'site has no netlify_site_id (admin has not connected hosting)');
  if (!netlifyConfigured()) return await fail('config', 'NETLIFY_AUTH_TOKEN not configured');

  // render (pure) + variants (EXIF-stripped webp bytes) → one file map
  const t = getTemplate(snapshotArg.snapshot.template_slug, snapshotArg.snapshot.template_version);
  if (!t) return await fail('render', `unknown template ${snapshotArg.snapshot.template_slug}@${snapshotArg.snapshot.template_version}`);
  const siteCfg = { baseUrl: site.custom_domain ? `https://${site.custom_domain}` : `https://${site.netlify_site_id}.netlify.app` };
  let fileMap: Record<string, string | Uint8Array>;
  try { fileMap = t.render(snapshotArg.snapshot, t.manifest, siteCfg); } catch (e) { return await fail('render', String(e).slice(0, 300)); }
  const { files: images, failed } = await fetchVariants(snapshotArg.mediaManifest);
  if (failed.length) return await fail('images', `variant generation failed for: ${failed.join('; ')}`);
  Object.assign(fileMap, images);

  await svc(`presence_publishes?id=eq.${pubId}`, { method: 'PATCH', body: JSON.stringify({ status: 'deploying' }) });
  const dep = await deployFileMap(site.netlify_site_id, fileMap, { title: `${kind} ${pubId}` });
  if (!dep.ok) return await fail('deploy', dep.error || 'unknown');

  const live = dep.state === 'ready';
  await svc(`presence_publishes?id=eq.${pubId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: live ? 'live' : 'deploying', netlify_deploy_id: dep.deployId, ...(live ? { completed_at: new Date().toISOString() } : {}) }),
  });
  if (live) await svc(`presence_sites?id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'live', last_published_at: new Date().toISOString() }) });

  await writeChangeEvent({ siteId: site.id, entityType: kind, entityId: null, action: kind, summary, principal, provenance: 'human' });

  return json({
    data: {
      status: live ? 'live' : 'publishing',
      message: live ? 'Your site is live. Every change you made is now published.' : 'Your site is being updated — this usually takes under a minute.',
      summary,
    },
  }, 200, cors);
}

export async function handlePublish(site: SiteRow, principal: Principal, cors: Record<string, string>) {
  // lifecycle guard (M6 §4): archived/deleting sites never publish; a site the
  // studio paused publishes only via an operator (staff), not the client
  if (PUBLISH_BLOCKED_STATES.includes(site.status)) {
    return json({ error: 'lifecycle_blocked', message: 'This site is archived and can’t be published. Contact your studio to reactivate it.' }, 409, cors);
  }
  if (site.status === 'paused' && principal.kind !== 'staff') {
    return json({ error: 'site_paused', message: 'Your site is currently paused. Contact your studio to resume publishing.' }, 409, cors);
  }
  const t = getTemplate(site.template_slug, site.template_version);
  if (!t) return json({ error: 'template_missing', message: CALM }, 500, cors);

  const now = new Date().toISOString();
  const { snapshot, mediaManifest } = await serializeDraft(site.id, t.manifest, { templateSlug: site.template_slug, templateVersion: site.template_version, now });

  const v = validateSnapshot(snapshot, t.manifest);
  if (!v.ok) return json({ error: 'validation_failed', message: 'A few things need fixing before your site can publish.', fields: v.blockers, warnings: v.warnings }, 422, cors);

  const summary = await changeSummary(site.id);
  return runPipeline(site, principal, 'publish', { snapshot, mediaManifest }, summary, cors);
}

export async function handleRestore(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let body: any = null; try { body = await req.json(); } catch { /* */ }
  const publishId = body?.publish_id;
  if (!publishId) return json({ error: 'bad_request', message: 'Which version should we restore?' }, 400, cors);

  const rec = await svc(`presence_publishes?id=eq.${encodeURIComponent(publishId)}&site_id=eq.${site.id}&select=snapshot_id,change_summary,created_at`);
  const row = rec.json?.[0];
  if (!row) return json({ error: 'not_found', message: 'We couldn’t find that version.' }, 404, cors);
  if (!row.snapshot_id) return json({ error: 'not_restorable', message: 'That version is no longer restorable (older versions are kept for a limited time).' }, 410, cors);

  const snap = await svc(`presence_snapshots?id=eq.${row.snapshot_id}&select=content,media_manifest,content_contract_version,template_slug,template_version,created_at`);
  const s = snap.json?.[0];
  if (!s) return json({ error: 'not_restorable', message: 'That version is no longer restorable.' }, 410, cors);

  const snapshot: Snapshot = { content: s.content, content_contract_version: s.content_contract_version, template_slug: s.template_slug, template_version: s.template_version, created_at: s.created_at };
  const summary = `Restored the version from ${new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  return runPipeline(site, principal, 'restore', { snapshot, snapshotId: row.snapshot_id, mediaManifest: s.media_manifest || [] }, summary, cors);
}

/** GET /publishes — plain-language history; lazily reconciles pending deploys. */
export async function handlePublishHistory(site: SiteRow, cors: Record<string, string>) {
  // reconcile anything left 'deploying' (⟐1 status-driven)
  const pend = await svc(`presence_publishes?site_id=eq.${site.id}&status=in.(queued,deploying)&select=id,netlify_deploy_id,created_at`);
  for (const p of Array.isArray(pend.json) ? pend.json : []) {
    if (!p.netlify_deploy_id) continue;
    const st = await deployState(p.netlify_deploy_id);
    if (st === 'ready') {
      await svc(`presence_publishes?id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'live', completed_at: new Date().toISOString() }) });
      await svc(`presence_sites?id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'live', last_published_at: new Date().toISOString() }) });
    } else if (st === 'error') {
      await svc(`presence_publishes?id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed', error_text: 'deploy: netlify reported error (reconciled)', completed_at: new Date().toISOString() }) });
    }
  }

  const r = await svc(`presence_publishes?site_id=eq.${site.id}&select=id,kind,status,change_summary,created_at,completed_at,snapshot_id&order=created_at.desc&limit=30`);
  const rows = Array.isArray(r.json) ? r.json : [];
  return json({
    data: rows.map((p: any) => ({
      id: p.id, kind: p.kind,
      status: p.status === 'live' ? 'live' : p.status === 'failed' ? 'failed' : 'publishing',
      summary: p.change_summary || (p.kind === 'restore' ? 'Restored an earlier version' : 'Published your site'),
      at: p.created_at, completed_at: p.completed_at,
      restorable: !!p.snapshot_id && p.status === 'live',
    })),
  }, 200, cors);
}
