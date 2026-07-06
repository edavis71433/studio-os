// ── Netlify Deploy API client (the approved deployment architecture) ────────
// Content-addressed: create a deploy with SHA1 digests; Netlify answers with
// the digests it's missing; upload only those; poll until ready. Atomic: the
// live site flips only when the deploy completes. Idempotent: same file map =
// same digests = nothing to upload.
//
// The token lives ONLY as this function's secret. It never reaches builds,
// clients, or any other function.
const NETLIFY_TOKEN = Deno.env.get('NETLIFY_AUTH_TOKEN') || '';
const API = 'https://api.netlify.com/api/v1';

export function netlifyConfigured(): boolean { return !!NETLIFY_TOKEN; }

async function nf(path: string, init: RequestInit = {}) {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${NETLIFY_TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await r.text();
  let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  return { ok: r.ok, status: r.status, json, text };
}

async function sha1Hex(data: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-1', data as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const enc = new TextEncoder();
const toBytes = (v: string | Uint8Array): Uint8Array => (typeof v === 'string' ? enc.encode(v) : v);

export interface DeployResult {
  ok: boolean;
  deployId?: string;
  state?: string;
  uploaded?: number;
  totalFiles?: number;
  error?: string; // operator-facing only
}

/** Create a content-addressed deploy of fileMap onto netlifySiteId and poll briefly. */
export async function deployFileMap(netlifySiteId: string, fileMap: Record<string, string | Uint8Array>, opts: { title?: string; pollMs?: number } = {}): Promise<DeployResult> {
  if (!NETLIFY_TOKEN) return { ok: false, error: 'NETLIFY_AUTH_TOKEN not configured' };

  // 1. digest every file (path must be /-prefixed for the API)
  const bytes: Record<string, Uint8Array> = {};
  const digests: Record<string, string> = {};
  for (const [p, v] of Object.entries(fileMap)) {
    const path = p.startsWith('/') ? p : `/${p}`;
    bytes[path] = toBytes(v);
    digests[path] = await sha1Hex(bytes[path]);
  }

  // 2. create deploy — Netlify replies with `required` = digests it lacks
  const create = await nf(`/sites/${netlifySiteId}/deploys`, {
    method: 'POST',
    body: JSON.stringify({ files: digests, title: opts.title || 'presence publish' }),
  });
  if (!create.ok || !create.json?.id) return { ok: false, error: `deploy create failed: ${create.status} ${create.text.slice(0, 200)}` };
  const deployId = String(create.json.id);
  const required: string[] = Array.isArray(create.json.required) ? create.json.required : [];

  // 3. upload only missing files (by digest match)
  const need = new Set(required);
  let uploaded = 0;
  for (const [path, digest] of Object.entries(digests)) {
    if (!need.has(digest)) continue;
    // one transient-failure retry per file (M6 §7); a second failure aborts the
    // deploy — Netlify only flips the live site on completion, so nothing is
    // ever partially updated
    let up: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      up = await fetch(`${API}/deploys/${deployId}/files${path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${NETLIFY_TOKEN}`, 'Content-Type': 'application/octet-stream' },
        body: bytes[path] as unknown as BodyInit,
      });
      if (up.ok) break;
      await up.text();
      if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
    }
    if (!up || !up.ok) return { ok: false, deployId, error: `upload failed for ${path}: ${up?.status ?? 'network'} (after retry)` };
    uploaded++;
    need.delete(digest); // identical files share a digest; one upload satisfies all
  }

  // 4. brief poll — the publish record reconciles anything still pending (⟐1)
  const deadline = Date.now() + (opts.pollMs ?? 30_000);
  let state = 'uploading';
  while (Date.now() < deadline) {
    const d = await nf(`/deploys/${deployId}`);
    state = String(d.json?.state || 'unknown');
    if (state === 'ready') return { ok: true, deployId, state, uploaded, totalFiles: Object.keys(digests).length };
    if (state === 'error') return { ok: false, deployId, state, error: `deploy state=error: ${String(d.json?.error_message || '').slice(0, 200)}` };
    await new Promise((r) => setTimeout(r, 1500));
  }
  // not an error: still deploying — status-driven record reconciles later
  return { ok: true, deployId, state, uploaded, totalFiles: Object.keys(digests).length };
}

export async function deployState(deployId: string): Promise<string | null> {
  if (!NETLIFY_TOKEN) return null;
  const d = await nf(`/deploys/${deployId}`);
  return d.ok ? String(d.json?.state || 'unknown') : null;
}

// ── M6: site provisioning + domain operations (admin-only callers) ──────────
// Same client, same token boundary. Raw Netlify responses NEVER leave the
// presence function — routes translate to plain language.

export interface NetlifySiteInfo {
  id: string;
  name: string;
  default_domain: string;       // <name>.netlify.app
  custom_domain: string | null;
  state: string;
  ssl_url: string | null;
}

function toSiteInfo(j: any): NetlifySiteInfo {
  return {
    id: String(j.id), name: String(j.name || ''),
    default_domain: String(j.default_domain || `${j.name}.netlify.app`),
    custom_domain: j.custom_domain ? String(j.custom_domain) : null,
    state: String(j.state || 'unknown'), ssl_url: j.ssl_url ? String(j.ssl_url) : null,
  };
}

/** Create a Netlify site with an exact name. 422 = name already taken. */
export async function createSite(name: string): Promise<{ ok: boolean; status: number; site?: NetlifySiteInfo; error?: string }> {
  if (!NETLIFY_TOKEN) return { ok: false, status: 0, error: 'NETLIFY_AUTH_TOKEN not configured' };
  const r = await nf('/sites', { method: 'POST', body: JSON.stringify({ name }) });
  if (!r.ok) return { ok: false, status: r.status, error: `site create failed: ${r.status} ${r.text.slice(0, 200)}` };
  return { ok: true, status: r.status, site: toSiteInfo(r.json) };
}

/** Look up a site by Netlify site id OR by domain (e.g. "name.netlify.app"). */
export async function getSite(idOrDomain: string): Promise<{ ok: boolean; status: number; site?: NetlifySiteInfo }> {
  if (!NETLIFY_TOKEN) return { ok: false, status: 0 };
  const r = await nf(`/sites/${encodeURIComponent(idOrDomain)}`);
  return r.ok ? { ok: true, status: r.status, site: toSiteInfo(r.json) } : { ok: false, status: r.status };
}

/** Permanently delete a Netlify site (lifecycle 'deleting'; DB data is retained). */
export async function deleteSite(netlifySiteId: string): Promise<{ ok: boolean; error?: string }> {
  if (!NETLIFY_TOKEN) return { ok: false, error: 'NETLIFY_AUTH_TOKEN not configured' };
  const r = await nf(`/sites/${encodeURIComponent(netlifySiteId)}`, { method: 'DELETE' });
  // 404 counts as done: the site is already gone
  return r.ok || r.status === 404 ? { ok: true } : { ok: false, error: `site delete failed: ${r.status} ${r.text.slice(0, 200)}` };
}

/** Deploy history (operator view — deploy ids are allowed for staff). */
export async function listDeploys(netlifySiteId: string, limit = 20): Promise<{ ok: boolean; deploys: Array<{ id: string; state: string; created_at: string; published_at: string | null; title: string }> }> {
  if (!NETLIFY_TOKEN) return { ok: false, deploys: [] };
  const r = await nf(`/sites/${encodeURIComponent(netlifySiteId)}/deploys?per_page=${limit}`);
  if (!r.ok || !Array.isArray(r.json)) return { ok: false, deploys: [] };
  return {
    ok: true,
    deploys: r.json.map((d: any) => ({
      id: String(d.id), state: String(d.state || 'unknown'),
      created_at: String(d.created_at || ''), published_at: d.published_at ? String(d.published_at) : null,
      title: String(d.title || ''),
    })),
  };
}

/** Attach (or with null: detach) a custom domain. */
export async function setCustomDomain(netlifySiteId: string, domain: string | null): Promise<{ ok: boolean; site?: NetlifySiteInfo; error?: string }> {
  if (!NETLIFY_TOKEN) return { ok: false, error: 'NETLIFY_AUTH_TOKEN not configured' };
  const r = await nf(`/sites/${encodeURIComponent(netlifySiteId)}`, { method: 'PATCH', body: JSON.stringify({ custom_domain: domain }) });
  if (!r.ok) return { ok: false, error: `domain update failed: ${r.status} ${r.text.slice(0, 200)}` };
  return { ok: true, site: toSiteInfo(r.json) };
}

/** Certificate state. 200 with empty body = no cert yet (valid pre-DNS state). */
export async function sslStatus(netlifySiteId: string): Promise<{ ok: boolean; state: string; expires_at: string | null }> {
  if (!NETLIFY_TOKEN) return { ok: false, state: 'unknown', expires_at: null };
  const r = await nf(`/sites/${encodeURIComponent(netlifySiteId)}/ssl`);
  if (!r.ok) return { ok: false, state: 'unknown', expires_at: null };
  if (!r.json) return { ok: true, state: 'none', expires_at: null };
  return { ok: true, state: String(r.json.state || 'unknown'), expires_at: r.json.expires_at ? String(r.json.expires_at) : null };
}

/** Ask Netlify to (re)provision the certificate — safe to call repeatedly. */
export async function provisionSsl(netlifySiteId: string): Promise<{ ok: boolean }> {
  if (!NETLIFY_TOKEN) return { ok: false };
  const r = await nf(`/sites/${encodeURIComponent(netlifySiteId)}/ssl`, { method: 'POST' });
  return { ok: r.ok };
}

/** Instant restore: re-publish a previous deploy (operational recovery). */
export async function restoreDeploy(netlifySiteId: string, deployId: string): Promise<{ ok: boolean; error?: string }> {
  if (!NETLIFY_TOKEN) return { ok: false, error: 'NETLIFY_AUTH_TOKEN not configured' };
  const r = await nf(`/sites/${netlifySiteId}/deploys/${deployId}/restore`, { method: 'POST' });
  return r.ok ? { ok: true } : { ok: false, error: `restore failed: ${r.status} ${r.text.slice(0, 200)}` };
}
