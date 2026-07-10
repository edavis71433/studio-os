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
import { injectPreviewBadge, hashPreviewPassword, newPreviewToken, shapePreviewStatus } from '../lib/preview_env.ts';
import { previewCache, previewCacheKey } from '../lib/preview_cache.ts';
import { signPreviewToken, verifyPreviewToken, previewLinkSecret, clampTtlSeconds } from '../lib/preview_link.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const fnBase = () => (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
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
  const [p, draftChanges, live] = await Promise.all([previewRow(site.id), draftChangeCount(site.id), lastLive(site.id)]);
  return json({ data: shapePreviewStatus({ draftChanges, preview: p, live, baseUrl: fnBase() }) }, 200, cors);
}

// ── POST /preview/publish — capture the draft into the Preview slot ──────────
export async function handlePreviewPublish(site: SiteRow, principal: Principal, cors: Record<string, string>) {
  if (PUBLISH_BLOCKED_STATES.includes(site.status)) return json({ error: 'lifecycle_blocked', message: 'This site can’t update its preview right now.' }, 409, cors);
  const cap = await captureDraftSnapshot(site, principal);
  if ('error' in cap) return json({ error: cap.error, message: cap.message }, cap.status, cors);
  const existing = await previewRow(site.id);
  const token = existing?.token || newPreviewToken();
  const up = await svc(`presence_site_preview?on_conflict=site_id`, {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ site_id: site.id, snapshot_id: cap.snapshotId, token, updated_at: new Date().toISOString() }),
  });
  if (!up.ok) return json({ error: 'write_failed', message: 'The preview couldn’t be saved — please try again.' }, 502, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'preview', entityId: null, action: 'update', summary: 'Updated the preview site', principal, provenance: 'human' });
  return json({ data: { ok: true, url: `${fnBase()}/functions/v1/presence/p/${token}`, blockers: cap.blockers, warnings: cap.warnings, message: 'Preview updated. Share the link, then promote to Live when you’re happy.' } }, 200, cors);
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
  return json({ data: { ok: true, url: `${fnBase()}/functions/v1/presence/p/${token}`, has_password: !!patch.password_hash } }, 200, cors);
}

// ── shared render core for BOTH public preview doors (opaque + signed) ────────
// M8: cache the deterministic render keyed by the (immutable) snapshot id, so a
// shared link viewed by many people renders once. Per-request bits (freshly
// signed image URLs, link rewrite, badge) are always re-applied → a cache hit
// never serves an expired signed URL. `linkPfx` keeps in-preview navigation on
// the same door the visitor arrived through.
async function renderStagedPreview(req: Request, siteId: string, snapshotId: string, linkPfx: string, cors: Record<string, string>): Promise<Response> {
  const htmlResp = (body: string, status = 200) => new Response(body, { status, headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
  const url = new URL(req.url);

  const key = previewCacheKey(siteId, 'snap', snapshotId);
  let hit = previewCache.get(key);
  if (!hit) {
    const loaded = await loadStagedSnapshot(snapshotId);
    if (!loaded || !snapshotContentUsable(loaded.snapshot.content)) return htmlResp(shell('This preview can’t be shown.'), 410);
    const site = await svc(`presence_sites?id=eq.${siteId}&select=custom_domain,netlify_site_id&limit=1`);
    const s = site.json?.[0] || {};
    const baseUrl = s.custom_domain ? `https://${s.custom_domain}` : (s.netlify_site_id ? `https://${s.netlify_site_id}.netlify.app` : 'https://preview.invalid');
    let fileMap: Record<string, string | Uint8Array>;
    try { fileMap = renderSnapshot(loaded.snapshot, { baseUrl }); } catch { return htmlResp(shell('We couldn’t draw this preview.'), 500); }
    hit = { fileMap, mediaManifest: loaded.mediaManifest, blockers: 0, warnings: 0, businessName: (loaded.snapshot.content as any)?.identity?.business_name || '' };
    previewCache.set(key, hit);
  }

  const page = url.searchParams.get('page') || '/';
  const filePath = page === '/' ? 'index.html' : `${page.replace(/^\/|\/$/g, '')}/index.html`;
  let html = hit.fileMap[filePath] as string | undefined;
  if (!html) return htmlResp(shell('No page at that address in this preview.'), 404);

  // signed images (private bucket, fresh per request) + inline the hashed stylesheet
  const urls = await previewUrlMap(hit.mediaManifest as any[]);
  for (const [outPath, signed] of Object.entries(urls)) html = html!.replaceAll(`"${outPath}"`, `"${signed}"`);
  const cssKey = Object.keys(hit.fileMap).find((k) => k.startsWith('assets/') && k.endsWith('.css'));
  if (cssKey) html = html!.replace(/<link rel="stylesheet" href="[^"]*">/, `<style>${hit.fileMap[cssKey]}</style>`);
  // keep navigation INSIDE the preview (same door the visitor arrived through)
  html = html!.replace(/href="\/(?!\/)([^"#?]*)"/g, (_m, p1) => `href="${linkPfx}?page=/${p1}"`);
  // noindex + the honest preview badge (the draft watermark)
  html = html!.replace('</head>', `<meta name="robots" content="noindex,nofollow"></head>`);
  html = injectPreviewBadge(html!, hit.businessName || '');
  return htmlResp(html!);
}

// ── GET /p/:token — the PUBLIC, shareable preview URL (pre-auth) ──────────────
// Resolved by the opaque token; optional password gate; rendered through the ONE
// engine (shared cached renderer) with a preview badge + noindex.
export async function handlePublicPreview(req: Request, token: string, cors: Record<string, string>): Promise<Response> {
  const htmlResp = (body: string, status = 200) => new Response(body, { status, headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
  if (!/^[0-9a-f]{16,80}$/i.test(token)) return htmlResp(shell('This preview link isn’t valid.'), 404);
  const r = await svc(`presence_site_preview?token=eq.${encodeURIComponent(token)}&select=site_id,snapshot_id,password_hash&limit=1`);
  const row = r.ok && r.json?.[0];
  if (!row || !row.snapshot_id) return htmlResp(shell('This preview isn’t available.'), 404);

  // password gate (only when set)
  if (row.password_hash) {
    const pw = new URL(req.url).searchParams.get('pw') || '';
    const given = pw ? await hashPreviewPassword(pw) : '';
    if (given !== row.password_hash) return htmlResp(passwordForm(token, !!pw), 200);
  }
  return renderStagedPreview(req, row.site_id, row.snapshot_id, `${fnBase()}/functions/v1/presence/p/${token}`, cors);
}

// ── GET /p/s/:token — the SIGNED, time-limited preview link (pre-auth) ────────
// Cryptographically-signed, expiring pointer to a site's current preview. Same
// render path as the opaque door; authorized ONLY by a valid, unexpired
// signature over {site_id, exp}. Fails closed on a missing secret, bad signature,
// tampered payload, or expiry. Site-scoped by the signed site_id.
export async function handleSignedPreview(req: Request, token: string, cors: Record<string, string>): Promise<Response> {
  const htmlResp = (body: string, status = 200) => new Response(body, { status, headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
  const secret = previewLinkSecret();
  if (!secret) return htmlResp(shell('This preview link isn’t available.'), 404); // fail closed (no signing secret configured)
  const v = await verifyPreviewToken(token, secret, nowSec());
  if (!v.ok) return htmlResp(shell(v.error === 'expired' ? 'This preview link has expired — ask for a fresh one.' : 'This preview link isn’t valid.'), v.error === 'expired' ? 410 : 404);
  const pv = await svc(`presence_site_preview?site_id=eq.${v.payload.site_id}&select=snapshot_id&limit=1`);
  const snapId = pv.ok && pv.json?.[0]?.snapshot_id;
  if (!snapId) return htmlResp(shell('This preview isn’t available yet.'), 404);
  return renderStagedPreview(req, v.payload.site_id, snapId, `${fnBase()}/functions/v1/presence/p/s/${token}`, cors);
}

// ── POST /preview/share-link — mint a signed, time-limited link (authed) ──────
// Site-scoped to the caller's site; TTL clamped to [1min, 7d] (default 24h).
export async function handlePreviewShareLink(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  const secret = previewLinkSecret();
  if (!secret) return json({ error: 'unavailable', message: 'Shareable preview links aren’t configured yet.' }, 503, cors);
  const p = await previewRow(site.id);
  if (!p || !p.snapshot_id) return json({ error: 'no_preview', message: 'Update your preview first, then you can share a timed link.' }, 409, cors);
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const ttl = clampTtlSeconds(body?.ttl_seconds ?? (body?.ttl_hours ? Number(body.ttl_hours) * 3600 : undefined));
  const exp = nowSec() + ttl;
  const token = await signPreviewToken({ site_id: site.id, exp, scope: 'preview' }, secret);
  await writeChangeEvent({ siteId: site.id, entityType: 'preview', entityId: null, action: 'update', summary: 'Created a timed preview link', principal, provenance: 'human' });
  return json({ data: { ok: true, url: `${fnBase()}/functions/v1/presence/p/s/${token}`, expires_at: new Date(exp * 1000).toISOString(), ttl_seconds: ttl } }, 200, cors);
}

function shell(msg: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Preview</title></head><body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#3a2470;max-width:420px;margin:14vh auto;padding:0 24px;text-align:center;line-height:1.6"><h1 style="font-size:20px">${msg}</h1><p style="color:#6b6478">Ask whoever shared this for an updated link.</p></body></html>`;
}
function passwordForm(token: string, wrong: boolean): string {
  const pfx = `/functions/v1/presence/p/${token}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Protected preview</title></head><body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1b1525;max-width:360px;margin:16vh auto;padding:0 24px"><h1 style="font-size:20px;color:#3a2470">This preview is password-protected</h1>${wrong ? `<p style="color:#a3423a">That password didn’t match — try again.</p>` : ''}<form method="get" action="${pfx}" style="display:flex;gap:8px;margin-top:14px"><input type="password" name="pw" placeholder="Password" autofocus style="flex:1;padding:10px;border:1px solid #ddd;border-radius:8px;font:inherit"><button type="submit" style="padding:10px 16px;border:none;border-radius:8px;background:#5b3fa0;color:#fff;font:inherit;font-weight:600;cursor:pointer">View</button></form></body></html>`;
}
