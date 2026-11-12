// ── The website draft, sent for the client's OK (builder list item 179, part two) ──
// The Nov 10 portal walk: "Review the design draft" had no draft to open, and the
// only way to show a client the website was a link pasted into a text. Now the
// studio asks for an OK on the draft from the project, and the client sees the
// draft itself inside the portal, page by page, approves it or asks for a change,
// and leaves notes pinned to one part of a page.
//
// One more approval kind, 'website' (migration 0179), on the client's project. Its
// subject is the exact SNAPSHOT of the client's own site the studio sent, captured
// at the ask, never the live draft, so the client approves what they saw and a
// later edit can't ride in under an old OK; a new ask supersedes the old one. The
// decision itself is the one approval contract (presented_hash + the 409 re-read,
// routes/client_delivery.ts handleClientApprovalDecide), unchanged.
//
// Notes go where the shared-link notes already go (routes/comments.ts, G11):
// presence_section_comments on the client's own site, author_kind 'client', so the
// studio finds them in the builder's Comments panel beside the section they're
// about, and the studio's bell counts them like any other open feedback.
import { json } from '../../_shared/http.ts';
import { svc, svcCount } from '../lib/db.ts';
import { SITE_COLS, type SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { UUID_RE } from '../lib/uuid.ts';
import { approvalHash } from '../lib/approvals.ts';
import { linkForCustomerVia } from '../lib/service_bridge.ts';
import { captureDraftSnapshot, loadStagedSnapshot } from '../lib/staging.ts';
import { PUBLISH_BLOCKED_STATES } from '../lib/lifecycle.ts';
import { cleanCommentBody, normalizePageSlug, normalizeBlockId, sectionsForContent, MAX_OPEN_CLIENT_COMMENTS, COMMENT_BODY_MAX } from '../lib/section_comments.ts';
import { rateAllow, tooMany } from '../lib/ratelimit.ts';
import { writeChangeEvent } from '../lib/provenance.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];

/** The title a website approval gets when the studio doesn't write one. */
export const WEBSITE_DRAFT_TITLE = 'Your website draft';
/** Links inside the drawn draft point here (a fragment, so a click inside the
 *  portal's frame goes nowhere); the portal reads the page from it. */
export const DRAFT_NAV = '#dds-draft-page=';
/** Approvals that still take notes: waiting, or sent back for changes. */
export const NOTE_STATUSES: ReadonlySet<string> = new Set(['pending', 'changes_requested']);

/** The pages of a snapshot's content, Home first: { slug ('' = Home), title }.
 *  Junk entries are skipped; a page without a title reads as its slug. Pure. */
export function draftPages(content: unknown): Array<{ slug: string; title: string }> {
  const c = (content && typeof content === 'object' ? content : {}) as Record<string, any>;
  const settings = (c.settings && typeof c.settings === 'object' ? c.settings : {}) as Record<string, any>;
  const out: Array<{ slug: string; title: string }> = [{ slug: '', title: 'Home' }];
  const seen = new Set<string>(['']);
  for (const p of (Array.isArray(settings.pages) ? settings.pages : [])) {
    const slug = p && typeof p === 'object' ? normalizePageSlug(p.slug) : null;
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const title = String(p.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    out.push({ slug, title: title || slug.replace(/-/g, ' ').replace(/^./, (m) => m.toUpperCase()) });
  }
  return out;
}

/** A client's notes as the portal shows them: which page and part, the words, and
 *  whether the studio has dealt with it. The part's name comes from the sections of
 *  the draft being viewed; a part that has gone since reads as the whole page. Pure. */
export function noteRows(notes: any[], content: unknown): Array<{ id: string; page: string; page_title: string; part: string; body: string; status: 'open' | 'done'; created_at: string }> {
  const pages = draftPages(content);
  const titleOf = (slug: string) => (pages.find((p) => p.slug === slug)?.title) || 'A page';
  const sections: Record<string, Array<{ id: string; name: string }>> = {};
  const partOf = (slug: string, block: string) => {
    if (!block) return 'The whole page';
    const list = sections[slug] || (sections[slug] = sectionsForContent(content, slug));
    return list.find((s) => s.id === block)?.name || 'The whole page';
  };
  return (Array.isArray(notes) ? notes : []).filter((n) => n && n.id).map((n) => {
    const slug = String(n.page_slug ?? '');
    return {
      id: String(n.id), page: slug, page_title: titleOf(slug), part: partOf(slug, String(n.block_id ?? '')),
      body: String(n.body ?? ''), status: n.status === 'open' ? 'open' as const : 'done' as const, created_at: String(n.created_at ?? ''),
    };
  });
}

// ═══ The studio's side: capture the client's draft for an approval ═══
/** The ask's subject: the project's client site, its draft captured now. The site
 *  comes from the project's own active service link, so a studio can only ever
 *  send the draft of a site it serves on that project. */
export async function captureWebsiteDraft(agencySiteId: string, projectId: string, principal: Principal):
  Promise<{ ok: true; snapshotId: string; hash: string } | { ok: false; status: number; error: string; message: string }> {
  const link = rows(await svc(`presence_service_links?agency_site_id=eq.${agencySiteId}&project_id=eq.${projectId}&status=eq.active&select=customer_site_id&limit=1`))[0];
  const customerSiteId = String(link?.customer_site_id || '');
  if (!UUID_RE.test(customerSiteId)) return { ok: false, status: 422, error: 'no_website', message: 'This project isn’t tied to a client’s website yet, so there’s no draft to send.' };
  const site = rows(await svc(`presence_sites?id=eq.${customerSiteId}&select=${SITE_COLS}&limit=1`))[0] as SiteRow | undefined;
  if (!site) return { ok: false, status: 422, error: 'no_website', message: 'This project isn’t tied to a client’s website yet, so there’s no draft to send.' };
  if (site.edition === 'monitor') return { ok: false, status: 422, error: 'hosted_elsewhere', message: 'This client’s website lives on its own host, so there’s no draft here to send.' };
  if (PUBLISH_BLOCKED_STATES.includes(site.status)) return { ok: false, status: 409, error: 'lifecycle_blocked', message: 'This client’s website can’t take a new draft right now.' };
  const cap = await captureDraftSnapshot(site, principal);
  if ('error' in cap) return { ok: false, status: cap.status, error: cap.error, message: cap.message };
  return { ok: true, snapshotId: cap.snapshotId, hash: await approvalHash('website', cap.snapshotId, site.id) };
}

// ═══ The client's side ═══
type Found = { ok: true; a: any; content: unknown } | { ok: false; resp: Response };
/** The approval a client asked about, checked all the way down: theirs (the bridge
 *  link to its project), still put to them, a website approval, and its snapshot a
 *  version of the CALLER'S OWN site. Anything else is a plain 404. */
async function draftFor(site: SiteRow, id: string, cors: Record<string, string>): Promise<Found> {
  const notHere = (): Found => ({ ok: false, resp: json({ error: 'not_found', message: 'That draft isn’t here.' }, 404, cors) });
  if (!UUID_RE.test(id)) return { ok: false, resp: json({ error: 'bad_request' }, 400, cors) };
  const me = site.client_id ? String(site.client_id) : '';
  if (!me) return notHere();
  const found = await linkForCustomerVia(me, 'presence_approvals', id);
  if (!found) return notHere();
  const a = rows(await svc(`presence_approvals?id=eq.${id}&site_id=eq.${found.link.agency_site_id}&deleted_at=is.null&client_visible=is.true&select=id,project_id,subject_type,subject_id,title,status,content_hash&limit=1`))[0];
  if (!a || a.subject_type !== 'website' || !UUID_RE.test(String(a.subject_id || ''))) return notHere();
  const snap = rows(await svc(`presence_snapshots?id=eq.${a.subject_id}&site_id=eq.${site.id}&select=id&limit=1`))[0];
  if (!snap) return notHere();
  const loaded = await loadStagedSnapshot(String(a.subject_id));
  if (!loaded) return { ok: false, resp: json({ error: 'gone', message: 'This draft can’t be shown any more. Ask your studio to send it again.' }, 410, cors) };
  return { ok: true, a, content: loaded.snapshot.content };
}

/** The client's own notes on their site, newest first (best-effort: [] on failure,
 *  including a database without 0112). */
async function clientNotes(siteId: string): Promise<any[]> {
  const r = await svc(`presence_section_comments?site_id=eq.${siteId}&author_kind=eq.client&deleted_at=is.null&select=id,page_slug,block_id,body,status,created_at&order=created_at.desc&limit=50`).catch(() => null);
  return r && r.ok ? rows(r) : [];
}

// ── GET /client/approvals/:id/draft?page=<slug> — one page of the draft, drawn ──
// The page as the shared-draft link draws it (one renderer, signed photos, the
// draft badge), its sections for the "Which part?" list, the draft's pages, and
// the client's notes. The photos' links expire, so nothing here is cached.
export async function handleClientDraft(req: Request, site: SiteRow, _principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  const slug = normalizePageSlug(new URL(req.url).searchParams.get('page') ?? '');
  if (slug === null) return json({ error: 'bad_request', message: 'That page isn’t in this draft.' }, 400, cors);
  const f = await draftFor(site, id, cors);
  if (!f.ok) return f.resp;
  const pages = draftPages(f.content);
  if (!pages.some((p) => p.slug === slug)) return json({ error: 'not_found', message: 'That page isn’t in this draft.' }, 404, cors);
  const { renderSnapshotPage } = await import('./preview_env.ts');
  const [out, notes] = await Promise.all([renderSnapshotPage(site.id, String(f.a.subject_id), slug ? `/${slug}/` : '/', DRAFT_NAV), clientNotes(site.id)]);
  if (out.status !== 200) return json({ error: 'render_failed', message: 'We couldn’t draw this page of the draft just now.' }, out.status === 404 ? 404 : 502, cors);
  return json({ data: {
    approval: { id: f.a.id, status: f.a.status },
    page: slug, pages, sections: sectionsForContent(f.content, slug),
    notes: noteRows(notes, f.content), html: out.html,
  } }, 200, { ...cors, 'Cache-Control': 'no-store' });
}

// ── POST /client/approvals/:id/notes {page, block_id, body} — a note on one part ──
export async function handleClientDraftNote(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  const f = await draftFor(site, id, cors);
  if (!f.ok) return f.resp;
  if (!NOTE_STATUSES.has(String(f.a.status))) return json({ error: 'decided', message: 'This draft has been answered already. Message your studio instead.' }, 409, cors);
  if (!(await rateAllow(`draft_notes:${site.id}`, 20, 600))) return tooMany(cors, 600);
  let b: any = {}; try { b = await req.json(); } catch { /* an empty body fails the checks below */ }
  const slug = normalizePageSlug(b?.page ?? '');
  if (slug === null || !draftPages(f.content).some((p) => p.slug === slug)) return json({ error: 'bad_request', message: 'That page isn’t in this draft.' }, 422, cors);
  const blockId = normalizeBlockId(b?.block_id ?? '');
  if (blockId === null || (blockId && !sectionsForContent(f.content, slug).some((s) => s.id === blockId))) return json({ error: 'bad_request', message: 'That part of the page isn’t in this draft.' }, 422, cors);
  const v = cleanCommentBody(b?.body);
  if (!v.ok) return json({ error: 'bad_request', message: v.error === 'empty' ? 'Write a note first.' : `That note is too long. Keep it under ${COMMENT_BODY_MAX} characters.` }, 422, cors);
  const open = await svcCount(`presence_section_comments?site_id=eq.${site.id}&author_kind=eq.client&status=eq.open&deleted_at=is.null`);
  if ((open ?? 0) >= MAX_OPEN_CLIENT_COMMENTS) return json({ error: 'feedback_full', message: 'Your studio has a lot of open notes to go through first. Message them instead.' }, 429, cors);
  const ins = await svc('presence_section_comments', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, page_slug: slug, block_id: blockId || null, author_kind: 'client', author_key: null, body: v.body, status: 'open' }),
  });
  const row = rows(ins)[0];
  if (!ins.ok || !row) return json({ error: 'write_failed', message: 'That note didn’t send. Please try again.' }, 502, cors);
  // the site's timeline says a note arrived, never its words (contract G1 §14)
  await writeChangeEvent({ siteId: site.id, entityType: 'site', entityId: null, action: 'update', summary: 'The client left a note on the draft', principal, provenance: 'human' }).catch(() => {});
  return json({ data: noteRows([row], f.content)[0] }, 201, cors);
}
