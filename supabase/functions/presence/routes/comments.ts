// ── Wave-2 G11: per-section annotations & review comments — routes ────────────
// Two doors, one table (presence_section_comments, migration 0112):
//   • OPERATOR (authed, site-scoped like every sibling site route; the reviewer
//     boundary already refuses a client_reviewer):
//       GET  /comments?page=            — all threads, grouped by page+section
//       POST /comments                  — { page_slug, block_id?, body }
//       POST /comments/:id/resolve      — close a note (open → resolved)
//       POST /comments/:id/delete       — soft delete
//   • CLIENT (pre-auth, authorized ONLY by the signed, expiring share-link token
//     — the SAME verify as the /p/s/:token draft door; fails closed on a missing
//     secret, bad signature, tampered payload, or expiry):
//       GET  /p/s/:token/sections       — the draft's {id,name} section list, NOTHING else
//       POST /p/s/:token/comments       — { page|page_slug?, block_id?, body }, rate-limited
// Deploy-order-tolerant: until 0112 is applied the reads degrade to empty and
// the writes return a calm write_failed. RLS on the table is deny-all — every
// access is mediated here with the service role (like presence_deal_tasks).
import { json } from '../../_shared/http.ts';
import { svc, svcCount } from '../lib/db.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { verifyPreviewToken, previewLinkSecret } from '../lib/preview_link.ts';
import { loadStagedSnapshot } from '../lib/staging.ts';
import { rateAllow, clientIp, tooMany } from '../lib/ratelimit.ts';
import {
  cleanCommentBody, normalizePageSlug, normalizeBlockId, groupThreads, canResolve,
  sectionsForContent, COMMENT_BODY_MAX, MAX_OPEN_CLIENT_COMMENTS,
} from '../lib/section_comments.ts';
import type { CommentRow } from '../lib/section_comments.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELECT = 'id,page_slug,block_id,author_kind,body,status,created_at,resolved_at';

function badBody(v: { error: 'empty' | 'too_long' }, cors: Record<string, string>): Response {
  return json({
    error: 'bad_request',
    message: v.error === 'empty' ? 'Write a note first.' : `That note is too long — keep it under ${COMMENT_BODY_MAX} characters.`,
  }, 422, cors);
}

// ── GET /comments?page= — every thread for the site (operator view) ───────────
export async function handleCommentsList(req: Request, site: SiteRow, cors: Record<string, string>) {
  const pageQ = new URL(req.url).searchParams.get('page');
  let filter = '';
  if (pageQ !== null) {
    const slug = normalizePageSlug(pageQ);
    if (slug === null) return json({ error: 'bad_request', message: 'That page reference isn’t valid.' }, 400, cors);
    filter = `&page_slug=eq.${encodeURIComponent(slug)}`;
  }
  const r = await svc(`presence_section_comments?site_id=eq.${site.id}&deleted_at=is.null${filter}&select=${SELECT}&order=created_at.desc&limit=500`);
  // Deploy-order tolerance: a database without 0112 applied serves an empty,
  // honest list — the builder simply shows no feedback yet.
  const rows: CommentRow[] = (r.ok && Array.isArray(r.json)) ? r.json as CommentRow[] : [];
  const threads = groupThreads(rows);
  const total_open = threads.reduce((n, t) => n + t.open_count, 0);
  return json({ data: { threads, total_open } }, 200, cors);
}

// ── POST /comments — the operator writes / replies (authed) ───────────────────
export async function handleCommentCreate(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const slug = normalizePageSlug(body?.page_slug ?? body?.page ?? '');
  if (slug === null) return json({ error: 'bad_request', message: 'That page reference isn’t valid.' }, 400, cors);
  const blockId = normalizeBlockId(body?.block_id ?? '');
  if (blockId === null) return json({ error: 'bad_request', message: 'That section reference isn’t valid.' }, 400, cors);
  const v = cleanCommentBody(body?.body);
  if (!v.ok) return badBody(v, cors);
  const ins = await svc('presence_section_comments', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      site_id: site.id, page_slug: slug, block_id: blockId || null,
      author_kind: 'operator', author_key: principal.userId || principal.email || 'operator',
      body: v.body, status: 'open',
    }),
  });
  const row = ins.ok && Array.isArray(ins.json) ? ins.json[0] : null;
  if (!row) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'site', entityId: null, action: 'update', summary: 'Left a review note on the draft', principal, provenance: 'human' });
  return json({ data: { ok: true, comment: { id: row.id, page_slug: row.page_slug, block_id: row.block_id || '', author_kind: row.author_kind, body: row.body, status: row.status, created_at: row.created_at } } }, 200, cors);
}

// ── POST /comments/:id/resolve — open → resolved (idempotent) ─────────────────
export async function handleCommentResolve(site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request', message: 'Invalid comment reference.' }, 400, cors);
  const cur = await svc(`presence_section_comments?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id,status&limit=1`);
  const row = cur.ok && cur.json?.[0];
  if (!row) return json({ error: 'not_found', message: 'That note is gone already.' }, 404, cors);
  if (!canResolve(row.status)) return json({ data: { ok: true, status: 'resolved' } }, 200, cors);   // already resolved — idempotent
  const up = await svc(`presence_section_comments?id=eq.${id}&site_id=eq.${site.id}&status=eq.open`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: principal.userId || principal.email || 'owner' }),
  });
  if (!up.ok) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'site', entityId: null, action: 'update', summary: 'Resolved a review note on the draft', principal, provenance: 'human' });
  return json({ data: { ok: true, status: 'resolved' } }, 200, cors);
}

// ── POST /comments/:id/delete — soft delete (any state) ───────────────────────
export async function handleCommentDelete(site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request', message: 'Invalid comment reference.' }, 400, cors);
  const up = await svc(`presence_section_comments?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ deleted_at: new Date().toISOString() }),
  });
  const row = up.ok && Array.isArray(up.json) ? up.json[0] : null;
  if (!row) return json({ error: 'not_found', message: 'That note is gone already.' }, 404, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'site', entityId: null, action: 'update', summary: 'Removed a review note from the draft', principal, provenance: 'human' });
  return json({ data: { ok: true } }, 200, cors);
}

// ── The signed-token door (pre-auth). ONE verification core, shared. ──────────
// Fails closed at every step, exactly like handleSignedPreview: no secret → 404,
// bad/tampered signature → 404, expired → 410. The token's own signed site_id is
// the ONLY site scope — a link can never reach another site's draft or comments.
async function verifyTokenSite(token: string, cors: Record<string, string>):
  Promise<{ ok: true; siteId: string } | { ok: false; resp: Response }> {
  const secret = previewLinkSecret();
  if (!secret) return { ok: false, resp: json({ error: 'not_found', message: 'This link isn’t available.' }, 404, cors) };
  const v = await verifyPreviewToken(token, secret, Math.floor(Date.now() / 1000));
  if (!v.ok) {
    return {
      ok: false,
      resp: v.error === 'expired'
        ? json({ error: 'expired', message: 'This link has expired — ask for a fresh one.' }, 410, cors)
        : json({ error: 'not_found', message: 'This link isn’t valid.' }, 404, cors),
    };
  }
  return { ok: true, siteId: v.payload.site_id };
}

/** The pinned preview snapshot id for a site (what /p/s/:token actually shows). */
async function previewSnapshotId(siteId: string): Promise<string | null> {
  const pv = await svc(`presence_site_preview?site_id=eq.${siteId}&select=snapshot_id&limit=1`);
  return (pv.ok && pv.json?.[0]?.snapshot_id) || null;
}

// ── GET /p/s/:token/sections — {id,name} pairs ONLY, never content ────────────
export async function handleTokenSections(req: Request, token: string, cors: Record<string, string>) {
  const t = await verifyTokenSite(token, cors);
  if (!t.ok) return t.resp;
  const slug = normalizePageSlug(new URL(req.url).searchParams.get('page') || '/');
  if (slug === null) return json({ error: 'bad_request', message: 'That page reference isn’t valid.' }, 400, cors);
  const snapId = await previewSnapshotId(t.siteId);
  if (!snapId) return json({ error: 'not_found', message: 'This preview isn’t available yet.' }, 404, cors);
  const loaded = await loadStagedSnapshot(snapId);
  if (!loaded) return json({ error: 'not_found', message: 'This preview isn’t available yet.' }, 404, cors);
  // ONLY {id, name} pairs leave this route — no titles, bodies, media, or settings.
  return json({ data: { page_slug: slug, sections: sectionsForContent(loaded.snapshot.content, slug) } }, 200, cors);
}

// ── POST /p/s/:token/comments — the client leaves feedback (rate-limited) ─────
export async function handleTokenComment(req: Request, token: string, cors: Record<string, string>) {
  const t = await verifyTokenSite(token, cors);
  if (!t.ok) return t.resp;
  // Fixed-window per-IP+site limiter (the durable rate_hit bucket, same as the
  // public form/booking/review doors). Fail-open on limiter error by design.
  if (!(await rateAllow(`sec_comments:${t.siteId}:${clientIp(req)}`, 10, 600))) return tooMany(cors, 600);
  // Feedback must attach to a draft that is actually shared (the preview slot).
  const snapId = await previewSnapshotId(t.siteId);
  if (!snapId) return json({ error: 'not_found', message: 'This preview isn’t available yet.' }, 404, cors);
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const slug = normalizePageSlug(body?.page_slug ?? body?.page ?? '');
  if (slug === null) return json({ error: 'bad_request', message: 'That page reference isn’t valid.' }, 400, cors);
  const blockId = normalizeBlockId(body?.block_id ?? '');
  if (blockId === null) return json({ error: 'bad_request', message: 'That section reference isn’t valid.' }, 400, cors);
  const v = cleanCommentBody(body?.body);
  if (!v.ok) return badBody(v, cors);
  // The abuse backstop behind the per-IP limiter: a hard cap of OPEN client
  // comments per site. HEAD + count=exact — flat cost at any size.
  const open = await svcCount(`presence_section_comments?site_id=eq.${t.siteId}&author_kind=eq.client&status=eq.open&deleted_at=is.null`);
  if ((open ?? 0) >= MAX_OPEN_CLIENT_COMMENTS) {
    return json({ error: 'feedback_full', message: 'This draft already has a lot of open feedback — the studio needs to review it before more can be added.' }, 429, cors);
  }
  const ins = await svc('presence_section_comments', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      site_id: t.siteId, page_slug: slug, block_id: blockId || null,
      author_kind: 'client', author_key: null,   // no PII stored for the client
      body: v.body, status: 'open',
    }),
  });
  if (!ins.ok) return json({ error: 'write_failed', message: 'That didn’t send — please try again.' }, 502, cors);
  // Provenance: the timeline shows THAT feedback arrived, never the words
  // (detail carries field names only — contract G1 §14). Best-effort.
  const anon: Principal = { kind: 'public', userId: null, tenantId: null, role: null, email: null, jwt: null, requestId: '' } as Principal;
  await writeChangeEvent({ siteId: t.siteId, entityType: 'site', entityId: null, action: 'update', summary: 'A client left feedback on the shared draft', principal: anon, provenance: 'human' });
  return json({ data: { ok: true, message: 'Thanks — your note went to the studio.' } }, 200, cors);
}
