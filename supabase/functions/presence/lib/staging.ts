// ── Phase T · Staging helpers (shared) ───────────────────────────────────────
// Capture the current draft into a persisted (staged, unpublished) SNAPSHOT, and
// load one back for rendering/publishing. These are the ONE capture/load path
// used by both Launches (FD-T7) and the Preview Environment (FD-T20) — no
// duplication. They reuse serializeDraft (the one serializer) + the snapshot store.
import { svc } from './db.ts';
import { getTemplate } from './render.ts';
import { serializeDraft } from './serializer.ts';
import { validateSnapshot } from './manifest_validate.ts';
import type { Snapshot } from './render_types.ts';
import type { SiteRow } from './site.ts';
import type { Principal } from '../../_shared/auth.ts';

const actorKind = (p: Principal) => (p.kind === 'staff' ? 'staff' : 'client');

export type CaptureResult = { snapshotId: string; blockers: any[]; warnings: any[] } | { error: string; message: string; status: number };

/** Serialize the draft, validate, and persist it as a staged snapshot. */
export async function captureDraftSnapshot(site: SiteRow, principal: Principal): Promise<CaptureResult> {
  const t = getTemplate(site.template_slug, site.template_version);
  if (!t) return { error: 'template_missing', message: 'This site’s template isn’t available.', status: 500 };
  const now = new Date().toISOString();
  const { snapshot, mediaManifest } = await serializeDraft(site.id, t.manifest, { templateSlug: site.template_slug, templateVersion: site.template_version, now });
  const v = validateSnapshot(snapshot, t.manifest);
  const ins = await svc('presence_snapshots', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, content: snapshot.content, media_manifest: mediaManifest, content_contract_version: snapshot.content_contract_version, template_slug: snapshot.template_slug, template_version: snapshot.template_version, dev_customization: snapshot.dev_customization ?? null, created_by: principal.userId, created_by_kind: actorKind(principal) }),
  });
  if (!ins.ok || !ins.json?.[0]?.id) return { error: 'snapshot_failed', message: 'We couldn’t stage that just now — please try again.', status: 502 };
  return { snapshotId: ins.json[0].id as string, blockers: v.blockers, warnings: v.warnings };
}

/** Load a staged snapshot (content + media manifest) for render/publish. */
export async function loadStagedSnapshot(snapshotId: string): Promise<{ snapshot: Snapshot; mediaManifest: any[] } | null> {
  const s = await svc(`presence_snapshots?id=eq.${snapshotId}&select=content,media_manifest,content_contract_version,template_slug,template_version,created_at,dev_customization`);
  const row = s.json?.[0]; if (!row) return null;
  return { snapshot: { content: row.content, content_contract_version: row.content_contract_version, template_slug: row.template_slug, template_version: row.template_version, created_at: row.created_at, dev_customization: row.dev_customization ?? null }, mediaManifest: row.media_manifest || [] };
}
