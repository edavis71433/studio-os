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
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const fnBase = () => (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');

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

// ── GET /p/:token — the PUBLIC, shareable preview URL (pre-auth) ──────────────
// Resolved by the token; optional password gate; rendered through the ONE engine
// with a preview badge + noindex; internal links stay inside the preview.
export async function handlePublicPreview(req: Request, token: string, cors: Record<string, string>): Promise<Response> {
  const htmlResp = (body: string, status = 200) => new Response(body, { status, headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
  if (!/^[0-9a-f]{16,80}$/i.test(token)) return htmlResp(shell('This preview link isn’t valid.'), 404);
  const r = await svc(`presence_site_preview?token=eq.${encodeURIComponent(token)}&select=site_id,snapshot_id,password_hash&limit=1`);
  const row = r.ok && r.json?.[0];
  if (!row || !row.snapshot_id) return htmlResp(shell('This preview isn’t available.'), 404);

  const url = new URL(req.url);
  // password gate (only when set)
  if (row.password_hash) {
    const pw = url.searchParams.get('pw') || '';
    const given = pw ? await hashPreviewPassword(pw) : '';
    if (given !== row.password_hash) return htmlResp(passwordForm(token, !!pw), 200);
  }

  const loaded = await loadStagedSnapshot(row.snapshot_id);
  if (!loaded || !snapshotContentUsable(loaded.snapshot.content)) return htmlResp(shell('This preview can’t be shown.'), 410);

  const site = await svc(`presence_sites?id=eq.${row.site_id}&select=custom_domain,netlify_site_id&limit=1`);
  const s = site.json?.[0] || {};
  const baseUrl = s.custom_domain ? `https://${s.custom_domain}` : (s.netlify_site_id ? `https://${s.netlify_site_id}.netlify.app` : 'https://preview.invalid');
  let fileMap: Record<string, string | Uint8Array>;
  try { fileMap = renderSnapshot(loaded.snapshot, { baseUrl }); } catch { return htmlResp(shell('We couldn’t draw this preview.'), 500); }

  const page = url.searchParams.get('page') || '/';
  const filePath = page === '/' ? 'index.html' : `${page.replace(/^\/|\/$/g, '')}/index.html`;
  let html = fileMap[filePath] as string | undefined;
  if (!html) return htmlResp(shell('No page at that address in this preview.'), 404);

  // signed images (private bucket) + inline the hashed stylesheet
  const urls = await previewUrlMap(loaded.mediaManifest);
  for (const [outPath, signed] of Object.entries(urls)) html = html!.replaceAll(`"${outPath}"`, `"${signed}"`);
  const cssKey = Object.keys(fileMap).find((k) => k.startsWith('assets/') && k.endsWith('.css'));
  if (cssKey) html = html!.replace(/<link rel="stylesheet" href="[^"]*">/, `<style>${fileMap[cssKey]}</style>`);
  // keep navigation INSIDE the preview: rewrite internal links to /p/:token?page=…
  const pfx = `${fnBase()}/functions/v1/presence/p/${token}`;
  html = html!.replace(/href="\/(?!\/)([^"#?]*)"/g, (_m, p1) => `href="${pfx}?page=/${p1}"`);
  // noindex + the honest preview badge
  html = html!.replace('</head>', `<meta name="robots" content="noindex,nofollow"></head>`);
  const bizName = (loaded.snapshot.content as any)?.identity?.business_name || '';
  html = injectPreviewBadge(html!, bizName);
  return htmlResp(html!);
}

function shell(msg: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Preview</title></head><body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#3a2470;max-width:420px;margin:14vh auto;padding:0 24px;text-align:center;line-height:1.6"><h1 style="font-size:20px">${msg}</h1><p style="color:#6b6478">Ask whoever shared this for an updated link.</p></body></html>`;
}
function passwordForm(token: string, wrong: boolean): string {
  const pfx = `/functions/v1/presence/p/${token}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Protected preview</title></head><body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1b1525;max-width:360px;margin:16vh auto;padding:0 24px"><h1 style="font-size:20px;color:#3a2470">This preview is password-protected</h1>${wrong ? `<p style="color:#a3423a">That password didn’t match — try again.</p>` : ''}<form method="get" action="${pfx}" style="display:flex;gap:8px;margin-top:14px"><input type="password" name="pw" placeholder="Password" autofocus style="flex:1;padding:10px;border:1px solid #ddd;border-radius:8px;font:inherit"><button type="submit" style="padding:10px 16px;border:none;border-radius:8px;background:#5b3fa0;color:#fff;font:inherit;font-weight:600;cursor:pointer">View</button></form></body></html>`;
}
