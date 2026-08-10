// ── The Client Room's read model + restore-to-draft (M7) ────────────────────
//   GET  /health           — health sentence + tri-state + the four facts
//   GET  /changes          — the diff engine's sentences (publish sheet + pill)
//   GET  /notes            — ≤3 active concierge notes (rules materialized)
//   POST /notes/{id}/dismiss | /notes/{id}/accept — outcomes (memory substrate)
//   POST /restore-to-draft — the Draft Writer's first caller (reconciliation §3)
//   GET  /media            — the library, with in-use flags
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { getTemplate } from '../lib/render.ts';
import { serializeDraft } from '../lib/serializer.ts';
import { validateSnapshot } from '../lib/manifest_validate.ts';
import { describeChanges } from '../lib/diff.ts';
import { computeDraftHash } from '../lib/draft_hash.ts';
import { deriveHealth } from '../lib/health.ts';
import { ensureAndListNotes, resolveNote } from '../lib/notes.ts';
import { applySnapshotToDraft } from '../lib/draft_writer.ts';
import { getSite as netlifyGetSite, netlifyConfigured } from '../lib/netlify.ts';
import { normalizeSnapshotContent, snapshotContentUsable } from '../lib/render_types.ts';
import { buildContentTree } from '../lib/content_tree.ts';
import type { SnapshotContent } from '../lib/render_types.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface RoomState {
  draftContent: SnapshotContent;
  liveContent: SnapshotContent | null;
  draftHash: string;               // M9: the M3 version token for optimistic locking
  blockers: number; warnings: number;
  changes: ReturnType<typeof describeChanges>;
  lastLive: { id: string; created_at: string; completed_at: string | null; actor_kind: string } | null;
  lastAny: { status: string } | null;
  oldestDraftChangeAt: string | null;
  hostingProblem: boolean;
  liveDomain: string | null;
}

/** One read model for /health, /changes, and /notes — computed identically. */
async function roomState(site: SiteRow): Promise<RoomState | null> {
  const t = getTemplate(site.template_slug, site.template_version);
  if (!t) return null;
  const now = new Date().toISOString();

  const [{ snapshot }, lastLiveQ, lastAnyQ] = await Promise.all([
    serializeDraft(site.id, t.manifest, { templateSlug: site.template_slug, templateVersion: site.template_version, now }),
    svc(`presence_publishes?site_id=eq.${site.id}&status=eq.live&select=id,snapshot_id,created_at,completed_at,actor_kind&order=created_at.desc&limit=1`),
    svc(`presence_publishes?site_id=eq.${site.id}&select=status&order=created_at.desc&limit=1`),
  ]);
  const lastLive = lastLiveQ.json?.[0] ?? null;
  const lastAny = lastAnyQ.json?.[0] ?? null;

  let liveContent: SnapshotContent | null = null;
  if (lastLive?.snapshot_id) {
    const s = await svc(`presence_snapshots?id=eq.${lastLive.snapshot_id}&select=content&limit=1`);
    liveContent = s.json?.[0]?.content ? normalizeSnapshotContent(s.json[0].content) : null;
  }

  const v = validateSnapshot(snapshot, t.manifest);
  const changes = describeChanges(snapshot.content, liveContent);
  const draftHash = await computeDraftHash(snapshot); // M9: reuse THIS serialize (no extra work)

  // oldest change event since the last live publish (staleness signal)
  let oldest: string | null = null;
  if (changes.count > 0) {
    const since = lastLive?.created_at ? `&created_at=gt.${encodeURIComponent(lastLive.created_at)}` : '';
    const ev = await svc(`presence_change_events?site_id=eq.${site.id}${since}&entity_type=not.in.(publish,restore)&select=created_at&order=created_at.asc&limit=1`);
    oldest = ev.json?.[0]?.created_at ?? null;
  }

  // hosting signal — only meaningful once hosting is attached
  let hostingProblem = false;
  let liveDomain: string | null = site.custom_domain;
  if (site.netlify_site_id && netlifyConfigured()) {
    const nf = await netlifyGetSite(site.netlify_site_id);
    hostingProblem = !nf.ok && nf.status === 404;
    if (!liveDomain && nf.ok && nf.site) liveDomain = nf.site.default_domain ?? null;
  }

  return { draftContent: snapshot.content, liveContent, draftHash, blockers: v.blockers.length, warnings: v.warnings.length, changes, lastLive, lastAny, oldestDraftChangeAt: oldest, hostingProblem, liveDomain };
}

export async function handleHealth(site: SiteRow, cors: Record<string, string>) {
  const st = await roomState(site);
  if (!st) return json({ error: 'template_missing', message: 'This site’s template isn’t available.' }, 500, cors);
  const nowIso = new Date().toISOString();

  const health = deriveHealth({
    businessName: (st.draftContent.identity?.business_name || '').trim(),
    siteStatus: site.status,
    everPublished: !!st.lastLive,
    lastPublishedAt: st.lastLive?.completed_at || st.lastLive?.created_at || null,
    lastPublishFailed: st.lastAny?.status === 'failed',
    hostingProblem: st.hostingProblem,
    draftBlockers: st.blockers,
    draftChanges: st.changes.count,
    oldestDraftChangeAt: st.oldestDraftChangeAt,
    nowIso,
  });

  const domain = site.custom_domain
    ? { label: site.custom_domain, state: st.hostingProblem ? 'attention' : 'ok', detail: st.hostingProblem ? 'being looked at' : 'connected' }
    : { label: 'No custom domain yet', state: 'none', detail: 'your studio can connect one anytime' };

  return json({
    data: {
      state: health.state,
      sentence: health.sentence,
      detail: health.detail,
      first_run: health.first_run,
      facts: {
        website: st.lastLive
          ? { state: st.hostingProblem ? 'attention' : 'live', label: st.hostingProblem ? 'Being looked at' : 'Live', detail: st.liveDomain || '' }
          : { state: 'none', label: 'Not live yet', detail: 'publish when you’re ready' },
        draft: st.changes.count > 0
          ? { state: 'changes', label: `${st.changes.count} change${st.changes.count > 1 ? 's' : ''}`, detail: st.blockers ? `${st.blockers} to fix before publishing` : 'ready to publish' }
          : { state: 'clean', label: 'Up to date', detail: 'no unpublished changes' },
        last_publish: st.lastLive
          ? { label: new Date(st.lastLive.completed_at || st.lastLive.created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }), detail: st.lastLive.actor_kind === 'staff' ? 'published by your studio' : 'published by you' }
          : { label: '—', detail: 'no publishes yet' },
        domain,
      },
    },
  }, 200, cors);
}

export async function handleChanges(site: SiteRow, cors: Record<string, string>) {
  const st = await roomState(site);
  if (!st) return json({ error: 'template_missing', message: 'This site’s template isn’t available.' }, 500, cors);
  return json({
    data: {
      count: st.changes.count,
      first_publish: st.changes.first_publish,
      changes: st.changes.changes,
      blockers: st.blockers, warnings: st.warnings,
      draft_hash: st.draftHash,   // M9: review these changes, then publish with If-Match this hash
    },
  }, 200, cors);
}

// ── GET /content-tree (CMS-UX-1) — the read-only Client Content Tree ─────────
// A calm, non-technical map of the site: pages × sections × status × edit links.
// ONE bounded projection: the same draft/live/validate/diff/publish reads the
// room already makes, plus a single scheduled-publish probe, fed to the pure
// buildContentTree adapter. Nothing new is stored; the client-safe shape only.
/** Assemble the Content Tree for a site (the one gather, shared). Returns null
 *  only when the template is unavailable. Reused by /content-tree and the
 *  CMS-UX-3 Attention Center so the validation → customer-safe status mapping
 *  lives in exactly one place. */
export async function siteContentTree(site: SiteRow): Promise<ReturnType<typeof buildContentTree> | null> {
  const t = getTemplate(site.template_slug, site.template_version);
  if (!t) return null;
  const now = new Date().toISOString();

  const [{ snapshot }, lastLiveQ, lastAnyQ, schedQ] = await Promise.all([
    serializeDraft(site.id, t.manifest, { templateSlug: site.template_slug, templateVersion: site.template_version, now }),
    svc(`presence_publishes?site_id=eq.${site.id}&status=eq.live&select=snapshot_id,created_at,completed_at&order=created_at.desc&limit=1`),
    svc(`presence_publishes?site_id=eq.${site.id}&select=status&order=created_at.desc&limit=1`),
    svc(`presence_scheduled_publishes?site_id=eq.${site.id}&status=eq.pending&select=id&limit=1`),
  ]);
  const lastLive = lastLiveQ.json?.[0] ?? null;
  const lastAny = lastAnyQ.json?.[0] ?? null;
  const scheduledPending = Array.isArray(schedQ.json) && schedQ.json.length > 0;

  let liveContent: SnapshotContent | null = null;
  if (lastLive?.snapshot_id) {
    const s = await svc(`presence_snapshots?id=eq.${lastLive.snapshot_id}&select=content&limit=1`);
    liveContent = s.json?.[0]?.content ? normalizeSnapshotContent(s.json[0].content) : null;
  }

  const validation = validateSnapshot(snapshot, t.manifest);
  const changes = describeChanges(snapshot.content, liveContent);

  return buildContentTree({
    manifest: t.manifest,
    draft: snapshot.content,
    live: liveContent,
    validation,
    changes,
    publish: {
      lastPublishedAt: lastLive?.completed_at || lastLive?.created_at || null,
      lastPublishFailed: lastAny?.status === 'failed',
      scheduledPending,
      everPublished: !!lastLive,
    },
  });
}

export async function handleContentTree(site: SiteRow, cors: Record<string, string>) {
  const tree = await siteContentTree(site);
  if (!tree) return json({ error: 'template_missing', message: 'This site’s template isn’t available.' }, 500, cors);
  return json({ data: tree }, 200, cors);
}

export async function handleNotesList(site: SiteRow, cors: Record<string, string>) {
  const st = await roomState(site);
  if (!st) return json({ error: 'template_missing', message: 'This site’s template isn’t available.' }, 500, cors);
  const notes = await ensureAndListNotes(site.id, {
    hostingProblem: st.hostingProblem,
    everPublished: !!st.lastLive,
    lastPublishedAt: st.lastLive?.completed_at || st.lastLive?.created_at || null,
    lastPublishFailed: st.lastAny?.status === 'failed',
    draftChanges: st.changes.count,
    oldestDraftChangeAt: st.oldestDraftChangeAt,
    nowIso: new Date().toISOString(),
  });
  return json({ data: notes }, 200, cors);
}

export async function handleNoteResolve(site: SiteRow, principal: Principal, noteId: string, outcome: 'accepted' | 'dismissed', cors: Record<string, string>) {
  if (!UUID_RE.test(noteId)) return json({ error: 'bad_request', message: 'Invalid note reference.' }, 400, cors);
  const ok = await resolveNote(site.id, noteId, outcome);
  if (!ok) return json({ error: 'not_found', message: 'That note is gone already.' }, 404, cors);
  return json({ data: { ok: true } }, 200, cors);
}

/** POST /restore-to-draft {publish_id} — reconciliation §3. The retained
 *  version is loaded INTO THE DRAFT for review; the live site is untouched
 *  until the client publishes through the normal ritual. */
export async function handleRestoreToDraft(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let body: { publish_id?: string } = {};
  try { body = await req.json(); } catch { /* fall through */ }
  const publishId = body?.publish_id || '';
  if (!UUID_RE.test(publishId)) return json({ error: 'bad_request', message: 'Which version should we bring back?' }, 400, cors);

  const p = await svc(`presence_publishes?id=eq.${publishId}&site_id=eq.${site.id}&select=snapshot_id,created_at&limit=1`);
  const rec = p.json?.[0];
  if (!rec) return json({ error: 'not_found', message: 'We couldn’t find that version.' }, 404, cors);
  if (!rec.snapshot_id) return json({ error: 'not_restorable', message: 'That version is no longer restorable (older versions are kept for a limited time).' }, 410, cors);

  const s = await svc(`presence_snapshots?id=eq.${rec.snapshot_id}&site_id=eq.${site.id}&select=content,media_manifest,content_contract_version,template_slug,template_version,dev_customization&limit=1`);
  const snap = s.json?.[0];
  if (!snap) return json({ error: 'not_restorable', message: 'That version is no longer restorable.' }, 410, cors);
  if (!snapshotContentUsable(snap.content)) return json({ error: 'not_restorable', message: 'That version predates the current site format and can’t be restored.' }, 410, cors);

  const when = new Date(rec.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const res = await applySnapshotToDraft(site, snap, principal, `Brought the version from ${when} into the draft`);
  if (!res.ok) return json({ error: 'restore_failed', message: 'That didn’t work — your draft is unchanged except where noted, and nothing was lost.', }, 502, cors);

  const dropped = res.applied?.dropped_media ?? 0;
  return json({
    data: {
      ok: true,
      message: `The version from ${when} is now in your draft. Look it over, then publish when you’re happy.` + (dropped ? ` ${dropped} photo${dropped > 1 ? 's' : ''} from that version ${dropped > 1 ? 'are' : 'is'} no longer in your library and ${dropped > 1 ? 'were' : 'was'} left off.` : ''),
      set_aside: 'Your previous draft was set aside as a safety copy — nothing was lost.',
      applied: res.applied,
    },
  }, 200, cors);
}

/** GET /media — the photo library with in-use flags (which entities use each). */
export async function handleMediaList(site: SiteRow, cors: Record<string, string>) {
  const [media, offerings, posts, settings] = await Promise.all([
    svc(`presence_media?site_id=eq.${site.id}&deleted_at=is.null&select=id,storage_path,alt_text,mime,width,height,bytes,created_at&order=created_at.desc`),
    svc(`presence_offerings?site_id=eq.${site.id}&deleted_at=is.null&media_id=not.is.null&select=media_id,name,is_visible`),
    svc(`presence_posts?site_id=eq.${site.id}&deleted_at=is.null&hero_media_id=not.is.null&select=hero_media_id,title`),
    svc(`presence_settings?site_id=eq.${site.id}&select=cover_media_id&limit=1`),
  ]);
  const uses = new Map<string, string[]>();
  const add = (id: string | null, label: string) => { if (!id) return; const a = uses.get(id) || []; a.push(label); uses.set(id, a); };
  for (const o of offerings.json ?? []) add(o.media_id, `menu item “${o.name}”`);
  for (const pRow of posts.json ?? []) add(pRow.hero_media_id, `update “${pRow.title}”`);
  add(settings.json?.[0]?.cover_media_id ?? null, 'cover photo');

  // short-lived signed thumbnails for the room's grid (the library is private)
  const SB_URL = Deno.env.get('SUPABASE_URL') || '';
  const SB_SERVICE = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const rows = [];
  for (const m of media.json ?? []) {
    let thumb: string | null = null;
    try {
      const objectPath = m.storage_path.replace(/^presence-media\//, '');
      // expiresIn belongs in the BODY (a query-string expiresIn 400s), and `format`
      // is not the output-format selector — both as documented in lib/media.ts
      // signThumb. Between them this grid signed nothing that could ever load.
      const r = await fetch(`${SB_URL}/storage/v1/object/sign/presence-media/${objectPath}`, {
        method: 'POST', headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: 3600, transform: { width: 320, quality: 70 } }),
      });
      const jj = await r.json().catch(() => null);
      if (jj?.signedURL) thumb = `${SB_URL}/storage/v1${jj.signedURL}`;
    } catch { /* thumb optional */ }
    rows.push({ id: m.id, alt_text: m.alt_text, width: m.width, height: m.height, created_at: m.created_at, used_by: uses.get(m.id) || [], thumb });
  }
  return json({ data: rows }, 200, cors);
}
