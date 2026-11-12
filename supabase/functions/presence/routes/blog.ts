// ── The blog's own actions (builder list items 40 and 160) ──────────────────
//   POST /posts/:id/publish     put this post live now, on its own (lib/post_publish.ts);
//                               a post already live goes out again with its edits
//   POST /posts/:id/unpublish   take this post off the live site, on its own; it is a draft again
//   GET  /posts/:id/email-draft what Send an update starts from for this post (item 160):
//                               its title, cover, summary and a link to it, and whether it is live
// Saving a post, scheduling it and its category and author go through the ordinary
// PATCH /posts/:id (routes/content.ts). Scheduled posts go out from the tick
// (ops/scheduled_posts.ts) through the same publishPostsOnly.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { liveStateOf, publishPostsOnly, type LiveState } from '../lib/post_publish.ts';
import { postEmailDraft } from '../lib/blog.ts';
import { cooldownRemainingMs } from '../lib/publish_guard.ts';
import { siteOrigin, type SiteRow } from '../lib/site.ts';
import { runPipeline } from './publish.ts';
import type { Principal } from '../../_shared/auth.ts';
import { UUID_LOWER_RE as UUID_RE } from '../lib/uuid.ts';

const rows = (r: { ok: boolean; json?: unknown }) => (r.ok && Array.isArray(r.json) ? r.json as any[] : []);

/** Why a post stays in the draft for now, in a sentence. Pure. */
export function draftOnlyMessage(why: Exclude<LiveState, { live: true }>['why'], verb: 'publish' | 'unpublish' = 'publish'): string {
  if (verb === 'unpublish') return 'It’s a draft again.';
  if (why === 'offline') return 'Saved. Your site is offline right now, so this post goes out when you publish your site again.';
  if (why === 'blocked') return 'Saved. Your site is paused, so this post goes out once your studio brings it back.';
  return 'Saved. Your site isn’t live yet, so this post goes out with your first publish.';
}

async function readPost(site: SiteRow, id: string) {
  return rows(await svc(`presence_posts?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id,title,slug,body_md,excerpt,hero_media_id,status,published_at&limit=1`))[0] || null;
}

/** Refused before anything is written: a publish in flight, or one a moment ago. */
async function notNow(site: SiteRow, state: LiveState, cors: Record<string, string>): Promise<Response | null> {
  if (!state.live && state.why === 'busy') return json({ error: 'publish_in_progress', message: 'Your site is publishing right now. Try again in a minute.' }, 409, cors);
  if (state.live) {
    const left = cooldownRemainingMs(site.last_published_at, Date.now());
    if (left > 0) { const secs = Math.ceil(left / 1000); return json({ error: 'cooldown', message: `Just a moment. You can publish again in about ${secs} second${secs === 1 ? '' : 's'}.`, retry_after: secs }, 429, { ...cors, 'Retry-After': String(secs) }); }
  }
  return null;
}

/** POST /posts/:id/publish */
export async function handlePostPublish(site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request', message: 'Which post?' }, 400, cors);
  const p = await readPost(site, id);
  if (!p) return json({ error: 'not_found', message: 'We couldn’t find that post.' }, 404, cors);
  if (!String(p.title || '').trim() || !String(p.body_md || '').trim()) return json({ error: 'empty_post', message: 'Give it a title and write something first.' }, 422, cors);
  const state = await liveStateOf(site);
  const refused = await notNow(site, state, cors);
  if (refused) return refused;
  const wasLive = p.status === 'published';
  if (!wasLive) {
    // a draft or a scheduled post goes out now, dated now
    const w = await svc(`presence_posts?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'published', published_at: new Date().toISOString() }),
    });
    if (!w.ok || !rows(w)[0]) return json({ error: 'write_failed', message: 'That didn’t save. Nothing changed. Please try again.' }, 502, cors);
    await writeChangeEvent({ siteId: site.id, entityType: 'post', entityId: id, action: 'update', summary: 'Published a blog post', principal, provenance: 'human', fields: ['status', 'published_at'] });
  }
  const title = String(p.title || '').trim().slice(0, 80);
  const out = await publishPostsOnly(site, principal, { add: [id] }, wasLive ? `Updated the blog post “${title}”` : `Published the blog post “${title}”`, cors, runPipeline);
  if (out.done === 'draft_only') return json({ data: { status: 'saved', live: false, why: out.why, message: draftOnlyMessage(out.why) } }, 200, cors);
  if (out.done === 'failed') return json({ error: 'publish_failed', message: out.message }, 502, cors);
  if (out.response.status !== 200) return out.response;
  const body = await out.response.clone().json().catch(() => null);
  const url = siteOrigin(site) ? `${siteOrigin(site)}/updates/${p.slug}/` : '';
  return json({ data: { ...(body?.data || {}), live: true, url, message: body?.data?.status === 'live' ? 'Your post is live.' : 'Your post is going live. This usually takes under a minute.' } }, 200, cors);
}

/** POST /posts/:id/unpublish */
export async function handlePostUnpublish(site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request', message: 'Which post?' }, 400, cors);
  const p = await readPost(site, id);
  if (!p) return json({ error: 'not_found', message: 'We couldn’t find that post.' }, 404, cors);
  if (p.status !== 'published') return json({ error: 'not_live', message: 'That post isn’t published.' }, 409, cors);
  const state = await liveStateOf(site);
  const refused = await notNow(site, state, cors);
  if (refused) return refused;
  // it keeps its date, so publishing it again puts it back where it was
  const w = await svc(`presence_posts?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'draft' }),
  });
  if (!w.ok || !rows(w)[0]) return json({ error: 'write_failed', message: 'That didn’t save. Nothing changed. Please try again.' }, 502, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'post', entityId: id, action: 'update', summary: 'Took a blog post off the site', principal, provenance: 'human', fields: ['status'] });
  const title = String(p.title || '').trim().slice(0, 80);
  const out = await publishPostsOnly(site, principal, { remove: [id] }, `Took the blog post “${title}” off the site`, cors, runPipeline);
  if (out.done === 'draft_only') return json({ data: { status: 'saved', live: false, message: draftOnlyMessage(out.why, 'unpublish') } }, 200, cors);
  if (out.done === 'failed') return json({ error: 'publish_failed', message: out.message }, 502, cors);
  if (out.response.status !== 200) return out.response;
  return json({ data: { status: 'draft', live: false, message: 'It’s off your site and back in your drafts.' } }, 200, cors);
}

/** GET /posts/:id/email-draft (item 160): Send an update starts from this. Only a post
 *  that is on the live site can be sent, so its link always opens. */
export async function handlePostEmailDraft(site: SiteRow, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request', message: 'Which post?' }, 400, cors);
  const p = await readPost(site, id);
  if (!p) return json({ error: 'not_found', message: 'We couldn’t find that post.' }, 404, cors);
  const origin = siteOrigin(site);
  let live = false;
  if (p.status === 'published' && origin) {
    const pub = rows(await svc(`presence_publishes?site_id=eq.${site.id}&status=eq.live&snapshot_id=not.is.null&select=snapshot_id&order=created_at.desc&limit=1`))[0];
    if (pub?.snapshot_id) {
      const snap = rows(await svc(`presence_snapshots?id=eq.${pub.snapshot_id}&site_id=eq.${site.id}&select=posts:content->posts&limit=1`))[0];
      live = Array.isArray(snap?.posts) && snap.posts.some((x: { id?: string }) => x?.id === id);
    }
  }
  if (!live) return json({ data: { live: false, message: p.status === 'scheduled' ? 'It can go to your list once it’s live.' : 'Publish it first, so the link in the email opens.' } }, 200, cors);
  let heroAlt = '';
  if (p.hero_media_id) heroAlt = String(rows(await svc(`presence_media?id=eq.${p.hero_media_id}&site_id=eq.${site.id}&select=alt_text&limit=1`))[0]?.alt_text || '');
  const url = `${origin}/updates/${p.slug}/`;
  return json({ data: { live: true, url, ...postEmailDraft(p, url, heroAlt) } }, 200, cors);
}
