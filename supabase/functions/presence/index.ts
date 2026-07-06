// ── Presence edge function — independent bounded context (M3) ────────────────
// Reuses _shared for CORS, the json helper, and auth/principal resolution.
// This function does NOT duplicate any middleware already in _shared.
//
// Boundary order, every request:
//   1. CORS / OPTIONS
//   2. resolvePrincipal (shared) — authenticated staff or client, else 401
//   3. resolve the caller's site via RLS (gives site_id + client_id)
//   4. entitlement gate at the boundary (outside RLS): full / readonly / denied
//   5. method+path router — GET /site, GET /identity, PUT /identity — else 404
//
// Scope is exactly those three routes. No generic router, no table routing,
// no publishing/preview/templates/media/CRUD beyond identity.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsFor } from '../_shared/cors.ts';
import { json } from '../_shared/http.ts';
import { resolvePrincipal } from '../_shared/auth.ts';
import { resolveSite } from './lib/site.ts';
import { checkEntitlement } from './middleware/entitlement.ts';
import { handleGetSite } from './routes/site.ts';
import { handleGetIdentity, handlePutIdentity } from './routes/identity.ts';
import { handlePreview } from './routes/preview.ts';
import { handlePublish, handleRestore, handlePublishHistory } from './routes/publish.ts';
import { handleMediaUpload, handleMediaDelete } from './routes/media.ts';
import { restoreDeploy } from './lib/netlify.ts';
import { svc } from './lib/db.ts';
import { writeChangeEvent } from './lib/provenance.ts';

// path after the function name: /functions/v1/presence/site -> "/site"
function routeOf(url: string): string {
  const path = new URL(url).pathname.replace(/\/+$/, '');
  const i = path.lastIndexOf('/presence');
  const rest = i >= 0 ? path.slice(i + '/presence'.length) : path;
  return rest || '/';
}

serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const route = routeOf(req.url);
  const method = req.method.toUpperCase();

  // 2. authentication (shared resolver; never throws)
  const principal = await resolvePrincipal(req, null);
  if (principal.kind !== 'client' && principal.kind !== 'staff') {
    return json({ error: 'unauthorized', message: 'Please sign in.' }, 401, cors);
  }
  const jwt = principal.jwt || '';

  // ── ADMIN routes: staff-only, operate on any site by id, sit BEFORE the
  //    caller-site resolution (staff own no site). Entitlement never applies
  //    to admin (bypass), auth/role already proven by the principal.
  if (route === '/admin/restore-deploy' && method === 'POST') {
    if (principal.kind !== 'staff') return json({ error: 'forbidden', message: 'Staff only.' }, 403, cors);
    let body: any = null; try { body = await req.json(); } catch { /* */ }
    const siteId = body?.site_id; const deployId = body?.deploy_id;
    if (!siteId || !deployId) return json({ error: 'bad_request', message: 'site_id and deploy_id are required.' }, 400, cors);
    const s = await svc(`presence_sites?id=eq.${encodeURIComponent(siteId)}&select=id,netlify_site_id&limit=1`);
    const row = s.json?.[0];
    if (!row?.netlify_site_id) return json({ error: 'not_found', message: 'Site not found or not connected to hosting.' }, 404, cors);
    const r = await restoreDeploy(row.netlify_site_id, String(deployId));
    if (!r.ok) return json({ error: 'restore_failed', message: r.error }, 502, cors);
    await writeChangeEvent({ siteId: row.id, entityType: 'restore', entityId: null, action: 'restore', summary: 'Instant restore of a previous deploy (operator)', principal, provenance: 'human' });
    return json({ data: { ok: true } }, 200, cors);
  }

  // 3. resolve the caller's site (RLS-scoped; staff/no-site => null)
  const site = await resolveSite(jwt);
  if (!site) {
    return json({ error: 'no_site', message: 'No Presence site is set up for this account yet.' }, 404, cors);
  }

  // 4. entitlement gate (boundary; outside RLS)
  const ent = await checkEntitlement(principal, site.client_id);
  if (ent.mode === 'denied') {
    return json({ error: 'entitlement_inactive', message: ent.message }, 403, cors);
  }
  const isWrite = method === 'PUT' || method === 'POST' || method === 'DELETE' || method === 'PATCH';
  if (isWrite && ent.mode === 'readonly') {
    return json({ error: 'entitlement_paused', message: ent.message }, 403, cors);
  }

  // 5. router — exact routes only
  if (route === '/site' && method === 'GET') return handleGetSite(jwt, site, cors);
  if (route === '/identity' && method === 'GET') return handleGetIdentity(jwt, site, cors);
  if (route === '/identity' && method === 'PUT') return handlePutIdentity(req, jwt, site, principal, cors);
  if (route === '/preview' && method === 'GET') return handlePreview(req, site, cors);
  if (route === '/publish' && method === 'POST') return handlePublish(site, principal, cors);
  if (route === '/restore' && method === 'POST') return handleRestore(req, site, principal, cors);
  if (route === '/publishes' && method === 'GET') return handlePublishHistory(site, cors);
  if (route === '/media/upload-url' && method === 'POST') return handleMediaUpload(req, site, principal, cors);
  {
    const m = route.match(/^\/media\/([0-9a-f-]{36})$/);
    if (m && method === 'DELETE') return handleMediaDelete(site, principal, m[1], cors);
  }

  return json({ error: 'not_found', message: `No route for ${method} ${route}.` }, 404, cors);
});
