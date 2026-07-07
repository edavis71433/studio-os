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
import { handleAdmin } from './routes/admin.ts';
import { handleCollection, handleLocation, handleVoice, handleSettings, SPECS } from './routes/content.ts';
import { handleHealth, handleChanges, handleNotesList, handleNoteResolve, handleRestoreToDraft, handleMediaList } from './routes/room.ts';
import { handleMomentsList, handleMomentDismiss } from './routes/moments.ts';
import { handleConciergeAsk } from './routes/concierge.ts';
import { handleWriterGenerate, handleWriterList, handleWriterGet, handleWriterAccept, handleWriterDiscard } from './routes/writer.ts';

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

  // ── ADMIN routes (M6): staff-only, operate on any site by id, sit BEFORE
  //    the caller-site resolution (staff own no site). Entitlement never
  //    applies to admin (bypass); role proven by the principal, fail-closed.
  if (route === '/admin' || route.startsWith('/admin/')) {
    if (principal.kind !== 'staff') return json({ error: 'forbidden', message: 'Staff only.' }, 403, cors);
    const resp = await handleAdmin(req, route, method, principal, cors);
    if (resp) return resp;
    return json({ error: 'not_found', message: `No admin route for ${method} ${route}.` }, 404, cors);
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

  // ── M7: the Client Room (all additive to frozen v1) ──
  if (route === '/health' && method === 'GET') return handleHealth(site, cors);
  if (route === '/changes' && method === 'GET') return handleChanges(site, cors);
  if (route === '/notes' && method === 'GET') return handleNotesList(site, cors);
  {
    const m = route.match(/^\/notes\/([0-9a-f-]{36})\/(dismiss|accept)$/);
    if (m && method === 'POST') return handleNoteResolve(site, principal, m[1], m[2] === 'accept' ? 'accepted' : 'dismissed', cors);
  }
  if (route === '/restore-to-draft' && method === 'POST') return handleRestoreToDraft(req, site, principal, cors);
  // ── M9.3: Business Moments (client read + dismiss; generation is operator/system) ──
  if (route === '/moments' && method === 'GET') return handleMomentsList(jwt, site, cors);
  {
    const m = route.match(/^\/moments\/([0-9a-f-]{36})\/dismiss$/);
    if (m && method === 'POST') return handleMomentDismiss(site, m[1], cors);
  }
  // ── M9.4: the Concierge (one host; grounded answers; prepares, never performs) ──
  if (route === '/concierge/ask' && method === 'POST') return handleConciergeAsk(req, site, cors);
  // ── M9.5A: the AI Writer (Draft verb, rung 2 — proposals only; never publishes) ──
  if (route === '/writer/generate' && method === 'POST') return handleWriterGenerate(req, site, cors);
  if (route === '/writer/drafts' && method === 'GET') return handleWriterList(jwt, site, cors);
  {
    const m = route.match(/^\/writer\/drafts\/([0-9a-f-]{36})(\/accept|\/discard)?$/);
    if (m && !m[2] && method === 'GET') return handleWriterGet(jwt, site, m[1], cors);
    if (m && m[2] === '/accept' && method === 'POST') return handleWriterAccept(req, site, m[1], principal, cors);
    if (m && m[2] === '/discard' && method === 'POST') return handleWriterDiscard(site, m[1], cors);
  }
  if (route === '/media' && method === 'GET') return handleMediaList(site, cors);
  if (route === '/location' && (method === 'GET' || method === 'PUT')) { const r = await handleLocation(req, jwt, site, principal, cors); if (r) return r; }
  if (route === '/voice' && (method === 'GET' || method === 'PUT')) { const r = await handleVoice(req, jwt, site, principal, cors); if (r) return r; }
  if (route === '/settings' && (method === 'GET' || method === 'PUT')) { const r = await handleSettings(req, jwt, site, principal, cors); if (r) return r; }
  {
    const m = route.match(/^\/(offerings|testimonials|faqs|posts)(?:\/([0-9a-f-]{36}))?$/);
    if (m && m[1] in SPECS) { const r = await handleCollection(req, jwt, site, principal, m[1], m[2] ?? null, cors); if (r) return r; }
  }

  return json({ error: 'not_found', message: `No route for ${method} ${route}.` }, 404, cors);
});
