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
    const up = await fetch(`${API}/deploys/${deployId}/files${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${NETLIFY_TOKEN}`, 'Content-Type': 'application/octet-stream' },
      body: bytes[path] as unknown as BodyInit,
    });
    if (!up.ok) return { ok: false, deployId, error: `upload failed for ${path}: ${up.status}` };
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

/** Instant restore: re-publish a previous deploy (operational recovery). */
export async function restoreDeploy(netlifySiteId: string, deployId: string): Promise<{ ok: boolean; error?: string }> {
  if (!NETLIFY_TOKEN) return { ok: false, error: 'NETLIFY_AUTH_TOKEN not configured' };
  const r = await nf(`/sites/${netlifySiteId}/deploys/${deployId}/restore`, { method: 'POST' });
  return r.ok ? { ok: true } : { ok: false, error: `restore failed: ${r.status} ${r.text.slice(0, 200)}` };
}
