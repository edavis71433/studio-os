// ── POST /publish · POST /restore · GET /publishes ───────────────────────────
// The permanent publishing pipeline (⟐1 status-driven):
//   entitlement (boundary, done) → in-flight check → validate → snapshot →
//   publish record → render → variants → Deploy API → brief poll → record/site
// Restore (business recovery) is the SAME pipeline fed a retained historical
// snapshot with kind=restore. History never lies; clients get plain language.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { getTemplate, renderSnapshot } from '../lib/render.ts';
import { serializeDraft } from '../lib/serializer.ts';
import { validateSnapshot } from '../lib/manifest_validate.ts';
import { fetchVariants } from '../lib/media.ts';
import { deployFileMap, netlifyConfigured } from '../lib/netlify.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import type { Snapshot } from '../lib/render_types.ts';
import { PUBLISH_BLOCKED_STATES } from '../lib/lifecycle.ts';
import { parseIdempotencyKey, cooldownRemainingMs, replayData } from '../lib/publish_guard.ts';
import { deployCeiling, deployCeilingExceeded, reconcileSitePublishes } from '../lib/deploy_reconcile.ts';
import { computeDraftHash } from '../lib/draft_hash.ts';
import { raiseNotice, clearNotice } from '../lib/notice.ts';
import { readIfMatch, preconditionOutcome, staleConflictBody } from '../lib/optimistic_lock.ts';
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
export async function runPipeline(site: SiteRow, principal: Principal, kind: 'publish' | 'restore', snapshotArg: { snapshot: Snapshot; snapshotId?: string; mediaManifest: any[] }, summary: string, cors: Record<string, string>, idempotencyKey?: string) {
  const actorKind = principal.kind === 'staff' ? 'staff' : 'client';
  let snapshotId = snapshotArg.snapshotId;

  // ── M5: per-stage telemetry via structured logging (reuses the logging floor —
  //    no new monitoring system, no DB migration). `st` holds cumulative ms from
  //    t0 per stage; emitted once at the terminal outcome (success or fail). ──
  const t0 = performance.now();
  const st: Record<string, number> = {};
  const at = (k: string) => { st[k] = Math.round(performance.now() - t0); };

  // ── M5: global concurrent-deploy ceiling — an operational safeguard ON TOP OF
  //    (never replacing) the per-site one-in-flight index. Counts deploys currently
  //    uploading to Netlify across ALL sites; over the ceiling we shed load with a
  //    retryable 503 BEFORE any snapshot/record is created. Fail-OPEN: a count
  //    hiccup never blocks publishing. The count is a bare number → no tenant leak.
  const ceiling = deployCeiling();
  if (ceiling > 0) {
    const dq = await svc(`presence_publishes?status=eq.deploying&select=id&limit=${ceiling + 1}`);
    if (dq.ok && Array.isArray(dq.json) && deployCeilingExceeded(dq.json.length, ceiling)) {
      console.log(JSON.stringify({ evt: 'deploy_ceiling', site_id: site.id, kind, deploying: dq.json.length, ceiling }));
      return json({ error: 'deploy_busy', message: 'The publishing system is briefly at capacity — please try again in a moment.', retry_after: 10 }, 503, { ...cors, 'Retry-After': '10' });
    }
  }

  // persist snapshot (publish only; restore reuses the retained one)
  if (!snapshotId) {
    const ins = await svc('presence_snapshots', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        site_id: site.id, content: snapshotArg.snapshot.content, media_manifest: snapshotArg.mediaManifest,
        content_contract_version: snapshotArg.snapshot.content_contract_version,
        template_slug: snapshotArg.snapshot.template_slug, template_version: snapshotArg.snapshot.template_version,
        dev_customization: snapshotArg.snapshot.dev_customization ?? null,  // Phase B1: capture the dev layer with the snapshot
        created_by: principal.userId, created_by_kind: actorKind,
      }),
    });
    if (!ins.ok || !ins.json?.[0]?.id) return json({ error: 'snapshot_failed', message: CALM }, 502, cors);
    snapshotId = ins.json[0].id as string;
  }
  at('snapshot');

  // publish record — the partial unique index IS the race-safe one-in-flight gate.
  // M4: when an idempotency key is present it is stored here, and a second partial
  // unique index on (site_id, idempotency_key) makes a racing same-key insert 409.
  const rec = await svc('presence_publishes', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, snapshot_id: snapshotId, kind, actor: principal.userId, actor_kind: actorKind, change_summary: summary, ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}) }),
  });
  if (rec.status === 409) {
    // Distinguish the two per-site unique gates. With a key, a 409 is (almost
    // always) the idempotency index racing an identical retry → replay the
    // existing publish (never a second deploy). Otherwise it's the one-in-flight
    // gate. The lookup is site-scoped, so one tenant's key can't reach another's.
    if (idempotencyKey) {
      const ex = await svc(`presence_publishes?site_id=eq.${site.id}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&select=status,change_summary&limit=1`);
      const row = ex.json?.[0];
      if (row) return json({ data: replayData(row) }, 200, cors);
    }
    return json({ error: 'publish_in_progress', message: 'A publish is already in progress — give it a moment to finish.' }, 409, cors);
  }
  if (!rec.ok || !rec.json?.[0]?.id) return json({ error: 'record_failed', message: CALM }, 502, cors);
  const pubId = rec.json[0].id as string;
  at('record');
  // M5: one structured telemetry line per publish at its terminal outcome —
  // stage timings + total; never throws (telemetry must not break a publish).
  const logStages = (outcome: string) => {
    try { console.log(JSON.stringify({ evt: 'publish_stages', pub_id: pubId, site_id: site.id, kind, outcome, ms: st, total_ms: Math.round(performance.now() - t0) })); } catch { /* */ }
  };
  const fail = async (stage: string, detail: string) => {
    at(stage);
    logStages('failed:' + stage);
    await svc(`presence_publishes?id=eq.${pubId}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed', error_text: `${stage}: ${detail}`.slice(0, 1000), completed_at: new Date().toISOString() }) });
    // P2-F G3 — surface the failure as a website-attention notice on the ONE
    // notice model, so an async/scheduled publish the owner wasn't watching still
    // reaches the card + bell. Idempotent per publish id (no storm on retry).
    if (site.client_id) await raiseNotice({
      siteId: site.id, clientId: site.client_id, kind: 'publish_failed', period: `pub:${pubId}`,
      headline: 'A publish didn’t go through',
      body: 'Your latest changes couldn’t be published (nothing on your live site changed). Open your website and try publishing again — your work is safe in the draft.',
    });
    return json({ error: 'publish_failed', message: CALM }, 502, cors);
  };

  if (!site.netlify_site_id) return await fail('config', 'site has no netlify_site_id (admin has not connected hosting)');
  if (!netlifyConfigured()) return await fail('config', 'NETLIFY_AUTH_TOKEN not configured');

  // render (pure) + variants (EXIF-stripped webp bytes) → one file map.
  // Phase B1: renderSnapshot is the ONE render entry — it applies the snapshot's
  // Developer-Mode layer, so a developer edit publishes identically to any change.
  const t = getTemplate(snapshotArg.snapshot.template_slug, snapshotArg.snapshot.template_version);
  if (!t) return await fail('render', `unknown template ${snapshotArg.snapshot.template_slug}@${snapshotArg.snapshot.template_version}`);
  // Phase F FD-2: activate the site's contact form — the template renders a real
  // <form> posting to the public capture endpoint (was a mailto CTA when absent).
  const fnBase = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
  const siteCfg = {
    baseUrl: site.custom_domain ? `https://${site.custom_domain}` : `https://${site.netlify_site_id}.netlify.app`,
    siteId: site.id,   // AN-2: baked into the injected first-party analytics tracker
    ...(fnBase ? { formEndpoint: `${fnBase}/functions/v1/presence/forms/${site.id}/submit` } : {}),
  };
  let fileMap: Record<string, string | Uint8Array>;
  try { fileMap = renderSnapshot(snapshotArg.snapshot, siteCfg); } catch (e) { return await fail('render', String(e).slice(0, 300)); }
  at('render');
  const { files: images, failed } = await fetchVariants(snapshotArg.mediaManifest);
  if (failed.length) return await fail('images', `variant generation failed for: ${failed.join('; ')}`);
  Object.assign(fileMap, images);
  at('images');

  await svc(`presence_publishes?id=eq.${pubId}`, { method: 'PATCH', body: JSON.stringify({ status: 'deploying' }) });
  const dep = await deployFileMap(site.netlify_site_id, fileMap, { title: `${kind} ${pubId}` });
  if (!dep.ok) return await fail('deploy', dep.error || 'unknown');
  at('deploy');

  const live = dep.state === 'ready';
  await svc(`presence_publishes?id=eq.${pubId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: live ? 'live' : 'deploying', netlify_deploy_id: dep.deployId, ...(live ? { completed_at: new Date().toISOString() } : {}) }),
  });
  if (live) await svc(`presence_sites?id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'live', last_published_at: new Date().toISOString() }) });
  // G3 — a successful publish clears any lingering publish-failed attention notice.
  if (live && site.client_id) await clearNotice(site.client_id, 'publish_failed');

  await writeChangeEvent({ siteId: site.id, entityType: kind, entityId: null, action: kind, summary, principal, provenance: 'human' });
  logStages(live ? 'live' : 'deploying');   // M5: terminal telemetry (deploying = handed to reconcile)

  return json({
    data: {
      status: live ? 'live' : 'publishing',
      message: live ? 'Your site is live. Every change you made is now published.' : 'Your site is being updated — this usually takes under a minute.',
      summary,
    },
  }, 200, cors);
}

export async function handlePublish(req: Request | null, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  // lifecycle guard (M6 §4): archived/deleting sites never publish; a site the
  // studio paused publishes only via an operator (staff), not the client
  if (PUBLISH_BLOCKED_STATES.includes(site.status)) {
    return json({ error: 'lifecycle_blocked', message: 'This site is archived and can’t be published. Contact your studio to reactivate it.' }, 409, cors);
  }
  if (site.status === 'paused' && principal.kind !== 'staff') {
    return json({ error: 'site_paused', message: 'Your site is currently paused. Contact your studio to resume publishing.' }, 409, cors);
  }

  // ── M4: idempotency + cooldown apply to the CLIENT HTTP /publish path ONLY.
  //    Internal callers (admin force-publish, agency bulk) pass req=null and are
  //    NOT cooldown-gated — they are authoritative/operator actions (requirement
  //    #11: admin behavior unchanged). Concurrency is still guarded for them by
  //    the race-safe one-in-flight index in runPipeline. Precedence (below the
  //    lifecycle guards): replay(same key) → in-flight(409) → cooldown(429). ──
  let idemKey: string | null = null;
  if (req) {
    const parsed = parseIdempotencyKey(req.headers.get('Idempotency-Key'));
    if (!parsed.ok) return json({ error: 'bad_idempotency_key', message: 'That request couldn’t be processed — please try again.' }, 400, cors);
    idemKey = parsed.key;

    // (a) idempotent replay — same key on this site returns the existing result,
    //     creating NO new snapshot/deploy and bypassing the cooldown. Site-scoped.
    if (idemKey) {
      const ex = await svc(`presence_publishes?site_id=eq.${site.id}&idempotency_key=eq.${encodeURIComponent(idemKey)}&select=status,change_summary&limit=1`);
      const row = ex.json?.[0];
      if (row) return json({ data: replayData(row) }, 200, cors);
    }

    // (b) in-flight fast-path — if a publish is already queued/deploying, "in
    //     progress" (409) is more accurate than "cooldown" and takes precedence,
    //     so the one-in-flight semantics are unchanged. The race-safe partial
    //     unique index in runPipeline remains the ultimate concurrency gate.
    const inflight = await svc(`presence_publishes?site_id=eq.${site.id}&status=in.(queued,deploying)&select=id&limit=1`);
    if (Array.isArray(inflight.json) && inflight.json.length) {
      return json({ error: 'publish_in_progress', message: 'A publish is already in progress — give it a moment to finish.' }, 409, cors);
    }

    // (c) 60-second per-site cooldown — authoritative persisted timestamp
    //     (multi-instance safe). Applies to NEW publishes only (a same-key replay
    //     already returned above). Never weakens the one-in-flight protection.
    const remaining = cooldownRemainingMs(site.last_published_at, Date.now());
    if (remaining > 0) {
      const secs = Math.ceil(remaining / 1000);
      return json(
        { error: 'cooldown', message: `Just a moment — you can publish again in about ${secs} second${secs === 1 ? '' : 's'}.`, retry_after: secs },
        429,
        { ...cors, 'Retry-After': String(secs) },
      );
    }
  }

  const t = getTemplate(site.template_slug, site.template_version);
  if (!t) return json({ error: 'template_missing', message: CALM }, 500, cors);

  const now = new Date().toISOString();
  const { snapshot, mediaManifest } = await serializeDraft(site.id, t.manifest, { templateSlug: site.template_slug, templateVersion: site.template_version, now });

  // M9 optimistic lock: if the caller reviewed a specific draft (If-Match), make
  // sure THAT is what publishes — refuse if the draft moved on since the review.
  // Reuses the snapshot just serialized (no extra work); opt-in, internal callers
  // (req === null) skip it.
  if (req) {
    const ifMatch = readIfMatch(req);
    if (ifMatch !== null && ifMatch !== '' && ifMatch !== '*') {
      const current = await computeDraftHash(snapshot);
      if (preconditionOutcome(ifMatch, current) === 'stale') {
        return json({ ...staleConflictBody(current), message: 'Your draft changed since you reviewed it — refresh the change list, take another look, then publish.' }, 409, { ...cors, ETag: `"${current}"` });
      }
    }
  }

  const v = validateSnapshot(snapshot, t.manifest);
  if (!v.ok) return json({ error: 'validation_failed', message: 'A few things need fixing before your site can publish.', fields: v.blockers, warnings: v.warnings }, 422, cors);

  const summary = await changeSummary(site.id);
  return runPipeline(site, principal, 'publish', { snapshot, mediaManifest }, summary, cors, idemKey ?? undefined);
}

export async function handleRestore(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let body: any = null; try { body = await req.json(); } catch { /* */ }
  const publishId = body?.publish_id;
  if (!publishId) return json({ error: 'bad_request', message: 'Which version should we restore?' }, 400, cors);

  const rec = await svc(`presence_publishes?id=eq.${encodeURIComponent(publishId)}&site_id=eq.${site.id}&select=snapshot_id,change_summary,created_at`);
  const row = rec.json?.[0];
  if (!row) return json({ error: 'not_found', message: 'We couldn’t find that version.' }, 404, cors);
  if (!row.snapshot_id) return json({ error: 'not_restorable', message: 'That version is no longer restorable (older versions are kept for a limited time).' }, 410, cors);

  const snap = await svc(`presence_snapshots?id=eq.${row.snapshot_id}&site_id=eq.${site.id}&select=content,media_manifest,content_contract_version,template_slug,template_version,created_at,dev_customization`);
  const s = snap.json?.[0];
  if (!s) return json({ error: 'not_restorable', message: 'That version is no longer restorable.' }, 410, cors);

  const snapshot: Snapshot = { content: s.content, content_contract_version: s.content_contract_version, template_slug: s.template_slug, template_version: s.template_version, created_at: s.created_at, dev_customization: s.dev_customization ?? null };
  const summary = `Restored the version from ${new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  return runPipeline(site, principal, 'restore', { snapshot, snapshotId: row.snapshot_id, mediaManifest: s.media_manifest || [] }, summary, cors);
}

/** GET /publishes — plain-language history; lazily reconciles pending deploys. */
export async function handlePublishHistory(site: SiteRow, cors: Record<string, string>) {
  // M5: reconcile anything left in-flight — the SAME reconcileOnePublish the cron
  // uses (one implementation, never re-deploys). Was inlined here; now shared.
  await reconcileSitePublishes(site.id);

  const r = await svc(`presence_publishes?site_id=eq.${site.id}&select=id,kind,status,change_summary,version_label,created_at,completed_at,snapshot_id&order=created_at.desc&limit=30`);
  const rows = Array.isArray(r.json) ? r.json : [];
  return json({
    data: rows.map((p: any) => ({
      id: p.id, kind: p.kind,
      status: p.status === 'live' ? 'live' : p.status === 'failed' ? 'failed' : 'publishing',
      summary: p.change_summary || (p.kind === 'restore' ? 'Restored an earlier version' : 'Published your site'),
      label: p.version_label || '',
      at: p.created_at, completed_at: p.completed_at,
      restorable: !!p.snapshot_id && p.status === 'live',
    })),
  }, 200, cors);
}

// ── Phase AA (FD-7): name a kept version ─────────────────────────────────────
// POST /publishes/:id/label { label } — set or clear (empty) the human name on
// any of the site's kept versions. Site-scoped; provenance-logged; 60-char cap.
export async function handleVersionLabel(req: Request, site: SiteRow, principal: Principal, publishId: string, cors: Record<string, string>) {
  if (!/^[0-9a-f-]{36}$/.test(publishId)) return json({ error: 'bad_request', message: 'Invalid version reference.' }, 400, cors);
  let body: any = null; try { body = await req.json(); } catch { /* */ }
  let label = '';
  for (const ch of String(body?.label ?? '')) { const c = ch.codePointAt(0)!; if (c >= 32) label += ch; }
  label = label.trim().slice(0, 60);
  const r = await svc(`presence_publishes?id=eq.${publishId}&site_id=eq.${site.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ version_label: label }),
  });
  if (!r.ok || !Array.isArray(r.json) || !r.json.length) return json({ error: 'not_found', message: 'That version isn’t in your journal.' }, 404, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'publish', entityId: publishId, action: 'update', summary: label ? `Named a kept version “${label}”` : 'Removed a version’s name', principal, provenance: 'human', fields: ['version_label'] });
  return json({ data: { id: publishId, label } }, 200, cors);
}
