// ── Presence edge function — the app's whole API ─────────────────────────────
// Reuses _shared for CORS, the json helper, and auth/principal resolution.
// This function does NOT duplicate any middleware already in _shared.
//
// Boundary order, every request (route_ below):
//   1. CORS / OPTIONS
//   2. /system/* — the scheduler, gated by its own secret, before any sign-in
//   3. resolvePrincipal (shared); /agency/* resolves its member and leaves here
//   4. routes that carry their own authority: /commerce, public pages and posts
//      (a signed token, or the site a visitor's form, booking, review or visit
//      names), signed webhooks, and the operators' marketplace and enterprise
//   5. signed in as staff or a client, else 401; staff admin, the agency
//      portfolio and help need no site and answer next
//   6. the caller's site: their own via RLS, a studio's scope re-checked (never
//      falling back to another site), or an invited member's seat
//   7. entitlement (full / readonly / denied), the reviewer boundary, the member
//      write gate (lib/site_roles.ts), then the Monitor and edition feature gates
//   8. exact method + path routes, else 404
//
// The route groups most requests never reach load on first use (lib/lazy.ts):
// a cold start evaluates the boundary and the everyday routes, not every file.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsFor, visitorCors } from '../_shared/cors.ts';
import { VISITOR_ROUTE } from './lib/site_send.ts';
import { json } from '../_shared/http.ts';
import { noteDraftBefore, withDraftVersion } from './lib/optimistic_lock.ts';
import { resolvePrincipal } from '../_shared/auth.ts';
import { resolveSite } from './lib/site.ts';
import type { SiteRow } from './lib/site.ts';
import { resolveScopedSite } from './lib/scope.ts';
import { lazyRoutes } from './lib/lazy.ts';
import { siteDb } from './lib/db.ts';
import { checkEntitlement } from './middleware/entitlement.ts';
import { featureForRoute, requireFeature, loadEdition } from './middleware/feature.ts';
import { loadPlan, draftingDenial } from './commerce/enforce.ts';
import { handleGetSite, handleTemplatesList, handlePutTemplate } from './routes/site.ts';
import { handleSearchHealth, handleRedirectsList, handleRedirectCreate, handleRedirectSuggest, handleRedirectDelete } from './routes/search.ts';
import { handleGetIdentity, handlePutIdentity } from './routes/identity.ts';
import { handlePreview, handlePreviewSection } from './routes/preview.ts';
import { handlePreviewStatus, handlePreviewPublish, handlePreviewPromote, handlePreviewSettings, handlePublicPreview, handlePublicPreviewOpen, handleSignedPreview, handlePreviewShareLink } from './routes/preview_env.ts';
import { handleDealTasksList, handleDealTaskCreate, handleDealTaskUpdate, handleSalesDeleted, handleSalesRestoreDeal } from './routes/sales.ts';
import { handleSalesSummary, handleSalesMyTasks, handleSalesReports, handleSalesViews, handleSalesStages, handleSalesReceivables, handleSalesContacts, handleSalesContact, handleSalesContactRestore, handleSalesContactFields, handleSalesDeals, handleSalesDeal, handleSalesDealStage, handleSalesDealActivity, handleSalesProposalCreate, handleSalesProposalSend, handleSalesDealSend, handleSalesProposalRevise, handleSalesProposalDecide, handleSalesProposalDelete, handleSalesContractCreate, handleSalesContractSend, handleSalesContractSign, handleSalesContractDelete, handleSalesConvert, handleSalesResendInvite, handleSalesAddCustomer, handleSalesInvoice, handleSalesSchedule, handleSalesInvoiceSend, handleSalesInvoiceVoid, handleSalesRetainer, handleSalesRetainerCancel, handleSalesContractTerm, handleSalesTemplates, handleSalesTemplateDelete, handleSalesServices, handleSalesPublicView, handleSalesDocument, handleSalesDocumentLink } from './routes/sales.ts';
import { handleProjects, handleProject, handleProjectReport, handleProjectsProgress, handleProjectStatus, handleTasksCreate, handleTask, handleProjectChecklist, handleMilestonesCreate, handleMilestone } from './routes/projects.ts';
import { handleDeliverableUploadUrl, handleDeliverablesCreate, handleDeliverable, handleDeliverableDownload, handleApprovalsCreate, handleApprovalDecide } from './routes/project_delivery.ts';
import { handleMessages, handleNotifications, handleNotificationsRead, handleProjectClientMessages, handleThreadRead } from './routes/project_comms.ts';
import { handleProjectSurveys, handleSurvey, handleSurveyRespond, handleSupport, handleSupportOne, handleSupportMessage } from './routes/service_intake.ts';
import { handleClientProjects, handleClientProject, handleClientReport, handleClientMessages, handleClientDeliverableDownload, handleClientApprovalDecide, handleClientSurvey, handleClientSurveyRespond, handleClientNotifications, handleClientNotificationsRead, handleClientSupport, handleClientSupportOne, handleClientSupportMessage, handleClientBilling, handleClientDocuments, handleClientBook, handleClientTaskDone, handleClientUploadUrl, handleClientUploadCreate, handleClientServices, handleClientWebsiteStats, handleClientWebsiteThumb, handleStudioCustomers } from './routes/client_delivery.ts';
import { handleSavedReplies, handleFaqAdmin, handleClientFaq } from './routes/service_edges.ts';
import { handlePublish, handleRestore, handlePublishHistory, handleVersionLabel, handleCompareVersions, handleTimewarp, handleCheckpointList, handleCheckpointSave, handleCheckpointRestore, handleCheckpointDelete, handleTakeOffline, handleBackOnline, handleSitePassword } from './routes/publish.ts';
const { handleLaunchList, handleLaunchCreate, handleLaunchGet, handleLaunchRecapture, handleLaunchDecide, handleLaunchSchedule, handleLaunchPromote, handleLaunchRollback, handleLaunchCancel } = lazyRoutes(() => import('./routes/launches.ts'));
import { handleMediaUpload, handleMediaUpdate, handleMediaDelete } from './routes/media.ts';
import { handleAssetsList, handleAssetsCollections, handleAssetsHealth, handleAssetsBulk, handleAssetsMatch, handleAssetsFolderMove, handleAssetUpdate, handleAssetStatus, handleAssetDelete, handleAssetDetail, handleAssetDownload, handleAssetReplace, handleAssetRollback, handleAssetDuplicate, handleAssetSuggest, handleAssetSocial, handleAssetCards, handleAssetRemoveBackground, handleAssetCutout, handleCutoutJob } from './routes/assets.ts';
const { handleVisualKinds, handleVisualGenerate, handleVisualList, handleVisualGet, handleVisualVary, handleVisualEdit, handleVisualDecide } = lazyRoutes(() => import('./routes/visual.ts'));
const { handleAdmin, handleDomain, handleDomainLookup, handleDomainForward } = lazyRoutes(() => import('./routes/admin.ts'));
import { handleCollection, handleLocation, handleSettings, handleBlockSuggestions, handlePageDuplicate, handlePageRefs, SPECS } from './routes/content.ts';
import { handleDeletedPages, handleDeletedPageRestore } from './routes/deleted_pages.ts';
import { handlePageLockCreate, handlePageLockList } from './routes/page_locks.ts';
import { handleHealth, handleChanges, handleContentTree, handleNotesList, handleNoteResolve, handleRestoreToDraft, handleMediaList } from './routes/room.ts';
const { handleWebsiteTimeline } = lazyRoutes(() => import('./routes/timeline.ts'));
const { handleWebsiteHealth, handleWebsiteHealthPdf } = lazyRoutes(() => import('./routes/health_page.ts'));
const { handleBusinessInsights } = lazyRoutes(() => import('./routes/insights_page.ts'));
const { handleMomentsList, handleMomentDismiss } = lazyRoutes(() => import('./routes/moments.ts'));
import { handlePortalContext, handlePortalFeed, handleMembersList, handleMemberAdd, handleMemberRevoke, handleMemberRole, handleSharesList, handleShareSet, reviewerAllowed, memberWriteGate } from './routes/workspace.ts';
const { handleDevFiles, handleDevCustomizationGet, handleDevCustomizationPut, handleBrandKitGet, handleBrandKitPut, handleBrandKitApply } = lazyRoutes(() => import('./routes/dev.ts'));
const { handleStockSearch, handleStockImport } = lazyRoutes(() => import('./routes/stock.ts'));
const { handleContentLibraryList, handleContentLibrarySave, handleContentLibraryUpdate, handleContentLibraryDelete } = lazyRoutes(() => import('./routes/content_library.ts'));
import { handleCrmRecord, handleCrmMessages, handleCrmActivity, handleCrmSearch, handleCrmProfile, handleCrmTimeline, handleCrmNotesList, handleCrmNoteAdd, handleCrmNoteDelete, handleCrmNotePin } from './routes/crm.ts';
const { handleEmailSending } = lazyRoutes(() => import('./routes/email_sending.ts'));
import { handleSalesExport } from './routes/sales_export.ts';   // sales review item 69: Download my data
import { handleEstimateCreate, handleEstimateSend, handleEstimateDecide, handleEstimateDelete, handleEstimateToProposal, handleEstimateToInvoice } from './routes/estimates.ts';   // sales review item 47
import { handleRecurringStart, handleRecurringChange, handleRecurringAction } from './routes/recurring_invoices.ts';   // sales review item 47
import { handleInvoicePayment, handleInvoicePaymentUndo } from './routes/invoice_payments.ts';   // sales review item 77
import { handleEmailLogAddress } from './routes/email_log.ts';   // sales review item 69: the log-this-email address   // sales review item 69: the sending-domain line
const { handleBroadcastsList, handleBroadcastCreate, handleBroadcastListCreate, handleBroadcastListDelete, handleBroadcastSegments, handleBroadcastGet, handleBroadcastUpdate, handleBroadcastSend, handleBroadcastCancel, handleBroadcastDraftAssist, handleBroadcastTest } = lazyRoutes(() => import('./routes/broadcasts.ts'));
import { handleScheduleCreate, handleScheduleList, handleScheduleCancel, handleFormSubmit, handleFormInbox, handleFormStatus, handleFormReply, handleApproveSend, handleApproveGet, handleApprovePost, handleSendTicket, handleSpamLinkGet, handleSpamLinkPost, handleFormFile, handleFormAnswers } from './routes/commercial.ts';
const { handleBookingTypes, handleBookingSlots, handleBookingCreate, handleManageGet, handleManagePost, handleManageSlots, handleManageIcs, handleBookingSettingsGet, handleBookingSettingsPut, handleBookingTypesList, handleBookingTypeCreate, handleBookingTypeUpdate, handleBookingTypeDelete, handleBookingAppointments, handleBookingConfirm, handleBookingCancel, handleBookingMark } = lazyRoutes(() => import('./routes/booking.ts'));
const { handleReviewPage, handleReviewSubmit, handleReviewsList, handleReviewApprove, handleReviewHide, handleReviewReply, handleReviewRequest, handleReviewGoogleLink } = lazyRoutes(() => import('./routes/reviews.ts'));
const { handleCommentsList, handleCommentCreate, handleCommentResolve, handleCommentDelete, handleTokenSections, handleTokenComment } = lazyRoutes(() => import('./routes/comments.ts'));
import { resolveMemberSite, resolveHeldBusiness, resolveSiteRoleCached } from './lib/workspace.ts';
import type { SiteRole } from './lib/site_roles.ts';
const { handleConciergeAsk } = lazyRoutes(() => import('./routes/concierge.ts'));
const { handleHelpAsk } = lazyRoutes(() => import('./routes/help.ts'));
const { handleWriterGenerate, handleWriterRewrite, handleWriterList, handleWriterGet, handleWriterAccept, handleWriterDiscard } = lazyRoutes(() => import('./routes/writer.ts'));
const { handleEditorImprove } = lazyRoutes(() => import('./routes/editor.ts'));
const { handleReviewRun, handleReviewList, handleReviewGet, handleReviewDismiss } = lazyRoutes(() => import('./routes/review.ts'));
const { handleBrandProfileGet, handleBrandProfilePut, handleBrandReviewRun, handleBrandReportList, handleBrandReportGet, handleBrandReportDismiss } = lazyRoutes(() => import('./routes/brand.ts'));
const { handleCoachRun, handleCoachList, handleCoachDecide, handleCoachHealth, handleCoachJourney } = lazyRoutes(() => import('./routes/coach.ts'));
import { handleAnalyticsPortfolio, handleAnalyticsDashboard } from './routes/analytics.ts';
import { handleCollect } from './routes/collect.ts';
import { noteVisitSource } from './routes/visit_source.ts';
import { runAfterResponse } from './lib/after_response.ts';
const { handleKnowledgeImport, handleKnowledgeList, handleKnowledgeDelete } = lazyRoutes(() => import('./routes/knowledge.ts'));
import { handleMonitorGet, handleMonitorConnect, handleMonitorVerify, handleMonitorDisconnect } from './routes/monitor.ts';
const { handleFoundationsGet, handleFoundationsPrepare, handleFoundationsPlans, handleFoundationsDecide } = lazyRoutes(() => import('./routes/foundations.ts'));
const { handleExport, handleLaunch } = lazyRoutes(() => import('./routes/services.ts'));
import { resolveAgencyMember } from './agency/auth.ts';
import { handleAgency } from './agency/routes.ts';
import { handleCommerce, isPublicCommerceRoute } from './routes/commerce.ts';
import { handleScopedCommerce } from './routes/commerce_scoped.ts';
const { handleSystem } = lazyRoutes(() => import('./routes/system.ts'));
const { handleVisibility, handleVisibilityCheck } = lazyRoutes(() => import('./routes/visibility.ts'));
const { handleFollowGet, handleFollowPut, handleLlmsDraft } = lazyRoutes(() => import('./routes/search_tab.ts'));
const { handleAiGet, handleAiQuestionsPut } = lazyRoutes(() => import('./routes/ai_answers.ts'));
const { handleConnectionsList, handleConnectionProfile, handleConnectionConnect, handleConnectionCallback, handleConnectionRefresh, handleConnectionDisconnect, handleConnectionProperties, handleConnectionPropertySelect, handleWritePrepare, handleWriteList, handleWriteDecide, handleWriteExecute, handleWriteRollback, handleConnectionAsk, handleConnectionAskStatus } = lazyRoutes(() => import('./routes/connections.ts'));
const { handleMarketplaceList, handleMarketplacePrepare, handleMarketplaceDecide, handleMarketplaceExecute, handleMarketplaceRollback, handleMarketplaceFeatures } = lazyRoutes(() => import('./routes/marketplace.ts'));
const { handleEnterpriseOverview, handleEnterpriseLocations, handleEnterpriseLocationConfig, handleEnterpriseRolloutPrepare, handleEnterpriseDecide, handleEnterpriseExecute, handleEnterpriseRollback, handleEnterpriseAudit } = lazyRoutes(() => import('./routes/enterprise.ts'));

// path after the function name: /functions/v1/presence/site -> "/site"
function routeOf(url: string): string {
  const path = new URL(url).pathname.replace(/\/+$/, '');
  const i = path.lastIndexOf('/presence');
  const rest = i >= 0 ? path.slice(i + '/presence'.length) : path;
  return rest || '/';
}

serve(async (req) => {
  // item 131: a client's site calls its routes from its own address (see visitorCors)
  const cors = VISITOR_ROUTE.test(routeOf(req.url)) ? visitorCors() : corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    return await withDraftVersion(req, await route_(req, cors));   // a write that moves the draft names the version it left
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
  //    Those answer for the CALLER, so a signed-in route asked in a client's
  //    context (?client=) doesn't stop here: it goes through the same gate as any
  //    other scoped request, then to handleScopedCommerce. A denied scope is
  //    refused at that gate and never falls back to the caller's own site.
  if (route === '/commerce' || route.startsWith('/commerce/')) {
    if (!req.headers.get('x-dds-scope-site') || isPublicCommerceRoute(route, method)) {
      return handleCommerce(req, route, method, principal, cors);
    }
  }

  // ── Phase F: PUBLIC commercial routes — a website visitor's form submission
  //    (FD-2) and a client's one-tap approval via a signed token (FD-3). No
  //    session; both are authorized by the target itself (site id / signed token).
  {
    const m = route.match(/^\/forms\/([0-9a-f-]{36})\/submit$/);
    // item 89: once the visitor has their answer, the enquiry notes where their visit began
    if (m && method === 'POST') { const sentAt = Date.now(), res = await handleFormSubmit(req, m[1], cors); runAfterResponse(noteVisitSource(req, m[1], sentAt).catch(() => false)); return res; }
    // item 140: the time ticket a site's page sends with a form or a booking
    const t = route.match(/^\/(?:forms|book)\/([0-9a-f-]{36})\/ticket$/);
    if (t && method === 'GET') return handleSendTicket(req, t[1], cors);
    // item 140: the "This was spam" link in the owner's alert email (spam.html asks, then marks)
    if (route === '/forms/spam' && method === 'GET') return handleSpamLinkGet(req, cors);
    if (route === '/forms/spam' && method === 'POST') return handleSpamLinkPost(req, cors);
  }
  // ── Phase BK: PUBLIC native booking — a website visitor lists services, reads
  //    open slots, and books an appointment. No session; authorized by the site id
  //    itself (like the form submit + analytics collector). Honeypot + rate-limit +
  //    validation live in routes/booking.ts, mirroring the form submit's safety.
  {
    let m = route.match(/^\/book\/([0-9a-f-]{36})\/types$/);
    if (m && method === 'GET') return handleBookingTypes(req, m[1], cors);
    m = route.match(/^\/book\/([0-9a-f-]{36})\/slots$/);
    if (m && method === 'GET') return handleBookingSlots(req, m[1], cors);
    m = route.match(/^\/book\/([0-9a-f-]{36})$/);
    if (m && method === 'POST') return handleBookingCreate(req, m[1], cors);
    // builder list item 149: the customer's own change-or-cancel link (booking.html reads, then acts)
    if (route === '/book/manage' && method === 'GET') return handleManageGet(req, cors);
    if (route === '/book/manage' && method === 'POST') return handleManagePost(req, cors);
    if (route === '/book/manage/slots' && method === 'GET') return handleManageSlots(req, cors);
    if (route === '/book/manage/calendar.ics' && (method === 'GET' || method === 'HEAD')) {
      const res = await handleManageIcs(req);
      return method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
    }
  }
  // ── Phase RV: PUBLIC native reviews — a website visitor opens a branded review
  //    page (GET) and leaves a review (POST). No session; authorized by the site id
  //    itself (like the form + booking submit). Honeypot + rate-limit + validation +
  //    ip_hash live in routes/reviews.ts. Stored 'pending' — never shown until the
  //    owner approves. (Owner /reviews management is post-auth, below.)
  {
    const m = route.match(/^\/reviews\/([0-9a-f-]{36})$/);
    if (m && method === 'GET') return handleReviewPage(req, m[1], cors);
    if (m && method === 'POST') return handleReviewSubmit(req, m[1], cors);
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
    // item 47: the client's Approve / Not now on an estimate — the estimate's own signed link
    m = route.match(/^\/sales\/estimates\/([0-9a-f-]{36})\/decide$/);
    if (m && method === 'POST') return handleEstimateDecide(req, m[1], cors);
  }
  // ── M8: the SIGNED, time-limited preview link — pre-auth, authorized ONLY by
  //    a valid unexpired HMAC signature over {site_id, exp}. Matched before the
  //    opaque door (its token carries a '.' + non-hex, so they never collide). ──
  // ── G11: the shared draft's feedback surface rides the SAME signed token —
  //    the {id,name} section list + the client comment drop. Matched BEFORE the
  //    door itself so "/sections" / "/comments" never get swallowed into a
  //    token (tokens are base64url + '.' + hex — never a '/'). ──
  {
    let m = route.match(/^\/p\/s\/([^/]+)\/sections$/);
    if (m && method === 'GET') return handleTokenSections(req, m[1], cors);
    m = route.match(/^\/p\/s\/([^/]+)\/comments$/);
    if (m && method === 'POST') return handleTokenComment(req, m[1], cors);
    m = route.match(/^\/p\/s\/([^/]+)$/);
    if (m && method === 'GET') return handleSignedPreview(req, m[1], cors);
  }
  // ── FD-T20: the PUBLIC, shareable preview URL — pre-auth, authorized by the
  //    token itself (+ optional password); rendered through the ONE engine. ──
  {
    const m = route.match(/^\/p\/([0-9a-f]{16,80})$/i);
    if (m && method === 'GET') return handlePublicPreview(req, m[1], cors);
    if (m && method === 'POST') return handlePublicPreviewOpen(req, m[1], cors);   // the viewer's call (item 74)
  }
  // ── Builder list item 59: the studio's name and logo for the client sign-in page,
  //    PUBLIC, pre-auth, keyed by the studio's site id (routes/studio_brand.ts). ──
  {
    const m = route.match(/^\/public\/studio\/([0-9a-f-]{36})\/brand$/);
    if (m && method === 'GET') return (await import('./routes/studio_brand.ts')).handlePublicStudioBrand(m[1], cors);
  }

  // ── Pitch pack (sales item 113): PUBLIC, pre-auth, authorized by the pack's own
  //    unguessable token (routes/pitch_pack.ts). Read-only; pitch.html renders it. ──
  {
    const m = route.match(/^\/sales\/pack\/([0-9a-f]{24,64})$/);
    if (m && method === 'GET') return (await import('./routes/pitch_pack.ts')).handlePackPublic(m[1], cors);
  }

  // ── Builder list item 176: the content form a studio sends a client — PUBLIC,
  //    pre-auth, authorized by the link's own secret (routes/intake_public.ts). ──
  {
    const m = route.match(/^\/intake\/([0-9a-f]{72})(\/files(?:\/[0-9a-f-]{36})?)?$/);
    if (m) return (await import('./routes/intake_public.ts')).handleIntakePublic(req, m[1], m[2] || '', method, cors);
  }

  // ── L5.5: Industry Pack Marketplace — OPERATOR management. Infrastructure,
  //    not client-scoped: reachable by staff or system (service-role/cron), and
  //    handled BEFORE the caller-site resolution (operators own no site). Every
  //    state change is an Approved Plan (lib/approved_plan.ts).
  if (route === '/marketplace' || route.startsWith('/marketplace/')) {
    if (route !== '/marketplace/features') {   // /features is the customer view, handled later with a site
      if (route === '/marketplace' && method === 'GET') return handleMarketplaceList(principal, cors);
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
  // Inbound email capture (CRM slice 6): a client's email REPLY enters the
  // platform here. svix-signed like /email/events, gated on RESEND_INBOUND_SECRET
  // (unset = 404). Pre-auth, tenant-safe (the site id is the recipient's local
  // part), matched to a KNOWN customer/contact by sender email. Sits BEFORE the
  // client/staff 401 — the sender has no session.
  if (route === '/email/inbound' && method === 'POST') {
    const { handleInboundEmail } = await import('./routes/inbound_email.ts');
    return handleInboundEmail(req);
  }
  // Sales review item 69: the open counter in an emailed update (a 1×1 image the
  // person's email app fetches). Public by design: the signature in the path is
  // the key, and it only ever stamps that one send's first open (a HEAD stamps nothing).
  const openPx = route.match(/^\/email\/open\/([0-9a-f-]{36})\.([A-Za-z0-9_-]{32})\.gif$/i);
  if (openPx && (method === 'GET' || method === 'HEAD')) {
    const { handleEmailOpen, PIXEL_HEADERS } = await import('./lib/email_engagement.ts');
    return method === 'HEAD' ? new Response(null, { status: 200, headers: PIXEL_HEADERS }) : await handleEmailOpen(openPx[1], openPx[2]);
  }
  // Bold redesign: a photo in an emailed update. Public by design: the signature in
  // the path is the key; a good one answers a short-lived link to the photo, anything
  // else a blank pixel (lib/update_media.ts).
  const updImg = route.match(/^\/email\/img\/([0-9a-f-]{36})\.([A-Za-z0-9_-]{32})$/i);
  if (updImg && (method === 'GET' || method === 'HEAD')) {
    const { handleEmailImage } = await import('./lib/update_media.ts');
    const res = await handleEmailImage(updImg[1], updImg[2]);
    return method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
  }
  // Sales review item 46: the private calendar link Google Calendar (or Apple,
  // Outlook) reads on its own schedule — no session; the 160-bit token in the
  // path is the key, and turning the link off or making a new one retires it.
  const calFeed = route.match(/^\/calendar\/feed\/([0-9a-f]{40})\.ics$/);
  if (calFeed && (method === 'GET' || method === 'HEAD')) {
    const { handleCalendarFeed } = await import('./routes/calendar.ts');
    const res = await handleCalendarFeed(calFeed[1]);
    return method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
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

  // ── HELP-1: in-app "how do I…?" helper — product help grounded in our OWN help
  //    copy. Site-agnostic (every signed-in user gets it, even one who owns no
  //    site), so it sits BEFORE the caller-site gate. Distinct from the site-aware
  //    Concierge; deterministic-first, honest fallback, no invented features.
  if (route === '/help/ask' && method === 'POST') return handleHelpAsk(req, cors);

  // ── Builder item 53: a transfer of ownership, answered by the person an email
  //    reached. Before any site is resolved: the new owner has no site here yet, and
  //    the owner answers about theirs. Each route checks the signed-in email itself.
  if (route === '/transfers' || route.startsWith('/transfers/')) {
    const { handleTransfersMine, handleTransferAnswer } = await import('./routes/site_transfer.ts');
    if (route === '/transfers' && method === 'GET') return handleTransfersMine(principal, cors);
    const tm = route.match(/^\/transfers\/([0-9a-f-]{36})\/(agree|accept|decline)$/);
    if (tm && method === 'POST') return handleTransferAnswer(req, tm[1], tm[2] as 'agree' | 'accept' | 'decline', principal, cors);
    return json({ error: 'not_found', message: 'No such page.' }, 404, cors);
  }

  // 3. resolve the caller's site. Un-scoped: RLS confines to the caller's OWN
  //    site. Scoped (SC-1): an agency operator drilled into a client — the
  //    x-dds-scope-site header is a REQUEST, re-validated here against agency
  //    authorization and FAIL-CLOSED (never falls back to another tenant).
  let site: SiteRow | null = null;
  let scopedName: string | null = null;
  // a seat that admits the caller: their oldest when nothing was picked, or (builder
  // item 83) the business they picked with ?client=. Stamped in ONE place, below.
  let seated: { site: SiteRow; member: { site_id: string; role: SiteRole } | null } | null = null;
  const scopeReq = req.headers.get('x-dds-scope-site');
  if (scopeReq) {
    // SC-2: pass the operator identity + request metadata so the drill-in is
    // recorded (allowed AND denied). No token, no body — resolveScopedSite logs
    // only the fields it is handed, best-effort, without gating this decision.
    const sc = await resolveScopedSite(jwt, scopeReq, {
      operatorUserId: principal.userId, operatorEmail: principal.email,
      route, method, requestId: principal.requestId,
      ip: req.headers.get('x-forwarded-for') || '', userAgent: req.headers.get('user-agent') || '',
    }, (id) => resolveHeldBusiness(jwt, principal, id));
    if (!sc.ok) return json({ error: 'scope_denied', message: 'You don’t have access to that client.' }, sc.status, cors);
    if ('held' in sc) {
      // builder item 83: one of the caller's own businesses, opened as themself, never as a studio
      seated = sc.held;
    } else {
      site = sc.site; scopedName = sc.scoped.name;
      // Studio audit change 2: the principal now KNOWS it is acting for a client,
      // so every attribution downstream (publishes, snapshots, change events,
      // connection events — lib/actor_kind.ts) says "the studio" without a second
      // membership query. Set only here, only after the scope was authorised.
      principal.scope = { site_id: sc.scoped.site_id, name: sc.scoped.name };
    }
  } else {
    site = await resolveSite(jwt);
    // MEMBERSHIP fallback: an invited member (client_reviewer / staff seat) owns
    // no site of their own — RLS returns nothing. Resolve via their active
    // membership instead; every in-site power still flows through resolveSiteRole
    // + the reviewer boundary below (fail-closed). Only a client caller carries the
    // seat onto the data path: platform staff operate as the owner already.
    if (!site && (principal.userId || principal.email)) {
      try { seated = await resolveMemberSite(principal); } catch { /* fail closed to no_site */ }
    }
  }
  if (seated) {
    site = seated.site;
    if (principal.kind === 'client') principal.member = seated.member;
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

  // 4c. A member's write gets what lib/site_roles.ts gives their role, on every route.
  //     Most routes use the service role, so nothing else holds a member to it.
  if (principal.member && isWrite) {
    const refused = await memberWriteGate(req, route, method, principal.member, cors);
    if (refused) return refused;
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

  // The data path for site content, chosen once and only now that every gate above
  // has passed: the owner under their JWT, an authorised scope or a member's seat
  // pinned to its site.
  const db = siteDb(jwt, site, principal);

  // Only a scoped, signed-in /commerce request is still here (L1 above): every gate
  // has passed and `site` is the client the scope authorised.
  if (route === '/commerce' || route.startsWith('/commerce/')) return handleScopedCommerce(req, db, site, route, method, cors);

  // A write that moves the draft and names a version: hash the draft as it is now, before
  // the write, so the answer can say which version the write left (lib/optimistic_lock.ts).
  await noteDraftBefore(req, route, site);

  // 5. router — exact routes only
  if (route === '/site' && method === 'GET') return handleGetSite(db, site, cors);
  if (route === '/site/templates' && method === 'GET') return handleTemplatesList(site, cors);            // Phase CP-1
  if (route === '/search/health' && method === 'GET') return handleSearchHealth(site, cors);              // Phase SD
  if (route === '/visibility' && method === 'GET') return handleVisibility(site, cors);                   // the Search tab
  if (route === '/visibility/check' && method === 'POST') return handleVisibilityCheck(site, cors);
  if (route === '/visibility/follow' && method === 'GET') return handleFollowGet(site, cors);              // item 181
  if (route === '/visibility/follow' && method === 'PUT') return handleFollowPut(req, site, principal, cors);
  if (route === '/visibility/llms-draft' && method === 'GET') return handleLlmsDraft(site, cors);         // item 124
  if (route === '/visibility/ai' && method === 'GET') return handleAiGet(site, cors);                     // item 182
  if (route === '/visibility/ai/questions' && method === 'PUT') return handleAiQuestionsPut(req, site, principal, cors);
  if (route === '/redirects' && method === 'GET') return handleRedirectsList(site, cors);                 // Phase SD
  if (route === '/redirects' && method === 'POST') return handleRedirectCreate(req, site, principal, cors);
  if (route === '/redirects/suggest' && method === 'GET') return handleRedirectSuggest(req, site, cors);   // item 156: the old site's pages, matched
  {
    const rm = route.match(/^\/redirects\/([0-9a-f-]{36})$/);
    if (rm && method === 'DELETE') return handleRedirectDelete(site, principal, rm[1], cors);
  }
  if (route === '/site/template' && method === 'PUT') return handlePutTemplate(req, jwt, site, principal, cors); // Phase CP-1
  if (route === '/identity' && method === 'GET') return handleGetIdentity(db, site, cors);
  if (route === '/identity' && method === 'PUT') return handlePutIdentity(req, db, site, principal, cors);
  if (route === '/preview' && method === 'GET') return handlePreview(req, site, cors);
  if (route === '/preview/section' && method === 'POST') return handlePreviewSection(req, site, cors);   // item 26: the canvas, before the save
  // ── FD-T20/T21: Draft → Preview → Live management (authed) ──
  if (route === '/preview/status' && method === 'GET') return handlePreviewStatus(site, cors);
  if (route === '/preview/publish' && method === 'POST') return handlePreviewPublish(site, principal, cors);
  if (route === '/preview/promote' && method === 'POST') return handlePreviewPromote(site, principal, cors);
  if (route === '/preview/settings' && method === 'POST') return handlePreviewSettings(req, site, principal, cors);
  if (route === '/preview/share-link' && method === 'POST') return handlePreviewShareLink(req, site, principal, cors); // M8: mint a signed, time-limited link
  if (route === '/publish' && method === 'POST') return handlePublish(req, site, principal, cors);
  if (route === '/restore' && method === 'POST') return handleRestore(req, site, principal, cors);
  // ── G10: unpublish / take offline — the reversible holding-page veil; back
  //    online restores the last live version through the ONE pipeline. ──
  if (route === '/site/offline' && method === 'POST') return handleTakeOffline(site, principal, cors);
  if (route === '/site/online' && method === 'POST') return handleBackOnline(site, principal, cors);
  if (route === '/site/password' && method === 'POST') return handleSitePassword(req, site, principal, cors);   // list item 175
  if (route === '/publishes' && method === 'GET') return handlePublishHistory(site, cors);
  // ── Version tools: compare any two versions · Timewarp · draft checkpoints ──
  // (all under /publishes/* so featureForRoute maps them to the 'website' area).
  if (route === '/publishes/compare' && method === 'GET') return handleCompareVersions(req, site, cors);
  if (route === '/publishes/timewarp' && method === 'GET') return handleTimewarp(req, site, cors);
  if (route === '/publishes/checkpoints' && method === 'GET') return handleCheckpointList(site, cors);
  if (route === '/publishes/checkpoints' && method === 'POST') return handleCheckpointSave(req, site, principal, cors);
  {
    const m = route.match(/^\/publishes\/checkpoints\/([0-9a-f-]{36})(\/restore)?$/);
    if (m) {
      if (m[2] === '/restore' && method === 'POST') return handleCheckpointRestore(req, site, principal, m[1], cors);
      if (!m[2] && method === 'DELETE') return handleCheckpointDelete(site, principal, m[1], cors);
    }
  }
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
    if (m && method === 'PUT') return handleContentLibraryUpdate(req, site, principal, m[1], cors);   // CL-LINK: edit the single source
    if (m && method === 'DELETE') return handleContentLibraryDelete(site, principal, m[1], cors);
  }

  // ── Phase DAM: the Studio Asset Library (lens + lifecycle over presence_media) ──
  if (route === '/assets' && method === 'GET') return handleAssetsList(req, site, cors);
  if (route === '/assets/collections' && method === 'GET') return handleAssetsCollections(site, cors);
  if (route === '/assets/health' && method === 'GET') return handleAssetsHealth(site, cors);
  if (route === '/assets/bulk' && method === 'POST') return handleAssetsBulk(req, site, principal, cors);
  if (route === '/assets/match' && method === 'GET') return handleAssetsMatch(req, site, cors);   // item 115: already in Files?
  if (route === '/assets/folders/move' && method === 'POST') return handleAssetsFolderMove(req, site, principal, cors);   // item 56
  {
    const msoc = route.match(/^\/assets\/([0-9a-f-]{36})\/social$/);
    if (msoc && method === 'GET') return handleAssetSocial(site, msoc[1], cors);
    // G31: branded social cards — photo + brand bar + headline, composed per platform preset
    const mcards = route.match(/^\/assets\/([0-9a-f-]{36})\/cards$/);
    if (mcards && method === 'GET') return handleAssetCards(req, site, mcards[1], cors);
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
    // AI-proposed alt text + tags + caption (propose-then-approve; never auto-applied)
    const msg = route.match(/^\/assets\/([0-9a-f-]{36})\/suggest$/);
    if (msg && method === 'POST') return handleAssetSuggest(site, principal, msg[1], cors);
    // G32: background removal — a proposed visual plan (decide via /visual/plans/:id/decide);
    // approving stores a NEW file beside the original. Never destructive.
    const mrb = route.match(/^\/assets\/([0-9a-f-]{36})\/remove-background$/);
    if (mrb && method === 'POST') return handleAssetRemoveBackground(site, principal, mrb[1], cors);
    // items 39 + 117: the photo editor's "Cut out the subject" (Replicate) — the PNG,
    // or a job to ask after while the model starts up; nothing is stored
    const mco = route.match(/^\/assets\/([0-9a-f-]{36})\/cutout$/);
    if (mco && method === 'POST') return handleAssetCutout(site, principal, mco[1], cors);
    const mcj = route.match(/^\/assets\/cutout\/([a-z0-9]{10,64}\.[A-Za-z0-9_-]{32})$/);
    if (mcj && method === 'GET') return handleCutoutJob(site, mcj[1], cors);
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
  if (route === '/website-health' && method === 'GET') return handleWebsiteHealth(site, cors);
  if (route === '/website-health/pdf' && method === 'GET') return handleWebsiteHealthPdf(site, cors);   // item 183
  if (route === '/business-insights' && method === 'GET') return handleBusinessInsights(site, cors);
  if (route === '/notes' && method === 'GET') return handleNotesList(site, cors);
  {
    const m = route.match(/^\/notes\/([0-9a-f-]{36})\/(dismiss|accept)$/);
    if (m && method === 'POST') return handleNoteResolve(site, principal, m[1], m[2] === 'accept' ? 'accepted' : 'dismissed', cors);
  }
  if (route === '/restore-to-draft' && method === 'POST') return handleRestoreToDraft(req, site, principal, cors);
  // ── G11: per-section review comments on the draft (operator side). Site-scoped
  //    like the sibling site routes; the reviewer boundary above already refuses a
  //    client_reviewer (this route is NOT in reviewerAllowed). The client writes
  //    through the signed share-link door (pre-auth, above). ──
  if (route === '/comments' && method === 'GET') return handleCommentsList(req, site, cors);
  if (route === '/comments' && method === 'POST') return handleCommentCreate(req, site, principal, cors);
  {
    const m = route.match(/^\/comments\/([0-9a-f-]{36})\/(resolve|delete)$/);
    if (m && method === 'POST') {
      return m[2] === 'resolve'
        ? handleCommentResolve(site, principal, m[1], cors)
        : handleCommentDelete(site, principal, m[1], cors);
    }
  }
  // ── Broadcasts: owner-approved email to a saved segment (compose → preview →
  //    EXPLICITLY send/schedule). Site-scoped + studio-gated by the reviewer
  //    boundary above; dispatch reuses the ONE send path (suppression + one-click
  //    unsubscribe inherited). Nothing auto-sends. Literal paths before the :id route.
  if (route === '/broadcasts' && method === 'GET') return handleBroadcastsList(site, cors);
  if (route === '/broadcasts' && method === 'POST') return handleBroadcastCreate(req, site, principal, cors);
  if (route === '/broadcasts/segments' && method === 'GET') return handleBroadcastSegments(site, cors);
  if (route === '/broadcasts/lists' && method === 'POST') return handleBroadcastListCreate(req, site, principal, cors);   // items 31 + 39: picked people
  { const lm = route.match(/^\/broadcasts\/lists\/([A-Za-z0-9-]{6,40})$/); if (lm && method === 'DELETE') return handleBroadcastListDelete(site, principal, lm[1], cors); }
  if (route === '/broadcasts/draft-assist' && method === 'POST') return handleBroadcastDraftAssist(req, site, cors);
  {
    let m = route.match(/^\/broadcasts\/([0-9a-f-]{36})$/);
    if (m && method === 'GET') return handleBroadcastGet(site, m[1], cors);
    if (m && method === 'PATCH') return handleBroadcastUpdate(req, site, m[1], cors);
    m = route.match(/^\/broadcasts\/([0-9a-f-]{36})\/send$/);
    if (m && method === 'POST') return handleBroadcastSend(req, site, principal, m[1], cors);
    m = route.match(/^\/broadcasts\/([0-9a-f-]{36})\/test$/);
    if (m && method === 'POST') return handleBroadcastTest(site, principal, m[1], cors);   // bold redesign: "Send me a test" — your own address only
    m = route.match(/^\/broadcasts\/([0-9a-f-]{36})\/cancel$/);
    if (m && method === 'POST') return handleBroadcastCancel(site, m[1], cors);
  }
  // ── P2-C: Sales & Customer Lifecycle (authed, site-scoped). One coherent
  //    /sales/* resource surface. Public token actions are handled pre-auth above. ──
  if (route === '/sales/contacts') return handleSalesContacts(req, site, principal, cors);
  // Owner-defined contact custom-field DEFINITIONS (≤5 labeled fields). Literal
  // path — matched before the :id route below (a uuid can't be "fields"). Studio-gated.
  if (route === '/sales/contacts/fields' && (method === 'GET' || method === 'PUT')) return handleSalesContactFields(req, site, principal, cors);
  // items 86 + 105: an import is a record you can undo for a day; two records for one person merge (and unmerge)
  if (route === '/sales/contacts/imports' && (method === 'GET' || method === 'POST')) return (await import('./routes/contacts_more.ts')).handleContactImports(req, site, principal, cors);
  {
    const mi = route.match(/^\/sales\/contacts\/imports\/([0-9a-f-]{36})\/undo$/);
    if (mi && method === 'POST') return (await import('./routes/contacts_more.ts')).handleContactImportUndo(req, site, principal, mi[1], cors);
    const mm = route.match(/^\/sales\/contacts\/([0-9a-f-]{36})\/(merge|unmerge)$/);
    if (mm && method === 'POST') { const cm = await import('./routes/contacts_more.ts'); return mm[2] === 'merge' ? cm.handleContactMerge(req, site, principal, mm[1], cors) : cm.handleContactUnmerge(req, site, principal, mm[1], cors); }
  }
  {
    // Contact DETAIL: tap a contact → their deals + recent activity + last-spoke
    // + custom-field values (GET); edit info + field values (PATCH); remove them
    // from the roster (DELETE — a SOFT delete that cascades to nothing, and that
    // answers 409 with the attached history until ?confirm=1). Site-scoped.
    const m = route.match(/^\/sales\/contacts\/([0-9a-f-]{36})$/);
    if (m && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) return handleSalesContact(req, site, principal, m[1], cors);
    // Phase 4 (delete safety): the Undo behind a removal — the soft delete is
    // reversed in place (deleted_at → null). Site-scoped; 404 once nothing is there.
    const mr = route.match(/^\/sales\/contacts\/([0-9a-f-]{36})\/restore$/);
    if (mr && method === 'POST') return handleSalesContactRestore(site, mr[1], cors);
  }
  // Add an EXISTING customer directly — no deal/sign/convert ceremony. Studio-gated
  // like every /sales/* route (relationship feature + the reviewer boundary above).
  if (route === '/sales/customers' && method === 'POST') return handleSalesAddCustomer(req, site, principal, cors);
  // The studio's own services catalog (name + price) that proposal line items are
  // picked from — studio-gated like every /sales/* route (relationship feature + the
  // reviewer boundary above), site-scoped to the studio issuing proposals.
  if (route === '/sales/services' && (method === 'GET' || method === 'PUT')) return handleSalesServices(req, site, principal, cors);
  // Pipeline rollup (open value / won this month / win rate / per-stage) over ALL
  // the site's deals — computed server-side because the list below is paged.
  if (route === '/sales/summary' && method === 'GET') return handleSalesSummary(req, site, principal, cors);
  if (route === '/sales/my-tasks' && method === 'GET') return handleSalesMyTasks(req, site, principal, cors);   // sales review item 29: Home's My tasks
  // sales items 85 and 106: to-dos for anyone (the To-dos page reads every one), and a call logged for a person with no deal
  if (route === '/sales/tasks' && (method === 'GET' || method === 'POST')) return (await import('./routes/todos.ts')).handleSalesTasks(req, site, principal, cors);
  if (route === '/sales/people/activity' && method === 'POST') return (await import('./routes/todos.ts')).handlePeopleActivity(req, site, principal, cors);
  // sales item 80: email a person from their record or deal; replies come back to the Inbox
  if (route === '/sales/email' && method === 'POST') return (await import('./routes/record_email.ts')).handleRecordEmail(req, site, principal, cors);
  if (route === '/sales/email' && method === 'GET') return (await import('./routes/record_email.ts')).handleRecordEmailInfo(req, site, cors);
  if (route === '/sales/reports' && method === 'GET') return handleSalesReports(req, site, principal, cors);   // sales review item 33: Analytics' fixed reports
  if (route === '/sales/views' && (method === 'GET' || method === 'PUT')) return handleSalesViews(req, site, principal, cors);   // sales review item 31: saved list views
  if (route === '/sales/stages' && (method === 'GET' || method === 'PUT')) return handleSalesStages(req, site, principal, cors);   // sales review item 38: rename the open stages
  if (route === '/email/sending' && method === 'GET') return handleEmailSending(cors);
  if (route === '/sales/export' && method === 'GET') return handleSalesExport(site, principal, cors);   // sales review item 69: one zip of CSVs
  // ── Prospects — the lead list (Semrush review, sales item 112). Lazy: most days nobody prospects. ──
  if (route.startsWith('/sales/prospects')) {
    const px = await import('./routes/prospects.ts');
    if (route === '/sales/prospects/discover' && method === 'POST') return px.handleProspectDiscover(req, site, principal, cors);
    if (route === '/sales/prospects/export' && method === 'GET') return px.handleProspectsExport(site, principal, cors);
    if (route === '/sales/prospects') return px.handleProspects(req, site, principal, cors);
    let pm = route.match(/^\/sales\/prospects\/([0-9a-f-]{36})$/);
    if (pm && (method === 'PATCH' || method === 'DELETE')) return px.handleProspect(req, site, principal, pm[1], cors);
    pm = route.match(/^\/sales\/prospects\/([0-9a-f-]{36})\/convert$/);
    if (pm && method === 'POST') return px.handleProspectConvert(req, site, principal, pm[1], cors);
    pm = route.match(/^\/sales\/prospects\/([0-9a-f-]{36})\/draft$/);
    if (pm && method === 'POST') return px.handleProspectDraft(req, site, principal, pm[1], cors);
    pm = route.match(/^\/sales\/prospects\/([0-9a-f-]{36})\/pack$/);   // item 113: build the next piece of the pitch pack
    if (pm && method === 'POST') return (await import('./routes/pitch_pack.ts')).handleProspectPack(req, site, principal, pm[1], cors);
  }
  // ── Free-tool leads (sales item 114): Site Review / AI Visibility requests on the Prospects page.
  //    Staff-only inside each handler — audit_leads is platform-level, never a client site's. ──
  if (route.startsWith('/sales/tool-leads')) {
    const px = await import('./routes/prospects.ts');
    if (route === '/sales/tool-leads' && method === 'GET') return px.handleToolLeads(site, principal, cors);
    let tl = route.match(/^\/sales\/tool-leads\/([0-9a-f-]{36})$/);
    if (tl && method === 'PATCH') return px.handleToolLead(req, site, principal, tl[1], cors);
    tl = route.match(/^\/sales\/tool-leads\/([0-9a-f-]{36})\/convert$/);
    if (tl && method === 'POST') return px.handleToolLeadConvert(req, site, principal, tl[1], cors);
  }
  if (route === '/email/log-address' && (method === 'GET' || method === 'POST' || method === 'DELETE')) return handleEmailLogAddress(req, site, principal, cors);   // sales review item 69: BCC to log   // sales review item 69: which address mail goes out from, and is it verified
  if (route === '/calendar/link' && (method === 'GET' || method === 'POST' || method === 'DELETE')) {   // sales review item 46: your calendar in Google Calendar
    const { handleCalendarLink } = await import('./routes/calendar.ts');
    return handleCalendarLink(req, site, principal, cors);
  }
  if (route === '/sales/receivables' && method === 'GET') return handleSalesReceivables(req, site, principal, cors);
  if (route === '/sales/invoices' && method === 'GET') return (await import('./routes/invoices_list.ts')).handleSalesInvoicesList(req, site, cors);   // sales item 85: the Invoices page
  if (route === '/sales/deals') return handleSalesDeals(req, site, principal, cors);
  if (route === '/sales/deleted' && method === 'GET') return handleSalesDeleted(site, cors);   // sales item 83: Recently deleted
  {
    let m = route.match(/^\/sales\/deals\/([0-9a-f-]{36})$/);
    if (m) return handleSalesDeal(req, site, principal, m[1], cors);
    // sales item 83: a deleted deal comes back (Undo, and Recently deleted)
    m = route.match(/^\/sales\/deals\/([0-9a-f-]{36})\/restore$/);
    if (m && method === 'POST') return handleSalesRestoreDeal(site, m[1], cors);
    m = route.match(/^\/sales\/deals\/([0-9a-f-]{36})\/stage$/);
    if (m && method === 'POST') return handleSalesDealStage(req, site, principal, m[1], cors);
    // Log a call / email / meeting / dated note on the deal — the quick-log that
    // feeds the deal's activity timeline + "last contacted". Site-scoped & authed.
    m = route.match(/^\/sales\/deals\/([0-9a-f-]{36})\/activity$/);
    if (m && method === 'POST') return handleSalesDealActivity(req, site, principal, m[1], cors);
    // First-class deal to-dos (Salesforce Activities parity)
    m = route.match(/^\/sales\/deals\/([0-9a-f-]{36})\/tasks$/);
    if (m && method === 'GET') return handleDealTasksList(req, site, principal, m[1], cors);
    if (m && method === 'POST') return handleDealTaskCreate(req, site, principal, m[1], cors);
    m = route.match(/^\/sales\/deal-tasks\/([0-9a-f-]{36})$/);
    if (m && method === 'PATCH') return handleDealTaskUpdate(req, site, principal, m[1], cors);
    m = route.match(/^\/sales\/deals\/([0-9a-f-]{36})\/proposals$/);
    if (m && method === 'POST') return handleSalesProposalCreate(req, site, principal, m[1], cors);
    m = route.match(/^\/sales\/deals\/([0-9a-f-]{36})\/contracts$/);
    if (m && method === 'POST') return handleSalesContractCreate(req, site, principal, m[1], cors);
    m = route.match(/^\/sales\/deals\/([0-9a-f-]{36})\/convert$/);
    if (m && method === 'POST') return handleSalesConvert(req, site, principal, m[1], cors);
    // Re-send the welcome / set-password email to a converted customer (never got it / it expired).
    m = route.match(/^\/sales\/deals\/([0-9a-f-]{36})\/resend-invite$/);
    if (m && method === 'POST') return handleSalesResendInvite(req, site, principal, m[1], cors);
    m = route.match(/^\/sales\/deals\/([0-9a-f-]{36})\/invoice$/);
    if (m && method === 'POST') return handleSalesInvoice(req, site, principal, m[1], cors);
    // Payment schedule (deposit + balance / staged installments) — mints the deal's
    // staged invoices atomically. Studio-gated & site-scoped like every authed /sales/*.
    m = route.match(/^\/sales\/deals\/([0-9a-f-]{36})\/schedule$/);
    if (m && method === 'POST') return handleSalesSchedule(req, site, principal, m[1], cors);
    // Send/resend ONE existing invoice (a plan stage, or a one-off) — the per-stage
    // "bill this now" action; generates the Stripe link on demand like the deposit path.
    m = route.match(/^\/sales\/invoices\/([0-9a-f-]{36})\/send$/);
    if (m && method === 'POST') return handleSalesInvoiceSend(req, site, principal, m[1], cors);
    // WITHDRAW an invoice raised in error — the only exit an unpaid invoice has
    // other than being paid, and the second teardown for the undismissable
    // `deal_followup`/`invremind:<id>` money notice. Never a paid one (409).
    // Studio-gated & site-scoped like every authed /sales/* route.
    m = route.match(/^\/sales\/invoices\/([0-9a-f-]{36})\/void$/);
    if (m && method === 'POST') return handleSalesInvoiceVoid(site, principal, m[1], cors);
    // Sales item 77: a payment that came in outside Stripe (check, cash, bank transfer,
    // Zelle): all of the invoice or part of it, and Undo for one recorded by mistake.
    m = route.match(/^\/sales\/invoices\/([0-9a-f-]{36})\/payment(\/undo)?$/);
    if (m && method === 'POST') return m[2] ? handleInvoicePaymentUndo(req, site, principal, m[1], cors) : handleInvoicePayment(req, site, principal, m[1], cors);
    // Retainer (recurring SERVICE billing) — set up / cancel a "$X every month/
    // year" on a deal. A separate service-purpose Stripe subscription, distinct
    // from the SaaS subscription (frozen billing boundary). Studio-gated & site-scoped.
    m = route.match(/^\/sales\/deals\/([0-9a-f-]{36})\/retainer$/);
    if (m && method === 'POST') return handleSalesRetainer(req, site, principal, m[1], cors);
    m = route.match(/^\/sales\/deals\/([0-9a-f-]{36})\/retainer\/cancel$/);
    if (m && method === 'POST') return handleSalesRetainerCancel(req, site, principal, m[1], cors);
    // Renewal/expiry date on a SIGNED agreement → the 'agreement_renewal' owner
    // reminder before it lapses (never an auto-renew). Site-scoped like every /sales/*.
    m = route.match(/^\/sales\/contracts\/([0-9a-f-]{36})\/term$/);
    if (m && method === 'POST') return handleSalesContractTerm(req, site, principal, m[1], cors);
    if (route === '/sales/templates' && (method === 'GET' || method === 'POST')) return handleSalesTemplates(req, site, principal, cors);
    m = route.match(/^\/sales\/templates\/([0-9a-f-]{36})$/);
    if (m && method === 'DELETE') return handleSalesTemplateDelete(site, m[1], cors);
    m = route.match(/^\/sales\/proposals\/([0-9a-f-]{36})\/send$/);
    if (m && method === 'POST') return handleSalesProposalSend(req, site, principal, m[1], cors);
    // ONE LINK (benchmark 2026-10, item 5): send the proposal AND the agreement
    // in one email, on one deal-bound page (choose → sign → pay). The per-document
    // sends above and below stay for sending one at a time.
    m = route.match(/^\/sales\/deals\/([0-9a-f-]{36})\/send$/);
    if (m && method === 'POST') return handleSalesDealSend(req, site, principal, m[1], cors);
    // Revise a sent/declined proposal → a new draft vN+1 on the same deal (clones
    // items + discount/tax + terms, records the trail, supersedes the prior).
    m = route.match(/^\/sales\/proposals\/([0-9a-f-]{36})\/revise$/);
    if (m && method === 'POST') return handleSalesProposalRevise(req, site, principal, m[1], cors);
    m = route.match(/^\/sales\/contracts\/([0-9a-f-]{36})\/send$/);
    if (m && method === 'POST') return handleSalesContractSend(req, site, principal, m[1], cors);
    // Remove a draft that was never sent — the mistaken duplicate. A SOFT delete,
    // and only ever on status='draft': once something is sent, decided or signed
    // it is the record between studio and client and the handler refuses (409).
    // Studio-gated & site-scoped like every authed /sales/* route above.
    m = route.match(/^\/sales\/proposals\/([0-9a-f-]{36})$/);
    if (m && method === 'DELETE') return handleSalesProposalDelete(site, principal, m[1], cors);
    m = route.match(/^\/sales\/contracts\/([0-9a-f-]{36})$/);
    if (m && method === 'DELETE') return handleSalesContractDelete(site, principal, m[1], cors);
    // Mint the printable Document-of-Record URL for the deal drawer (proposal /
    // contract / invoice). Studio-gated & site-scoped like every authed /sales/*.
    m = route.match(/^\/sales\/(proposals|contracts|invoices|estimates)\/([0-9a-f-]{36})\/document$/);
    if (m && method === 'GET') return handleSalesDocumentLink(site, (m[1] === 'invoices' ? 'invoice' : m[1] === 'contracts' ? 'contract' : m[1] === 'estimates' ? 'estimate' : 'proposal'), m[2], cors);
    // ── item 47: estimates (a price before anything is agreed) and recurring
    //    invoices (a fresh bill on a schedule). Studio-gated & site-scoped like
    //    every authed /sales/* route; the client's answer is pre-auth above. ──
    m = route.match(/^\/sales\/deals\/([0-9a-f-]{36})\/estimates$/);
    if (m && method === 'POST') return handleEstimateCreate(req, site, principal, m[1], cors);
    m = route.match(/^\/sales\/estimates\/([0-9a-f-]{36})\/(send|proposal|invoice)$/);
    if (m && method === 'POST') return m[2] === 'send' ? handleEstimateSend(req, site, principal, m[1], cors) : m[2] === 'proposal' ? handleEstimateToProposal(req, site, principal, m[1], cors) : handleEstimateToInvoice(req, site, principal, m[1], cors);
    m = route.match(/^\/sales\/estimates\/([0-9a-f-]{36})$/);
    if (m && method === 'DELETE') return handleEstimateDelete(site, principal, m[1], cors);
    m = route.match(/^\/sales\/deals\/([0-9a-f-]{36})\/recurring$/);
    if (m && method === 'POST') return handleRecurringStart(req, site, principal, m[1], cors);
    m = route.match(/^\/sales\/recurring\/([0-9a-f-]{36})$/);
    if (m && method === 'PATCH') return handleRecurringChange(req, site, principal, m[1], cors);
    m = route.match(/^\/sales\/recurring\/([0-9a-f-]{36})\/(pause|resume|skip|stop)$/);
    if (m && method === 'POST') return handleRecurringAction(req, site, principal, m[1], m[2], cors);
  }
  // ── P2-D: Service Delivery (authed, site-scoped). One coherent /projects/*
  //    resource surface — projects · tasks · milestones · activity. Studio side
  //    manages; the client side reads only client_visible rows (enforced in the
  //    handlers). All access is site_id-scoped for tenant isolation. ──
  if (route === '/projects') return handleProjects(req, jwt, site, principal, cors);
  if (route === '/projects/progress' && method === 'GET') return handleProjectsProgress(req, jwt, site, principal, cors);   // item 86: one read for many
  {
    let m = route.match(/^\/projects\/([0-9a-f-]{36})$/);
    if (m) return handleProject(req, jwt, site, principal, m[1], cors);
    m = route.match(/^\/projects\/([0-9a-f-]{36})\/report$/);
    if (m && method === 'GET') return handleProjectReport(req, jwt, site, principal, m[1], cors);
    m = route.match(/^\/projects\/([0-9a-f-]{36})\/status$/);
    if (m && method === 'POST') return handleProjectStatus(req, jwt, site, principal, m[1], cors);
    m = route.match(/^\/projects\/([0-9a-f-]{36})\/tasks$/);
    if (m && method === 'POST') return handleTasksCreate(req, jwt, site, principal, m[1], cors);
    // the studio's standard-step picker: add chosen steps of the ten-step
    // delivery checklist (lib/project_checklist.ts) to this project
    m = route.match(/^\/projects\/([0-9a-f-]{36})\/checklist$/);
    if (m && method === 'POST') return handleProjectChecklist(req, jwt, site, principal, m[1], cors);
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
    // A customer's GENERAL (project-less) messages, surfaced inside their own delivery view.
    m = route.match(/^\/projects\/([0-9a-f-]{36})\/client-messages$/);
    if (m && method === 'GET') return handleProjectClientMessages(req, jwt, site, principal, m[1], cors);
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
  // Service-loop edges (#4 saved replies, #5 FAQ): owner-managed JSON settings
  if (route === '/service/saved-replies' && (method === 'GET' || method === 'PUT')) return handleSavedReplies(req, jwt, site, principal, cors);
  if (route === '/service/faq' && (method === 'GET' || method === 'PUT')) return handleFaqAdmin(req, jwt, site, principal, cors);
  // P2-D-3: notifications (derived from the activity log + a per-reader last-seen)
  if (route === '/notifications' && method === 'GET') return handleNotifications(req, jwt, site, principal, cors);
  if (route === '/notifications/read' && method === 'POST') return handleNotificationsRead(req, jwt, site, principal, cors);
  // Slice 2 (Inbox split view): per-thread read mark — opening one conversation
  // clears ITS unread dot only (presence_thread_reads, 0113; tolerant pre-apply).
  if (route === '/threads/read' && method === 'POST') return handleThreadRead(req, jwt, site, principal, cors);
  // FIX 6: the operator's roster of THIS studio's customers (studio-side; site-scoped
  // to the operator's own site via the Agency–Client Bridge). Powers customers.html.
  if (route === '/studio/customers' && method === 'GET') return handleStudioCustomers(req, jwt, site, principal, cors);
  // ── P2-D hardening: the CLIENT App's service-delivery view (Agency–Client
  //    Bridge). The customer is on THEIR OWN site; every action resolves their
  //    client + verifies a service_link before touching agency-site data. ──
  if (route === '/client/projects' && method === 'GET') return handleClientProjects(req, site, principal, cors);
  if (route === '/client/billing' && method === 'GET') return handleClientBilling(req, site, principal, cors);
  if (route === '/client/documents' && method === 'GET') return handleClientDocuments(req, site, principal, cors);
  // item 179: the monthly reports that went out, for the client's Documents shelf
  if (route === '/client/reports' && method === 'GET') return (await import('./ops/monthly_report.ts')).handleClientReports(site, cors);
  {
    const m = route.match(/^\/client\/reports\/(\d{4}-\d{2})\/pdf$/);
    if (m && method === 'GET') return (await import('./ops/monthly_report.ts')).handleClientReportPdf(site, m[1], cors);
  }
  if (route === '/client/book' && method === 'GET') return handleClientBook(req, site, principal, cors);
  if (route === '/client/notifications' && method === 'GET') return handleClientNotifications(req, site, principal, cors);
  if (route === '/client/notifications/read' && method === 'POST') return handleClientNotificationsRead(req, site, principal, cors);
  if (route === '/client/services' && method === 'GET') return handleClientServices(req, site, principal, cors);   // R2: the studio's service catalog
  if (route === '/client/website-stats' && method === 'GET') return handleClientWebsiteStats(req, site, principal, cors);   // slice 8b: the portal Home's "Your website" card
  if (route === '/client/website-thumb' && method === 'GET') return handleClientWebsiteThumb(req, site, principal, cors);   // item 179: the card's picture of the site itself
  if (route === '/client/support' && (method === 'GET' || method === 'POST')) return handleClientSupport(req, site, principal, cors);
  if (route === '/client/faq' && method === 'GET') return handleClientFaq(req, site, principal, cors);   // service edge #5: the studio's FAQ in the portal
  if (route === '/client/kit' && method === 'GET') return (await import('./routes/client_kit.ts')).handleClientKit(req, site, principal, cors);   // builder list item 176: the hand-over kit under Help
  {
    let m = route.match(/^\/client\/projects\/([0-9a-f-]{36})$/);
    if (m && method === 'GET') return handleClientProject(req, site, principal, m[1], cors);
    m = route.match(/^\/client\/projects\/([0-9a-f-]{36})\/report$/);
    if (m && method === 'GET') return handleClientReport(req, site, principal, m[1], cors);
    m = route.match(/^\/client\/projects\/([0-9a-f-]{36})\/messages$/);
    if (m && (method === 'GET' || method === 'POST')) return handleClientMessages(req, site, principal, m[1], cors);
    m = route.match(/^\/client\/projects\/([0-9a-f-]{36})\/tasks\/([0-9a-f-]{36})\/done$/);
    if (m && method === 'POST') return handleClientTaskDone(req, site, principal, m[1], m[2], cors);
    m = route.match(/^\/client\/projects\/([0-9a-f-]{36})\/upload-url$/);
    if (m && method === 'POST') return handleClientUploadUrl(req, site, principal, m[1], cors);
    m = route.match(/^\/client\/projects\/([0-9a-f-]{36})\/uploads$/);
    if (m && method === 'POST') return handleClientUploadCreate(req, site, principal, m[1], cors);
    m = route.match(/^\/client\/deliverables\/([0-9a-f-]{36})\/download$/);
    if (m && method === 'GET') return handleClientDeliverableDownload(req, site, principal, m[1], cors);
    m = route.match(/^\/client\/approvals\/([0-9a-f-]{36})\/decide$/);
    if (m && method === 'POST') return handleClientApprovalDecide(req, site, principal, m[1], cors);
    // builder list item 179, part two: the website draft sent for an OK, drawn in the portal, and notes on its parts
    m = route.match(/^\/client\/approvals\/([0-9a-f-]{36})\/draft$/);
    if (m && method === 'GET') return (await import('./routes/client_drafts.ts')).handleClientDraft(req, site, principal, m[1], cors);
    m = route.match(/^\/client\/approvals\/([0-9a-f-]{36})\/notes$/);
    if (m && method === 'POST') return (await import('./routes/client_drafts.ts')).handleClientDraftNote(req, site, principal, m[1], cors);
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
  // Final pass (Nov 8, S1): a studio asked to work with this website's owner; the owner answers
  if (route === '/portal/studio-requests' || /^\/portal\/studio-requests\/[0-9a-f-]{36}\/(accept|decline)$/.test(route)) {
    const { handleStudioRequests } = await import('./routes/connect_requests.ts');
    return handleStudioRequests(req, route, site, principal, cors);
  }
  if (route === '/portal/members' && method === 'GET') return handleMembersList(jwt, site, principal, cors);
  if (route === '/portal/members' && method === 'POST') return handleMemberAdd(req, jwt, site, principal, cors);
  {
    const m = route.match(/^\/portal\/members\/([0-9a-f-]{36})\/revoke$/);
    if (m && method === 'POST') return handleMemberRevoke(jwt, site, m[1], principal, cors);
    const r = route.match(/^\/portal\/members\/([0-9a-f-]{36})\/role$/);   // builder item 53: change a seat's role
    if (r && method === 'POST') return handleMemberRole(req, jwt, site, r[1], principal, cors);
  }
  // builder item 53: hand the site to a new owner (the owner, or the studio asking the owner)
  if (route === '/portal/transfer' && method === 'POST') { const { handleTransferStart } = await import('./routes/site_transfer.ts'); return handleTransferStart(req, jwt, site, principal, cors); }
  if (route === '/portal/transfer/cancel' && method === 'POST') { const { handleTransferCancel } = await import('./routes/site_transfer.ts'); return handleTransferCancel(jwt, site, principal, cors); }
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
  if (route === '/dev/brand-kit/apply' && method === 'POST') return handleBrandKitApply(jwt, site, principal, cors);  // G30: one-tap apply-brand

  // ── Phase C: the Client Relationship Center (CRM) — aggregates existing
  //    signals into one calm per-client view + relationship notes. Audience is
  //    studio-vs-client (existing principal/agency signals); reviewer is already
  //    refused. No new permission/visibility/navigation model.
  if (route === '/crm/record' && method === 'GET') return handleCrmRecord(req, jwt, site, principal, cors);
  if (route === '/crm/messages' && method === 'GET') return handleCrmMessages(req, jwt, site, principal, cors);
  if (route === '/crm/activity' && method === 'GET') return handleCrmActivity(req, jwt, site, principal, cors);   // slice 1: the record page's ONE timeline
  if (route === '/crm/search' && method === 'GET') return handleCrmSearch(req, jwt, site, principal, cors);
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
  if (route === '/forms/inbox' && method === 'GET') return handleFormInbox(site, cors, req);
  // item 147: one enquiry's attached file (a ten-minute link), and one form's own table of answers
  {
    const m = route.match(/^\/forms\/inbox\/([0-9a-f-]{36})\/files\/(\d{1,2})$/);
    if (m && method === 'GET') return handleFormFile(site, m[1], Number(m[2]), cors);
  }
  if (route === '/forms/answers' && method === 'GET') return handleFormAnswers(req, site, cors);
  {
    const m = route.match(/^\/forms\/inbox\/([0-9a-f-]{36})$/);
    if (m && method === 'POST') return handleFormStatus(req, site, m[1], cors);
  }
  {
    const m = route.match(/^\/forms\/inbox\/([0-9a-f-]{36})\/reply$/);
    if (m && method === 'POST') return handleFormReply(req, jwt, site, principal, m[1], cors);
  }
  if (route === '/approve/send' && method === 'POST') return handleApproveSend(site, principal, cors);

  // ── Phase BK: Bookings (authed, site-scoped) — the owner defines services +
  //    weekly availability, and manages incoming appointments. Studio-side surface
  //    (the reviewer boundary above already refuses a client_reviewer). Dormant
  //    until migration 0099 is owner-applied (handlers degrade to "unavailable").
  if (route === '/bookings/settings' && method === 'GET') return handleBookingSettingsGet(site, cors);
  if (route === '/bookings/settings' && method === 'PUT') return handleBookingSettingsPut(req, site, principal, cors);
  if (route === '/bookings/types' && method === 'GET') return handleBookingTypesList(site, cors);
  if (route === '/bookings/types' && method === 'POST') return handleBookingTypeCreate(req, site, principal, cors);
  {
    const m = route.match(/^\/bookings\/types\/([0-9a-f-]{36})$/);
    if (m && method === 'PATCH') return handleBookingTypeUpdate(req, site, m[1], principal, cors);
    if (m && method === 'DELETE') return handleBookingTypeDelete(site, m[1], principal, cors);
  }
  if (route === '/bookings/appointments' && method === 'GET') return handleBookingAppointments(req, site, cors);
  {
    const m = route.match(/^\/bookings\/appointments\/([0-9a-f-]{36})\/(confirm|cancel|complete|no_show)$/);
    if (m && method === 'POST') {
      if (m[2] === 'confirm') return handleBookingConfirm(site, m[1], principal, cors);
      if (m[2] === 'cancel') return handleBookingCancel(req, site, m[1], principal, cors);
      return handleBookingMark(site, m[1], m[2] as 'complete' | 'no_show', principal, cors);
    }
  }

  // ── Phase RV: Reviews (authed, site-scoped) — the owner moderates incoming reviews
  //    (approve / hide / reply) and invites customers to leave one. Studio-side surface
  //    (the reviewer boundary above already refuses a client_reviewer). Dormant until
  //    migration 0101 is owner-applied (handlers degrade to "unavailable"). Note: the
  //    public review page + submit are UUID-pathed (/reviews/:siteId) and matched
  //    pre-auth above; these word-pathed owner routes never collide with them.
  if (route === '/reviews' && method === 'GET') return handleReviewsList(req, site, cors);
  if (route === '/reviews/request' && method === 'POST') return handleReviewRequest(req, site, principal, cors);
  if (route === '/reviews/google-link' && method === 'POST') return handleReviewGoogleLink(req, site, principal, cors);   // item 115: the paste-once Google place id
  {
    const m = route.match(/^\/reviews\/([0-9a-f-]{36})\/(approve|hide|reply)$/);
    if (m && method === 'POST') {
      if (m[2] === 'approve') return handleReviewApprove(site, m[1], principal, cors);
      if (m[2] === 'hide') return handleReviewHide(site, m[1], principal, cors);
      return handleReviewReply(req, site, m[1], principal, cors);
    }
  }

  // ── M9.3: Business Moments (client read + dismiss; generation is operator/system) ──
  if (route === '/moments' && method === 'GET') return handleMomentsList(db, site, cors);
  {
    const m = route.match(/^\/moments\/([0-9a-f-]{36})\/dismiss$/);
    if (m && method === 'POST') return handleMomentDismiss(site, m[1], cors);
  }
  // ── M9.4: the Concierge (one host; grounded answers; prepares, never performs) ──
  if (route === '/concierge/ask' && method === 'POST') return handleConciergeAsk(req, site, cors);
  // ── M9.5A: the AI Writer (Draft verb, rung 2 — proposals only; never publishes) ──
  if (route === '/writer/generate' && method === 'POST') return handleWriterGenerate(req, site, cors);
  // ── M9.5H: snippet rewrite for the builder's "Write with AI" (returns text only; stores/publishes nothing) ──
  if (route === '/writer/rewrite' && method === 'POST') return handleWriterRewrite(req, site, cors);
  // ── M9.5B: the AI Editor (improve existing content; shares the Writer's proposal flow) ──
  if (route === '/editor/improve' && method === 'POST') return handleEditorImprove(req, site, cors);
  // ── M9.5C: the AI Reviewer (critique only; no write path to content exists) ──
  if (route === '/review/run' && method === 'POST') return handleReviewRun(req, site, cors);
  // ── M9.5D: the Brand Guardian (protects identity; findings only) ──
  if (route === '/brand/profile' && method === 'GET') return handleBrandProfileGet(db, site, cors);
  if (route === '/brand/studio' && method === 'GET') return (await import('./routes/studio_brand.ts')).handleStudioBrandGet(site, cors);   // builder list item 59: what clients see of this studio
  if (route === '/brand/profile' && method === 'PUT') return handleBrandProfilePut(req, db, site, principal, cors);
  if (route === '/brand/review' && method === 'POST') return handleBrandReviewRun(req, site, cors);
  if (route === '/brand/reports' && method === 'GET') return handleBrandReportList(db, site, cors);
  {
    const m = route.match(/^\/brand\/reports\/([0-9a-f-]{36})(\/dismiss)?$/);
    if (m && !m[2] && method === 'GET') return handleBrandReportGet(db, site, m[1], cors);
    if (m && m[2] === '/dismiss' && method === 'POST') return handleBrandReportDismiss(req, site, m[1], cors);
  }
  // ── M14: Presence Platform Services — ownership (the export) and the launch checklist ──
  if (route === '/export' && method === 'GET') return handleExport(site, principal, cors);
  if (route === '/launch' && method === 'GET') return handleLaunch(site, cors);
  // ── M12: Platform Services — the technical foundation, in plain words; changes only as approved plans ──
  // Self-serve custom domain (the caller's OWN site) — reuses the complete domain
  // core (attach → SSL → live DNS status). Reviewer boundary above already blocks
  // client_reviewers; a site owner or an operator scoped into the client reaches it.
  if (route === '/foundations/domain/lookup' && method === 'GET') return handleDomainLookup(req, site, cors);   // item 162: steps for their provider as they type
  if (route === '/foundations/domain/forward' && (method === 'POST' || method === 'DELETE')) return handleDomainForward(req, method, site, principal, cors);   // item 174: another domain sends visitors here
  if (route === '/foundations/domain' && (method === 'GET' || method === 'POST' || method === 'DELETE')) {
    const r = await handleDomain(req, method, site, principal, cors);
    return r || json({ error: 'method_not_allowed' }, 405, cors);
  }
  if (route === '/foundations' && method === 'GET') return handleFoundationsGet(site, cors);
  if (route === '/foundations/prepare' && method === 'POST') return handleFoundationsPrepare(req, site, principal, cors);
  if (route === '/foundations/plans' && method === 'GET') return handleFoundationsPlans(db, site, cors);
  {
    const m = route.match(/^\/foundations\/plans\/([0-9a-f-]{36})\/decide$/);
    if (m && method === 'POST') return handleFoundationsDecide(req, site, m[1], principal, cors);
  }
  // ── M11: Presence Monitor connection (read-only observation of an existing website) ──
  if (route === '/monitor/connection' && method === 'GET') return handleMonitorGet(jwt, site, cors);
  if (route === '/monitor/connection' && method === 'DELETE') return handleMonitorDisconnect(site, principal, cors);
  if (route === '/monitor/connect' && method === 'POST') return handleMonitorConnect(req, site, principal, cors);
  if (route === '/monitor/verify' && method === 'POST') return handleMonitorVerify(site, principal, cors);
  // ── M10: Business Knowledge Import (knowledge in, evidence out) ──
  if (route === '/knowledge/import' && method === 'POST') return handleKnowledgeImport(req, site, principal, cors);
  if (route === '/knowledge/docs' && method === 'GET') return handleKnowledgeList(db, site, cors);
  {
    const m = route.match(/^\/knowledge\/docs\/([0-9a-f-]{36})$/);
    if (m && method === 'DELETE') return handleKnowledgeDelete(site, m[1], principal, cors);
  }
  // ── L5.5: Industry Pack Marketplace — CUSTOMER features (per-site) ──
  if (route === '/marketplace/features' && method === 'GET') return handleMarketplaceFeatures(site, cors);
  // ── L4.0/L4.1: Connected Platform reads (connect/refresh/disconnect) ──
  if (route === '/connections' && method === 'GET') return handleConnectionsList(site, cors);
  // ── Studio audit change 9: the studio asks the client to connect their own Google
  //    (POST, scoped operator); the client's portal reads the ask (GET, their session).
  //    Before the /:key routes — "ask" is not a provider key.
  if (route === '/connections/ask' && method === 'POST') return handleConnectionAsk(req, site, principal, cors);
  if (route === '/connections/ask' && method === 'GET') return handleConnectionAskStatus(req, site, cors);
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
  // GA4 property selection: list what the connected account can read; record the pick
  {
    const m = route.match(/^\/connections\/([a-z0-9_]+)\/(properties|property)$/);
    if (m) {
      if (m[2] === 'properties' && method === 'GET') return handleConnectionProperties(site, m[1], cors);
      if (m[2] === 'property' && method === 'POST') return handleConnectionPropertySelect(req, site, m[1], principal, cors);
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
  // ── Builder list item 58: the monthly report email to this client (ops/monthly_report.ts) ──
  if (route === '/report/monthly' && method === 'GET') return (await import('./ops/monthly_report.ts')).handleReportGet(site, cors);
  if (route === '/report/monthly' && method === 'PUT') return (await import('./ops/monthly_report.ts')).handleReportPut(req, site, principal, cors);
  if (route === '/report/monthly/preview' && method === 'POST') return (await import('./ops/monthly_report.ts')).handleReportPreview(site, principal, cors);
  if (route === '/report/monthly/pdf' && method === 'GET') return (await import('./ops/monthly_report.ts')).handleReportPdf(site, cors);   // item 184
  // ── AN-1: Analytics — plain-English understanding composed from stored signals
  //    (no new engine, no new AI, no fabricated numbers). Site-scoped surfaces.
  // Slice 8: the Business dashboard summary (analytics.html's two-band board)
  if (route === '/analytics/dashboard' && method === 'GET') return handleAnalyticsDashboard(req, site, cors);

  // ── M9.5E: the Growth Coach (observes, plans, prepares; never executes) ──
  if (route === '/coach/run' && method === 'POST') return handleCoachRun(site, cors);
  if (route === '/coach/health' && method === 'GET') return handleCoachHealth(site, cors);       // PT-6 Business Health Coach
  if (route === '/coach/journey' && method === 'GET') return handleCoachJourney(site, cors);     // PT-7 Customer Timeline
  if (route === '/coach/opportunities' && method === 'GET') return handleCoachList(db, site, cors);
  {
    const m = route.match(/^\/coach\/opportunities\/([0-9a-f-]{36})\/decide$/);
    if (m && method === 'POST') return handleCoachDecide(req, site, m[1], cors);
  }
  if (route === '/review/reports' && method === 'GET') return handleReviewList(db, site, cors);
  {
    const m = route.match(/^\/review\/reports\/([0-9a-f-]{36})(\/dismiss)?$/);
    if (m && !m[2] && method === 'GET') return handleReviewGet(db, site, m[1], cors);
    if (m && m[2] === '/dismiss' && method === 'POST') return handleReviewDismiss(req, site, m[1], cors);
  }
  if (route === '/writer/drafts' && method === 'GET') return handleWriterList(db, site, cors);
  {
    const m = route.match(/^\/writer\/drafts\/([0-9a-f-]{36})(\/accept|\/discard)?$/);
    if (m && !m[2] && method === 'GET') return handleWriterGet(db, site, m[1], cors);
    if (m && m[2] === '/accept' && method === 'POST') return handleWriterAccept(req, site, m[1], principal, cors);
    if (m && m[2] === '/discard' && method === 'POST') return handleWriterDiscard(site, m[1], cors);
  }
  if (route === '/media' && method === 'GET') return handleMediaList(site, cors);
  if (route === '/location' && (method === 'GET' || method === 'PUT')) { const r = await handleLocation(req, db, site, principal, cors); if (r) return r; }
  if (route === '/settings' && (method === 'GET' || method === 'PUT')) { const r = await handleSettings(req, db, site, principal, cors); if (r) return r; }
  // ── Wave-1 G7: page operations on the settings.pages model (duplicate = a
  //    create-with-source over the ONE pages store; refs = delete-awareness) ──
  if (route === '/pages/duplicate' && method === 'POST') return handlePageDuplicate(req, db, site, principal, cors);
  if (route === '/pages/refs' && method === 'GET') return handlePageRefs(req, site, cors);
  if (route === '/pages/deleted' && method === 'GET') return handleDeletedPages(site, cors);   // item 154: pages deleted in the last 30 days
  { const dm = route.match(/^\/pages\/deleted\/([0-9a-f-]{36})\/restore$/); if (dm && method === 'POST') return handleDeletedPageRestore(req, db, site, principal, dm[1], cors); }
  // items 48 and 120: a page's password (only the key made from it is kept)
  if (route === '/page-locks' && method === 'POST') return handlePageLockCreate(req, site, principal, cors);
  if (route === '/page-locks' && method === 'GET') return handlePageLockList(site, cors);
  if (route === '/blocks/suggested' && method === 'GET') return handleBlockSuggestions(site, cors);   // FD-T4 vertical presets
  {
    const m = route.match(/^\/(offerings|testimonials|faqs|posts)(?:\/([0-9a-f-]{36}))?$/);
    if (m && m[1] in SPECS) { const r = await handleCollection(req, db, site, principal, m[1], m[2] ?? null, cors); if (r) return r; }
  }

  return json({ error: 'not_found', message: `No route for ${method} ${route}.` }, 404, cors);
}
