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
import type { SiteRow } from './lib/site.ts';
import { resolveScopedSite } from './lib/scope.ts';
import { checkEntitlement } from './middleware/entitlement.ts';
import { featureForRoute, requireFeature, loadEdition } from './middleware/feature.ts';
import { loadPlan, draftingDenial } from './commerce/enforce.ts';
import { handleGetSite, handleTemplatesList, handlePutTemplate } from './routes/site.ts';
import { handleSearchHealth, handleRedirectsList, handleRedirectCreate, handleRedirectDelete } from './routes/search.ts';
import { handleGetIdentity, handlePutIdentity } from './routes/identity.ts';
import { handlePreview } from './routes/preview.ts';
import { handlePreviewStatus, handlePreviewPublish, handlePreviewPromote, handlePreviewSettings, handlePublicPreview, handleSignedPreview, handlePreviewShareLink } from './routes/preview_env.ts';
import { handleSalesContacts, handleSalesDeals, handleSalesDeal, handleSalesDealStage, handleSalesProposalCreate, handleSalesProposalSend, handleSalesProposalDecide, handleSalesContractCreate, handleSalesContractSend, handleSalesContractSign, handleSalesConvert, handleSalesAddCustomer, handleSalesInvoice, handleSalesTemplates, handleSalesTemplateDelete, handleSalesServices, handleSalesPublicView, handleSalesDocument, handleSalesDocumentLink } from './routes/sales.ts';
import { handleProjects, handleProject, handleProjectReport, handleProjectStatus, handleTasksCreate, handleTask, handleMilestonesCreate, handleMilestone } from './routes/projects.ts';
import { handleDeliverableUploadUrl, handleDeliverablesCreate, handleDeliverable, handleDeliverableDownload, handleApprovalsCreate, handleApprovalDecide } from './routes/project_delivery.ts';
import { handleMessages, handleNotifications, handleNotificationsRead } from './routes/project_comms.ts';
import { handleProjectSurveys, handleSurvey, handleSurveyRespond, handleSupport, handleSupportOne, handleSupportMessage } from './routes/service_intake.ts';
import { handleClientProjects, handleClientProject, handleClientReport, handleClientMessages, handleClientDeliverableDownload, handleClientApprovalDecide, handleClientSurvey, handleClientSurveyRespond, handleClientNotifications, handleClientNotificationsRead, handleClientSupport, handleClientSupportOne, handleClientSupportMessage, handleClientBilling } from './routes/client_delivery.ts';
import { handlePublish, handleRestore, handlePublishHistory, handleVersionLabel } from './routes/publish.ts';
import { handleLaunchList, handleLaunchCreate, handleLaunchGet, handleLaunchRecapture, handleLaunchDecide, handleLaunchSchedule, handleLaunchPromote, handleLaunchRollback, handleLaunchCancel } from './routes/launches.ts';
import { handleMediaUpload, handleMediaUpdate, handleMediaDelete } from './routes/media.ts';
import { handleAssetsList, handleAssetsCollections, handleAssetsTags, handleAssetsHealth, handleAssetsDuplicates, handleAssetsUsage, handleAssetUpdate, handleAssetStatus, handleAssetDelete, handleAssetDetail, handleAssetDownload, handleAssetReplace, handleAssetRollback, handleAssetDuplicate } from './routes/assets.ts';
import { handleVisualKinds, handleVisualGenerate, handleVisualList, handleVisualGet, handleVisualVary, handleVisualEdit, handleVisualDecide } from './routes/visual.ts';
import { handleAdmin, handleDomain } from './routes/admin.ts';
import { handleCollection, handleLocation, handleVoice, handleSettings, handleBlockSuggestions, SPECS } from './routes/content.ts';
import { handleHealth, handleChanges, handleContentTree, handleNotesList, handleNoteResolve, handleRestoreToDraft, handleMediaList } from './routes/room.ts';
import { handleWebsiteTimeline } from './routes/timeline.ts';
import { handleAttentionCenter } from './routes/attention.ts';
import { handleWebsiteHealth } from './routes/health_page.ts';
import { handleUpcoming } from './routes/upcoming.ts';
import { handleApprovalCenter } from './routes/approvals_page.ts';
import { handleBusinessInsights } from './routes/insights_page.ts';
import { handleSnapshotHistory } from './routes/history_page.ts';
import { handleMomentsList, handleMomentDismiss } from './routes/moments.ts';
import { handlePortalContext, handlePortalFeed, handleMembersList, handleMemberAdd, handleMemberRevoke, handleSharesList, handleShareSet, reviewerAllowed } from './routes/workspace.ts';
import { handleDevFiles, handleDevCustomizationGet, handleDevCustomizationPut, handleBrandKitGet, handleBrandKitPut } from './routes/dev.ts';
import { handleStockSearch, handleStockImport } from './routes/stock.ts';
import { handleContentLibraryList, handleContentLibrarySave, handleContentLibraryDelete } from './routes/content_library.ts';
import { handleCrmProfile, handleCrmTimeline, handleCrmNotesList, handleCrmNoteAdd, handleCrmNotePin, handleCrmNoteDelete } from './routes/crm.ts';
import { handleScheduleCreate, handleScheduleList, handleScheduleCancel, handleFormSubmit, handleFormInbox, handleFormStatus, handleApproveSend, handleApproveGet, handleApprovePost } from './routes/commercial.ts';
import { resolveSiteRoleCached } from './lib/workspace.ts';
import { handleConciergeAsk } from './routes/concierge.ts';
import { handleWriterGenerate, handleWriterList, handleWriterGet, handleWriterAccept, handleWriterDiscard } from './routes/writer.ts';
import { handleEditorImprove } from './routes/editor.ts';
import { handleReviewRun, handleReviewList, handleReviewGet, handleReviewDismiss } from './routes/review.ts';
import { handleBrandProfileGet, handleBrandProfilePut, handleBrandReviewRun, handleBrandReportList, handleBrandReportGet, handleBrandReportDismiss } from './routes/brand.ts';
import { handleCoachRun, handleCoachList, handleCoachDecide, handleCoachHealth, handleCoachJourney, handleCoachMemory } from './routes/coach.ts';
import { handleAnalyticsHome, handleAnalyticsWebsite, handleAnalyticsCustomers, handleAnalyticsSearch, handleAnalyticsPortfolio } from './routes/analytics.ts';
import { handleCollect } from './routes/collect.ts';
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
  try {
    return await route_(req, cors);
  } catch (e) {
    // OBSERVABILITY: a request-path exception must land somewhere a human looks,
    // not just an ephemeral edge log. Best-effort ledger write; always returns a
    // clean 500 (never leaks a stack to the caller).
    const msg = String((e as Error)?.stack || (e as Error)?.message || e).slice(0, 800);
    try {
      const SB = Deno.env.get('SUPABASE_URL') || '';
      const KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      if (SB && KEY) {
        await fetch(`${SB}/rest/v1/ops_errors`, {
          method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ kind: `presence:${req.method} ${routeOf(req.url)}`, detail: msg }),
        });
      }
    } catch { /* the ledger write is itself best-effort */ }
    console.error(`[presence] unhandled: ${msg}`);
    return json({ error: 'server_error', message: 'Something went wrong on our side — please try again in a moment.' }, 500, cors);
  }
});

async function route_(req: Request, cors: Record<string, string>): Promise<Response> {
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
    const agencyJwt = req.headers.get('x-dds-user-jwt') || '';
    const member = await resolveAgencyMember(agencyJwt);
    if (!member) {
      // Distinguish "not signed in" (401 → the door) from "signed in, but this
      // account has no agency" (403 → honest copy) — a valid session must never
      // be told to sign in again.
      const authed = agencyJwt && (principal.kind === 'client' || principal.kind === 'staff');
      if (authed) return json({ error: 'forbidden', message: 'This account isn’t part of an agency.' }, 403, cors);
      return json({ error: 'unauthorized', message: 'Please sign in with an agency account.' }, 401, cors);
    }
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
  // ── AN-2: the first-party analytics collector — PUBLIC, pre-auth, authorized
  //    by the site id itself. Privacy-first, bot-dropping, always 204. ──
  {
    const m = route.match(/^\/px\/([0-9a-f-]{36})$/);
    if (m && method === 'POST') return handleCollect(req, m[1], cors);
  }
  if (route === '/approve' && method === 'GET') return handleApproveGet(req, cors);
  if (route === '/approve' && method === 'POST') return handleApprovePost(req, cors);
  // ── P2-C: PUBLIC proposal/contract review + accept/sign, authorized ONLY by a
  //    signed link (site_id is inside the token) — pre-auth, tenant-safe. ──
  {
    let m = route.match(/^\/sales\/(?:p|c|view)\/(.+)$/);
    if (m && method === 'GET') return handleSalesPublicView(req, m[1], cors);
    // The branded, print-ready Document of Record — server-rendered HTML, opened
    // directly in a browser and saved as PDF. Authorized ONLY by a signed `doc`
    // token (site_id inside it); renders existing immutable rows, never mutates.
    m = route.match(/^\/sales\/doc\/(.+)$/);
    if (m && method === 'GET') return handleSalesDocument(req, m[1], cors);
    m = route.match(/^\/sales\/proposals\/([0-9a-f-]{36})\/decide$/);
    if (m && method === 'POST') return handleSalesProposalDecide(req, m[1], cors);
    m = route.match(/^\/sales\/contracts\/([0-9a-f-]{36})\/sign$/);
    if (m && method === 'POST') return handleSalesContractSign(req, m[1], cors);
  }
  // ── M8: the SIGNED, time-limited preview link — pre-auth, authorized ONLY by
  //    a valid unexpired HMAC signature over {site_id, exp}. Matched before the
  //    opaque door (its token carries a '.' + non-hex, so they never collide). ──
  {
    const m = route.match(/^\/p\/s\/(.+)$/);
    if (m && method === 'GET') return handleSignedPreview(req, m[1], cors);
  }
  // ── FD-T20: the PUBLIC, shareable preview URL — pre-auth, authorized by the
  //    token itself (+ optional password); rendered through the ONE engine. ──
  {
    const m = route.match(/^\/p\/([0-9a-f]{16,80})$/i);
    if (m && method === 'GET') return handlePublicPreview(req, m[1], cors);
  }

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

  // Web Push: the VAPID public key is public by design (the browser needs it to
  // subscribe). Served before the auth gate so the enable-notifications prompt
  // can read it without a round-trip through context.
  if (route === '/push/key' && method === 'GET') {
    const { pushConfigured } = await import('./lib/webpush.ts');
    return json({ data: { enabled: pushConfigured(), key: pushConfigured() ? (Deno.env.get('VAPID_PUBLIC_KEY') || '') : '' } }, 200, cors);
  }

  // Email infrastructure (public by design): the one-click unsubscribe a
  // recipient reaches from any email (no account needed — token-authenticated),
  // and the Resend bounce/complaint webhook (svix-signed, gated on its secret).
  if (route === '/unsubscribe' && (method === 'GET' || method === 'POST')) {
    const { handleUnsubscribe } = await import('./routes/email_infra.ts');
    return handleUnsubscribe(req, method);
  }
  if (route === '/email/events' && method === 'POST') {
    const { handleResendEvents } = await import('./routes/email_infra.ts');
    return handleResendEvents(req);
  }

  if (principal.kind !== 'client' && principal.kind !== 'staff') {
    return json({ error: 'unauthorized', message: 'Please sign in.' }, 401, cors);
  }
  const jwt = principal.jwt || '';

  // Web Push subscribe/unsubscribe — authed; stores the caller's browser endpoint.
  if (route === '/push/subscribe' && method === 'POST') {
    const { handlePushSubscribe } = await import('./routes/push.ts');
    return handlePushSubscribe(req, principal, cors);
  }
  if (route === '/push/unsubscribe' && method === 'POST') {
    const { handlePushUnsubscribe } = await import('./routes/push.ts');
    return handlePushUnsubscribe(req, principal, cors);
  }

  // ── ADMIN routes (M6): staff-only, operate on any site by id, sit BEFORE
  //    the caller-site resolution (staff own no site). Entitlement never
  //    applies to admin (bypass); role proven by the principal, fail-closed.
  if (route === '/admin' || route.startsWith('/admin/')) {
    if (principal.kind !== 'staff') return json({ error: 'forbidden', message: 'Staff only.' }, 403, cors);
    const resp = await handleAdmin(req, route, method, principal, cors);
    if (resp) return resp;
    return json({ error: 'not_found', message: `No admin route for ${method} ${route}.` }, 404, cors);
  }

  // ── AN-7: agency-scope Analytics — an agency member owns no site, so this is
  //    resolved from the JWT (portfolio rollup) BEFORE caller-site resolution.
  if (route === '/analytics/portfolio' && method === 'GET') return handleAnalyticsPortfolio(jwt, cors);

  // 3. resolve the caller's site. Un-scoped: RLS confines to the caller's OWN
  //    site. Scoped (SC-1): an agency operator drilled into a client — the
  //    x-dds-scope-site header is a REQUEST, re-validated here against agency
  //    authorization and FAIL-CLOSED (never falls back to another tenant).
  let site: SiteRow | null;
  let scopedName: string | null = null;
  const scopeReq = req.headers.get('x-dds-scope-site');
  if (scopeReq) {
    // SC-2: pass the operator identity + request metadata so the drill-in is
    // recorded (allowed AND denied). No token, no body — resolveScopedSite logs
    // only the fields it is handed, best-effort, without gating this decision.
    const sc = await resolveScopedSite(jwt, scopeReq, {
      operatorUserId: principal.userId, operatorEmail: principal.email,
      route, method, requestId: principal.requestId,
      ip: req.headers.get('x-forwarded-for') || '', userAgent: req.headers.get('user-agent') || '',
    });
    if (!sc.ok) return json({ error: 'scope_denied', message: 'You don’t have access to that client.' }, sc.status, cors);
    site = sc.site; scopedName = sc.scoped.name;
  } else {
    site = await resolveSite(jwt);
    // MEMBERSHIP fallback: an invited member (client_reviewer / staff seat) owns
    // no site of their own — RLS returns nothing. Resolve via their active
    // membership instead; every in-site power still flows through resolveSiteRole
    // + the reviewer boundary below (fail-closed).
    if (!site && (principal.userId || principal.email)) {
      try {
        const { svc } = await import('./lib/db.ts');
        const or = `or=(user_id.eq.${encodeURIComponent(principal.userId || '00000000-0000-0000-0000-000000000000')},email.eq.${encodeURIComponent((principal.email || '').toLowerCase())})`;
        const m = await svc(`presence_site_members?status=eq.active&${or}&select=site_id&order=created_at.asc&limit=1`);
        const siteId = Array.isArray(m.json) && (m.json as any[])[0]?.site_id;
        if (siteId) {
          const s = await svc(`presence_sites?id=eq.${siteId}&select=id,client_id,status,last_published_at,template_slug,template_version,custom_domain,netlify_site_id,edition&limit=1`);
          if (Array.isArray(s.json) && (s.json as any[])[0]) site = (s.json as any[])[0] as SiteRow;
        }
      } catch { /* fail closed to no_site */ }
    }
  }
  if (!site) {
    return json({ error: 'no_site', message: 'No Presence site is set up for this account yet.' }, 404, cors);
  }

  // 4. entitlement gate (boundary; outside RLS)
  const ent = await checkEntitlement(principal, site.client_id);
  if (ent.mode === 'denied') {
    // Phase RL: the right to leave survives lapsing — a customer whose
    // subscription ended can ALWAYS take their data. Export only; read-only.
    if (route === '/export' && method === 'GET') {
      return handleExport(site, principal, cors);
    }
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
    const siteRole = await resolveSiteRoleCached(principal, jwt, site.id);
    if (siteRole === 'client_reviewer' && !reviewerAllowed(route, method)) {
      return json({ error: 'forbidden', message: 'That lives in your studio’s full workspace — your client view shows what they’ve chosen to share.' }, 403, cors);
    }
  }

  // ── M11 boundary: Monitor sites observe an EXISTING external website.
  //    Publishing concepts don't exist for them — the platform never writes
  //    to a website it doesn't host. Everything else (profile, studio,
  //    coach, concierge) prepares guidance and stays available.
  //    "Monitor never drafts" is now true at the boundary, not merely hidden in the
  //    nav: reads of the website area are fine, but ANY write to a website-authoring
  //    route (publish/restore/launches AND content edits — offerings, media, identity,
  //    etc.) is refused for an observe-only monitor site. Non-website writes it
  //    legitimately makes (connections, notes, settings) are unaffected.
  if (site.edition === 'monitor' && (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') && featureForRoute(route, method) === 'website') {
    return json({ error: 'edition_monitor', message: 'Your website stays exactly where it is — this plan watches and guides, it never edits or publishes. Upgrading adds editing and publishing whenever you’re ready.' }, 403, cors);
  }

  // ── Phase FE-1: FEATURE-boundary enforcement (outside RLS; mirrors buildNav).
  //    The site's edition (from its entitlement plan) decides which capability
  //    AREAS exist at all — CMS-only cannot reach Customers, Business-OS-only
  //    cannot reach the website, and so on. Baseline/shell routes map to null and
  //    are always allowed; supersets (Studio OS+) never deny. Applies to the
  //    operator too when scoped into a client (bounded by that client's plan).
  {
    const needed = featureForRoute(route, method);
    if (needed) {
      const edition = await loadEdition(principal, site.client_id, site.edition);
      const denial = requireFeature(edition, needed, cors);
      if (denial) return denial;
    }
  }

  // ── Phase FE-1: Visual Studio CREATES brand assets → drafting-class. It sits in
  //    the website area (feature-gated above), but generation must also honor the
  //    drafting boundary, so an observe-only Monitor site cannot generate. List /
  //    get / decide stay available (reviewing existing assets is not creation).
  if (method === 'POST' && (route === '/visual/generate' || /^\/visual\/plans\/[0-9a-f-]{36}\/(vary|edit)$/.test(route))) {
    const denial = draftingDenial(await loadPlan(site.client_id), cors);
    if (denial) return denial;
  }

  // 5. router — exact routes only
  if (route === '/site' && method === 'GET') return handleGetSite(jwt, site, cors);
  if (route === '/site/templates' && method === 'GET') return handleTemplatesList(site, cors);            // Phase CP-1
  if (route === '/search/health' && method === 'GET') return handleSearchHealth(site, cors);              // Phase SD
  if (route === '/redirects' && method === 'GET') return handleRedirectsList(site, cors);                 // Phase SD
  if (route === '/redirects' && method === 'POST') return handleRedirectCreate(req, site, principal, cors);
  {
    const rm = route.match(/^\/redirects\/([0-9a-f-]{36})$/);
    if (rm && method === 'DELETE') return handleRedirectDelete(site, principal, rm[1], cors);
  }
  if (route === '/site/template' && method === 'PUT') return handlePutTemplate(req, jwt, site, principal, cors); // Phase CP-1
  if (route === '/identity' && method === 'GET') return handleGetIdentity(jwt, site, cors);
  if (route === '/identity' && method === 'PUT') return handlePutIdentity(req, jwt, site, principal, cors);
  if (route === '/preview' && method === 'GET') return handlePreview(req, site, cors);
  // ── FD-T20/T21: Draft → Preview → Live management (authed) ──
  if (route === '/preview/status' && method === 'GET') return handlePreviewStatus(site, cors);
  if (route === '/preview/publish' && method === 'POST') return handlePreviewPublish(site, principal, cors);
  if (route === '/preview/promote' && method === 'POST') return handlePreviewPromote(site, principal, cors);
  if (route === '/preview/settings' && method === 'POST') return handlePreviewSettings(req, site, principal, cors);
  if (route === '/preview/share-link' && method === 'POST') return handlePreviewShareLink(req, site, principal, cors); // M8: mint a signed, time-limited link
  if (route === '/publish' && method === 'POST') return handlePublish(req, site, principal, cors);
  if (route === '/restore' && method === 'POST') return handleRestore(req, site, principal, cors);
  if (route === '/publishes' && method === 'GET') return handlePublishHistory(site, cors);
  // ── FD-T7: Launches — named staged releases through the ONE pipeline ──
  if (route === '/launches' && method === 'GET') return handleLaunchList(site, cors);
  if (route === '/launches' && method === 'POST') return handleLaunchCreate(req, site, principal, cors);
  {
    const m = route.match(/^\/launches\/([0-9a-f-]{36})(\/recapture|\/decide|\/schedule|\/promote|\/rollback|\/cancel)?$/);
    if (m) {
      const lid = m[1], act = m[2];
      if (!act && method === 'GET') return handleLaunchGet(site, lid, cors);
      if (act === '/recapture' && method === 'POST') return handleLaunchRecapture(site, principal, lid, cors);
      if (act === '/decide' && method === 'POST') return handleLaunchDecide(req, jwt, site, principal, lid, cors);
      if (act === '/schedule' && method === 'POST') return handleLaunchSchedule(req, site, principal, lid, cors);
      if (act === '/promote' && method === 'POST') return handleLaunchPromote(site, principal, lid, cors);
      if (act === '/rollback' && method === 'POST') return handleLaunchRollback(site, principal, lid, cors);
      if (act === '/cancel' && method === 'POST') return handleLaunchCancel(site, principal, lid, cors);
    }
  }
  {
    const m = route.match(/^\/publishes\/([0-9a-f-]{36})\/label$/);
    if (m && method === 'POST') return handleVersionLabel(req, site, principal, m[1], cors);   // Phase AA FD-7
  }
  if (route === '/media/upload-url' && method === 'POST') return handleMediaUpload(req, site, principal, cors);
  {
    const m = route.match(/^\/media\/([0-9a-f-]{36})$/);
    if (m && method === 'DELETE') return handleMediaDelete(site, principal, m[1], cors);
    if (m && method === 'PUT') return handleMediaUpdate(req, site, principal, m[1], cors);   // Phase O: edit alt text
  }

  // ── FD-T10: Stock Library — browse a royalty-free source + import into Files ──
  if (route === '/stock/search' && method === 'GET') return handleStockSearch(req, cors);
  if (route === '/stock/import' && method === 'POST') return handleStockImport(req, site, principal, cors);

  // ── CL-1: Content Library — reusable structured blocks (one block model) ──
  if (route === '/content-library' && method === 'GET') return handleContentLibraryList(site, cors);
  if (route === '/content-library' && method === 'POST') return handleContentLibrarySave(req, site, principal, cors);
  {
    const m = route.match(/^\/content-library\/([0-9a-f-]{36})$/);
    if (m && method === 'DELETE') return handleContentLibraryDelete(site, principal, m[1], cors);
  }

  // ── Phase DAM: the Studio Asset Library (lens + lifecycle over presence_media) ──
  if (route === '/assets' && method === 'GET') return handleAssetsList(req, site, cors);
  if (route === '/assets/collections' && method === 'GET') return handleAssetsCollections(site, cors);
  if (route === '/assets/tags' && method === 'GET') return handleAssetsTags(site, cors);
  if (route === '/assets/health' && method === 'GET') return handleAssetsHealth(site, cors);
  if (route === '/assets/duplicates' && method === 'GET') return handleAssetsDuplicates(site, cors);
  if (route === '/assets/usage' && method === 'GET') return handleAssetsUsage(site, cors);
  {
    const ms = route.match(/^\/assets\/([0-9a-f-]{36})\/status$/);
    if (ms && method === 'POST') return handleAssetStatus(req, site, principal, ms[1], cors);
    const mdl = route.match(/^\/assets\/([0-9a-f-]{36})\/download$/);
    if (mdl && method === 'GET') return handleAssetDownload(site, mdl[1], cors);
    const mr = route.match(/^\/assets\/([0-9a-f-]{36})\/replace$/);
    if (mr && method === 'POST') return handleAssetReplace(req, site, principal, mr[1], cors);
    const mb = route.match(/^\/assets\/([0-9a-f-]{36})\/rollback$/);
    if (mb && method === 'POST') return handleAssetRollback(site, principal, mb[1], cors);
    const mdup = route.match(/^\/assets\/([0-9a-f-]{36})\/duplicate$/);
    if (mdup && method === 'POST') return handleAssetDuplicate(site, principal, mdup[1], cors);
    const m = route.match(/^\/assets\/([0-9a-f-]{36})$/);
    if (m && method === 'GET') return handleAssetDetail(site, m[1], cors);
    if (m && method === 'PATCH') return handleAssetUpdate(req, site, principal, m[1], cors);
    if (m && method === 'DELETE') return handleAssetDelete(site, principal, m[1], cors);
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
  if (route === '/content-tree' && method === 'GET') return handleContentTree(site, cors);
  if (route === '/website-timeline' && method === 'GET') return handleWebsiteTimeline(site, cors);
  if (route === '/attention' && method === 'GET') return handleAttentionCenter(site, cors);
  if (route === '/website-health' && method === 'GET') return handleWebsiteHealth(site, cors);
  if (route === '/upcoming' && method === 'GET') return handleUpcoming(site, cors);
  if (route === '/approval-center' && method === 'GET') return handleApprovalCenter(site, cors);
  if (route === '/business-insights' && method === 'GET') return handleBusinessInsights(site, cors);
  if (route === '/snapshot-history' && method === 'GET') return handleSnapshotHistory(site, cors);
  if (route === '/notes' && method === 'GET') return handleNotesList(site, cors);
  {
    const m = route.match(/^\/notes\/([0-9a-f-]{36})\/(dismiss|accept)$/);
    if (m && method === 'POST') return handleNoteResolve(site, principal, m[1], m[2] === 'accept' ? 'accepted' : 'dismissed', cors);
  }
  if (route === '/restore-to-draft' && method === 'POST') return handleRestoreToDraft(req, site, principal, cors);
  // ── P2-C: Sales & Customer Lifecycle (authed, site-scoped). One coherent
  //    /sales/* resource surface. Public token actions are handled pre-auth above. ──
  if (route === '/sales/contacts') return handleSalesContacts(req, site, principal, cors);
  // Add an EXISTING customer directly — no deal/sign/convert ceremony. Studio-gated
  // like every /sales/* route (relationship feature + the reviewer boundary above).
  if (route === '/sales/customers' && method === 'POST') return handleSalesAddCustomer(req, site, principal, cors);
  // The studio's own services catalog (name + price) that proposal line items are
  // picked from — studio-gated like every /sales/* route (relationship feature + the
  // reviewer boundary above), site-scoped to the studio issuing proposals.
  if (route === '/sales/services' && (method === 'GET' || method === 'PUT')) return handleSalesServices(req, site, principal, cors);
  if (route === '/sales/deals') return handleSalesDeals(req, site, principal, cors);
  {
    let m = route.match(/^\/sales\/deals\/([0-9a-f-]{36})$/);
    if (m) return handleSalesDeal(req, site, principal, m[1], cors);
    m = route.match(/^\/sales\/deals\/([0-9a-f-]{36})\/stage$/);
    if (m && method === 'POST') return handleSalesDealStage(req, site, principal, m[1], cors);
    m = route.match(/^\/sales\/deals\/([0-9a-f-]{36})\/proposals$/);
    if (m && method === 'POST') return handleSalesProposalCreate(req, site, principal, m[1], cors);
    m = route.match(/^\/sales\/deals\/([0-9a-f-]{36})\/contracts$/);
    if (m && method === 'POST') return handleSalesContractCreate(req, site, principal, m[1], cors);
    m = route.match(/^\/sales\/deals\/([0-9a-f-]{36})\/convert$/);
    if (m && method === 'POST') return handleSalesConvert(req, site, principal, m[1], cors);
    m = route.match(/^\/sales\/deals\/([0-9a-f-]{36})\/invoice$/);
    if (m && method === 'POST') return handleSalesInvoice(req, site, principal, m[1], cors);
    if (route === '/sales/templates' && (method === 'GET' || method === 'POST')) return handleSalesTemplates(req, site, principal, cors);
    m = route.match(/^\/sales\/templates\/([0-9a-f-]{36})$/);
    if (m && method === 'DELETE') return handleSalesTemplateDelete(site, m[1], cors);
    m = route.match(/^\/sales\/proposals\/([0-9a-f-]{36})\/send$/);
    if (m && method === 'POST') return handleSalesProposalSend(req, site, principal, m[1], cors);
    m = route.match(/^\/sales\/contracts\/([0-9a-f-]{36})\/send$/);
    if (m && method === 'POST') return handleSalesContractSend(req, site, principal, m[1], cors);
    // Mint the printable Document-of-Record URL for the deal drawer (proposal /
    // contract / invoice). Studio-gated & site-scoped like every authed /sales/*.
    m = route.match(/^\/sales\/(proposals|contracts|invoices)\/([0-9a-f-]{36})\/document$/);
    if (m && method === 'GET') return handleSalesDocumentLink(site, (m[1] === 'invoices' ? 'invoice' : m[1] === 'contracts' ? 'contract' : 'proposal'), m[2], cors);
  }
  // ── P2-D: Service Delivery (authed, site-scoped). One coherent /projects/*
  //    resource surface — projects · tasks · milestones · activity. Studio side
  //    manages; the client side reads only client_visible rows (enforced in the
  //    handlers). All access is site_id-scoped for tenant isolation. ──
  if (route === '/projects') return handleProjects(req, jwt, site, principal, cors);
  {
    let m = route.match(/^\/projects\/([0-9a-f-]{36})$/);
    if (m) return handleProject(req, jwt, site, principal, m[1], cors);
    m = route.match(/^\/projects\/([0-9a-f-]{36})\/report$/);
    if (m && method === 'GET') return handleProjectReport(req, jwt, site, principal, m[1], cors);
    m = route.match(/^\/projects\/([0-9a-f-]{36})\/status$/);
    if (m && method === 'POST') return handleProjectStatus(req, jwt, site, principal, m[1], cors);
    m = route.match(/^\/projects\/([0-9a-f-]{36})\/tasks$/);
    if (m && method === 'POST') return handleTasksCreate(req, jwt, site, principal, m[1], cors);
    m = route.match(/^\/projects\/([0-9a-f-]{36})\/tasks\/([0-9a-f-]{36})$/);
    if (m && method === 'PATCH') return handleTask(req, jwt, site, principal, m[1], m[2], cors);
    m = route.match(/^\/projects\/([0-9a-f-]{36})\/milestones$/);
    if (m && method === 'POST') return handleMilestonesCreate(req, jwt, site, principal, m[1], cors);
    m = route.match(/^\/projects\/([0-9a-f-]{36})\/milestones\/([0-9a-f-]{36})$/);
    if (m && method === 'PATCH') return handleMilestone(req, jwt, site, principal, m[1], m[2], cors);
    // P2-D-2: deliverables (files overlay) + approvals
    m = route.match(/^\/projects\/([0-9a-f-]{36})\/deliverables\/upload-url$/);
    if (m && method === 'POST') return handleDeliverableUploadUrl(req, jwt, site, principal, m[1], cors);
    m = route.match(/^\/projects\/([0-9a-f-]{36})\/deliverables$/);
    if (m && method === 'POST') return handleDeliverablesCreate(req, jwt, site, principal, m[1], cors);
    m = route.match(/^\/projects\/([0-9a-f-]{36})\/deliverables\/([0-9a-f-]{36})\/download$/);
    if (m && method === 'GET') return handleDeliverableDownload(req, jwt, site, principal, m[1], m[2], cors);
    m = route.match(/^\/projects\/([0-9a-f-]{36})\/deliverables\/([0-9a-f-]{36})$/);
    if (m && (method === 'PATCH' || method === 'DELETE')) return handleDeliverable(req, jwt, site, principal, m[1], m[2], cors);
    m = route.match(/^\/projects\/([0-9a-f-]{36})\/approvals$/);
    if (m && method === 'POST') return handleApprovalsCreate(req, jwt, site, principal, m[1], cors);
    m = route.match(/^\/approvals\/([0-9a-f-]{36})\/decide$/);
    if (m && method === 'POST') return handleApprovalDecide(req, jwt, site, principal, m[1], cors);
    // P2-D-3: project messages
    m = route.match(/^\/projects\/([0-9a-f-]{36})\/messages$/);
    if (m && (method === 'GET' || method === 'POST')) return handleMessages(req, jwt, site, principal, m[1], cors);
    // P2-D-4: project surveys
    m = route.match(/^\/projects\/([0-9a-f-]{36})\/surveys$/);
    if (m && (method === 'GET' || method === 'POST')) return handleProjectSurveys(req, jwt, site, principal, m[1], cors);
    m = route.match(/^\/surveys\/([0-9a-f-]{36})$/);
    if (m && method === 'GET') return handleSurvey(req, jwt, site, principal, m[1], cors);
    m = route.match(/^\/surveys\/([0-9a-f-]{36})\/respond$/);
    if (m && method === 'POST') return handleSurveyRespond(req, jwt, site, principal, m[1], cors);
  }
  // P2-D-4: support
  if (route === '/support' && (method === 'GET' || method === 'POST')) return handleSupport(req, jwt, site, principal, cors);
  {
    let m = route.match(/^\/support\/([0-9a-f-]{36})$/);
    if (m && (method === 'GET' || method === 'PATCH')) return handleSupportOne(req, jwt, site, principal, m[1], cors);
    m = route.match(/^\/support\/([0-9a-f-]{36})\/messages$/);
    if (m && method === 'POST') return handleSupportMessage(req, jwt, site, principal, m[1], cors);
  }
  // P2-D-3: notifications (derived from the activity log + a per-reader last-seen)
  if (route === '/notifications' && method === 'GET') return handleNotifications(req, jwt, site, principal, cors);
  if (route === '/notifications/read' && method === 'POST') return handleNotificationsRead(req, jwt, site, principal, cors);
  // ── P2-D hardening: the CLIENT App's service-delivery view (Agency–Client
  //    Bridge). The customer is on THEIR OWN site; every action resolves their
  //    client + verifies a service_link before touching agency-site data. ──
  if (route === '/client/projects' && method === 'GET') return handleClientProjects(req, site, principal, cors);
  if (route === '/client/billing' && method === 'GET') return handleClientBilling(req, site, principal, cors);
  if (route === '/client/notifications' && method === 'GET') return handleClientNotifications(req, site, principal, cors);
  if (route === '/client/notifications/read' && method === 'POST') return handleClientNotificationsRead(req, site, principal, cors);
  if (route === '/client/support' && (method === 'GET' || method === 'POST')) return handleClientSupport(req, site, principal, cors);
  {
    let m = route.match(/^\/client\/projects\/([0-9a-f-]{36})$/);
    if (m && method === 'GET') return handleClientProject(req, site, principal, m[1], cors);
    m = route.match(/^\/client\/projects\/([0-9a-f-]{36})\/report$/);
    if (m && method === 'GET') return handleClientReport(req, site, principal, m[1], cors);
    m = route.match(/^\/client\/projects\/([0-9a-f-]{36})\/messages$/);
    if (m && (method === 'GET' || method === 'POST')) return handleClientMessages(req, site, principal, m[1], cors);
    m = route.match(/^\/client\/deliverables\/([0-9a-f-]{36})\/download$/);
    if (m && method === 'GET') return handleClientDeliverableDownload(req, site, principal, m[1], cors);
    m = route.match(/^\/client\/approvals\/([0-9a-f-]{36})\/decide$/);
    if (m && method === 'POST') return handleClientApprovalDecide(req, site, principal, m[1], cors);
    m = route.match(/^\/client\/surveys\/([0-9a-f-]{36})$/);
    if (m && method === 'GET') return handleClientSurvey(req, site, principal, m[1], cors);
    m = route.match(/^\/client\/surveys\/([0-9a-f-]{36})\/respond$/);
    if (m && method === 'POST') return handleClientSurveyRespond(req, site, principal, m[1], cors);
    m = route.match(/^\/client\/support\/([0-9a-f-]{36})$/);
    if (m && method === 'GET') return handleClientSupportOne(req, site, principal, m[1], cors);
    m = route.match(/^\/client\/support\/([0-9a-f-]{36})\/messages$/);
    if (m && method === 'POST') return handleClientSupportMessage(req, site, principal, m[1], cors);
  }
  // ── A7: Workspace context, members, and client-visibility shares ──
  if (route === '/portal/context' && method === 'GET') return handlePortalContext(jwt, site, principal, cors, scopedName);
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
  if (route === '/dev/brand-kit' && method === 'GET') return handleBrandKitGet(jwt, site, principal, cors);      // FD-T9
  if (route === '/dev/brand-kit' && method === 'PUT') return handleBrandKitPut(req, jwt, site, principal, cors);  // FD-T9

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
  // Self-serve custom domain (the caller's OWN site) — reuses the complete domain
  // core (attach → SSL → live DNS status). Reviewer boundary above already blocks
  // client_reviewers; a site owner or an operator scoped into the client reaches it.
  if (route === '/foundations/domain' && (method === 'GET' || method === 'POST' || method === 'DELETE')) {
    const r = await handleDomain(req, method, site, principal, cors);
    return r || json({ error: 'method_not_allowed' }, 405, cors);
  }
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
  // ── AN-1: Analytics — plain-English understanding composed from stored signals
  //    (no new engine, no new AI, no fabricated numbers). Site-scoped surfaces.
  if (route === '/analytics' && method === 'GET') return handleAnalyticsHome(req, site, cors);
  if (route === '/analytics/website' && method === 'GET') return handleAnalyticsWebsite(req, site, cors);
  if (route === '/analytics/customers' && method === 'GET') return handleAnalyticsCustomers(req, site, cors);
  if (route === '/analytics/search' && method === 'GET') return handleAnalyticsSearch(req, site, cors);

  // ── M9.5E: the Growth Coach (observes, plans, prepares; never executes) ──
  if (route === '/coach/run' && method === 'POST') return handleCoachRun(site, cors);
  if (route === '/coach/health' && method === 'GET') return handleCoachHealth(site, cors);       // PT-6 Business Health Coach
  if (route === '/coach/journey' && method === 'GET') return handleCoachJourney(site, cors);     // PT-7 Customer Timeline
  if (route === '/coach/memory' && method === 'GET') return handleCoachMemory(site, cors);       // PT-9 AI Business Memory
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
  if (route === '/blocks/suggested' && method === 'GET') return handleBlockSuggestions(site, cors);   // FD-T4 vertical presets
  {
    const m = route.match(/^\/(offerings|testimonials|faqs|posts)(?:\/([0-9a-f-]{36}))?$/);
    if (m && m[1] in SPECS) { const r = await handleCollection(req, jwt, site, principal, m[1], m[2] ?? null, cors); if (r) return r; }
  }

  return json({ error: 'not_found', message: `No route for ${method} ${route}.` }, 404, cors);
}
