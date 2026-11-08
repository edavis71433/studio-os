// ── Phase T · Dedicated Preview Environment (FD-T20) — routes ────────────────
// Draft → Preview → Live. "Publish to Preview" captures the draft into a pinned
// snapshot + a share token. The preview is SERVED THROUGH THE RENDER PIPELINE at
// the public /p/:token (no second deploy, no duplicate infra), optionally password
// gated, and carries an honest badge. "Promote to Live" reuses the ONE publish
// pipeline (runPipeline). Everything else reuses existing systems.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { runPipeline } from './publish.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { PUBLISH_BLOCKED_STATES } from '../lib/lifecycle.ts';
import { captureDraftSnapshot, loadStagedSnapshot } from '../lib/staging.ts';
import { renderSnapshot } from '../lib/render.ts';
import { previewUrlMap } from '../lib/media.ts';
import { snapshotContentUsable } from '../lib/render_types.ts';
import { injectPreviewBadge, hashPreviewPassword, verifyPreviewPassword, mintPreviewPass, verifyPreviewPass, draftLinkUrl, newPreviewToken, shapePreviewStatus, signPreviewImages, absoluteLibraryFonts } from '../lib/preview_env.ts';
import { rateAllow, clientIp } from '../lib/ratelimit.ts';
import { previewCache, previewCacheKey } from '../lib/preview_cache.ts';
import { signPreviewToken, verifyPreviewToken, previewLinkSecret, clampTtlSeconds } from '../lib/preview_link.ts';
import { injectFeedbackPanel } from '../lib/section_comments.ts';
import type { SiteRow } from '../lib/site.ts';
import { siteOrigin } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const fnBase = () => (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
const appUrl = () => (Deno.env.get('APP_URL') || 'https://app.davisdigitalstudio.com').replace(/\/$/, '');
const nowSec = () => Math.floor(Date.now() / 1000);

async function previewRow(siteId: string) {
  const r = await svc(`presence_site_preview?site_id=eq.${siteId}&select=site_id,snapshot_id,token,password_hash,updated_at&limit=1`);
  return (r.ok && r.json?.[0]) || null;
}
async function draftChangeCount(siteId: string): Promise<number> {
  const last = await svc(`presence_publishes?site_id=eq.${siteId}&status=eq.live&select=created_at&order=created_at.desc&limit=1`);
  const since = last.json?.[0]?.created_at;
  const ev = await svc(`presence_change_events?site_id=eq.${siteId}${since ? `&created_at=gt.${encodeURIComponent(since)}` : ''}&select=id&limit=500`);
  return Array.isArray(ev.json) ? ev.json.length : 0;
}
async function lastLive(siteId: string) {
  const r = await svc(`presence_publishes?site_id=eq.${siteId}&status=eq.live&select=created_at,change_summary&order=created_at.desc&limit=1`);
  const row = r.json?.[0];
  return row ? { last_published_at: row.created_at, summary: row.change_summary || null } : null;
}

// ── GET /preview/status — the three states for the management surface ────────
export async function handlePreviewStatus(site: SiteRow, cors: Record<string, string>) {
  const [p, draftChanges, live, off] = await Promise.all([
    previewRow(site.id), draftChangeCount(site.id), lastLive(site.id),
    // G10: the offline marker — read separately + best-effort so a database
    // without 0111 applied still serves the status untouched (offline = null).
    svc(`presence_sites?id=eq.${site.id}&select=offline_at&limit=1`).catch(() => ({ ok: false, json: null } as any)),
  ]);
  const offlineAt = (off.ok && off.json?.[0]?.offline_at) || null;
  return json({ data: shapePreviewStatus({ draftChanges, preview: p, live, baseUrl: appUrl(), offlineAt }) }, 200, cors);
}

/** Capture the CURRENT draft into the Preview slot (snapshot + upsert). The ONE
 *  implementation behind "Update preview" and the share-a-draft capture. */
async function capturePreviewSlot(site: SiteRow, principal: Principal):
  Promise<{ ok: true; token: string; blockers: any[]; warnings: any[] } | { ok: false; error: string; message: string; status: number }> {
  if (PUBLISH_BLOCKED_STATES.includes(site.status)) return { ok: false, error: 'lifecycle_blocked', message: 'This site can’t update its preview right now.', status: 409 };
  const cap = await captureDraftSnapshot(site, principal);
  if ('error' in cap) return { ok: false, error: cap.error, message: cap.message, status: cap.status };
  const existing = await previewRow(site.id);
  const token = existing?.token || newPreviewToken();
  const up = await svc(`presence_site_preview?on_conflict=site_id`, {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ site_id: site.id, snapshot_id: cap.snapshotId, token, updated_at: new Date().toISOString() }),
  });
  if (!up.ok) return { ok: false, error: 'write_failed', message: 'The preview couldn’t be saved — please try again.', status: 502 };
  return { ok: true, token, blockers: cap.blockers, warnings: cap.warnings };
}

// ── POST /preview/publish — capture the draft into the Preview slot ──────────
export async function handlePreviewPublish(site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const cap = await capturePreviewSlot(site, principal);
  if (!cap.ok) return json({ error: cap.error, message: cap.message }, cap.status, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'preview', entityId: null, action: 'update', summary: 'Updated the preview site', principal, provenance: 'human' });
  return json({ data: { ok: true, url: draftLinkUrl(appUrl(), 't', cap.token), blockers: cap.blockers, warnings: cap.warnings, message: 'Preview updated. Share the link, then promote to Live when you’re happy.' } }, 200, cors);
}

// ── POST /preview/promote — promote the Preview snapshot to Live (one pipeline) ─
export async function handlePreviewPromote(site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const p = await previewRow(site.id);
  if (!p || !p.snapshot_id) return json({ error: 'no_preview', message: 'There’s no preview to promote — update your preview first.' }, 409, cors);
  const loaded = await loadStagedSnapshot(p.snapshot_id);
  if (!loaded) return json({ error: 'not_restorable', message: 'The preview version is no longer available.' }, 410, cors);
  const res = await runPipeline(site, principal, 'publish', { snapshot: loaded.snapshot, snapshotId: p.snapshot_id, mediaManifest: loaded.mediaManifest }, 'Promoted the preview to Live', cors);
  if (res.status === 200) await writeChangeEvent({ siteId: site.id, entityType: 'preview', entityId: null, action: 'publish', summary: 'Promoted the preview to Live', principal, provenance: 'human' });
  return res;
}

// ── POST /preview/settings — set/clear a password, or regenerate the link ────
export async function handlePreviewSettings(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const p = await previewRow(site.id);
  if (!p) return json({ error: 'no_preview', message: 'Update your preview first, then you can protect or reshare it.' }, 409, cors);
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body?.regenerate_token) patch.token = newPreviewToken();
  if (body?.password !== undefined) patch.password_hash = await hashPreviewPassword(String(body.password || '')) || null;
  await svc(`presence_site_preview?site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  await writeChangeEvent({ siteId: site.id, entityType: 'preview', entityId: null, action: 'update', summary: body?.regenerate_token ? 'Reset the preview link' : (body?.password ? 'Password-protected the preview' : 'Removed the preview password'), principal, provenance: 'human' });
  const token = (patch.token as string) || p.token;
  return json({ data: { ok: true, url: draftLinkUrl(appUrl(), 't', token), has_password: !!patch.password_hash } }, 200, cors);
}

// ── shared render core for BOTH public preview doors (opaque + signed) ────────
// M8: cache the deterministic render keyed by the (immutable) snapshot id, so a
// shared link viewed by many people renders once. Per-request bits (freshly
// signed image URLs, link rewrite, badge) are always re-applied → a cache hit
// never serves an expired signed URL. Internal links go to `navBase` + the page,
// which is the draft viewer on the app (draft.html), the door the visitor came by.
async function stagedPreviewHtml(siteId: string, snapshotId: string, page: string, navBase: string, decorate?: (html: string) => string): Promise<{ status: number; html: string }> {
  const key = previewCacheKey(siteId, 'snap', snapshotId);
  let hit = previewCache.get(key);
  if (!hit) {
    const loaded = await loadStagedSnapshot(snapshotId);
    if (!loaded || !snapshotContentUsable(loaded.snapshot.content)) return { status: 410, html: shell('This preview can’t be shown.') };
    const site = await svc(`presence_sites?id=eq.${siteId}&select=id,custom_domain,netlify_site_id&limit=1`);
    const s = site.json?.[0] || {};
    const baseUrl = siteOrigin(s) || 'https://preview.invalid';
    let fileMap: Record<string, string | Uint8Array>;
    try { fileMap = renderSnapshot(loaded.snapshot, { baseUrl }); } catch { return { status: 500, html: shell('We couldn’t draw this preview.') }; }
    hit = { fileMap, mediaManifest: loaded.mediaManifest, blockers: 0, warnings: 0, businessName: (loaded.snapshot.content as any)?.identity?.business_name || '' };
    previewCache.set(key, hit);
  }

  const filePath = page === '/' ? 'index.html' : `${page.replace(/^\/|\/$/g, '')}/index.html`;
  let html = hit.fileMap[filePath] as string | undefined;
  if (!html) return { status: 404, html: shell('No page at that address in this preview.') };

  // signed images (private bucket, fresh per request) + inline the hashed stylesheet
  html = signPreviewImages(html!, await previewUrlMap(hit.mediaManifest as any[]));
  const cssKey = Object.keys(hit.fileMap).find((k) => k.startsWith('assets/') && k.endsWith('.css'));
  if (cssKey) html = html!.replace(/<link rel="stylesheet" href="[^"]*">/, `<style>${hit.fileMap[cssKey]}</style>`);
  html = absoluteLibraryFonts(html!, appUrl());
  // keep navigation INSIDE the preview (same door the visitor arrived through)
  html = html!.replace(/href="\/(?!\/)([^"#?]*)"/g, (_m, p1) => `href="${navBase}${encodeURIComponent('/' + p1)}"`);
  // noindex + the honest preview badge (the draft watermark)
  html = html!.replace('</head>', `<meta name="robots" content="noindex,nofollow"></head>`);
  html = injectPreviewBadge(html!, hit.businessName || '');
  // G11: per-door decoration (the signed door adds its "Leave feedback" panel) —
  // applied after the cache, so a cache hit is decorated per request too.
  if (decorate) html = decorate(html!);
  return { status: 200, html: html! };
}

// The page a viewer asked for: a site path like "/" or "/menu/", nothing else.
const cleanPage = (raw: unknown): string => { const p = String(raw ?? '/'); return /^\/[a-z0-9/_-]{0,120}$/i.test(p) ? p : '/'; };
const htmlResp = (cors: Record<string, string>, body: string, status = 200) => new Response(body, { status, headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
// Supabase serves an HTML answer from the function's own address as plain text, so a
// visitor who opens a door directly is sent on to the viewer, which asks for the page.
const toViewer = (cors: Record<string, string>, kind: 't' | 's', token: string, page: string) =>
  new Response(null, { status: 302, headers: { ...cors, Location: `${draftLinkUrl(appUrl(), kind, token)}${page !== '/' ? `&page=${encodeURIComponent(page)}` : ''}`, 'Cache-Control': 'no-store' } });
// ── The TWO public preview doors — why both exist (M9 Part-1 clarification) ───
// They are DELIBERATELY different tools that share ONE render path
// (renderStagedPreview) — not duplicates, and neither supersedes the other:
//
//   • GET /p/:token   (FD-T20, opaque)  — a PERSISTENT, revocable share link.
//       The token is a random value stored on presence_site_preview; it does NOT
//       expire, can be password-protected, and is revoked by REGENERATING it
//       (POST /preview/settings {regenerate_token}). For a stable link a client
//       bookmarks and returns to over the life of a project.
//
//   • GET /p/s/:token (M8, signed)      — an EPHEMERAL, self-expiring link.
//       The token is a stateless HMAC signature over {site_id, exp}; it carries
//       its own expiry, needs no DB row, and cannot be individually revoked (it
//       simply stops working at `exp`). For time-boxed sharing ("good for 24h").
//
// Both are intended to coexist permanently (persistent+revocable+password vs.
// expiring+stateless). A FUTURE, post-launch consolidation into a single
// preview-sharing surface that mints EITHER kind is tracked in
// STUDIO-OS-ROADMAP.md (Phase 7 · Post-Launch Product Evolution) — not done now.

// ── /p/:token — the PUBLIC, shareable preview link (pre-auth) ────────────────
// GET (a visitor opening the link) goes on to the viewer, draft.html. POST is the
// viewer's own call: {page, pw?, pass?} → {html, pass?}. Item 74: the password is
// sent in the body, never the address; tries are limited per visitor and per link;
// the right password earns a short-lived pass, so the viewer never keeps the password.
export async function handlePublicPreview(req: Request, token: string, cors: Record<string, string>): Promise<Response> {
  if (!/^[0-9a-f]{16,80}$/i.test(token)) return htmlResp(cors, shell('This preview link isn’t valid.'), 404);
  return toViewer(cors, 't', token, cleanPage(new URL(req.url).searchParams.get('page')));
}
export async function handlePublicPreviewOpen(req: Request, token: string, cors: Record<string, string>): Promise<Response> {
  if (!/^[0-9a-f]{16,80}$/i.test(token)) return json({ error: 'not_found', message: 'This preview link isn’t valid.' }, 404, cors);
  let b: { page?: unknown; pw?: unknown; pass?: unknown } = {};
  try { b = await req.json(); } catch { /* an empty body asks for the home page */ }
  const r = await svc(`presence_site_preview?token=eq.${encodeURIComponent(token)}&select=site_id,snapshot_id,password_hash&limit=1`);
  const row = r.ok && r.json?.[0];
  if (!row || !row.snapshot_id) return json({ error: 'not_found', message: 'This preview isn’t available. Ask whoever shared it for an updated link.' }, 404, cors);

  let pass = '';
  if (row.password_hash) {
    const secret = previewLinkSecret() || '';
    const passed = !!secret && typeof b.pass === 'string' && await verifyPreviewPass(b.pass, token, row.password_hash, secret, nowSec());
    if (!passed) {
      if (typeof b.pw !== 'string' || !b.pw.trim()) return json({ error: 'password_required', message: 'This preview is password-protected.' }, 401, cors);
      const ip = clientIp(req);
      if (!(await rateAllow(`pvpw:${token}:${ip}`, 8, 900)) || !(await rateAllow(`pvpw:${token}`, 40, 900))) {
        return json({ error: 'rate_limited', message: 'Too many tries. Wait a few minutes, then try again.' }, 429, cors);
      }
      if (!(await verifyPreviewPassword(b.pw, row.password_hash))) return json({ error: 'wrong_password', message: 'That password didn’t match. Try again.' }, 401, cors);
      if (secret) pass = await mintPreviewPass(token, row.password_hash, secret, nowSec());
    }
  }
  const page = cleanPage(b.page);
  const out = await stagedPreviewHtml(row.site_id, row.snapshot_id, page, `${draftLinkUrl(appUrl(), 't', token)}&page=`);
  return json({ data: { html: out.html, ...(pass ? { pass } : {}) } }, out.status, { ...cors, 'Cache-Control': 'no-store' });
}

// ── GET /p/s/:token — the SIGNED, time-limited preview link (pre-auth) ────────
// Cryptographically-signed, expiring pointer to a site's current preview. Same
// render path as the opaque door; authorized ONLY by a valid, unexpired
// signature over {site_id, exp}. Fails closed on a missing secret, bad signature,
// tampered payload, or expiry. Site-scoped by the signed site_id.
export async function handleSignedPreview(req: Request, token: string, cors: Record<string, string>): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const page = cleanPage(q.get('page'));
  // a visitor opening the link goes on to the viewer; the viewer itself asks with ?embed=1
  if (q.get('embed') !== '1') return toViewer(cors, 's', token, page);
  const secret = previewLinkSecret();
  if (!secret) return htmlResp(cors, shell('This preview link isn’t available.'), 404); // fail closed (no signing secret configured)
  const v = await verifyPreviewToken(token, secret, nowSec());
  if (!v.ok) return htmlResp(cors, shell(v.error === 'expired' ? 'This preview link has expired — ask for a fresh one.' : 'This preview link isn’t valid.'), v.error === 'expired' ? 410 : 404);
  const pv = await svc(`presence_site_preview?site_id=eq.${v.payload.site_id}&select=snapshot_id&limit=1`);
  const snapId = pv.ok && pv.json?.[0]?.snapshot_id;
  if (!snapId) return htmlResp(cors, shell('This preview isn’t available yet.'), 404);
  // G11: the shared-draft page carries a "Leave feedback" panel — per-section
  // comment boxes fed by /p/s/:token/sections and posted to /p/s/:token/comments,
  // both authorized by THIS same signed token. The opaque door is untouched.
  const pfx = `${fnBase()}/functions/v1/presence/p/s/${token}`;
  const out = await stagedPreviewHtml(v.payload.site_id, snapId, page, `${draftLinkUrl(appUrl(), 's', token)}&page=`, (h) => injectFeedbackPanel(h, { pfx, page }));
  return htmlResp(cors, out.html, out.status);
}

// ── POST /preview/share-link — mint a signed, time-limited link (authed) ──────
// Site-scoped to the caller's site; TTL clamped to [1min, 7d] (default 24h).
// G6: pass { capture: true } to first capture the CURRENT draft into the Preview
// slot (same one implementation as "Update preview"), so "Share draft" hands out
// a link to the draft as it stands right now — one tap, no separate update step.
export async function handlePreviewShareLink(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  const secret = previewLinkSecret();
  if (!secret) return json({ error: 'unavailable', message: 'Shareable preview links aren’t configured yet.' }, 503, cors);
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  if (body?.capture === true) {
    const cap = await capturePreviewSlot(site, principal);
    if (!cap.ok) return json({ error: cap.error, message: cap.message }, cap.status, cors);
  }
  const p = await previewRow(site.id);
  if (!p || !p.snapshot_id) return json({ error: 'no_preview', message: 'Update your preview first, then you can share a timed link.' }, 409, cors);
  const ttl = clampTtlSeconds(body?.ttl_seconds ?? (body?.ttl_hours ? Number(body.ttl_hours) * 3600 : undefined));
  const exp = nowSec() + ttl;
  const token = await signPreviewToken({ site_id: site.id, exp, scope: 'preview' }, secret);
  await writeChangeEvent({ siteId: site.id, entityType: 'preview', entityId: null, action: 'update', summary: body?.capture === true ? 'Shared a timed draft preview link' : 'Created a timed preview link', principal, provenance: 'human' });
  return json({ data: { ok: true, url: draftLinkUrl(appUrl(), 's', token), expires_at: new Date(exp * 1000).toISOString(), ttl_seconds: ttl } }, 200, cors);
}

function shell(msg: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Preview</title></head><body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#3a2470;max-width:420px;margin:14vh auto;padding:0 24px;text-align:center;line-height:1.6"><h1 style="font-size:20px">${msg}</h1><p style="color:#6b6478">Ask whoever shared this for an updated link.</p></body></html>`;
}
