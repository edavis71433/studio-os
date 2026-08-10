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
import { mergeSecurityHeaders } from '../lib/security_headers.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import type { Snapshot } from '../lib/render_types.ts';
import { PUBLISH_BLOCKED_STATES } from '../lib/lifecycle.ts';
import { parseIdempotencyKey, cooldownRemainingMs, replayData } from '../lib/publish_guard.ts';
import { deployCeiling, deployCeilingExceeded, reconcileSitePublishes } from '../lib/deploy_reconcile.ts';
import { computeDraftHash } from '../lib/draft_hash.ts';
import { raiseNotice, clearNotice } from '../lib/notice.ts';
import { tickChecklistForCustomerSite, emailCustomerSiteLive } from '../lib/service_bridge.ts';
import { readIfMatch, preconditionOutcome, staleConflictBody } from '../lib/optimistic_lock.ts';
import { describeVersionDiff, resolveTimewarpTarget, normalizeTimewarpDate, cleanCheckpointName, type TimewarpVersion } from '../lib/preview_env.ts';
import { captureDraftSnapshot } from '../lib/staging.ts';
import { applySnapshotToDraft } from '../lib/draft_writer.ts';
import { renderOfflinePage, offlineFileMap } from '../lib/offline_page.ts';
import { loadEmailBrand } from '../lib/email_brand.ts';
import { snapshotContentUsable } from '../lib/render_types.ts';
import type { SnapshotContent } from '../lib/render_types.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const CALM = 'We hit a snag updating your site and we’re on it — nothing changed on your live site.';

export async function changeSummary(siteId: string): Promise<string> {
  const lastLive = await svc(`presence_publishes?site_id=eq.${siteId}&status=eq.live&select=created_at&order=created_at.desc&limit=1`);
  const since = lastLive.json?.[0]?.created_at;
  const ev = await svc(`presence_change_events?site_id=eq.${siteId}${since ? `&created_at=gt.${encodeURIComponent(since)}` : ''}&select=entity_type,action&limit=200`);
  const rows: Array<{ entity_type: string; action: string }> = Array.isArray(ev.json) ? ev.json : [];
  if (!rows.length) return 'Publishing your site';
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.entity_type] = (counts[r.entity_type] || 0) + 1;
  const label: Record<string, string> = { identity: 'business details', location: 'hours & location', offering: 'offerings', testimonial: 'testimonials', faq: 'FAQs', post: 'updates', media: 'photos', redirect: 'links', voice: 'voice profile', settings: 'settings' };
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
    // Phase BK: the native-booking API base — the booking block's first-party enhancer
    // reads it to call /types, /slots, and POST a booking (all same-origin to the fn).
    ...(fnBase ? { bookEndpoint: `${fnBase}/functions/v1/presence/book/${site.id}` } : {}),
  };
  let fileMap: Record<string, string | Uint8Array>;
  try { fileMap = renderSnapshot(snapshotArg.snapshot, siteCfg); } catch (e) { return await fail('render', String(e).slice(0, 300)); }
  at('render');
  const { files: images, failed } = await fetchVariants(snapshotArg.mediaManifest);
  if (failed.length) return await fail('images', `variant generation failed for: ${failed.join('; ')}`);
  Object.assign(fileMap, images);
  at('images');

  // ── Response-level security headers (parity with the marketing site) ────────
  // The tenant HTML already carries a <meta> CSP (defense-in-depth, kept). Ship a
  // Netlify `_headers` file too, so every published page ALSO returns HSTS,
  // clickjacking (X-Frame-Options DENY + CSP frame-ancestors 'none'), MIME-sniff,
  // referrer, permissions, and a real CSP header. Merged into (never clobbering)
  // the template's asset-cache `_headers`. One source of truth: lib/security_headers.ts.
  fileMap['_headers'] = mergeSecurityHeaders(typeof fileMap['_headers'] === 'string' ? fileMap['_headers'] as string : undefined);

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
  // G10: a live deploy of real content IS being online — any publish/restore that
  // goes live lifts the offline veil. Separate best-effort PATCH so a database
  // without 0111 applied never fails the main status write above.
  if (live) await svc(`presence_sites?id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ offline_at: null }) }).catch(() => {});
  // G3 — a successful publish clears any lingering publish-failed attention notice.
  if (live && site.client_id) await clearNotice(site.client_id, 'publish_failed');
  // "Site live" is step 9 of the studio's delivery checklist, and a live deploy
  // of the customer's site IS that step — so it ticks itself rather than waiting
  // for someone to remember. Resolved through the ACTIVE service link
  // (customer_site_id → the agency's project), so it can never cross tenants,
  // and idempotent: the PATCH matches only a not-yet-done row, so the tenth
  // re-publish writes nothing. A site with no delivery bridge — every ordinary
  // self-serve customer — resolves to no link and this is one cheap read.
  // The FRESH tick (true = the step just transitioned) is also the send-once
  // gate for the client's "your website is live" email — see
  // emailCustomerSiteLive's contract: a re-publish returns false and never
  // re-sends. Both best-effort: neither may fail a publish.
  if (live) await tickChecklistForCustomerSite(site.id, 'site_live', 'publish', 'system').catch(() => false)
    .then((fresh) => fresh ? emailCustomerSiteLive(site.id) : false).catch(() => false);

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
/** The site's kept-version history, with the customer-facing summary fallback +
 *  restorable flag. Shared by GET /publishes and the CMS-UX-8 Snapshot History
 *  so the version wording lives in exactly one place. */
export async function publishHistoryRows(site: SiteRow) {
  // M5: reconcile anything left in-flight — the SAME reconcileOnePublish the cron
  // uses (one implementation, never re-deploys). Was inlined here; now shared.
  await reconcileSitePublishes(site.id);

  const r = await svc(`presence_publishes?site_id=eq.${site.id}&select=id,kind,status,change_summary,version_label,created_at,completed_at,snapshot_id&order=created_at.desc&limit=30`);
  const rows = Array.isArray(r.json) ? r.json : [];
  return rows.map((p: any) => ({
    id: p.id, kind: p.kind,
    status: p.status === 'live' ? 'live' : p.status === 'failed' ? 'failed' : 'publishing',
    summary: p.change_summary || (p.kind === 'restore' ? 'Restored an earlier version' : 'Published your site'),
    label: p.version_label || '',
    at: p.created_at, completed_at: p.completed_at,
    restorable: !!p.snapshot_id && p.status === 'live',
    snapshot_id: p.snapshot_id || null,
  }));
}

export async function handlePublishHistory(site: SiteRow, cors: Record<string, string>) {
  const rows = await publishHistoryRows(site);
  // keep the existing /publishes shape exactly (no snapshot_id in the response)
  return json({ data: rows.map(({ snapshot_id: _s, ...pub }) => pub) }, 200, cors);
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

// ── Version tools (Compare · Timewarp · Checkpoint) ──────────────────────────
// All three are WIRING over engines that already exist:
//   • Compare  → the change-sentence engine (lib/diff.ts describeChanges), which
//     until now only ever saw draft-vs-live; here it is fed ANY two snapshots.
//   • Timewarp → the preview renderer (routes/preview.ts, publish_id door): we
//     resolve which retained version was live on a date, then hand its publish_id
//     to the SAME read-only preview the "Look" button uses.
//   • Checkpoint → captureDraftSnapshot (lib/staging.ts) + the presence_launches
//     named-snapshot substrate (status='checkpoint'); restore reuses the shared
//     draft-writer, preview reuses the existing /preview?launch_id= door. No new
//     store, no migration — GC already retains presence_launches.snapshot_id.

/** Resolve one side of a comparison to its snapshot CONTENT. Accepts a kept
 *  version's publish id, or the tokens 'live' / 'draft'. Site-scoped throughout. */
async function loadVersionContent(site: SiteRow, ref: string):
  Promise<{ content: SnapshotContent; label: string; at: string | null } | { error: string; message: string; status: number }> {
  if (ref === 'draft') {
    const t = getTemplate(site.template_slug, site.template_version);
    if (!t) return { error: 'template_missing', message: 'This site’s template isn’t available.', status: 500 };
    const { snapshot } = await serializeDraft(site.id, t.manifest, { templateSlug: site.template_slug, templateVersion: site.template_version, now: new Date().toISOString() });
    return { content: snapshot.content as SnapshotContent, label: 'Your working draft', at: null };
  }
  let snapId: string | null = null, at: string | null = null, label = '';
  if (ref === 'live') {
    const p = await svc(`presence_publishes?site_id=eq.${site.id}&status=eq.live&select=snapshot_id,created_at,completed_at,version_label&order=created_at.desc&limit=1`);
    const row = p.json?.[0];
    if (!row?.snapshot_id) return { error: 'not_found', message: 'Nothing is live yet — publish first, then you can compare.', status: 404 };
    snapId = row.snapshot_id; at = row.completed_at || row.created_at; label = row.version_label || '';
  } else if (UUID_RE.test(ref)) {
    const p = await svc(`presence_publishes?id=eq.${ref}&site_id=eq.${site.id}&select=snapshot_id,created_at,completed_at,version_label&limit=1`);
    const row = p.json?.[0];
    if (!row) return { error: 'not_found', message: 'We couldn’t find that version.', status: 404 };
    if (!row.snapshot_id) return { error: 'not_comparable', message: 'That version is no longer kept, so it can’t be compared.', status: 410 };
    snapId = row.snapshot_id; at = row.completed_at || row.created_at; label = row.version_label || '';
  } else {
    return { error: 'bad_request', message: 'Pick two versions to compare.', status: 400 };
  }
  const s = await svc(`presence_snapshots?id=eq.${snapId}&site_id=eq.${site.id}&select=content&limit=1`);
  const content = s.json?.[0]?.content;
  if (!content || !snapshotContentUsable(content)) return { error: 'not_comparable', message: 'That version predates the current site format, so it can’t be compared.', status: 410 };
  return { content: content as SnapshotContent, label, at };
}

/** GET /publishes/compare?a=<id|live|draft>&b=<id|live|draft> — plain-language
 *  differences going FROM version a TO version b, in the ONE change-sentence
 *  vocabulary the publish sheet uses. */
export async function handleCompareVersions(req: Request, site: SiteRow, cors: Record<string, string>) {
  const url = new URL(req.url);
  const a = (url.searchParams.get('a') || '').trim();
  const b = (url.searchParams.get('b') || '').trim();
  if (!a || !b) return json({ error: 'bad_request', message: 'Pick two versions to compare.' }, 400, cors);
  const A = await loadVersionContent(site, a);
  if ('error' in A) return json({ error: A.error, message: A.message }, A.status, cors);
  const B = await loadVersionContent(site, b);
  if ('error' in B) return json({ error: B.error, message: B.message }, B.status, cors);
  const cs = describeVersionDiff(A.content, B.content);
  // Raw home block lists ride along so the compare UI (snapshot-history.html)
  // can render its structured section-level diff strip (G9) — matched by
  // stable id there; sentences above stay the plain-words summary.
  const blocksOf = (c: unknown) => (((c as any)?.blocks as unknown[]) || []);
  return json({
    data: {
      from: { ref: a, label: A.label, at: A.at, blocks: blocksOf(A.content) },
      to: { ref: b, label: B.label, at: B.at, blocks: blocksOf(B.content) },
      count: cs.count, identical: cs.count === 0, changes: cs.changes,
    },
  }, 200, cors);
}

/** GET /publishes/timewarp?date=<YYYY-MM-DD | ISO> — resolve the retained version
 *  that was live on that date. The client then opens it in the read-only preview
 *  (publish_id door). Honest when the date predates retention. */
export async function handleTimewarp(req: Request, site: SiteRow, cors: Record<string, string>) {
  const url = new URL(req.url);
  const date = url.searchParams.get('date') || '';
  const r = await svc(`presence_publishes?site_id=eq.${site.id}&status=eq.live&snapshot_id=not.is.null&select=id,created_at,completed_at,version_label&order=created_at.desc&limit=60`);
  const rows: any[] = Array.isArray(r.json) ? r.json : [];
  const versions: TimewarpVersion[] = rows.map((p) => ({ publish_id: p.id, effective_at: p.completed_at || p.created_at, label: p.version_label || '' }));
  const res = resolveTimewarpTarget(versions, normalizeTimewarpDate(date));
  const friendly = (iso?: string) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
  if (!res.ok) {
    const msg = res.reason === 'bad_date' ? 'Pick a date to travel back to.'
      : res.reason === 'no_versions' ? 'Your website has no saved versions yet — publish first, then you can look back in time.'
      : `We don’t keep a version from that far back. The earliest one we still have is from ${friendly(res.earliest_at)}.`;
    return json({ error: res.reason, message: msg, ...(res.earliest_at ? { earliest_at: res.earliest_at } : {}) }, res.reason === 'bad_date' ? 400 : 404, cors);
  }
  return json({
    data: {
      publish_id: res.publish_id, effective_at: res.effective_at, label: res.label, is_current: res.is_current,
      message: res.is_current ? 'That’s how your website looks right now.' : `Here’s your website as it looked on ${friendly(res.effective_at)}.`,
    },
  }, 200, cors);
}

const CHECKPOINT_STATUS = 'checkpoint';   // an off-workflow status on the shared named-snapshot table; never enters the launch state machine

/** GET /publishes/checkpoints — the site's saved draft checkpoints. */
export async function handleCheckpointList(site: SiteRow, cors: Record<string, string>) {
  const r = await svc(`presence_launches?site_id=eq.${site.id}&status=eq.${CHECKPOINT_STATUS}&snapshot_id=not.is.null&select=id,name,created_at&order=created_at.desc&limit=30`);
  const rows: any[] = Array.isArray(r.json) ? r.json : [];
  return json({ data: rows.map((l) => ({ id: l.id, name: l.name, at: l.created_at })) }, 200, cors);
}

/** POST /publishes/checkpoints { name } — snapshot the current draft as a named
 *  safety point. Reuses captureDraftSnapshot (the one draft-capture path). */
export async function handleCheckpointSave(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  if (PUBLISH_BLOCKED_STATES.includes(site.status)) return json({ error: 'lifecycle_blocked', message: 'This site can’t save a checkpoint right now.' }, 409, cors);
  let body: any = null; try { body = await req.json(); } catch { /* */ }
  const name = cleanCheckpointName(body?.name);
  const cap = await captureDraftSnapshot(site, principal);
  if ('error' in cap) return json({ error: cap.error, message: cap.message }, cap.status, cors);
  const ins = await svc('presence_launches', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, name, status: CHECKPOINT_STATUS, snapshot_id: cap.snapshotId, created_by: principal.userId }),
  });
  if (!ins.ok || !ins.json?.[0]?.id) return json({ error: 'checkpoint_failed', message: 'We couldn’t save that checkpoint — please try again.' }, 502, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'launch', entityId: ins.json[0].id, action: 'create', summary: `Saved a checkpoint “${name}”`, principal, provenance: 'human' });
  return json({ data: { id: ins.json[0].id, name, at: ins.json[0].created_at, blockers: cap.blockers, warnings: cap.warnings, message: 'Checkpoint saved — you can look at it or return to it anytime.' } }, 201, cors);
}

/** POST /publishes/checkpoints/:id/restore — bring a checkpoint back into the
 *  draft (a safety point). Reuses the shared draft-writer; the live site is
 *  untouched until the owner publishes. */
export async function handleCheckpointRestore(site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'bad_request', message: 'Which checkpoint should we bring back?' }, 400, cors);
  const l = await svc(`presence_launches?id=eq.${id}&site_id=eq.${site.id}&status=eq.${CHECKPOINT_STATUS}&select=name,snapshot_id&limit=1`);
  const row = l.json?.[0];
  if (!row) return json({ error: 'not_found', message: 'That checkpoint isn’t here.' }, 404, cors);
  if (!row.snapshot_id) return json({ error: 'not_restorable', message: 'That checkpoint is no longer available.' }, 410, cors);
  const s = await svc(`presence_snapshots?id=eq.${row.snapshot_id}&site_id=eq.${site.id}&select=content,media_manifest,content_contract_version,template_slug,template_version,dev_customization&limit=1`);
  const snap = s.json?.[0];
  if (!snap) return json({ error: 'not_restorable', message: 'That checkpoint is no longer available.' }, 410, cors);
  const res = await applySnapshotToDraft(site, snap, principal, `Returned to checkpoint “${row.name}”`);
  if (!res.ok) return json({ error: 'restore_failed', message: 'That didn’t work — your draft is unchanged and nothing was lost.' }, 502, cors);
  return json({ data: { ok: true, message: `Checkpoint “${row.name}” is now in your draft. Your previous draft was set aside as a safety copy — nothing was lost.` } }, 200, cors);
}

// ── G10 · Unpublish / take offline — the reversible veil ─────────────────────
// "Offline" NEVER deletes the deploy or any kept version: it deploys a minimal,
// on-brand, noindex holding page over the live site through the SAME Netlify
// deploy machinery every publish uses. Reversible by POST /site/online (restores
// the last live version through the ONE pipeline) or by any ordinary publish
// (runPipeline clears offline_at when a deploy goes live). Provenance-logged.

/** Core take-offline, shared by the route and the scheduler (kind='offline'
 *  rows on presence_scheduled_publishes — G5's "unpublish at" leg). */
export async function takeSiteOffline(site: SiteRow, principal: Principal): Promise<{ ok: true } | { ok: false; error: string; message: string; status: number }> {
  if (PUBLISH_BLOCKED_STATES.includes(site.status)) return { ok: false, error: 'lifecycle_blocked', message: 'This site is archived and can’t be changed. Contact your studio to reactivate it.', status: 409 };
  if (site.status === 'paused' && principal.kind !== 'staff' && principal.kind !== 'system') return { ok: false, error: 'site_paused', message: 'Your site is currently paused. Contact your studio first.', status: 409 };
  if (!site.netlify_site_id || !netlifyConfigured()) return { ok: false, error: 'config', message: 'Hosting isn’t connected for this site yet.', status: 409 };

  // offline only makes sense for a site that has actually gone live
  const lastLive = await svc(`presence_publishes?site_id=eq.${site.id}&status=eq.live&select=id&order=created_at.desc&limit=1`);
  if (!lastLive.json?.[0]) return { ok: false, error: 'not_live', message: 'Your site isn’t live yet — there’s nothing to take offline.', status: 409 };
  // never interleave with a publish in flight (the deploy would race it)
  const inflight = await svc(`presence_publishes?site_id=eq.${site.id}&status=in.(queued,deploying)&select=id&limit=1`);
  if (Array.isArray(inflight.json) && inflight.json.length) return { ok: false, error: 'publish_in_progress', message: 'A publish is in progress — let it finish, then take the site offline.', status: 409 };
  // capability + idempotence, checked BEFORE any deploy: if the offline marker
  // column can't be read (migration 0111 not applied yet), refuse up front —
  // never deploy a veil that can't be recorded. Already-offline is a calm no-op.
  const cur = await svc(`presence_sites?id=eq.${site.id}&select=offline_at&limit=1`).catch(() => ({ ok: false, json: null } as any));
  if (!cur.ok) return { ok: false, error: 'unavailable', message: 'Taking the site offline isn’t available on this environment yet.', status: 503 };
  if (cur.json?.[0]?.offline_at) return { ok: false, error: 'already_offline', message: 'Your site is already offline. Publish to bring it back whenever you’re ready.', status: 409 };

  // on-brand holding page: business name + contact (already public on the live
  // site) + the Brand Kit accent (loadEmailBrand = the one brand resolver)
  const [ident, brand] = await Promise.all([
    svc(`presence_identity?site_id=eq.${site.id}&select=business_name,email,phone&limit=1`),
    loadEmailBrand(site.id),
  ]);
  const id0 = ident.json?.[0] || {};
  const html = renderOfflinePage({ businessName: id0.business_name, accent: brand.accent, email: id0.email, phone: id0.phone });
  const dep = await deployFileMap(site.netlify_site_id, offlineFileMap(html), { title: 'offline holding page' });
  if (!dep.ok) return { ok: false, error: 'deploy_failed', message: 'That didn’t go through — your live site is unchanged.', status: 502 };

  const mark = await svc(`presence_sites?id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ offline_at: new Date().toISOString() }) });
  if (!mark.ok) {
    // the column exists (pre-checked above), so this is a transient write hiccup
    // AFTER the veil deployed — say so honestly instead of pretending nothing happened.
    console.log(JSON.stringify({ evt: 'offline_mark_failed', site_id: site.id }));
    return { ok: false, error: 'write_failed', message: 'The offline page may be up, but we couldn’t record it. Publish to bring your site back, or try again.', status: 502 };
  }
  await writeChangeEvent({ siteId: site.id, entityType: 'site', entityId: null, action: 'update', summary: 'Took the website offline — visitors see a simple “temporarily offline” page. Every version is kept.', principal, provenance: 'human', fields: ['offline_at'] });
  console.log(JSON.stringify({ evt: 'site_offline', site_id: site.id, deploy_id: dep.deployId || null }));
  return { ok: true };
}

/** POST /site/offline — take the site offline (holding page over live). */
export async function handleTakeOffline(site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const r = await takeSiteOffline(site, principal);
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status, cors);
  return json({ data: { ok: true, offline: true, message: 'Your site is offline. Visitors see a simple “temporarily offline” page — nothing was deleted, and publishing brings everything back.' } }, 200, cors);
}

/** POST /site/online — bring the site back by restoring the last live version
 *  through the ONE pipeline (same path as /restore; no second deploy path). */
export async function handleBackOnline(site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const cur = await svc(`presence_sites?id=eq.${site.id}&select=offline_at&limit=1`).catch(() => ({ ok: false, json: null } as any));
  if (!(cur.ok && cur.json?.[0]?.offline_at)) return json({ error: 'not_offline', message: 'Your site is already online.' }, 409, cors);
  const rec = await svc(`presence_publishes?site_id=eq.${site.id}&status=eq.live&snapshot_id=not.is.null&select=snapshot_id,created_at&order=created_at.desc&limit=1`);
  const row = rec.json?.[0];
  if (!row?.snapshot_id) return json({ error: 'not_restorable', message: 'No kept version is available to bring back — publish your draft instead.' }, 410, cors);
  const snap = await svc(`presence_snapshots?id=eq.${row.snapshot_id}&site_id=eq.${site.id}&select=content,media_manifest,content_contract_version,template_slug,template_version,created_at,dev_customization&limit=1`);
  const s = snap.json?.[0];
  if (!s) return json({ error: 'not_restorable', message: 'No kept version is available to bring back — publish your draft instead.' }, 410, cors);
  const snapshot: Snapshot = { content: s.content, content_contract_version: s.content_contract_version, template_slug: s.template_slug, template_version: s.template_version, created_at: s.created_at, dev_customization: s.dev_customization ?? null };
  // runPipeline clears offline_at the moment the deploy goes live — one invariant, one place.
  return runPipeline(site, principal, 'restore', { snapshot, snapshotId: row.snapshot_id, mediaManifest: s.media_manifest || [] }, 'Brought the website back online', cors);
}

/** DELETE /publishes/checkpoints/:id — remove a saved checkpoint (its snapshot is
 *  reclaimed later by the normal GC once unreferenced). */
export async function handleCheckpointDelete(site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'bad_request', message: 'Which checkpoint?' }, 400, cors);
  const r = await svc(`presence_launches?id=eq.${id}&site_id=eq.${site.id}&status=eq.${CHECKPOINT_STATUS}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  if (!r.ok || !Array.isArray(r.json) || !r.json.length) return json({ error: 'not_found', message: 'That checkpoint is already gone.' }, 404, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'launch', entityId: id, action: 'update', summary: 'Removed a checkpoint', principal, provenance: 'human' });
  return json({ data: { ok: true } }, 200, cors);
}
