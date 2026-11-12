// ── One blog post on or off the live site, on its own (builder list item 40) ──
// Publish on a post, and a scheduled post when its time comes, put that post live
// in about a minute WITHOUT the rest of the draft: the live site is drawn again from
// what is live now, with this post added (or taken off). A half-done page in the
// draft never goes out with a post. It is the ONE publish pipeline (runPipeline):
// a new version in Versions, the same failure notice, the same history.
//
// Only a site that is live gets this. A site not live yet, taken offline, paused or
// archived keeps the post in its draft, and it goes out with the next publish.
//
// The post's snapshot entry is built by serializer.ts postEntry, the shape a full
// publish writes, so the changes list never shows a post as changed when it isn't.
import { svc } from './db.ts';
import { getTemplate } from './render.ts';
import { blogListsOf, mediaResolver, postEntry, type MediaManifestEntry, type MediaRow } from './serializer.ts';
import { postImageIds } from './blog.ts';
import { PUBLISH_BLOCKED_STATES } from './lifecycle.ts';
import type { Snapshot, SnapshotContent } from './render_types.ts';
import type { SiteRow } from './site.ts';
import type { Principal } from '../../_shared/auth.ts';

const rows = (r: { ok: boolean; json?: unknown }) => (r.ok && Array.isArray(r.json) ? r.json as any[] : []);
const MEDIA_COLS = 'id,storage_path,alt_text,mime,width,height,focal_x,focal_y';

export type LiveState = { live: true; snapshotId: string } | { live: false; why: 'not_live' | 'offline' | 'blocked' | 'busy' };

/** Can one post go live on its own right now? The live version to build on, or why not. */
export async function liveStateOf(site: SiteRow): Promise<LiveState> {
  if (PUBLISH_BLOCKED_STATES.includes(site.status) || site.status === 'paused') return { live: false, why: 'blocked' };
  if (site.status !== 'live' || !site.netlify_site_id) return { live: false, why: 'not_live' };
  const [pub, off, inflight] = await Promise.all([
    svc(`presence_publishes?site_id=eq.${site.id}&status=eq.live&snapshot_id=not.is.null&select=snapshot_id&order=created_at.desc&limit=1`),
    svc(`presence_sites?id=eq.${site.id}&select=offline_at&limit=1`).catch(() => ({ ok: false, json: null } as any)),
    svc(`presence_publishes?site_id=eq.${site.id}&status=in.(queued,deploying)&select=id&limit=1`),
  ]);
  const snapshotId = rows(pub)[0]?.snapshot_id;
  if (!snapshotId) return { live: false, why: 'not_live' };
  // a site behind its "temporarily offline" page stays there: any publish would lift it
  if (rows(off)[0]?.offline_at) return { live: false, why: 'offline' };
  if (rows(inflight).length) return { live: false, why: 'busy' };
  return { live: true, snapshotId: String(snapshotId) };
}

/** The live content with `add` posts put in (replacing any copy of them) and `remove`
 *  taken out, newest first like a full publish. Pure. */
export function mergePosts(live: SnapshotContent['posts'], add: SnapshotContent['posts'], remove: string[]): SnapshotContent['posts'] {
  const gone = new Set([...remove, ...add.map((p) => p.id)]);
  const out = [...(live || []).filter((p) => !gone.has(p.id)), ...add];
  return out.sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')));
}

/** The live media manifest with `extra` added, one entry per photo. Pure. */
export function mergeManifest(live: MediaManifestEntry[], extra: MediaManifestEntry[]): MediaManifestEntry[] {
  const by = new Map<string, MediaManifestEntry>();
  for (const e of [...(live || []), ...extra]) if (e && e.media_id && !by.has(String(e.media_id).toLowerCase())) by.set(String(e.media_id).toLowerCase(), e);
  return [...by.values()];
}

/** Everything a post-only publish needs, read once: the live version, the posts as they
 *  are in the draft, the blog's lists, and the photos those posts show. */
async function readPieces(site: SiteRow, snapshotId: string, addIds: string[]) {
  const snapQ = await svc(`presence_snapshots?id=eq.${snapshotId}&site_id=eq.${site.id}&select=content,media_manifest,content_contract_version,template_slug,template_version,dev_customization,draft_settings&limit=1`);
  let snap = rows(snapQ)[0];
  if (!snap && !snapQ.ok) snap = rows(await svc(`presence_snapshots?id=eq.${snapshotId}&site_id=eq.${site.id}&select=content,media_manifest,content_contract_version,template_slug,template_version,dev_customization&limit=1`))[0];   // before 0169
  if (!snap?.content) return null;
  const [postsQ, setQ] = await Promise.all([
    addIds.length ? svc(`presence_posts?site_id=eq.${site.id}&id=in.(${addIds.join(',')})&deleted_at=is.null&status=eq.published&select=*`) : Promise.resolve({ ok: true, json: [] }),
    svc(`presence_settings?site_id=eq.${site.id}&select=post_categories,post_authors&limit=1`).catch(() => ({ ok: false, json: null } as any)),
  ]);
  const posts = rows(postsQ);
  const lists = blogListsOf(rows(setQ)[0]);
  const want = new Set<string>();
  for (const p of posts) {
    if (p.hero_media_id) want.add(String(p.hero_media_id).toLowerCase());
    for (const id of postImageIds(p.body_md)) want.add(id);
    const au = lists.authors.find((a) => a.id === String(p.author ?? ''));
    if (au?.photo_media_id) want.add(au.photo_media_id);
  }
  const media = want.size ? rows(await svc(`presence_media?site_id=eq.${site.id}&id=in.(${[...want].join(',')})&deleted_at=is.null&select=${MEDIA_COLS}`)) as MediaRow[] : [];
  return { snap, posts, lists, media };
}

export type PostPublishOutcome =
  | { done: 'live'; response: Response }
  | { done: 'draft_only'; why: 'not_live' | 'offline' | 'blocked' | 'busy' }
  | { done: 'failed'; message: string };

/** Put `add` posts live and take `remove` posts off, without the rest of the draft.
 *  `run` is routes/publish.ts runPipeline (passed in, so this file never imports a route). */
export async function publishPostsOnly(
  site: SiteRow, principal: Principal, change: { add?: string[]; remove?: string[] }, summary: string, cors: Record<string, string>,
  run: (site: SiteRow, principal: Principal, kind: 'publish', arg: { snapshot: Snapshot; mediaManifest: any[]; draftSettings?: Record<string, unknown> }, summary: string, cors: Record<string, string>) => Promise<Response>,
): Promise<PostPublishOutcome> {
  const state = await liveStateOf(site);
  if (!state.live) return { done: 'draft_only', why: state.why };
  const addIds = (change.add || []).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const pieces = await readPieces(site, state.snapshotId, addIds);
  if (!pieces) return { done: 'failed', message: 'We couldn’t read what’s live just now. Nothing changed. Try again in a moment.' };
  const t = getTemplate(pieces.snap.template_slug, pieces.snap.template_version);
  if (!t) return { done: 'failed', message: 'This site’s design isn’t available. Nothing changed.' };
  const { ref, used } = mediaResolver(pieces.media, t.manifest);
  const entries = pieces.posts.map((p) => postEntry(p, pieces.lists, ref));
  const content = { ...pieces.snap.content, posts: mergePosts(pieces.snap.content.posts, entries, change.remove || []) } as SnapshotContent;
  const snapshot: Snapshot = {
    content, content_contract_version: pieces.snap.content_contract_version,
    template_slug: pieces.snap.template_slug, template_version: pieces.snap.template_version,
    created_at: new Date().toISOString(),
    ...(pieces.snap.dev_customization ? { dev_customization: pieces.snap.dev_customization } : {}),
  } as Snapshot;
  const mediaManifest = mergeManifest(pieces.snap.media_manifest || [], used());
  const response = await run(site, principal, 'publish', { snapshot, mediaManifest, ...(pieces.snap.draft_settings ? { draftSettings: pieces.snap.draft_settings } : {}) }, summary, cors);
  return { done: 'live', response };
}
