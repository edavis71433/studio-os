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
import { handleVisualKinds, handleVisualGenerate, handleVisualList, handleVisualGet, handleVisualVary, handleVisualEdit, handleVisualDecide } from './routes/visual.ts';
import { handleAdmin } from './routes/admin.ts';
import { handleCollection, handleLocation, handleVoice, handleSettings, SPECS } from './routes/content.ts';
import { handleHealth, handleChanges, handleNotesList, handleNoteResolve, handleRestoreToDraft, handleMediaList } from './routes/room.ts';
import { handleMomentsList, handleMomentDismiss } from './routes/moments.ts';
import { handlePortalContext, handlePortalFeed, handleMembersList, handleMemberAdd, handleMemberRevoke, handleSharesList, handleShareSet, reviewerAllowed } from './routes/workspace.ts';
import { handleDevFiles, handleDevCustomizationGet, handleDevCustomizationPut } from './routes/dev.ts';
import { handleCrmProfile, handleCrmTimeline, handleCrmNotesList, handleCrmNoteAdd, handleCrmNotePin, handleCrmNoteDelete } from './routes/crm.ts';
import { handleScheduleCreate, handleScheduleList, handleScheduleCancel, handleFormSubmit, handleFormInbox, handleFormStatus, handleApproveSend, handleApproveGet, handleApprovePost } from './routes/commercial.ts';
import { resolveSiteRole } from './lib/workspace.ts';
import { handleConciergeAsk } from './routes/concierge.ts';
import { handleWriterGenerate, handleWriterList, handleWriterGet, handleWriterAccept, handleWriterDiscard } from './routes/writer.ts';
import { handleEditorImprove } from './routes/editor.ts';
import { handleReviewRun, handleReviewList, handleReviewGet, handleReviewDismiss } from './routes/review.ts';
import { handleBrandProfileGet, handleBrandProfilePut, handleBrandReviewRun, handleBrandReportList, handleBrandReportGet, handleBrandReportDismiss } from './routes/brand.ts';
import { handleCoachRun, handleCoachList, handleCoachDecide } from './routes/coach.ts';
import { handleKnowledgeImport, handleKnowledgeList, handleKnowledgeDelete } from './routes/knowledge.ts';
import { handleMonitorGet, handleMonitorConnect, handleMonitorVerify, handleMonitorDisconnect, handleMonitorReadiness } from './routes/monitor.ts';
import { handleFoundationsGet, handleFoundationsPrepare, handleFoundationsPlans, handleFoundationsDecide } from './routes/foundations.ts';
import { handleExport, handleLaunch, handleDnsGet, handleDnsPut, handleDnsRollback, handleEmailHealth } from './routes/services.ts';
import { handleImportInventory } from './routes/monitor.ts';
import { resolveAgencyMember } from './agency/auth.ts';
import { handleAgency } from './agency/routes.ts';
import { handleCommerce } from './routes/commerce.ts';
import { handleSystem } from './routes/system.ts';
import { handleConnectionsList, handleConnectionProfile, handleConnectionConnect, handleConnectionCallback, handleConnectionRefresh, handleConnectionDisconnect, handleWritePrepare, handleWriteList, handleWriteDecide, handleWriteExecute, handleWriteRollback } from './routes/connections.ts';
import { handleMarketplaceList, handleMarketplacePrepare, handleMarketplaceDecide, handleMarketplaceExecute, handleMarketplaceRollback, handleMarketplaceAudit, handleMarketplaceFeatures } from './routes/marketplace.ts';
import { handleEnterpriseOverview, handleEnterpriseLocations, handleEnterpriseLocationConfig, handleEnterpriseRolloutPrepare, handleEnterpriseDecide, handleEnterpriseExecute, handleEnterpriseRollback, handleEnterpriseAudit } from './routes/enterprise.ts';

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

  // ── L2: /system/* — unattended operations (cron). Secret-gated, no session,
  //    so it is handled BEFORE principal resolution and self-gates on
  //    SCHEDULER_SECRET. This is how the platform keeps observing, retries
  //    failures, and reports its own health while no operator is present.
  if (route === '/system' || route.startsWith('/system/')) {
    return handleSystem(req, route, method, cors);
  }

  // 2. authentication (shared resolver; never throws)
  const principal = await resolvePrincipal(req, null);

  // ── M13: /agency routes — a third, explicitly-scoped principal. Members
  //    own no site; membership + role are resolved fail-closed and every
  //    operation inside is fenced to the agency's own linked sites. Staff
  //    and clients continue through the existing boundary untouched.
  if (route === '/agency' || route.startsWith('/agency/')) {
    const member = await resolveAgencyMember(req.headers.get('x-dds-user-jwt') || '');
    if (!member) return json({ error: 'unauthorized', message: 'Please sign in with an agency account.' }, 401, cors);
    return handleAgency(req, route, method, member, principal, cors);
  }

  // ── L1: /commerce routes — self-serve signup & commerce. Public-safe by
  //    design (discover, price, buy with no operator). Handled BEFORE the
  //    client/staff 401 so a stranger can sign up; the authed routes inside
  //    (subscription, billing portal, first-run) enforce their own sign-in.
  if (route === '/commerce' || route.startsWith('/commerce/')) {
    return handleCommerce(req, route, method, principal, cors);
  }

  // ── Phase F: PUBLIC commercial routes — a website visitor's form submission
  //    (FD-2) and a client's one-tap approval via a signed token (FD-3). No
  //    session; both are authorized by the target itself (site id / signed token).
  {
    const m = route.match(/^\/forms\/([0-9a-f-]{36})\/submit$/);
    if (m && method === 'POST') return handleFormSubmit(req, m[1], cors);
  }
  if (route === '/approve' && method === 'GET') return handleApproveGet(req, cors);
  if (route === '/approve' && method === 'POST') return handleApprovePost(req, cors);

  // ── L5.5: Industry Pack Marketplace — OPERATOR management. Infrastructure,
  //    not client-scoped: reachable by staff or system (service-role/cron), and
  //    handled BEFORE the caller-site resolution (operators own no site). Every
  //    state change is an Approved Plan (lib/approved_plan.ts).
  if (route === '/marketplace' || route.startsWith('/marketplace/')) {
    if (route !== '/marketplace/features') {   // /features is the customer view, handled later with a site
      if (route === '/marketplace' && method === 'GET') return handleMarketplaceList(principal, cors);
      if (route === '/marketplace/audit' && method === 'GET') return handleMarketplaceAudit(principal, cors);
      const mo = route.match(/^\/marketplace\/operations\/([0-9a-f-]{36})\/(decide|execute|rollback)$/);
      if (mo && method === 'POST') {
        if (mo[2] === 'decide') return handleMarketplaceDecide(req, mo[1], principal, cors);
        if (mo[2] === 'execute') return handleMarketplaceExecute(mo[1], principal, cors);
        if (mo[2] === 'rollback') return handleMarketplaceRollback(mo[1], principal, cors);
      }
      const mp = route.match(/^\/marketplace\/([a-z0-9_]+)\/prepare$/);
      if (mp && method === 'POST') return handleMarketplacePrepare(req, mp[1], principal, cors);
    }
  }

  // ── L5.6: Enterprise & Multi-Location — OPERATOR/agency management. Operators
  //    own no site; handled BEFORE the caller-site gate. Every org-wide change is
  //    an Approved Plan (lib/approved_plan.ts). One org, many locations.
  if (route === '/enterprise' || route.startsWith('/enterprise/')) {
    const eo = route.match(/^\/enterprise\/operations\/([0-9a-f-]{36})\/(decide|execute|rollback)$/);
    if (eo && method === 'POST') {
      if (eo[2] === 'decide') return handleEnterpriseDecide(req, eo[1], principal, cors);
      if (eo[2] === 'execute') return handleEnterpriseExecute(eo[1], principal, cors);
      if (eo[2] === 'rollback') return handleEnterpriseRollback(eo[1], principal, cors);
    }
    const cfg = route.match(/^\/enterprise\/([0-9a-f-]{36})\/locations\/([0-9a-f-]{36})\/config$/);
    if (cfg && method === 'GET') return handleEnterpriseLocationConfig(cfg[1], cfg[2], principal, cors);
    const locs = route.match(/^\/enterprise\/([0-9a-f-]{36})\/locations$/);
    if (locs && method === 'GET') return handleEnterpriseLocations(locs[1], principal, cors);
    const rp = route.match(/^\/enterprise\/([0-9a-f-]{36})\/rollout\/prepare$/);
    if (rp && method === 'POST') return handleEnterpriseRolloutPrepare(req, rp[1], principal, cors);
    const au = route.match(/^\/enterprise\/([0-9a-f-]{36})\/audit$/);
    if (au && method === 'GET') return handleEnterpriseAudit(au[1], principal, cors);
    const ov = route.match(/^\/enterprise\/([0-9a-f-]{36})$/);
    if (ov && method === 'GET') return handleEnterpriseOverview(ov[1], principal, cors);
  }

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

  // 4b. A7.2 reviewer boundary: a client_reviewer (the client portal audience) may
  //     reach ONLY the shared feed + the approvals put to them. Everything else in
  //     the client gate is refused — the simplified portal is a real boundary, not
  //     a UI facade. Fast-path: sites with no extra members skip this entirely.
  {
    const siteRole = await resolveSiteRole(jwt, site.id, principal.kind);
    if (siteRole === 'client_reviewer' && !reviewerAllowed(route, method)) {
      return json({ error: 'forbidden', message: 'That lives in your studio’s full workspace — your client view shows what they’ve chosen to share.' }, 403, cors);
    }
  }

  // ── M11 boundary: Monitor sites observe an EXISTING external website.
  //    Publishing concepts don't exist for them — the platform never writes
  //    to a website it doesn't host. Everything else (profile, studio,
  //    coach, concierge) prepares guidance and stays available.
  if (site.edition === 'monitor' && (route === '/publish' || route === '/restore') && method === 'POST') {
    return json({ error: 'edition_monitor', message: 'Your website stays exactly where it is — this plan observes and guides, it never publishes. Upgrading adds hosting and publishing whenever you’re ready.' }, 403, cors);
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

  // ── AI Visual Studio (V1): brand-aware image generation, approval before use ──
  if (route === '/visual/kinds' && method === 'GET') return handleVisualKinds(cors);
  if (route === '/visual/generate' && method === 'POST') return handleVisualGenerate(req, site, principal, cors);
  if (route === '/visual/plans' && method === 'GET') return handleVisualList(site, cors);
  {
    const m = route.match(/^\/visual\/plans\/([0-9a-f-]{36})(\/vary|\/edit|\/decide)?$/);
    if (m) {
      if (!m[2] && method === 'GET') return handleVisualGet(site, m[1], cors);
      if (m[2] === '/vary' && method === 'POST') return handleVisualVary(req, site, m[1], cors);
      if (m[2] === '/edit' && method === 'POST') return handleVisualEdit(req, site, m[1], cors);
      if (m[2] === '/decide' && method === 'POST') return handleVisualDecide(req, site, m[1], principal, cors);
    }
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
  // ── A7: Workspace context, members, and client-visibility shares ──
  if (route === '/portal/context' && method === 'GET') return handlePortalContext(jwt, site, principal, cors);
  if (route === '/portal/feed' && method === 'GET') return handlePortalFeed(jwt, site, principal, cors);
  if (route === '/portal/members' && method === 'GET') return handleMembersList(jwt, site, principal, cors);
  if (route === '/portal/members' && method === 'POST') return handleMemberAdd(req, jwt, site, principal, cors);
  {
    const m = route.match(/^\/portal\/members\/([0-9a-f-]{36})\/revoke$/);
    if (m && method === 'POST') return handleMemberRevoke(jwt, site, m[1], principal, cors);
  }
  if (route === '/portal/shares' && method === 'GET') return handleSharesList(jwt, site, principal, cors);
  if (route === '/portal/shares' && method === 'POST') return handleShareSet(req, jwt, site, principal, cors);

  // ── Phase B: Developer Mode — safe presentation-layer authoring, gated by the
  //    use_developer_mode capability (operator OR developer role). Publishing,
  //    versioning, approval and isolation are unchanged — this only stores the
  //    validated/sanitized theme + CSS + HTML the developer authors.
  if (route === '/dev/files' && method === 'GET') return handleDevFiles(jwt, site, principal, cors);
  if (route === '/dev/customization' && method === 'GET') return handleDevCustomizationGet(jwt, site, principal, cors);
  if (route === '/dev/customization' && method === 'PUT') return handleDevCustomizationPut(req, jwt, site, principal, cors);

  // ── Phase C: the Client Relationship Center (CRM) — aggregates existing
  //    signals into one calm per-client view + relationship notes. Audience is
  //    studio-vs-client (existing principal/agency signals); reviewer is already
  //    refused. No new permission/visibility/navigation model.
  if (route === '/crm/profile' && method === 'GET') return handleCrmProfile(jwt, site, principal, cors);
  if (route === '/crm/timeline' && method === 'GET') return handleCrmTimeline(jwt, site, principal, cors);
  if (route === '/crm/notes' && method === 'GET') return handleCrmNotesList(jwt, site, principal, cors);
  if (route === '/crm/notes' && method === 'POST') return handleCrmNoteAdd(req, jwt, site, principal, cors);
  {
    const m = route.match(/^\/crm\/notes\/([0-9a-f-]{36})\/pin$/);
    if (m && method === 'POST') return handleCrmNotePin(req, jwt, site, principal, m[1], cors);
  }
  {
    const m = route.match(/^\/crm\/notes\/([0-9a-f-]{36})$/);
    if (m && method === 'DELETE') return handleCrmNoteDelete(jwt, site, principal, m[1], cors);
  }

  // ── Phase F: authed commercial routes — scheduled publish (FD-1), lead inbox
  //    (FD-2), notify client for one-tap approval (FD-3). Site-scoped via the gate.
  if (route === '/schedule' && method === 'POST') return handleScheduleCreate(req, site, principal, cors);
  if (route === '/schedule' && method === 'GET') return handleScheduleList(site, cors);
  {
    const m = route.match(/^\/schedule\/([0-9a-f-]{36})\/cancel$/);
    if (m && method === 'POST') return handleScheduleCancel(site, m[1], principal, cors);
  }
  if (route === '/forms/inbox' && method === 'GET') return handleFormInbox(site, cors);
  {
    const m = route.match(/^\/forms\/inbox\/([0-9a-f-]{36})$/);
    if (m && method === 'POST') return handleFormStatus(req, site, m[1], cors);
  }
  if (route === '/approve/send' && method === 'POST') return handleApproveSend(site, principal, cors);

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
  // ── M9.5B: the AI Editor (improve existing content; shares the Writer's proposal flow) ──
  if (route === '/editor/improve' && method === 'POST') return handleEditorImprove(req, site, cors);
  // ── M9.5C: the AI Reviewer (critique only; no write path to content exists) ──
  if (route === '/review/run' && method === 'POST') return handleReviewRun(req, site, cors);
  // ── M9.5D: the Brand Guardian (protects identity; findings only) ──
  if (route === '/brand/profile' && method === 'GET') return handleBrandProfileGet(jwt, site, cors);
  if (route === '/brand/profile' && method === 'PUT') return handleBrandProfilePut(req, jwt, site, principal, cors);
  if (route === '/brand/review' && method === 'POST') return handleBrandReviewRun(req, site, cors);
  if (route === '/brand/reports' && method === 'GET') return handleBrandReportList(jwt, site, cors);
  {
    const m = route.match(/^\/brand\/reports\/([0-9a-f-]{36})(\/dismiss)?$/);
    if (m && !m[2] && method === 'GET') return handleBrandReportGet(jwt, site, m[1], cors);
    if (m && m[2] === '/dismiss' && method === 'POST') return handleBrandReportDismiss(req, site, m[1], cors);
  }
  // ── M14: Presence Platform Services — ownership, launch, DNS documents, email posture ──
  if (route === '/export' && method === 'GET') return handleExport(site, principal, cors);
  if (route === '/launch' && method === 'GET') return handleLaunch(site, cors);
  if (route === '/foundations/dns' && method === 'GET') return handleDnsGet(jwt, site, cors);
  if (route === '/foundations/dns' && method === 'PUT') return handleDnsPut(req, site, principal, cors);
  if (route === '/foundations/dns/rollback' && method === 'POST') return handleDnsRollback(req, site, principal, cors);
  if (route === '/foundations/email' && method === 'GET') return handleEmailHealth(site, cors);
  if (route === '/monitor/import-inventory' && method === 'GET') return handleImportInventory(site, cors);
  // ── M12: Platform Services — the technical foundation, in plain words; changes only as approved plans ──
  if (route === '/foundations' && method === 'GET') return handleFoundationsGet(site, cors);
  if (route === '/foundations/prepare' && method === 'POST') return handleFoundationsPrepare(req, site, principal, cors);
  if (route === '/foundations/plans' && method === 'GET') return handleFoundationsPlans(jwt, site, cors);
  {
    const m = route.match(/^\/foundations\/plans\/([0-9a-f-]{36})\/decide$/);
    if (m && method === 'POST') return handleFoundationsDecide(req, site, m[1], principal, cors);
  }
  // ── M11: Presence Monitor connection (read-only observation of an existing website) ──
  if (route === '/monitor/connection' && method === 'GET') return handleMonitorGet(jwt, site, cors);
  if (route === '/monitor/connection' && method === 'DELETE') return handleMonitorDisconnect(site, principal, cors);
  if (route === '/monitor/connect' && method === 'POST') return handleMonitorConnect(req, site, principal, cors);
  if (route === '/monitor/verify' && method === 'POST') return handleMonitorVerify(site, principal, cors);
  if (route === '/monitor/readiness' && method === 'GET') return handleMonitorReadiness(site, cors);
  // ── M10: Business Knowledge Import (knowledge in, evidence out) ──
  if (route === '/knowledge/import' && method === 'POST') return handleKnowledgeImport(req, site, principal, cors);
  if (route === '/knowledge/docs' && method === 'GET') return handleKnowledgeList(jwt, site, cors);
  {
    const m = route.match(/^\/knowledge\/docs\/([0-9a-f-]{36})$/);
    if (m && method === 'DELETE') return handleKnowledgeDelete(site, m[1], principal, cors);
  }
  // ── L5.5: Industry Pack Marketplace — CUSTOMER features (per-site) ──
  if (route === '/marketplace/features' && method === 'GET') return handleMarketplaceFeatures(site, cors);
  // ── L4.0/L4.1: Connected Platform reads (connect/refresh/disconnect) ──
  if (route === '/connections' && method === 'GET') return handleConnectionsList(site, cors);
  // ── L4.3: Connected Platform WRITES — every write is an approval-gated plan ──
  {
    const m = route.match(/^\/connections\/([a-z0-9_]+)\/write(?:\/(prepare|[0-9a-f-]{36}))?(?:\/(decide|execute|rollback))?$/);
    if (m) {
      const key = m[1], seg = m[2], action = m[3];
      if (!seg && method === 'GET') return handleWriteList(site, key, cors);
      if (seg === 'prepare' && method === 'POST') return handleWritePrepare(req, site, key, principal, cors);
      if (seg && seg !== 'prepare' && action === 'decide' && method === 'POST') return handleWriteDecide(req, site, key, seg, principal, cors);
      if (seg && seg !== 'prepare' && action === 'execute' && method === 'POST') return handleWriteExecute(site, key, seg, principal, cors);
      if (seg && seg !== 'prepare' && action === 'rollback' && method === 'POST') return handleWriteRollback(site, key, seg, principal, cors);
    }
  }
  {
    const m = route.match(/^\/connections\/([a-z0-9_]+)(\/connect|\/callback|\/refresh|\/disconnect)?$/);
    if (m) {
      if (!m[2] && method === 'GET') return handleConnectionProfile(site, m[1], cors);
      if (m[2] === '/connect' && method === 'POST') return handleConnectionConnect(req, site, m[1], principal, cors);
      if (m[2] === '/callback' && method === 'POST') return handleConnectionCallback(req, site, m[1], principal, cors);
      if (m[2] === '/refresh' && method === 'POST') return handleConnectionRefresh(site, m[1], cors);
      if (m[2] === '/disconnect' && method === 'POST') return handleConnectionDisconnect(site, m[1], principal, cors);
    }
  }
  // ── M9.5E: the Growth Coach (observes, plans, prepares; never executes) ──
  if (route === '/coach/run' && method === 'POST') return handleCoachRun(site, cors);
  if (route === '/coach/opportunities' && method === 'GET') return handleCoachList(jwt, site, cors);
  {
    const m = route.match(/^\/coach\/opportunities\/([0-9a-f-]{36})\/decide$/);
    if (m && method === 'POST') return handleCoachDecide(req, site, m[1], cors);
  }
  if (route === '/review/reports' && method === 'GET') return handleReviewList(jwt, site, cors);
  {
    const m = route.match(/^\/review\/reports\/([0-9a-f-]{36})(\/dismiss)?$/);
    if (m && !m[2] && method === 'GET') return handleReviewGet(jwt, site, m[1], cors);
    if (m && m[2] === '/dismiss' && method === 'POST') return handleReviewDismiss(req, site, m[1], cors);
  }
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
