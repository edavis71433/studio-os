// ── Scheduled blog posts go out on time (builder list item 40) ──────────────
// A post scheduled for 9:00 has status 'scheduled' and published_at 9:00 (0181). Each
// 15-minute tick, before the scheduled publishes, this finds the posts whose time has
// come, marks them published (the claim: only a row still 'scheduled' is taken, so two
// overlapping ticks can't both send one), and puts them live on their own site through
// publishPostsOnly, the path Publish on a post uses. A 9:00 post is live by 9:15.
//
// A site whose publish is still going is left for the next tick, its posts unclaimed.
// A site not live yet, offline or paused keeps the post published in its draft; it goes
// out with the next publish. A deploy that fails raises the usual "A publish didn't go
// through" notice (routes/publish.ts runPipeline), and the post stays published in the
// draft, so the next publish carries it. Nothing is retried in a loop.
import { svc } from '../lib/db.ts';
import { SITE_COLS, type SiteRow } from '../lib/site.ts';
import { liveStateOf, publishPostsOnly } from '../lib/post_publish.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { runPipeline } from '../routes/publish.ts';
import type { Principal } from '../../_shared/auth.ts';

const rows = (r: { ok: boolean; json?: unknown }) => (r.ok && Array.isArray(r.json) ? r.json as any[] : []);

/** The due posts, grouped by site, in the order they were due. Pure. */
export function groupDue(due: Array<{ id: string; site_id: string; title?: string }>): Map<string, Array<{ id: string; title?: string }>> {
  const by = new Map<string, Array<{ id: string; title?: string }>>();
  for (const p of due) {
    if (!p?.id || !p?.site_id) continue;
    if (!by.has(p.site_id)) by.set(p.site_id, []);
    by.get(p.site_id)!.push({ id: p.id, title: p.title });
  }
  return by;
}

export interface DuePostsResult { ok: boolean; run_type: 'scheduled_posts'; due: number; published: number; live_sites: number; waiting_sites: number; failures: number; errors?: string[] }

export async function runDuePosts(limit = 25, deps: { run?: typeof runPipeline; now?: () => string } = {}): Promise<DuePostsResult> {
  const now = (deps.now || (() => new Date().toISOString()))();
  const run = deps.run || runPipeline;
  const out: DuePostsResult = { ok: true, run_type: 'scheduled_posts', due: 0, published: 0, live_sites: 0, waiting_sites: 0, failures: 0 };
  const q = await svc(`presence_posts?status=eq.scheduled&deleted_at=is.null&published_at=lte.${encodeURIComponent(now)}&select=id,site_id,title&order=published_at.asc&limit=${Math.max(1, Math.min(100, limit))}`);
  const due = rows(q);
  out.due = due.length;
  if (!due.length) return out;
  const system: Principal = { kind: 'system', userId: 'scheduler', tenantId: null, role: null, email: null, jwt: null, requestId: 'scheduled-posts' };
  const errors: string[] = [];
  for (const [siteId, posts] of groupDue(due)) {
    try {
      const site = rows(await svc(`presence_sites?id=eq.${siteId}&select=${SITE_COLS}&limit=1`))[0] as SiteRow | undefined;
      if (!site) continue;
      const state = await liveStateOf(site);
      if (!state.live && state.why === 'busy') { out.waiting_sites++; continue; }   // left scheduled; the next tick takes them
      const claim = await svc(`presence_posts?site_id=eq.${siteId}&id=in.(${posts.map((p) => p.id).join(',')})&status=eq.scheduled&deleted_at=is.null`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'published' }),
      });
      const claimed = rows(claim).map((p) => ({ id: String(p.id), title: String(p.title || '') }));
      if (!claimed.length) continue;   // another tick took them
      out.published += claimed.length;
      for (const p of claimed) await writeChangeEvent({ siteId, entityType: 'post', entityId: p.id, action: 'update', summary: 'A scheduled blog post went out', principal: system, provenance: 'human', fields: ['status'] }).catch(() => {});
      if (!state.live) continue;   // not live, offline or paused: it goes out with the next publish
      const names = claimed.map((p) => `“${p.title.slice(0, 60)}”`).join(', ');
      const res = await publishPostsOnly(site, system, { add: claimed.map((p) => p.id) }, `Scheduled blog post${claimed.length > 1 ? 's' : ''} ${names} went live`, {}, run);
      if (res.done === 'live' && res.response.status === 200) out.live_sites++;
      else if (res.done !== 'draft_only') { out.failures++; errors.push(`${siteId}: ${res.done === 'failed' ? res.message : `status ${res.response.status}`}`.slice(0, 200)); }
    } catch (e) {
      out.failures++; errors.push(`${siteId}: ${String((e as Error)?.message || e)}`.slice(0, 200));
    }
  }
  if (errors.length) out.errors = errors;
  out.ok = out.failures === 0;
  return out;
}
