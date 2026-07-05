import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const RESEND_KEY = Deno.env.get('RESEND_KEY') || '';
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_KEY') || ''; // matches the ANTHROPIC_KEY secret in Supabase
const ERIC = 'eric@davisdigitalstudio.com';
const FROM = 'Davis Digital Studio <noreply@davisdigitalstudio.com>';
const PSI_KEY = Deno.env.get('PSI_KEY') || ''; // set as an Edge Function secret in Supabase; rotate the old hardcoded key in Google Cloud

// Service-role key + project URL for privileged server-side calls (creating auth users).
// These MUST be set as Edge Function secrets in Supabase (see deploy notes).
const SB_URL = Deno.env.get('SUPABASE_URL') || 'https://qksstlqzbhesadrrofgn.supabase.co';
const SB_SERVICE = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
// Anon (publishable) key. Paired with a caller's user-JWT, REST reads run UNDER
// that user's identity, so RLS scopes the rows. Used for client-portal reads
// that should only ever return the caller's own data.
const SB_ANON = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('ANON_KEY') || '';

// ── CORS: allowlist real origins instead of '*' ──
// Add any new front-end origin here (e.g. a Netlify deploy-preview URL) if needed.
const ALLOWED_ORIGINS = [
  'https://davisdigitalstudio.com',
  'https://www.davisdigitalstudio.com',
];

function corsFor(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dds-admin, x-dds-user-jwt',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

// Kept for the email/notification helpers below that reference `cors` directly.
// Uses the canonical origin; per-request CORS is applied at the response layer.
const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dds-admin, x-dds-user-jwt',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};

// ============================================================================
//  PART 2a — FAIL-CLOSED STAFF VERIFICATION (replaces the old admin checks)
// ============================================================================
//  WHAT CHANGED vs. the previous version:
//   • verifyAdminJwt        → DELETED (it returned the email even when the
//                             admins lookup was inconclusive: a real hole).
//   • isAuthorizedAdmin     → DELETED (the x-dds-admin shared-secret check).
//   • isAdminRequest        → DELETED (wrapper around the above two).
//   • PRIVILEGED_TYPES set  → DELETED (privilege now comes from role, see gate).
//   • ADMIN_SECRET / ADMIN_EMAILS env reads → DELETED.
//
//  Source of truth is now the `memberships` table (Part 1). EVERY uncertain
//  path returns null. There is no "accept on validated session" fallback.
//
//  A compatibility shim `verifyAdminJwt` is provided so the inline checks still
//  scattered through the routes keep working unchanged — it simply delegates to
//  verifyStaff and returns the email (or null). The real enforcement happens at
//  the single gate near the top of serve(); the inline checks are now redundant
//  but harmless, and can be deleted route-by-route over time.
// ============================================================================

const TENANT_ID = '00000000-0000-0000-0000-000000000001'; // DDS = tenant #1

async function verifyStaff(req: Request): Promise<
  { userId: string; email: string; tenantId: string; role: string } | null
> {
  const jwt = req.headers.get('x-dds-user-jwt') || '';
  if (!jwt) return null;

  // 1) Validate the session and resolve the user. Bad/expired JWT => deny.
  let user: any;
  try {
    const uRes = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_SERVICE, Authorization: `Bearer ${jwt}` },
    });
    if (!uRes.ok) return null;
    user = await uRes.json();
  } catch (_) {
    return null; // network error talking to auth => deny, never guess
  }
  if (!user || !user.id) return null;

  // 2) Confirm membership. NO row, query error, or anything unexpected => deny.
  //    This closes the old hole: a validated session is NOT sufficient.
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/memberships?user_id=eq.${encodeURIComponent(String(user.id))}` +
        `&select=tenant_id,role&limit=1`,
      { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` } },
    );
    if (!r.ok) return null;                                       // lookup failed => deny
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;   // not staff => deny
    return {
      userId: String(user.id),
      email: (user.email ? String(user.email) : '').toLowerCase(),
      tenantId: String(rows[0].tenant_id),
      role: String(rows[0].role),
    };
  } catch (_) {
    return null; // any exception => deny
  }
}

// Compatibility shim so existing inline `const admin = await verifyAdminJwt(req)`
// checks keep compiling and behaving (now fail-closed). Returns email or null.
async function verifyAdminJwt(req: Request): Promise<string | null> {
  const staff = await verifyStaff(req);
  return staff ? (staff.email || staff.userId) : null;
}

// Role ranking + per-route minimums (the real enforcement, applied at the gate).
const ROLE_RANK: Record<string, number> = { owner: 4, admin: 3, staff: 2, readonly: 1 };
function atLeast(role: string, min: keyof typeof ROLE_RANK): boolean {
  return (ROLE_RANK[role] || 0) >= ROLE_RANK[min];
}

// Minimum role each privileged route requires. Routes NOT listed are either
// public (lead_intake, psi_fetch, deep_audit, ai_critique, concierge,
// report_card, contact_reply, audit_lead, the email notifies) or are
// client-portal routes guarded by their own JWT/ownership logic
// (client_project, client_feed, ai_project_help), or are secret-gated
// (run_scheduled_jobs). Destructive ops sit at a higher bar.
const ROUTE_MIN_ROLE: Record<string, keyof typeof ROLE_RANK> = {
  studio_brief:       'staff',   // The Brief — cross-module morning intelligence
  reasoning_query:    'staff',   // the queryable brain — every module's one interface
  draft_action:       'staff',   // the actions layer — drafts a message for one engine recommendation
  create_client_auth: 'admin',
  invite_client:      'admin',
  delete_client_auth: 'owner',
  delete_client_cascade: 'owner',  // Part 2c: full child-table delete, owner only
  // ── Release 0.4: Client Archive System ──
  client_archive:        'admin',  // soft-delete the whole client graph
  client_restore:        'admin',  // un-archive the whole client graph
  client_purge:          'owner',  // permanent, irreversible hard delete (owner only)
  archived_clients_list: 'admin',  // the Recently Archived view
  client_audit_trail:    'admin',  // archive/restore/purge log
  // ── Phase 4B: Client Workspace ──
  client_decision_surface: 'staff', // the Overview decision surface (EBV-ranked insights)
  portfolio_priorities:    'staff', // Portfolio Intelligence: where Eric spends time today
  signals_rebuild:         'admin', // Data Foundation: (re)ingest internal signals
  client_scores:           'staff', // Data Foundation: derived scores from signals
  admin_analytics:         'staff', // Admin BI: full analytics + interpretation
  integrations_status:     'staff', // Integrations: provider connection status
  integration_connect:     'staff', // Integrations: begin OAuth / store key
  integration_disconnect:  'staff', // Integrations: revoke a provider
  integration_list_properties: 'staff', // Integrations: list a provider's available properties/sites
  integration_set_property: 'staff', // Integrations: choose which property/site to sync
  provider_sync:           'staff', // Integrations: run provider adapters
  sync_history:            'staff', // Integrations: sync audit trail
  lead_delete:        'admin',
  // Team management — owner only. Controls who is staff and at what role.
  team_list:          'owner',
  team_invite:        'owner',
  team_set_role:      'owner',
  team_remove:        'owner',
  advance_stage:      'staff',
  emit_event:         'staff',
  admin_db:           'staff',   // until admin_db is carved up (Part 2c)
  admin_write:        'staff',   // Part 2c: named mutations, per-table method allowlist
  admin_query:        'staff',   // Part 2c: GET-only reads
  lead_list:          'staff',
  lead_detail:        'staff',
  lead_reply:         'staff',
  lead_status:        'staff',
  lead_ai_draft:      'staff',
  prospect_email_draft: 'staff', // Pipeline: AI-or-template outreach draft
  prospect_email_send:  'staff', // Pipeline: send outreach via Resend (eric@, reply-to eric@)
  home_snapshot:      'staff',
  home_brief:         'staff',
  ai_draft_reply:     'staff',
  ai_triage:          'staff',
  visibility_list:    'staff',
  visibility_check:   'staff',
  visibility_add:     'staff',
  visibility_remove:  'staff',
  visibility_sync_clients: 'staff',

  // ── Growth Partnership (staff manage; owner for destructive) ──
  partnership_list:        'staff',
  partnership_get:         'staff',
  partnership_upsert:      'admin',
  partnership_delete:      'owner',
  partnership_dashboard:   'staff',
  goal_list:               'staff',
  goal_upsert:             'staff',
  goal_delete:             'staff',
  rec_list:                'staff',
  rec_upsert:              'staff',
  rec_decide:              'staff',
  rec_generate:            'staff',
  rec_to_task:             'staff',
  task_list:               'staff',
  task_upsert:             'staff',
  task_delete:             'staff',
  worklog_list:            'staff',
  worklog_upsert:          'staff',
  content_list:            'staff',
  content_upsert:          'staff',
  content_delete:          'staff',
  review_list:             'staff',
  review_get:              'staff',
  review_upsert:           'staff',
  review_draft:            'staff',
  review_publish:          'staff',
  note_list:               'staff',
  note_upsert:             'staff',
  note_delete:             'staff',
  health_upsert:           'staff',
  reminders_feed:          'staff',
  // ── Growth workflow admin routes (NEW) ──
  rec_set_status:          'staff',
  gp_quote_respond:        'staff',
  gp_rec_reply:            'staff',
  admin_growth_inbox:      'staff',
  rec_ai_evaluate:         'staff',
  // client-portal GP routes (gp_workspace, gp_submit_request, gp_rec_respond)
  // guard themselves by JWT/contact scope, like client_project — NOT listed here.
};

// Tables the admin_db route is allowed to touch.
const ADMIN_DB_TABLES = new Set([
  'clients', 'messages', 'files', 'invoices', 'approvals', 'timeline',
  'intake_forms', 'activity_log', 'audit_leads', 'client_requests',
  'message_templates', 'notifications', 'prospects', 'discovery_intake', 'addons',
  'contacts', 'projects', 'events', 'organizations',
  'leads', 'lead_messages',
  // ── Growth Partnership tables ──
  'partnerships', 'partnership_goals', 'recommendations', 'growth_tasks',
  'work_log', 'content_calendar', 'monthly_reviews', 'client_notes', 'health_metrics',
]);

// ═══════════════════════════════════════════════════════════════════════════
//  ADMIN_DB CARVE-UP (Part 2c)
//  Replaces the do-anything admin_db proxy with two narrow surfaces:
//   • admin_write — named mutations. Each table declares EXACTLY which methods
//     are allowed. A staffer can no longer DELETE on a table the UI never deletes
//     from, or PATCH a table that should be insert-only. This is the real win.
//   • admin_query — GET-only. Preserves PostgREST query flexibility for the
//     join-heavy reads, but can NEVER mutate (method is hard-coded to GET).
//  admin_db is KEPT (deprecated) so the old frontend still works mid-rollout.
//
//  ADMIN_WRITE_OPS maps table -> allowed methods. Derived from the ACTUAL
//  call sites in the admin panel (audited), nothing speculative:
//    clients        POST (create), PATCH (update), DELETE (remove client)
//    messages       POST only
//    files          POST only
//    invoices       POST, PATCH, DELETE
//    approvals      POST only
//    timeline       POST, PATCH
//    notifications  POST only
//    activity_log   POST only
//    client_requests PATCH only (status cycling)
//    message_templates POST, DELETE
//    prospects      POST, PATCH, DELETE
//    contacts       POST, PATCH  (owner_notes / auto-link; no UI delete)
//    projects       POST, PATCH  (advance/create; no UI delete)
// ═══════════════════════════════════════════════════════════════════════════
const ADMIN_WRITE_OPS: Record<string, Set<string>> = {
  clients:           new Set(['POST', 'PATCH', 'DELETE']),
  messages:          new Set(['POST']),
  files:             new Set(['POST']),
  invoices:          new Set(['POST', 'PATCH', 'DELETE']),
  approvals:         new Set(['POST']),
  timeline:          new Set(['POST', 'PATCH']),
  notifications:     new Set(['POST']),
  activity_log:      new Set(['POST']),
  client_requests:   new Set(['PATCH']),
  message_templates: new Set(['POST', 'DELETE']),
  prospects:         new Set(['POST', 'PATCH', 'DELETE']),
  contacts:          new Set(['POST', 'PATCH']),
  projects:          new Set(['POST', 'PATCH']),
  audit_leads:       new Set(['PATCH', 'DELETE']),
};
// Tables a staffer may READ via admin_query (GET only). Superset of write tables
// plus read-only references the dashboards pull.
const ADMIN_READ_TABLES = new Set([
  ...ADMIN_DB_TABLES,
]);


// ── Simple in-memory per-IP rate limiter for cost-bearing AI/PSI routes ──
const RATE_LIMITED_TYPES = new Set(['psi_fetch', 'deep_audit', 'ai_critique', 'ai_critique_email', 'concierge', 'reset_password', 'ai_draft_reply', 'ai_triage', 'ai_project_help', 'lead_ai_draft', 'prospect_email_draft', 'visibility_check', 'rec_generate', 'review_draft']);
const RATE_MAX = 12;
const RATE_WINDOW_MS = 60_000;
const rateHits = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
}

function isRateLimited(req: Request): boolean {
  const ip = clientIp(req);
  const now = Date.now();
  const rec = rateHits.get(ip);
  if (!rec || now > rec.resetAt) {
    rateHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  rec.count++;
  return rec.count > RATE_MAX;
}

function json(payload: unknown, status = 200, corsHeaders: Record<string, string> = cors) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

// Loud startup guard: if Resend isn't configured, every send will fail. Make
// that obvious in the function logs instead of silently no-opping.
if (!RESEND_KEY) {
  console.error('[email] RESEND_KEY is not set — all Resend emails will fail. Set it as an Edge Function secret.');
}

// Core sender. Returns the raw Resend Response so the ~30 existing call sites
// that ignore the return value keep working unchanged. New code should prefer
// emailOk() below, which returns a clean boolean. Failures are always logged
// with the exact Resend status + body so they're visible in dev/prod logs.
async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_KEY) {
    console.error('[email] skipped send to', to, '— RESEND_KEY not configured. Subject:', subject);
    return new Response(JSON.stringify({ error: 'resend_not_configured' }), { status: 500 });
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    });
    if (!r.ok) {
      let detail = '';
      try { detail = await r.text(); } catch (_) { /* ignore */ }
      console.error('[email] Resend send FAILED', r.status, 'to', to, '| subject:', subject, '| detail:', detail);
    } else {
      console.log('[email] sent to', to, '| subject:', subject);
    }
    return r;
  } catch (e) {
    console.error('[email] Resend send THREW to', to, '| subject:', subject, '|', String(e));
    return new Response(null, { status: 500 });
  }
}

// Boolean wrapper for new code paths that want a truthful emailed flag without
// inspecting a Response object. Never throws.
async function emailOk(to: string, subject: string, html: string): Promise<boolean> {
  try {
    const r = await sendEmail(to, subject, html);
    return !!(r && (r as Response).ok);
  } catch (_) {
    return false;
  }
}

function emailWrap(body: string) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0f0820;font-family:'Helvetica Neue',Arial,sans-serif;">${body}</body></html>`;
}

function notifyShell(heading: string, lines: string[], cta?: { label: string; href: string }) {
  return emailWrap(`
    <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
      <a href="https://davisdigitalstudio.com" style="font-family:Georgia,serif;font-size:18px;color:#fff;text-decoration:none;display:block;margin-bottom:20px;">Davis<span style="color:#c4aee8;">Digital</span> Studio</a>
      <div style="background:#1e1338;border-radius:16px;padding:28px;">
        <h1 style="font-family:Georgia,serif;font-size:21px;font-weight:400;color:#fff;margin:0 0 14px;">${heading}</h1>
        ${lines.map(l => `<p style="font-size:14px;color:rgba(255,255,255,0.65);line-height:1.6;margin:0 0 10px;">${l}</p>`).join('')}
        ${cta ? `<div style="text-align:center;margin-top:20px;"><a href="${cta.href}" style="display:inline-block;background:#5b3fa0;color:#fff;font-size:13px;font-weight:600;padding:11px 24px;border-radius:100px;text-decoration:none;">${cta.label}</a></div>` : ''}
      </div>
    </div>
  `);
}

// ── DEEP AUDIT ─────────────────────────────────────────────────────────────
async function deepAudit(targetUrl: string) {
  const out: any = {
    url: targetUrl, domain: '', https: false, fetchedHtml: false,
    onPage: { title: '', titleLength: 0, metaDescription: '', metaDescriptionLength: 0, canonical: null, h1Count: 0, h1Text: '', h2Count: 0, h3Count: 0, ogTitle: false, ogDescription: false, ogImage: false, ogUrl: false, twitterCard: false, wordCount: 0, imageCount: 0, imagesWithAlt: 0, internalLinks: 0, externalLinks: 0, favicon: false, langAttr: false },
    schema: { blocks: 0, types: [] as string[], hasLocalBusiness: false, hasOrganization: false, hasWebSite: false, hasBreadcrumb: false, localBusinessNAP: null as any },
    local: { phoneOnPage: false, phone: null as string | null, zipOnPage: false, googleMapsEmbed: false, hoursMentioned: false, socialLinks: [] as string[] },
    discoverability: { robotsTxt: false, robotsTxtBlocksAll: false, sitemapDeclared: false, sitemapUrl: null as string | null, sitemapXml: false, sitemapUrlCount: 0 },
  };

  let normalized = (targetUrl || '').trim();
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = 'https://' + normalized.replace(/^\/+/, '');
  }

  let u: URL;
  try { u = new URL(normalized); } catch { return out; }
  out.url = normalized;
  out.domain = u.hostname;
  out.https = u.protocol === 'https:';

  const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  let html = '';
  try {
    const res = await fetch(normalized, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      signal: AbortSignal.timeout(9000), redirect: 'follow',
    });
    if (res.ok) {
      html = (await res.text()).slice(0, 600000);
      out.fetchedHtml = true;
    }
  } catch (_) { /* ignore */ }

  if (html) {
    const lc = html.toLowerCase();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) { out.onPage.title = titleMatch[1].replace(/\s+/g, ' ').trim(); out.onPage.titleLength = out.onPage.title.length; }
    const md1 = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i);
    const md2 = html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i);
    const desc = md1 ? md1[1] : (md2 ? md2[1] : '');
    out.onPage.metaDescription = desc; out.onPage.metaDescriptionLength = desc.length;
    const can = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
    out.onPage.canonical = can ? can[1] : null;
    out.onPage.h1Count = (html.match(/<h1[\s>]/gi) || []).length;
    out.onPage.h2Count = (html.match(/<h2[\s>]/gi) || []).length;
    out.onPage.h3Count = (html.match(/<h3[\s>]/gi) || []).length;
    const h1Text = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    out.onPage.h1Text = h1Text ? h1Text[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) : '';
    out.onPage.ogTitle = /<meta[^>]+property=["']og:title["']/i.test(html);
    out.onPage.ogDescription = /<meta[^>]+property=["']og:description["']/i.test(html);
    out.onPage.ogImage = /<meta[^>]+property=["']og:image["']/i.test(html);
    out.onPage.ogUrl = /<meta[^>]+property=["']og:url["']/i.test(html);
    out.onPage.twitterCard = /<meta[^>]+name=["']twitter:card["']/i.test(html);
    out.onPage.favicon = /<link[^>]+rel=["'](?:shortcut |icon|apple-touch-icon)/i.test(html);
    out.onPage.langAttr = /<html[^>]+lang=/i.test(html);
    const bodyMatch = html.match(/<body[\s\S]*?<\/body>/i);
    const bodyText = (bodyMatch ? bodyMatch[0] : html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
    out.onPage.wordCount = bodyText ? bodyText.split(/\s+/).length : 0;
    const imgs = html.match(/<img[^>]*>/gi) || [];
    out.onPage.imageCount = imgs.length;
    out.onPage.imagesWithAlt = imgs.filter(t => /\salt=["'][^"']/.test(t)).length;
    const anchors = html.match(/<a[^>]+href=["']([^"']+)["']/gi) || [];
    const host = u.hostname.replace(/^www\./, '');
    let internal = 0, external = 0;
    for (const a of anchors) {
      const href = (a.match(/href=["']([^"']+)["']/i) || [])[1] || '';
      if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
      if (href.startsWith('/') || href.startsWith('?') || href.toLowerCase().includes(host)) internal++;
      else if (/^https?:\/\//i.test(href)) external++;
    }
    out.onPage.internalLinks = internal; out.onPage.externalLinks = external;
    const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    const schemas: any[] = [];
    for (const m of blocks) {
      try {
        const parsed = JSON.parse(m[1].trim());
        if (Array.isArray(parsed)) schemas.push(...parsed);
        else if (parsed['@graph'] && Array.isArray(parsed['@graph'])) schemas.push(...parsed['@graph']);
        else schemas.push(parsed);
      } catch (_) { /* skip */ }
    }
    out.schema.blocks = blocks.length;
    const typeStrs: string[] = [];
    for (const s of schemas) {
      if (!s || !s['@type']) continue;
      if (Array.isArray(s['@type'])) typeStrs.push(...s['@type']); else typeStrs.push(s['@type']);
    }
    out.schema.types = [...new Set(typeStrs)];
    const LB = /LocalBusiness|Restaurant|Store|Bar|CafeOrCoffeeShop|FoodEstablishment|BarOrPub|HealthAndBeautyBusiness|HomeAndConstructionBusiness|MedicalBusiness|ProfessionalService|RealEstateAgent|LegalService|Dentist|HairSalon|DaySpa/i;
    out.schema.hasLocalBusiness = typeStrs.some(t => LB.test(t));
    out.schema.hasOrganization = typeStrs.includes('Organization');
    out.schema.hasWebSite = typeStrs.includes('WebSite');
    out.schema.hasBreadcrumb = typeStrs.includes('BreadcrumbList');
    const lbSchema = schemas.find(s => s && (Array.isArray(s['@type']) ? s['@type'].some((t: string) => LB.test(t)) : LB.test(s['@type'] || '')));
    if (lbSchema) {
      out.schema.localBusinessNAP = {
        name: !!lbSchema.name, address: !!lbSchema.address, phone: !!lbSchema.telephone,
        hours: !!(lbSchema.openingHours || lbSchema.openingHoursSpecification), geo: !!lbSchema.geo,
        sameAs: !!(lbSchema.sameAs && (Array.isArray(lbSchema.sameAs) ? lbSchema.sameAs.length : 1)),
        image: !!lbSchema.image, priceRange: !!lbSchema.priceRange,
      };
    }
    const phone = bodyText.match(/(\(\d{3}\)\s*\d{3}[-.\s]?\d{4}|\d{3}[-.\s]\d{3}[-.\s]\d{4})/);
    out.local.phoneOnPage = !!phone; out.local.phone = phone ? phone[0] : null;
    out.local.zipOnPage = /\b\d{5}(-\d{4})?\b/.test(bodyText);
    out.local.googleMapsEmbed = /maps\.google\.com\/maps|google\.com\/maps\/embed|maps\.googleapis|google\.com\/maps\?/i.test(html);
    out.local.hoursMentioned = /\b(mon|tue|wed|thu|fri|sat|sun)(day)?\b[\s\S]{0,40}\d{1,2}\s*(am|pm|:)/i.test(bodyText);
    const socials = ['facebook.com','instagram.com','twitter.com','x.com','linkedin.com','youtube.com','tiktok.com','yelp.com','pinterest.com'];
    for (const p of socials) if (lc.includes(p)) out.local.socialLinks.push(p);
  }

  return out;
}


// ===== AI WEBSITE REVIEW + CONCIERGE HELPERS =====

async function aiCritique(targetUrl: string, businessType: string, goal: string) {
  const audit = await deepAudit(targetUrl);

  if (!audit.fetchedHtml) {
    return { error: 'unreachable' };
  }

  const op = audit.onPage || {};
  const local = audit.local || {};
  const schema = audit.schema || {};
  const disc = audit.discoverability || {};

  const facts = [
    `Domain: ${audit.domain}`,
    `HTTPS (secure): ${audit.https ? 'yes' : 'NO — not secure'}`,
    `Page title: ${op.title ? `"${op.title}" (${op.titleLength} chars)` : 'MISSING'}`,
    `Meta description: ${op.metaDescription ? `"${op.metaDescription}" (${op.metaDescriptionLength} chars)` : 'MISSING'}`,
    `Main headline (H1): ${op.h1Text ? `"${op.h1Text}"` : 'MISSING'} (count: ${op.h1Count})`,
    `Subheadings (H2/H3): ${op.h2Count}/${op.h3Count}`,
    `Visible word count: ${op.wordCount}`,
    `Images: ${op.imageCount} total, ${op.imagesWithAlt} have alt text`,
    `Internal links: ${op.internalLinks}, external links: ${op.externalLinks}`,
    `Social share preview (Open Graph): title ${op.ogTitle ? 'yes' : 'no'}, image ${op.ogImage ? 'yes' : 'no'}`,
    `Canonical tag: ${op.canonical ? 'present' : 'missing'}`,
    `Favicon: ${op.favicon ? 'yes' : 'no'}`,
    `Phone number on page: ${local.phoneOnPage ? (local.phone || 'yes') : 'NO'}`,
    `Address/ZIP on page: ${local.zipOnPage ? 'yes' : 'no'}`,
    `Google Map embedded: ${local.googleMapsEmbed ? 'yes' : 'no'}`,
    `Hours listed: ${local.hoursMentioned ? 'yes' : 'no'}`,
    `Social profile links: ${(local.socialLinks && local.socialLinks.length) ? local.socialLinks.join(', ') : 'none found'}`,
    `Structured data for Google: ${schema.blocks} block(s); LocalBusiness ${schema.hasLocalBusiness ? 'yes' : 'no'}, Organization ${schema.hasOrganization ? 'yes' : 'no'}`,
    `robots.txt: ${disc.robotsTxt ? (disc.robotsTxtBlocksAll ? 'present but BLOCKS Google' : 'present') : 'missing'}`,
    `Sitemap: ${disc.sitemapXml ? `yes (${disc.sitemapUrlCount} URLs)` : 'not found'}`,
  ].join('\n');

  const system = `You are Eric Davis, a friendly web designer in Los Angeles who runs Davis Digital Studio. A small business owner just asked for a free, honest review of their website. You are looking at REAL facts pulled from their live page (below). Your job is to tell them, in plain English, what is working and what is quietly costing them business, and what you would fix first.

Hard rules:
- Write like a real person talking to a non-technical business owner. Warm, direct, encouraging.
- NO jargon. If you must use a term, explain it in everyday words.
- NEVER use em dashes. Use commas, periods, or "and".
- Do not invent facts. Only comment on what the facts support. If something is fine, say so.
- Be honest but kind. Lead with at least one genuine strength. Do not fear-monger.
- Tie advice to THEIR goal and THEIR type of business wherever you can.
- This is free. Do not hard-sell. The point is to be useful first.

You must respond with ONLY valid JSON, no preamble, no markdown fences. Shape:
{
  "headline": "one short, specific sentence summarizing the overall state of their site",
  "intro": "2 to 3 warm sentences setting up what you found, mentioning their business type and goal naturally",
  "blocks": [
    {
      "type": "win" | "fix" | "watch",
      "label": "2-4 word custom label (optional, else omit)",
      "title": "the specific finding, plain English, under 10 words",
      "detail": "2 to 4 sentences explaining it simply and what to do about it",
      "why": "one sentence on why this matters for a business like theirs (optional)"
    }
  ]
}

Give 5 to 7 blocks total. Always include at least 1 "win". Order them most important first. Make the FIRST fix the single highest-impact thing.`;

  const user = `Business type: ${businessType}
Their #1 goal for the site: ${goal}

Real facts from their live website:
${facts}

Write the review now as JSON only.`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1800,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(45000),
    });

    const aiData = await aiRes.json();
    if (aiData.error) {
      return { error: 'ai_failed', message: aiData.error.message || 'AI error' };
    }

    let text = '';
    if (Array.isArray(aiData.content)) {
      text = aiData.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    }
    text = text.replace(/```json|```/g, '').trim();

    let parsed: any;
    try { parsed = JSON.parse(text); }
    catch (_) {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch (_2) { /* fall through */ } }
    }

    if (!parsed || !parsed.blocks || !Array.isArray(parsed.blocks) || !parsed.blocks.length) {
      return { error: 'parse_failed' };
    }

    parsed.domain = audit.domain;
    return parsed;

  } catch (e) {
    const isTimeout = e instanceof Error && (e.name === 'TimeoutError' || String(e).includes('timeout'));
    return { error: isTimeout ? 'timeout' : 'ai_failed', message: String(e) };
  }
}


function critiqueEmailHtml(domain: string, result: any) {
  const tagColor: Record<string, string> = { win: '#1d7a45', fix: '#b5651d', watch: '#a83440' };
  const tagBg: Record<string, string> = { win: '#e8f6ee', fix: '#fdeede', watch: '#fbe9ea' };
  const tagLabel: Record<string, string> = { win: 'Working', fix: 'Worth fixing', watch: 'Keep an eye on' };

  const blocks = (result.blocks || []).map((b: any) => {
    const t = (b.type || 'fix').toLowerCase();
    const lbl = b.label || tagLabel[t] || 'Worth a look';
    return `
      <div style="background:#1e1338;border-radius:12px;padding:18px 18px 16px;margin-bottom:12px;">
        <div style="margin-bottom:8px;"><span style="font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;padding:3px 10px;border-radius:100px;background:${tagBg[t] || '#fdeede'};color:${tagColor[t] || '#b5651d'};">${lbl}</span></div>
        <div style="font-family:Georgia,serif;font-size:17px;color:#fff;margin-bottom:7px;">${b.title || ''}</div>
        <div style="font-size:14px;color:rgba(255,255,255,0.65);line-height:1.65;">${b.detail || ''}</div>
        ${b.why ? `<div style="font-size:13px;color:rgba(196,174,232,0.85);margin-top:9px;">Why it matters: ${b.why}</div>` : ''}
      </div>`;
  }).join('');

  return emailWrap(`
    <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
      <a href="https://davisdigitalstudio.com" style="font-family:Georgia,serif;font-size:18px;color:#fff;text-decoration:none;display:block;margin-bottom:20px;">Davis<span style="color:#c4aee8;">Digital</span> Studio</a>
      <h1 style="font-family:Georgia,serif;font-size:23px;font-weight:400;color:#fff;margin:0 0 8px;">${result.headline || `Your website review for ${domain}`}</h1>
      <p style="font-size:14px;color:rgba(255,255,255,0.6);line-height:1.7;margin:0 0 22px;">${result.intro || ''}</p>
      ${blocks}
      <div style="text-align:center;margin-top:24px;">
        <a href="https://davisdigitalstudio.com/contact" style="display:inline-block;background:#5b3fa0;color:#fff;font-size:14px;font-weight:600;padding:13px 26px;border-radius:100px;text-decoration:none;">Book a free 15-minute call →</a>
      </div>
      <p style="text-align:center;font-size:12px;color:rgba(255,255,255,0.3);margin-top:22px;line-height:1.6;">This was a free first-pass review of ${domain}. Happy to talk through any of it, no charge.<br>Eric Davis · Davis Digital Studio · Los Angeles</p>
    </div>
  `);
}


const DDS_KNOWLEDGE = `
ABOUT DAVIS DIGITAL STUDIO
Davis Digital Studio is Eric Davis, a web designer in Los Angeles who builds websites and SEO for small businesses. Positioning: enterprise experience, small business heart. Fully remote, works with small businesses across the United States, local to LA. Eric brings nearly a decade of experience including managing 13 enterprise websites.

WEBSITE BUILDS (one-time pricing, every project includes a free discovery call to confirm scope and price)
1. Template — $1,500 one-time. Get online fast with a polished template build on whatever platform fits the business. Best for new businesses that need a clean, professional presence right away. Includes: your branding applied (colors, fonts, logo), up to 5 pages mobile-optimized, contact form and basic SEO setup, Google Analytics installation, 1 revision round, launch walkthrough video. You update it yourself, no code needed.
2. Custom + Photography — $3,800 one-time. A bespoke design with art-directed photography, built to rank and convert. For businesses ready to compete online. Includes: bespoke design and custom typography, art-directed photography with a shot list, mobile-first and performance-optimized, on-page SEO implementation, Google Analytics 4 and Search Console setup, Google Business Profile setup, 2 revision rounds, 30-day post-launch support. You update it yourself, no code.
3. Custom HTML — $6,500 one-time. The hand-coded version. No template limits, fastest performance, completely unique. For businesses that want the best. Includes: custom HTML, CSS, and JavaScript, mobile-first and performance-optimized, on-page SEO, Google Analytics 4 and Search Console setup, Google Business Profile setup, 2 revision rounds, 30-day post-launch support. Eric updates it since it is hand-coded.

PLATFORMS
Eric builds on any platform that fits the business: Squarespace, Webflow, or fully custom hand-coded HTML. The platform is chosen to fit the client, not forced.

TIMELINES
Template builds take 2 to 4 weeks. Custom + Photography takes 4 to 6 weeks. Custom HTML takes 6 to 10 weeks depending on scope. Rush delivery is available at a 25% surcharge.

PAYMENT
50% upfront, 50% at launch. Payment plans available. Payments are handled through Stripe.

ONGOING SUPPORT AFTER LAUNCH (3-month minimum either way)
- DIY — $0/mo. You manage updates yourself on the platform. Includes a launch walkthrough so your team can take it from here. Available on Template and Custom + Photography tiers.
- Managed — $400/mo. Eric handles updates, seasonal content, SEO monitoring, and a monthly performance report. Available on Template and Custom + Photography tiers.
- HTML Managed — $850/mo. Required for Custom HTML builds since the site is hand-coded. Eric handles every update, content change, and SEO improvement.
Every build also includes a 30-day post-launch support window at no extra cost.

AUDITS (paid, separate from a build, and the fee is credited toward any project)
- $99 — a real 1-page report you can act on, delivered in 24 hours.
- $499 — deeper audit delivered in 5 business days.
- $899 — most thorough, delivered in 7 business days.
Paid audits cover Lighthouse performance scores, mobile usability, search visibility, local presence, and a prioritized fix list in a branded report. There is also a FREE instant site score tool and a FREE AI Website Review tool on the site.

ADD-ONS (layer onto any package, priced per engagement)
- Brand Identity — from $500. Logo, color palette, typography system, and brand guidelines. This is how Eric handles logos and branding. Created with the help of AI tooling.
- Copywriting — from $400/page. Professional website copy written for clarity and conversion, with SEO keywords integrated.
- Google Ads Setup — from $600. Campaign structure, keyword targeting, and ad copy for a first paid search campaign.
- SEO Strategy roadmap — from $800. A data-driven roadmap built with SEMrush: keyword research, competitive analysis, and a 6-month content plan.
- Custom Widget or Feature — from $300. Interactive tools, calculators, quiz flows, booking integrations, or anything custom.

SEO
On-page and local SEO is built into every website project, not sold separately. Deeper SEO strategy work is available as the SEO Strategy add-on or an ongoing retainer. SEO work uses real keyword data from SEMrush, Google Business Profile optimization, on-page work, and technical fixes.

HOSTING
Eric builds the website but is not a web hosting company. He does not host sites. He builds the pages and sets them up on the platform that fits the client, and the client owns it.

EXISTING WEBSITES
If a business already has a website, Eric can make it better rather than always starting from scratch. The free AI Website Review or a paid audit is a good first step to see what is worth fixing.

WHAT MAKES A GOOD FIT FOR EACH TIER
Template fits new businesses or tight budgets that need a clean professional site quickly. Custom + Photography fits established businesses ready to invest in standing out and competing. Custom HTML fits businesses that want the absolute best, fully unique, fastest performance, no limits.
`;

const DDS_CALENDLY = 'https://calendly.com/eric-davisdigitalstudio/30min';

const GOOGLE_REVIEW_LINK = Deno.env.get('GOOGLE_REVIEW_LINK') || '';
const SCHEDULER_SECRET = Deno.env.get('SCHEDULER_SECRET') || '';
// OAuth state-signing secret. Dedicated secret preferred; falls back to
// SCHEDULER_SECRET so signing works even before a dedicated secret is set.
const STATE_SIGNING_SECRET = Deno.env.get('STATE_SIGNING_SECRET') || Deno.env.get('SCHEDULER_SECRET') || '';
const SURVEY_DELAY_DAYS = 4;
const CONTENT_NUDGE_EVERY_DAYS = 3;
const CONTENT_NUDGE_LEAD_DAYS = 2;


async function conciergeChat(messages: Array<{ role: string; content: string }>) {
  const system = `You are the friendly site concierge for Davis Digital Studio, the web design business of Eric Davis in Los Angeles. You talk to visitors on the website. Your purpose is to remove someone's hesitation and, when they are a good fit, gently guide them to book a free discovery call. You are not a pushy salesperson. You lead with genuine help.

YOUR THREE JOBS, in order of priority:
1. Answer "can you do X" (capabilities and services).
2. Answer "what does it cost" and "how long does it take".
3. Once you have helped, warmly offer to book a free discovery call with Eric.

ABSOLUTE RULES:
- Answer ONLY from the KNOWLEDGE BASE below. It is the single source of truth.
- NEVER invent or guess a price, a timeline, a service, or a capability. If a specific number or detail is not in the knowledge base, do not make one up.
- When you genuinely cannot answer from the knowledge base, say something natural like "That is a great question for Eric directly. You can grab a free 15 to 30 minute call with him here:" and share the booking link. Do not pretend to know.
- If someone asks for an exact quote for their specific project, explain that real projects vary so the honest answer is a quick free call where Eric confirms scope and an exact price. Give them the relevant tier and its starting price from the knowledge base first, then offer the call.
- Keep the booking link natural, not spammy. Offer it when it actually helps: after you have answered their question, or when only Eric can answer. Do not paste it in every single message.

STYLE:
- Plain, warm, conversational language. Talk like a helpful human, not a brochure.
- NEVER use em dashes. Use commas, periods, or the word "and".
- Keep replies short and easy to read on a phone. Two or three short sentences is usually plenty. Use a short list only when it truly helps (like comparing the three build tiers).
- Do not open every message with "Hi". You are mid-conversation.
- Be honest about what Eric does and does not do. For example, he builds sites but does not host them.

THE BOOKING LINK is: ${DDS_CALENDLY}
When you want to offer the call, end your message with the exact token [BOOK] on its own and the website will show a booking button. Use [BOOK] when offering the call rather than pasting the raw URL into a sentence.

KNOWLEDGE BASE:
${DDS_KNOWLEDGE}`;

  const clean = messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-16)
    .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));

  if (!clean.length || clean[0].role !== 'user') {
    return { reply: "Hey! I'm the studio assistant. Ask me anything about what Eric builds, what it costs, or how long it takes, and I'll point you in the right direction.", book: false };
  }

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system,
        messages: clean,
      }),
      signal: AbortSignal.timeout(30000),
    });

    const aiData = await aiRes.json();
    if (aiData.error) {
      return { reply: "Sorry, I hit a snag just then. You can always reach Eric directly with a quick free call.", book: true, error: aiData.error.message || 'ai_error' };
    }

    let text = '';
    if (Array.isArray(aiData.content)) {
      text = aiData.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    }
    text = (text || '').trim();

    let book = false;
    if (text.includes('[BOOK]')) {
      book = true;
      text = text.replace(/\[BOOK\]/g, '').trim();
    }
    if (text.includes(DDS_CALENDLY)) {
      book = true;
      text = text.split(DDS_CALENDLY).join('').replace(/\(\s*\)/g, '').replace(/:\s*$/,'').trim();
    }

    if (!text) {
      text = "Happy to help with that. Want to talk it through with Eric on a quick free call?";
      book = true;
    }

    return { reply: text, book };

  } catch (e) {
    const isTimeout = e instanceof Error && (e.name === 'TimeoutError' || String(e).includes('timeout'));
    return {
      reply: "Sorry, that took too long on my end. The fastest way to get your question answered is a quick free call with Eric.",
      book: true,
      error: isTimeout ? 'timeout' : String(e),
    };
  }
}

// ============================================================================
//  RELEASE 0.4 — CLIENT ARCHIVE SYSTEM (helpers)
//  Soft-delete the full client graph via deleted_at; restore by un-stamping;
//  owner-only purge hard-deletes children-first. All actions audited.
// ============================================================================
const ARCHIVE_GRAPH = {
  // tier 1 — keyed directly by client_id
  direct: [
    'client_requests', 'files', 'messages', 'approvals', 'invoices',
    'timeline', 'activity_log', 'notifications', 'client_onboarding',
    'intake_forms', 'file_comments',
  ],
  // tier 2 — keyed by contact_id
  byContact: ['projects', 'events', 'partnerships'],
  // tier 3 — keyed by partnership_id (full Growth history)
  byPartnership: [
    'partnership_goals', 'recommendations', 'growth_tasks', 'client_growth_tasks',
    'work_log', 'content_calendar', 'monthly_reviews', 'client_notes',
    'health_metrics', 'growth_quotes', 'growth_messages',
  ],
};

async function archiveDb(
  table: string, filterCol: string, filterVal: string,
  patch: Record<string, unknown> | null, hardDelete = false,
): Promise<{ ok: boolean; count: number; detail?: unknown }> {
  const headers: Record<string, string> = {
    apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`,
    'Content-Type': 'application/json', Prefer: 'return=representation',
  };
  const url = `${SB_URL}/rest/v1/${table}?${filterCol}=eq.${encodeURIComponent(filterVal)}`;
  const init: RequestInit = hardDelete
    ? { method: 'DELETE', headers }
    : { method: 'PATCH', headers, body: JSON.stringify(patch || {}) };
  try {
    const r = await fetch(url, init);
    const text = await r.text();
    let data: unknown = [];
    try { data = text ? JSON.parse(text) : []; } catch { data = []; }
    const count = Array.isArray(data) ? data.length : 0;
    return r.ok ? { ok: true, count } : { ok: false, count: 0, detail: data };
  } catch (e) {
    return { ok: false, count: 0, detail: String(e) };
  }
}

// ===== PHASE 4B: EBV ENGINE (v2, embedded for decision surface) =====

const EBV_VERSIONS = {
  v1: { weights:{impact:0.24,risk_if_ignored:0.18,confidence:0.14,urgency:0.12,time_to_value:0.10,effort:0.08,unblocks:0.08,goal_fit:0.06}, flags:{severityFloor:false,effortSuppress:false,clamp:false,criticalCoherentScore:false} },
  v2: { weights:{impact:0.25,risk_if_ignored:0.19,confidence:0.14,urgency:0.13,time_to_value:0.10,unblocks:0.08,effort:0.05,goal_fit:0.06}, flags:{severityFloor:true,effortSuppress:true,clamp:true,criticalCoherentScore:true} },
};
const EBV_ACTIVE = 'v2';
const _LV={none:0,low:0.33,medium:0.66,high:1};
const _TTV={immediate:1,fast:0.8,weeks:0.55,month:0.35,quarter:0.15};
const _EFF={tiny:1,low:0.8,medium:0.5,high:0.25,heavy:0.1};
const _CRIT=new Set(['outage','security','bug']);
const _CRANK={outage:3,bug:2,security:1};
const _FLAB={impact:'high business impact',risk_if_ignored:'real loss if it waits',confidence:'high confidence',urgency:'time-sensitive',time_to_value:'fast results',unblocks:'unblocks future work',effort:'low effort to deliver',goal_fit:'fits their goals'};
const _CLINE={outage:'the site is down — nothing converts until this is fixed',bug:'leads are silently vanishing through a broken form',security:'an exposed security hole needs to be closed now'};

function ebvScore(rec, client, fieldAvg) {
  const cfg = EBV_VERSIONS[EBV_ACTIVE], W = cfg.weights, F = cfg.flags;
  const f = {
    impact:_LV[rec.impact]??0, risk_if_ignored:_LV[rec.risk]??0, confidence:(rec.confidence??50)/100,
    urgency:_LV[rec.urgency]??0, time_to_value:_TTV[rec.ttv]??0.5, unblocks:Math.min((rec.unblocks??0)/3,1),
    effort:_EFF[rec.effort]??0.5, goal_fit:_LV[rec.goal_fit]??0,
  };
  const effW = F.effortSuppress ? W.effort*(1-0.7*f.urgency) : W.effort;
  let base=0; for (const k in W) base += (k==='effort'?effW:W[k]) * f[k];
  base *= 0.6 + 0.4*f.confidence;
  const isRisk=['risk','security','outage','bug','accessibility'].includes(rec.type);
  let ctx=1;
  if (client.health<60 && isRisk) ctx*=1.18;
  if (client.health>=80 && !isRisk) ctx*=1.10;
  if (client.stage==='onboarding' && rec.foundational) ctx*=1.12;
  if (client.stage==='mature' && rec.optimization) ctx*=1.06;
  let score=base*ctx*100;
  const tier=(F.severityFloor && _CRIT.has(rec.type))?1:0;
  if (tier===1 && F.criticalCoherentScore) score = 90 + _CRANK[rec.type]*3 + f.confidence;
  if (F.clamp) score=Math.min(100,Math.max(0,score));
  let reason;
  if (tier===1) reason = 'Critical — ' + (_CLINE[rec.type]||'needs immediate attention') + '.';
  else if (fieldAvg) {
    const d=Object.keys(_FLAB).map(k=>({k,edge:f[k]-(fieldAvg[k]??0),val:f[k]})).filter(x=>x.val>=0.5).sort((a,b)=>b.edge-a.edge).slice(0,3).map(x=>_FLAB[x.k]);
    reason = 'Ranked here because it has ' + d.join(', ') + '.';
  } else reason = 'Ranked by overall expected business value.';
  return { score:+score.toFixed(1), tier, critRank:_CRANK[rec.type]||0, factors:f, ranking_reason:reason };
}

// ── Map a raw recommendation row → EBV input shape ──
// The recs table stores impact/effort/confidence/why/depends; we infer type,
// urgency, ttv, unblocks, goal_fit defensively with sensible fallbacks.
function recToEbvInput(r) {
  const cat = String(r.category || r.ai_bucket || '').toLowerCase();
  let type = 'content';
  if (/outage|down|offline/.test(cat + ' ' + (r.title||''))) type = 'outage';
  else if (/security|vuln|exposed|breach/.test(cat)) type = 'security';
  else if (/broken|bug|form.*fail|not working/.test(cat + ' ' + (r.title||''))) type = 'bug';
  else if (/gbp|google business|citation|review|local/.test(cat)) type = 'local';
  else if (/track|analytics|conversion|measure/.test(cat)) type = 'foundation';
  else if (/speed|performance|web vital|core web/.test(cat)) type = 'performance';
  else if (/accessib|a11y|wcag/.test(cat)) type = 'accessibility';
  const dependsCount = Array.isArray(r.depends) ? r.depends.length : (r.depends ? 1 : 0);
  return {
    type,
    impact: r.impact || 'medium',
    risk: r.risk_if_ignored || (type==='outage'||type==='bug'||type==='security' ? 'high' : 'low'),
    confidence: r.confidence != null ? r.confidence : 75,
    urgency: r.urgency || (type==='outage'||type==='bug'||type==='security' ? 'high' : 'medium'),
    ttv: r.time_to_value || 'weeks',
    effort: r.effort || 'medium',
    unblocks: r.unblocks != null ? r.unblocks : 0,
    goal_fit: r.goal_fit || 'medium',
    foundational: /foundation|track|setup/.test(cat) || undefined,
    optimization: /optimi|improve|rewrite|speed/.test(cat) || undefined,
    _depends: dependsCount,
  };
}

// ── Build an Insight-contract object from a scored rec (Level-4 only) ──
function recToInsight(r, scored) {
  // predicted outcome WITH CONTEXT (never a naked number)
  const impactMap = { high:{range:'15-25%', basis:['past lifts for similar work','current ranking trends','site health']},
                      medium:{range:'8-15%', basis:['historical client improvements','current traffic trend']},
                      low:{range:'3-8%', basis:['general benchmarks']} };
  const im = impactMap[r.impact || 'medium'] || impactMap.medium;
  const confPct = scored.factors.confidence ? Math.round(scored.factors.confidence*100) : 75;
  return {
    level: 4,
    headline: r.title || 'Recommendation',
    why: r.why || r.detail || '',
    meaning: r.ai_reasoning || '',
    impact: { metric:'qualified leads', direction:'+', magnitude:im.range, basis:im.basis },
    confidence: { level: confPct>=85?'high':confPct>=70?'medium':'low', pct:confPct, reason:r.confidence_basis || 'based on similar work and current signals' },
    effort: r.effort==='low'||r.effort==='tiny' ? 'I handle it · quick' : r.effort==='high'||r.effort==='heavy' ? 'larger project' : 'I handle it · ~few days',
    dependencies: Array.isArray(r.depends) ? r.depends : (r.depends ? [r.depends] : []),
    predicted: `${im.range} more ${'qualified leads'} by next review`,
    assumptions: ['completed within 30 days','no major Google algorithm change','current traffic trend continues'],
    owner: r.needs_client_input ? 'client' : 'eric',
    urgency: scored.tier===1 ? 'urgent' : (r.urgency==='high'?'urgent':r.urgency==='low'?'fyi':'soon'),
    decision: { prompt: scored.tier===1 ? 'Fix this now?' : 'Move forward with this?', action:'approve_rec', ref:r.id },
    ebv_score: scored.score,
    ranking_reason: scored.ranking_reason,
    source: 'rule',
    deepenable: true,
  };
}


// ===== DATA FOUNDATION & INTEGRATIONS: provider framework =====
// ── The adapter contract every provider implements ──
//   id        : provider key (matches signals.source and client_integrations.provider)
//   label     : human name
//   kind      : 'internal' (no auth) | 'apikey' | 'oauth'
//   metrics   : the canonical metric keys this provider can produce
//   ingest    : async (ctx) => number  — fetch, normalize, writeSignal, return count
//   oauth?    : { authUrl(state), exchange(code), scopes } — only for kind:'oauth'
//
// ctx = { clientId, partnershipId, svc, integration?, writeSignal, rawStore, now }
interface AdapterCtx {
  clientId: string;
  partnershipId: string | null;
  svc: Record<string, string>;
  integration: any | null;            // the client_integrations row (oauth/apikey providers)
  now: number;
  putSignal: (metric: string, value: number | null, opts?: any) => Promise<void>;
  read: (path: string) => Promise<any>;
  rawStore: (source: string, payload: any, period?: string) => Promise<string | null>;
}
interface ProviderAdapter {
  id: string;
  label: string;
  kind: 'internal' | 'apikey' | 'oauth';
  metrics: string[];
  scope: 'internal' | 'client_visible' | 'ai_only';
  ingest: (ctx: AdapterCtx) => Promise<number>;
  oauth?: {
    scopes: string[];
    authUrl: (state: string, redirectUri: string) => string;
    exchange: (code: string, redirectUri: string) => Promise<{ access_token: string; refresh_token?: string; expires_in?: number }>;
  };
}

// ── shared helpers used by adapters ──

// ════════════════════════════════════════════════════════════════════════════
//  GOOGLE OAUTH (shared across GA4 / GSC / GBP — one consent, scoped tokens)
// ════════════════════════════════════════════════════════════════════════════
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') || '';
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || '';

async function googleExchange(code: string, redirectUri: string) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });
  if (!r.ok) throw new Error('google_token_exchange_failed: ' + (await r.text()).slice(0, 400));
  return await r.json();
}
async function googleRefresh(refreshToken: string): Promise<string | null> {
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ refresh_token: refreshToken, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token' }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.access_token || null;
  } catch { return null; }
}
// ── OAuth state signing (HMAC-SHA256) ──
// The state param round-trips through Google, so it must be tamper-proof.
// Format: base64url(payloadJson) + "." + base64url(hmac). Verify recomputes
// the HMAC and constant-time compares, then checks a freshness window.
function b64urlEncode(bytes: Uint8Array): string {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlEncodeStr(str: string): string { return b64urlEncode(new TextEncoder().encode(str)); }
function b64urlDecodeStr(b64: string): string {
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const s = b64.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return atob(s);
}
async function hmacSign(message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(STATE_SIGNING_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return b64urlEncode(new Uint8Array(sig));
}
async function signState(payload: Record<string, unknown>): Promise<string> {
  const body = b64urlEncodeStr(JSON.stringify(payload));
  const sig = await hmacSign(body);
  return `${body}.${sig}`;
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function verifyState(state: string, maxAgeMs = 15 * 60 * 1000): Promise<Record<string, any> | null> {
  if (!STATE_SIGNING_SECRET) return null; // fail closed if no secret configured
  const dot = state.lastIndexOf('.');
  if (dot < 1) return null;
  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = await hmacSign(body);
  if (!timingSafeEqual(sig, expected)) return null; // tampered or wrong secret
  let payload: any;
  try { payload = JSON.parse(b64urlDecodeStr(body)); } catch { return null; }
  if (!payload || typeof payload.ts !== 'number') return null;
  if (Date.now() - payload.ts > maxAgeMs) return null; // expired
  return payload;
}

function googleAuthUrl(scopes: string[], state: string, redirectUri: string) {
  const p = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code',
    scope: scopes.join(' '), access_type: 'offline', prompt: 'consent', state,
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + p.toString();
}

// ════════════════════════════════════════════════════════════════════════════
//  THE PROVIDER REGISTRY — add a provider by adding an entry here. Nothing else.
// ════════════════════════════════════════════════════════════════════════════
const PROVIDERS: Record<string, ProviderAdapter> = {

  // ── PageSpeed Insights (apikey; already have PSI_KEY) ──
  psi: {
    id: 'psi', label: 'PageSpeed Insights', kind: 'apikey', scope: 'client_visible',
    metrics: ['psi_performance', 'psi_seo', 'psi_accessibility', 'lcp_ms', 'cls'],
    ingest: async (ctx) => {
      const sites = await ctx.read(`monitored_sites?client_id=eq.${encodeURIComponent(ctx.clientId)}&select=url&limit=1`);
      const url = (sites || [])[0]?.url;
      if (!url || !PSI_KEY) return 0;
      const psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance&category=seo&category=accessibility&key=${PSI_KEY}`;
      const r = await fetch(psiUrl); if (!r.ok) return 0;
      const j = await r.json();
      const rawId = await ctx.rawStore('psi', j);
      const cats = j?.lighthouseResult?.categories || {};
      const audits = j?.lighthouseResult?.audits || {};
      let n = 0;
      const perf = cats.performance?.score != null ? Math.round(cats.performance.score * 100) : null;
      const seo = cats.seo?.score != null ? Math.round(cats.seo.score * 100) : null;
      const a11y = cats.accessibility?.score != null ? Math.round(cats.accessibility.score * 100) : null;
      const lcp = audits['largest-contentful-paint']?.numericValue ?? null;
      const cls = audits['cumulative-layout-shift']?.numericValue ?? null;
      if (perf != null) { await ctx.putSignal('psi_performance', perf, { unit: 'score_0_100', source: 'psi', scope: 'client_visible' }); n++; }
      if (seo != null) { await ctx.putSignal('psi_seo', seo, { unit: 'score_0_100', source: 'psi', scope: 'client_visible' }); n++; }
      if (a11y != null) { await ctx.putSignal('psi_accessibility', a11y, { unit: 'score_0_100', source: 'psi', scope: 'internal' }); n++; }
      if (lcp != null) { await ctx.putSignal('lcp_ms', Math.round(lcp), { unit: 'ms', source: 'psi', scope: 'internal' }); n++; }
      if (cls != null) { await ctx.putSignal('cls', Number(cls.toFixed(3)), { unit: 'score', source: 'psi', scope: 'internal' }); n++; }
      return n;
    },
  },

  // ── Google Analytics 4 (oauth) ──
  ga4: {
    id: 'ga4', label: 'Google Analytics', kind: 'oauth', scope: 'client_visible',
    metrics: ['sessions', 'conversions', 'engagement_rate'],
    oauth: {
      scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
      authUrl: (state, redirectUri) => googleAuthUrl(['https://www.googleapis.com/auth/analytics.readonly'], state, redirectUri),
      exchange: googleExchange,
    },
    ingest: async (ctx) => {
      const integ = ctx.integration; if (!integ || !integ.property_id) return 0;
      let token = integ.access_token;
      const propertyId = integ.property_id; // GA4 numeric property id
      // GA4 Data API: last 30 days vs previous 30, monthly granularity
      const body = {
        dateRanges: [{ startDate: '60daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'yearMonth' }],
        metrics: [{ name: 'sessions' }, { name: 'conversions' }, { name: 'engagementRate' }],
      };
      const callGA = async (tok: string) => fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
        method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      let r = await callGA(token);
      if (r.status === 401 && integ.refresh_token) { const fresh = await googleRefresh(integ.refresh_token); if (fresh) { token = fresh; await ctx.read(`client_integrations?id=eq.${integ.id}`); r = await callGA(token); } }
      if (!r.ok) return 0;
      const j = await r.json();
      await ctx.rawStore('ga4', j);
      const rows = j.rows || []; let n = 0;
      // write a signal per month so Growth can compute trajectory
      for (const row of rows) {
        const period = row.dimensionValues?.[0]?.value; // 'YYYYMM'
        if (!period) continue;
        const ym = period.slice(0, 4) + '-' + period.slice(4, 6);
        const sessions = Number(row.metricValues?.[0]?.value || 0);
        const conv = Number(row.metricValues?.[1]?.value || 0);
        const eng = Number(row.metricValues?.[2]?.value || 0);
        await ctx.putSignal('sessions', sessions, { unit: 'count', source: 'ga4', period: ym, scope: 'client_visible' }); n++;
        await ctx.putSignal('conversions', conv, { unit: 'count', source: 'ga4', period: ym, scope: 'client_visible' }); n++;
        await ctx.putSignal('engagement_rate', Math.round(eng * 100), { unit: 'pct', source: 'ga4', period: ym, scope: 'internal' }); n++;
      }
      return n;
    },
  },

  // ── Google Search Console (oauth) ──
  gsc: {
    id: 'gsc', label: 'Search Console', kind: 'oauth', scope: 'client_visible',
    metrics: ['search_clicks', 'search_impressions', 'search_ctr', 'avg_position'],
    oauth: {
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
      authUrl: (state, redirectUri) => googleAuthUrl(['https://www.googleapis.com/auth/webmasters.readonly'], state, redirectUri),
      exchange: googleExchange,
    },
    ingest: async (ctx) => {
      const integ = ctx.integration; if (!integ || !integ.property_id) return 0;
      let token = integ.access_token;
      const site = integ.property_id; // e.g. 'sc-domain:example.com' or 'https://example.com/'
      const mkBody = (start: string, end: string) => ({ startDate: start, endDate: end, dimensions: [] as string[], rowLimit: 1 });
      const monthRange = (offset: number) => { const d = new Date(); d.setMonth(d.getMonth() - offset); const s = new Date(d.getFullYear(), d.getMonth(), 1); const e = new Date(d.getFullYear(), d.getMonth() + 1, 0); const f = (x: Date) => x.toISOString().slice(0, 10); return { ym: f(s).slice(0, 7), start: f(s), end: f(e) }; };
      const callGSC = async (tok: string, b: any) => fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
        method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b),
      });
      let n = 0;
      for (const offset of [0, 1]) {
        const { ym, start, end } = monthRange(offset);
        let r = await callGSC(token, mkBody(start, end));
        if (r.status === 401 && integ.refresh_token) { const fresh = await googleRefresh(integ.refresh_token); if (fresh) { token = fresh; r = await callGSC(token, mkBody(start, end)); } }
        if (!r.ok) continue;
        const j = await r.json(); await ctx.rawStore('gsc', j, ym);
        const row = (j.rows || [])[0]; if (!row) continue;
        await ctx.putSignal('search_clicks', Math.round(row.clicks || 0), { source: 'gsc', period: ym, scope: 'client_visible' }); n++;
        await ctx.putSignal('search_impressions', Math.round(row.impressions || 0), { source: 'gsc', period: ym, scope: 'client_visible' }); n++;
        await ctx.putSignal('search_ctr', Math.round((row.ctr || 0) * 100), { unit: 'pct', source: 'gsc', period: ym, scope: 'internal' }); n++;
        await ctx.putSignal('avg_position', Number((row.position || 0).toFixed(1)), { unit: 'rank', source: 'gsc', period: ym, scope: 'client_visible' }); n++;
      }
      return n;
    },
  },

  // ── Google Business Profile (oauth) ──
  gbp: {
    id: 'gbp', label: 'Google Business Profile', kind: 'oauth', scope: 'client_visible',
    metrics: ['gbp_calls', 'gbp_direction_requests', 'gbp_website_clicks', 'gbp_review_count', 'gbp_avg_rating'],
    oauth: {
      scopes: ['https://www.googleapis.com/auth/business.manage'],
      authUrl: (state, redirectUri) => googleAuthUrl(['https://www.googleapis.com/auth/business.manage'], state, redirectUri),
      exchange: googleExchange,
    },
    ingest: async (ctx) => {
      const integ = ctx.integration; if (!integ || !integ.property_id) return 0;
      let token = integ.access_token;
      const location = integ.property_id; // 'locations/{id}'
      // GBP Performance API — monthly metric time series
      const end = new Date(); const start = new Date(); start.setMonth(start.getMonth() - 1);
      const dp = (d: Date) => ({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });
      const metrics = ['CALL_CLICKS', 'BUSINESS_DIRECTION_REQUESTS', 'WEBSITE_CLICKS'];
      const qs = metrics.map(m => `dailyMetric=${m}`).join('&') +
        `&dailyRange.start_date.year=${dp(start).year}&dailyRange.start_date.month=${dp(start).month}&dailyRange.start_date.day=${dp(start).day}` +
        `&dailyRange.end_date.year=${dp(end).year}&dailyRange.end_date.month=${dp(end).month}&dailyRange.end_date.day=${dp(end).day}`;
      const callGBP = async (tok: string) => fetch(`https://businessprofileperformance.googleapis.com/v1/${location}:fetchMultiDailyMetricsTimeSeries?${qs}`, { headers: { Authorization: `Bearer ${tok}` } });
      let r = await callGBP(token);
      if (r.status === 401 && integ.refresh_token) { const fresh = await googleRefresh(integ.refresh_token); if (fresh) { token = fresh; r = await callGBP(token); } }
      if (!r.ok) return 0;
      const j = await r.json(); await ctx.rawStore('gbp', j);
      let n = 0;
      const ym = new Date().toISOString().slice(0, 7);
      const sumMetric = (name: string) => {
        const series = (j.multiDailyMetricTimeSeries || []).flatMap((x: any) => x.dailyMetricTimeSeries || []).find((d: any) => d.dailyMetric === name);
        const pts = series?.timeSeries?.datedValues || [];
        return pts.reduce((s: number, p: any) => s + Number(p.value || 0), 0);
      };
      const calls = sumMetric('CALL_CLICKS');
      const dirs = sumMetric('BUSINESS_DIRECTION_REQUESTS');
      const webc = sumMetric('WEBSITE_CLICKS');
      await ctx.putSignal('gbp_calls', calls, { source: 'gbp', period: ym, scope: 'client_visible' }); n++;
      await ctx.putSignal('gbp_direction_requests', dirs, { source: 'gbp', period: ym, scope: 'client_visible' }); n++;
      await ctx.putSignal('gbp_website_clicks', webc, { source: 'gbp', period: ym, scope: 'client_visible' }); n++;
      return n;
    },
  },
};

// ── shared sync engine: runs provider adapters for ONE client. Used by both
//    the manual provider_sync route AND the nightly scheduler — one engine,
//    no divergence. Logs sync_log + stamps client_integrations identically. ──
async function syncClientProviders(clientId: string, onlyProvider: string | null): Promise<any[]> {
  const svc = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` };
  const { partnershipId } = await resolveClientGraph(clientId);
  const ir = await fetch(`${SB_URL}/rest/v1/client_integrations?client_id=eq.${encodeURIComponent(clientId)}&select=*`, { headers: svc });
  const integrations = ir.ok ? await ir.json() : [];
  const integByProvider: Record<string, any> = {};
  for (const i of (integrations || [])) integByProvider[i.provider] = i;

  const results: any[] = [];
  for (const adapter of Object.values(PROVIDERS)) {
    if (onlyProvider && adapter.id !== onlyProvider) continue;
    // graceful: oauth providers that aren't connected are skipped, not failed
    if (adapter.kind === 'oauth' && integByProvider[adapter.id]?.status !== 'connected') { results.push({ provider: adapter.id, status: 'skipped', reason: 'not_connected' }); continue; }
    try {
      const ctx = makeAdapterCtx(clientId, partnershipId, integByProvider[adapter.id] || null);
      const n = await adapter.ingest(ctx);
      await fetch(`${SB_URL}/rest/v1/sync_log`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }, body: JSON.stringify({ client_id: clientId, source: adapter.id, status: 'ok', signals_written: n }) });
      if (integByProvider[adapter.id]) await fetch(`${SB_URL}/rest/v1/client_integrations?client_id=eq.${encodeURIComponent(clientId)}&provider=eq.${adapter.id}`, { method: 'PATCH', headers: { ...svc, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }, body: JSON.stringify({ last_sync_at: new Date().toISOString(), error: null }) });
      results.push({ provider: adapter.id, status: 'ok', signals_written: n });
    } catch (e) {
      await fetch(`${SB_URL}/rest/v1/sync_log`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }, body: JSON.stringify({ client_id: clientId, source: adapter.id, status: 'error', error: String(e).slice(0, 300) }) });
      if (integByProvider[adapter.id]) await fetch(`${SB_URL}/rest/v1/client_integrations?client_id=eq.${encodeURIComponent(clientId)}&provider=eq.${adapter.id}`, { method: 'PATCH', headers: { ...svc, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }, body: JSON.stringify({ error: String(e).slice(0, 300) }) });
      results.push({ provider: adapter.id, status: 'error', error: String(e).slice(0, 200) });
    }
  }
  return results;
}

// ── shared ctx factory ──
function makeAdapterCtx(clientId: string, partnershipId: string | null, integration: any | null): AdapterCtx {
  const svc = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` };
  const read = async (p: string) => { try { const r = await fetch(`${SB_URL}/rest/v1/${p}`, { headers: svc }); return r.ok ? await r.json() : []; } catch { return []; } };
  const rawStore = async (source: string, payload: any, period?: string) => {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/raw_ingestions`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', 'Prefer': 'return=representation' }, body: JSON.stringify({ client_id: clientId, source, payload, period: period || null }) });
      if (!r.ok) return null; const rows = await r.json(); return rows?.[0]?.id || null;
    } catch { return null; }
  };
  const putSignal = async (metric: string, value: number | null, opts: any = {}) => {
    await writeSignal(svc, { client_id: clientId, partnership_id: partnershipId, metric, value, confidence: 'measured', ...opts });
  };
  return { clientId, partnershipId, svc, integration, now: Date.now(), putSignal, read, rawStore };
}

// ===== DATA FOUNDATION (Phase A): adapters + scores =====
// ── signal write helper: idempotent upsert on (client,metric,period,source) ──
async function writeSignal(svc: Record<string,string>, sig: {
  client_id: string|null; partnership_id?: string|null; metric: string; value: number|null;
  unit?: string; period?: string; observed_at?: string; source: string;
  confidence?: string; scope?: string;
}) {
  const row = {
    client_id: sig.client_id, partnership_id: sig.partnership_id ?? null,
    metric: sig.metric, value: sig.value,
    unit: sig.unit ?? 'count', period: sig.period ?? 'point',
    observed_at: sig.observed_at ?? new Date().toISOString(),
    source: sig.source, confidence: sig.confidence ?? 'measured',
    scope: sig.scope ?? 'internal',
  };
  // upsert via PostgREST: on_conflict the unique fact index, merge-duplicates
  const url = `${SB_URL}/rest/v1/signals?on_conflict=client_id,metric,period,source`;
  await fetch(url, {
    method: 'POST',
    headers: { ...svc, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  });
}

// ── the internal adapter: existing tables → canonical signals for one client ──
async function ingestInternalSignals(svc: Record<string,string>, clientId: string): Promise<number> {
  const read = async (p: string) => { try { const r = await fetch(`${SB_URL}/rest/v1/${p}`, { headers: svc }); return r.ok ? await r.json() : []; } catch { return []; } };
  const { contactId, partnershipId } = await resolveClientGraph(clientId);
  const pid = partnershipId;
  const now = Date.now(); const DAY = 86400000;
  const thisMonth = new Date().toISOString().slice(0, 7);
  let n = 0;
  const put = async (m: string, v: number|null, opts: any = {}) => { await writeSignal(svc, { client_id: clientId, partnership_id: pid, metric: m, value: v, source: 'derived', ...opts }); n++; };

  // ── FINANCIAL (invoices) ──
  const invoices = await read(`invoices?client_id=eq.${encodeURIComponent(clientId)}&deleted_at=is.null&select=amount,status,due_date,created_at&limit=200`);
  const unpaid = (invoices || []).filter((i: any) => i.status && i.status !== 'paid');
  const overdue = unpaid.filter((i: any) => i.due_date && new Date(i.due_date).getTime() < now);
  const overdueAmt = overdue.reduce((s: number, i: any) => s + (Number(i.amount) || 0), 0);
  const overdueDays = overdue.length ? Math.floor((now - Math.min(...overdue.map((i: any) => new Date(i.due_date).getTime()))) / DAY) : 0;
  const ltv = (invoices || []).filter((i: any) => i.status === 'paid').reduce((s: number, i: any) => s + (Number(i.amount) || 0), 0);
  await put('overdue_amount', overdueAmt, { unit: 'usd', source: 'crm', scope: 'internal' });
  await put('overdue_days', overdueDays, { source: 'crm', scope: 'internal' });
  await put('lifetime_value', ltv, { unit: 'usd', source: 'crm', scope: 'internal' });

  // ── RELATIONSHIP (messages) ──
  const messages = await read(`messages?client_id=eq.${encodeURIComponent(clientId)}&deleted_at=is.null&select=from_who,created_at&order=created_at.desc&limit=100`);
  if ((messages || []).length) {
    const lastDays = Math.floor((now - new Date(messages[0].created_at).getTime()) / DAY);
    await put('days_since_contact', lastDays, { source: 'crm', scope: 'internal' });
    await put('unanswered_client_msg', messages[0].from_who === 'client' ? 1 : 0, { unit: 'bool', source: 'crm', scope: 'internal' });
    // response rate: of client messages, how many got a later non-client reply
    const sorted = [...messages].reverse();
    let clientMsgs = 0, replied = 0;
    for (let i = 0; i < sorted.length; i++) { if (sorted[i].from_who === 'client') { clientMsgs++; if (sorted.slice(i + 1).some((m: any) => m.from_who !== 'client')) replied++; } }
    if (clientMsgs) await put('client_response_rate', Math.round((replied / clientMsgs) * 100), { unit: 'pct', confidence: 'estimated', source: 'crm', scope: 'ai_only' });
  } else {
    await put('days_since_contact', 999, { confidence: 'estimated', source: 'crm', scope: 'internal' });
  }

  // ── DELIVERY (approvals, requests, projects) ──
  const approvals = await read(`approvals?client_id=eq.${encodeURIComponent(clientId)}&deleted_at=is.null&status=eq.pending&select=created_at&limit=50`);
  await put('open_approvals', (approvals || []).length, { source: 'crm', scope: 'client_visible' });
  if ((approvals || []).length) {
    const oldest = Math.floor((now - Math.min(...approvals.map((a: any) => new Date(a.created_at).getTime()))) / DAY);
    await put('approval_age_days', oldest, { source: 'crm', scope: 'internal' });
  }
  const requests = await read(`client_requests?client_id=eq.${encodeURIComponent(clientId)}&deleted_at=is.null&select=status&limit=50`);
  await put('open_requests', (requests || []).filter((r: any) => (r.status || '') !== 'done' && (r.status || '') !== 'closed').length, { source: 'crm', scope: 'client_visible' });
  if (contactId) {
    const projects = await read(`projects?contact_id=eq.${encodeURIComponent(contactId)}&deleted_at=is.null&select=progress,stage,updated_at&order=created_at.desc&limit=1`);
    if ((projects || []).length) {
      const p = projects[0];
      if (p.progress != null) await put('project_progress', Number(p.progress), { unit: 'pct', source: 'crm', scope: 'client_visible' });
      if (p.updated_at && (p.stage || '') !== 'complete') {
        const stalled = Math.floor((now - new Date(p.updated_at).getTime()) / DAY);
        await put('project_stalled_days', stalled, { confidence: 'estimated', source: 'crm', scope: 'internal' });
      }
    }
  }

  // ── GROWTH PROOF (work_log) ──
  if (pid) {
    const work = await read(`work_log?partnership_id=eq.${pid}&select=done_at&order=done_at.desc&limit=100`);
    const completed30 = (work || []).filter((w: any) => w.done_at && (now - new Date(w.done_at).getTime()) < 30 * DAY).length;
    await put('work_completed_30d', completed30, { source: 'crm', scope: 'client_visible' });
    // review currency
    const reviews = await read(`monthly_reviews?partnership_id=eq.${pid}&select=period,status&order=period.desc&limit=1`);
    const current = (reviews || []).length && reviews[0].period >= thisMonth ? 1 : 0;
    await put('review_current', current, { unit: 'bool', source: 'crm', scope: 'client_visible' });
  }

  // ── TECHNICAL (site_checks — REAL PSI scans already running) ──
  const sites = await read(`monitored_sites?client_id=eq.${encodeURIComponent(clientId)}&select=id&limit=1`);
  if ((sites || []).length) {
    const sid = sites[0].id;
    const checks = await read(`site_checks?site_id=eq.${encodeURIComponent(sid)}&select=performance,visibility,https,overall,checked_at&order=checked_at.desc&limit=1`);
    if ((checks || []).length) {
      const c = checks[0];
      const age = c.checked_at ? (now - new Date(c.checked_at).getTime()) / DAY : 999;
      const conf = age > 14 ? 'stale' : 'measured';   // scans older than 2 weeks degrade
      const obs = c.checked_at || new Date().toISOString();
      if (c.performance != null) await put('psi_performance', Number(c.performance), { unit: 'score_0_100', source: 'psi', confidence: conf, scope: 'client_visible', observed_at: obs });
      if (c.visibility != null) await put('psi_seo', Number(c.visibility), { unit: 'score_0_100', source: 'psi', confidence: conf, scope: 'client_visible', observed_at: obs });
      if (c.https != null) await put('https_valid', c.https ? 1 : 0, { unit: 'bool', source: 'monitor', confidence: conf, scope: 'client_visible', observed_at: obs });
      if (c.overall != null) await put('site_health_raw', Number(c.overall), { unit: 'score_0_100', source: 'psi', confidence: conf, scope: 'internal', observed_at: obs });
    }
  }

  return n;
}

// ── derived scores: pure functions of signals, each explains its inputs ──
function latestSignal(signals: any[], metric: string): any | null {
  const m = signals.filter(s => s.metric === metric).sort((a, b) => new Date(b.observed_at).getTime() - new Date(a.observed_at).getTime());
  return m.length ? m[0] : null;
}
const CONF_RANK: Record<string,number> = { measured: 3, estimated: 2, manual: 2, stale: 1 };
function weakestConfidence(sigs: (any|null)[]): string {
  const present = sigs.filter(Boolean);
  if (!present.length) return 'estimated';
  return present.reduce((w, s) => (CONF_RANK[s.confidence] ?? 2) < (CONF_RANK[w.confidence] ?? 2) ? s : w).confidence;
}

function computeScores(signals: any[]) {
  const v = (m: string) => { const s = latestSignal(signals, m); return s ? Number(s.value) : null; };
  const used: string[] = [];
  const track = (m: string) => { if (latestSignal(signals, m)) used.push(m); return latestSignal(signals, m); };

  // Business Health (present state)
  const bhInputs = [track('overdue_amount'), track('days_since_contact'), track('open_approvals'), track('psi_performance'), track('site_health_raw')];
  let businessHealth: number | null = null; let bhDrivers: string[] = [];
  {
    const parts: number[] = [];
    const od = v('overdue_amount'); if (od != null) { parts.push(od === 0 ? 100 : Math.max(0, 100 - Math.min(od / 10, 60))); if (od > 0) bhDrivers.push('overdue payment'); }
    const dsc = v('days_since_contact'); if (dsc != null) { parts.push(dsc <= 7 ? 100 : dsc <= 21 ? 75 : 45); if (dsc > 21) bhDrivers.push('gone quiet'); }
    const oa = v('open_approvals'); if (oa != null) { parts.push(oa === 0 ? 100 : Math.max(40, 100 - oa * 15)); if (oa > 0) bhDrivers.push('pending approvals'); }
    const perf = v('psi_performance'); if (perf != null) { parts.push(perf); if (perf < 60) bhDrivers.push('slow site'); }
    if (parts.length >= 2) businessHealth = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
  }

  // Growth (trajectory) — best available signal, this period vs prior
  let growth: number | null = null; let growthWhy = ''; let growthConf = 'measured';
  {
    const candidates = ['conversions', 'gbp_calls', 'search_clicks', 'work_completed_30d'];
    for (const metric of candidates) {
      const rows = signals.filter(s => s.metric === metric).sort((a, b) => new Date(b.observed_at).getTime() - new Date(a.observed_at).getTime());
      if (rows.length >= 2 && Number(rows[1].value) > 0) {
        growth = Math.round(((Number(rows[0].value) - Number(rows[1].value)) / Number(rows[1].value)) * 100);
        growthWhy = metric === 'conversions' ? 'more conversions' : metric === 'gbp_calls' ? 'more calls' : metric === 'search_clicks' ? 'more search traffic' : 'more work delivered';
        growthConf = rows[0].confidence; break;
      }
    }
  }

  // Relationship Health (NEW) — communication + responsiveness + proof + satisfaction proxy
  const rhInputs = [track('days_since_contact'), track('client_response_rate'), track('work_completed_30d'), track('review_current'), track('open_approvals')];
  let relationshipHealth: number | null = null; let rhNote = '';
  {
    const parts: number[] = [];
    const dsc = v('days_since_contact'); if (dsc != null) parts.push(dsc <= 7 ? 100 : dsc <= 21 ? 70 : 40);
    const rr = v('client_response_rate'); if (rr != null) parts.push(rr);
    const wc = v('work_completed_30d'); if (wc != null) parts.push(Math.min(100, wc * 25));
    const rc = v('review_current'); if (rc != null) parts.push(rc ? 100 : 60);
    if (parts.length >= 2) { relationshipHealth = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
      rhNote = relationshipHealth >= 80 ? 'strong and active' : relationshipHealth >= 60 ? 'steady' : 'needs warming up'; }
  }

  // Website Health — site_up gate, else technical composite
  const whInputs = [track('https_valid'), track('psi_performance'), track('psi_seo')];
  let websiteHealth: number | null = null;
  {
    const parts: number[] = [];
    const perf = v('psi_performance'); if (perf != null) parts.push(perf);
    const seo = v('psi_seo'); if (seo != null) parts.push(seo);
    const https = v('https_valid'); if (https != null) parts.push(https ? 100 : 50);
    if (parts.length) websiteHealth = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
  }

  return {
    business_health: businessHealth == null ? null : { value: businessHealth, drivers: bhDrivers, confidence: weakestConfidence(bhInputs), inputs: used.filter(u => ['overdue_amount','days_since_contact','open_approvals','psi_performance','site_health_raw'].includes(u)) },
    growth: growth == null ? null : { value: growth, why: growthWhy, confidence: growthConf },
    relationship_health: relationshipHealth == null ? null : { value: relationshipHealth, note: rhNote, confidence: weakestConfidence(rhInputs), inputs: used.filter(u => ['days_since_contact','client_response_rate','work_completed_30d','review_current'].includes(u)) },
    website_health: websiteHealth == null ? null : { value: websiteHealth, confidence: weakestConfidence(whInputs), inputs: used.filter(u => ['https_valid','psi_performance','psi_seo'].includes(u)) },
  };
}

// ── persist the four derived scores as signals so trend history accumulates ──
// Writes one row per score per period (month). The signals table's unique
// (client,metric,period,source) makes this idempotent — re-running in the same
// month updates rather than duplicates, so a daily nightly run yields one point
// per month that reflects the latest computation.
async function persistScores(svc: Record<string,string>, clientId: string, partnershipId: string | null): Promise<number> {
  const r = await fetch(`${SB_URL}/rest/v1/signals?client_id=eq.${encodeURIComponent(clientId)}&select=metric,value,unit,period,observed_at,source,confidence,scope&order=observed_at.desc&limit=500`, { headers: svc });
  const signals = r.ok ? await r.json() : [];
  const scores = computeScores(signals || []);
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM
  const map: Array<[string, any]> = [
    ['business_health', scores.business_health],
    ['growth_score', scores.growth],
    ['relationship_health', scores.relationship_health],
    ['website_health_score', scores.website_health],
  ];
  let n = 0;
  for (const [metric, score] of map) {
    if (!score || score.value == null) continue; // never persist a null/fake score
    await writeSignal(svc, { client_id: clientId, partnership_id: partnershipId, metric, value: score.value, unit: 'score_0_100', period, source: 'derived', confidence: score.confidence || 'estimated', scope: 'internal' });
    n++;
  }
  return n;
}

// ===== PORTFOLIO INTELLIGENCE: attention signals =====
const ATTENTION_SIGNALS = {
  revenue_at_risk:   { weight: 100, kind: 'risk' },   // overdue invoice on an active client
  churn_risk:        { weight: 95,  kind: 'risk' },    // health dropping / gone quiet
  blocked_approval:  { weight: 80,  kind: 'unblock' }, // a rec/work blocked on client sign-off Eric can chase
  waiting_on_eric:   { weight: 75,  kind: 'owed' },    // client is waiting — ball in Eric's court
  review_due:        { weight: 60,  kind: 'cadence' }, // monthly review due (the retention moment)
  renewal_window:    { weight: 55,  kind: 'opportunity' },
  high_opportunity:  { weight: 50,  kind: 'opportunity' }, // a high-EBV rec ready to pitch
  work_near_done:    { weight: 40,  kind: 'momentum' },    // ship it, get the win logged
  followup_due:      { weight: 35,  kind: 'cadence' },
  proposal_stale:    { weight: 58,  kind: 'opportunity' }, // a sent quote going cold — chase before it dies
};

async function resolveClientGraph(clientId: string): Promise<{ contactId: string | null; partnershipId: string | null }> {
  const svc = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` };
  let contactId: string | null = null, partnershipId: string | null = null;
  try {
    const cr = await fetch(`${SB_URL}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id,contact_id&limit=1`, { headers: svc });
    const rows = cr.ok ? await cr.json() : [];
    if (Array.isArray(rows) && rows.length && rows[0].contact_id) contactId = String(rows[0].contact_id);
  } catch (_) { /* ignore */ }
  try {
    const pr = await fetch(`${SB_URL}/rest/v1/partnerships?client_id=eq.${encodeURIComponent(clientId)}&select=id,contact_id&limit=1`, { headers: svc });
    const rows = pr.ok ? await pr.json() : [];
    if (Array.isArray(rows) && rows.length) {
      partnershipId = String(rows[0].id);
      if (!contactId && rows[0].contact_id) contactId = String(rows[0].contact_id);
    }
  } catch (_) { /* ignore */ }
  return { contactId, partnershipId };
}

async function logClientAudit(entry: {
  clientId: string; clientName?: string; action: 'archive' | 'restore' | 'purge';
  actorEmail?: string; actorRole?: string; reason?: string; affected?: Record<string, number>;
}) {
  try {
    await fetch(`${SB_URL}/rest/v1/client_audit_log`, {
      method: 'POST',
      headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        client_id: entry.clientId, client_name: entry.clientName || null,
        action: entry.action, actor_email: entry.actorEmail || null,
        actor_role: entry.actorRole || null, reason: entry.reason || null,
        affected: entry.affected || {},
      }),
    });
  } catch (_) { /* audit write is best-effort; never blocks the operation */ }
}

// ===== end helpers =====


// ════════════════════════════════════════════════════════════════════════════
//  REASONING ENGINE — the platform's one brain.
//
//  Architecture (three layers, one service; see the operating-system directive):
//
//    1. COLLECTORS  — pure async functions, one per module, each emitting
//                     neutral Observations (facts, never opinions). Adding a
//                     module = adding a collector. Nothing else changes.
//
//    2. INTERPRETER — deterministic. Takes Observations, applies the
//                     ATTENTION_SIGNALS weight table, clusters by subject, and
//                     ranks. This is the inspectable, auditable, explainable
//                     business logic. AI NEVER touches ranking, priority, or
//                     urgency. This layer alone decides what matters.
//
//    3. NARRATOR    — AI on top, never instead. Interprets, connects across
//                     modules, explains, summarizes, drafts, surfaces patterns.
//                     Always grounded in the interpreter's output. Always
//                     disposable: if the model errors or is slow, the
//                     deterministic answer stands. Business rules stay separate
//                     from AI-generated reasoning, always.
//
//  QUERYABLE INTERFACE: every module calls reason() with a QuestionIntent.
//  The Brief asks 'who_needs_attention'. Opportunities asks
//  'strongest_opportunity'. Clients asks 'most_at_risk'. One brain, many
//  questions. No module implements its own AI logic.
//
//  This is infrastructure, not a feature. New modules emit observations and
//  consume shared intelligence. The layer is designed to never be replaced.
// ════════════════════════════════════════════════════════════════════════════

type ObsModule = 'Billing' | 'Clients' | 'Partnerships' | 'Inbox' | 'Opportunities' | 'Monitoring' | 'Domains' | 'Analytics' | 'Proposals' | 'Tasks';
type Confidence = 'high' | 'medium' | 'low';

// An Observation is a neutral fact a module reports. Collectors produce these.
// The interpreter turns them into ranked Attention. Never an opinion, never a
// rank — just "this is true about this subject right now."
interface Observation {
  id: string;               // stable id, e.g. 'inv_<clientId>'
  signal: keyof typeof ATTENTION_SIGNALS; // maps to the weight table
  module: ObsModule;        // where it came from
  subjectId: string;        // the entity it concerns (clientId, leadId, ...)
  subject: string;          // human label, e.g. 'Bacchus Kitchen'
  changed: string;          // what changed, plain English (Q: what changed)
  why: string;              // why it matters (Q: why)
  action: string;           // the suggested next move (Q: what to do)
  impact: string;           // business impact, e.g. '$1,200 at risk'
  confidence: Confidence;   // honest confidence in THIS observation
  go: string;               // front-end route key to act on it
  refId: string;            // id the front-end deep-links to
  canDraft?: boolean;       // can the AI pre-draft a reply here
  magnitude?: number;       // optional numeric size (e.g. $ amount) for tie-break
}

// The interpreter's output unit: a ranked, explained call on one subject.
interface AttentionItem extends Observation {
  weight: number;           // deterministic priority from ATTENTION_SIGNALS
  kind: string;             // risk | unblock | owed | cadence | opportunity | momentum
  also?: string[];          // other observations on the same subject, briefly
  score: number;            // final deterministic score (weight + clustering bonus)
}

// ── small shared db reader, service-role, fail-soft ──
// Always returns an array. Postgrest can return a 200 with a NON-array error
// object (e.g. a selected column doesn't exist, or certain RLS responses); if we
// passed that through, every collector's `for..of` and every `.find`/`.filter`
// on the result would throw and take down the whole brain. Guarding the shape
// here protects every consumer at once — the snapshot is only ever arrays.
function _svc() { return { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` }; }
async function _read(path: string): Promise<any[]> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: _svc() });
    if (!r.ok) return [];
    const body = await r.json();
    return Array.isArray(body) ? body : [];
  } catch (_) { return []; }
}
// coerce any value to a safe array — the engine never iterates a non-array
function _arr(v: any): any[] { return Array.isArray(v) ? v : []; }
const _now = () => Date.now();
const _DAY = 86400000;
const _daysAgo = (iso: string | null) => iso ? Math.floor((_now() - new Date(iso).getTime()) / _DAY) : null;
const _daysUntil = (iso: string | null) => iso ? Math.floor((new Date(iso).getTime() - _now()) / _DAY) : null;
const _money = (v: any) => Number(String(v == null ? 0 : v).replace(/[^0-9.]/g, '')) || 0;

// ════════════════════════════════════════════════════════════════════════════
//  LAYER 1 — COLLECTORS. One per module. Each returns Observations.
//  A new module plugs in by adding a collector to COLLECTORS below.
// ════════════════════════════════════════════════════════════════════════════

interface PlatformSnapshot {
  clients: any[]; invoices: any[]; approvals: any[]; projects: any[];
  messages: any[]; partnerships: any[]; reviews: any[]; recs: any[];
  leads: any[]; auditLeads: any[]; quotes: any[];
  // indexes
  pByClient: Record<string, any>; contactToClient: Record<string, string>;
  invByClient: Record<string, any[]>; apprByClient: Record<string, any[]>;
  msgByClient: Record<string, any[]>; recsByP: Record<string, any[]>;
  reviewByP: Record<string, any>; projByClient: Record<string, any[]>;
  clientByPartnership: Record<string, { clientId: string; name: string }>;
}

// gather the whole platform once; collectors read from this shared snapshot so
// we never hit the database more than once per reasoning call.
async function gatherSnapshot(): Promise<PlatformSnapshot> {
  const [clients, invoices, approvals, projects, messages, partnerships, reviews, recs, leads, auditLeads, quotes] = await Promise.all([
    _read(`clients?deleted_at=is.null&select=id,name,business_type,industry,monthly_amount,status,renews_at,progress&limit=500`),
    _read(`invoices?deleted_at=is.null&status=neq.paid&select=client_id,amount,status,due_date&limit=500`),
    _read(`approvals?deleted_at=is.null&status=eq.pending&select=client_id,title,created_at&limit=500`),
    _read(`projects?deleted_at=is.null&stage=neq.complete&select=contact_id,name,stage,ball_in_court,progress,updated_at&limit=500`),
    _read(`messages?deleted_at=is.null&select=client_id,from_who,text,created_at&order=created_at.desc&limit=1000`),
    _read(`partnerships?deleted_at=is.null&select=id,client_id,contact_id&limit=500`),
    _read(`monthly_reviews?select=partnership_id,period,status&order=period.desc&limit=500`),
    _read(`recommendations?deleted_at=is.null&select=partnership_id,title,impact,confidence,status&limit=1000`),
    _read(`leads?select=id,name,email,subject,status,unread,last_actor,created_at,updated_at&order=updated_at.desc&limit=300`),
    _read(`audit_leads?select=id,business_name,url,city,business_type,score,client_email,status,pipeline_stage,created_at&order=created_at.desc&limit=300`),
    _read(`growth_quotes?select=id,partnership_id,recommendation_id,status,amount,created_at,responded_at&order=created_at.desc&limit=200`),
  ]);
  const pByClient: Record<string, any> = {};
  const contactToClient: Record<string, string> = {};
  for (const p of (partnerships || [])) { pByClient[String(p.client_id)] = p; if (p.contact_id) contactToClient[String(p.contact_id)] = String(p.client_id); }
  const grp = (rows: any[], key: string) => { const m: Record<string, any[]> = {}; for (const r of rows) { const k = String(r[key] || ''); if (!k) continue; (m[k] ||= []).push(r); } return m; };
  const reviewByP: Record<string, any> = {};
  for (const r of (reviews || [])) { const k = String(r.partnership_id || ''); if (!reviewByP[k]) reviewByP[k] = r; }
  const projByClient: Record<string, any[]> = {};
  for (const pr of (projects || [])) { const cid = contactToClient[String(pr.contact_id || '')]; if (!cid) continue; (projByClient[cid] ||= []).push(pr); }
  // partnership id -> { clientId, client name } so proposal/quote signals can name the client
  const clientByPartnership: Record<string, { clientId: string; name: string }> = {};
  for (const p of (partnerships || [])) {
    const cid = String(p.client_id || '');
    const c = (clients || []).find((x: any) => String(x.id) === cid);
    clientByPartnership[String(p.id)] = { clientId: cid, name: (c && c.name) || 'a client' };
  }
  return {
    clients, invoices, approvals, projects, messages, partnerships, reviews, recs, leads, auditLeads, quotes,
    pByClient, contactToClient,
    invByClient: grp(invoices || [], 'client_id'), apprByClient: grp(approvals || [], 'client_id'),
    msgByClient: grp(messages || [], 'client_id'), recsByP: grp(recs || [], 'partnership_id'),
    reviewByP, projByClient, clientByPartnership,
  };
}

// ── Billing + Clients + Partnerships collector (client-care observations) ──
function collectClientCare(s: PlatformSnapshot): Observation[] {
  const obs: Observation[] = [];
  for (const c of (s.clients || [])) {
    const cid = String(c.id);
    const p = s.pByClient[cid]; const pid = p ? String(p.id) : null;

    const overdue = (s.invByClient[cid] || []).filter((i: any) => i.due_date && new Date(i.due_date).getTime() < _now());
    if (overdue.length) {
      const amt = overdue.reduce((sum: number, i: any) => sum + _money(i.amount), 0);
      const od = Math.floor((_now() - Math.min(...overdue.map((i: any) => new Date(i.due_date).getTime()))) / _DAY);
      obs.push({ id: `inv_${cid}`, signal: 'revenue_at_risk', module: 'Billing', subjectId: cid, subject: c.name, changed: `$${amt.toLocaleString()} invoice ${od}d overdue`, why: 'unpaid revenue ages and gets harder to collect', action: `Send ${c.name} a gentle payment nudge`, impact: `$${amt.toLocaleString()} at risk`, confidence: 'high', go: 'invoices', refId: '', magnitude: amt });
    }

    const msgs = s.msgByClient[cid] || [];
    if (msgs.length) {
      const last = _daysAgo(msgs[0].created_at) ?? 0;
      if (msgs[0].from_who === 'client' && last <= 21) {
        obs.push({ id: `msg_${cid}`, signal: 'waiting_on_eric', module: 'Clients', subjectId: cid, subject: c.name, changed: `${c.name} is waiting on your reply`, why: 'they reached out and the ball is in your court', action: `Reply to ${c.name}`, impact: 'responsiveness', confidence: 'high', go: 'messages', refId: '' });
      } else if (last > 21 && (c.progress || 0) < 100) {
        obs.push({ id: `quiet_${cid}`, signal: 'churn_risk', module: 'Clients', subjectId: cid, subject: c.name, changed: `no contact with ${c.name} in ${last} days`, why: 'silence often precedes churn', action: `Send ${c.name} a value-add check-in`, impact: c.monthly_amount ? `$${c.monthly_amount}/mo relationship` : 'retention', confidence: 'medium', go: 'messages', refId: '', magnitude: _money(c.monthly_amount) });
      }
    }

    const apprs = s.apprByClient[cid] || [];
    if (apprs.length) {
      const od = _daysAgo(apprs[0].created_at) ?? 0;
      obs.push({ id: `appr_${cid}`, signal: 'blocked_approval', module: 'Clients', subjectId: cid, subject: c.name, changed: `${apprs.length} approval${apprs.length > 1 ? 's' : ''} pending ${od}d for ${c.name}`, why: 'queued work is blocked until they sign off', action: `Nudge ${c.name} to approve`, impact: 'unblocks delivery', confidence: 'high', go: 'approvals', refId: '' });
    }

    const projs = s.projByClient[cid] || [];
    const nearDone = projs.find((pr: any) => ['review', 'launch'].includes(String(pr.stage || '').toLowerCase()) && pr.ball_in_court !== 'client');
    if (nearDone) obs.push({ id: `ship_${cid}`, signal: 'work_near_done', module: 'Clients', subjectId: cid, subject: c.name, changed: `${nearDone.name || 'a project'} is at ${nearDone.stage}`, why: 'finishing logs a win and frees you for the next client', action: `Push ${nearDone.name || 'it'} over the line`, impact: 'completed deliverable', confidence: 'high', go: 'timeline', refId: '' });

    if (pid) {
      const lastReview = s.reviewByP[pid];
      const thisPeriod = new Date().toISOString().slice(0, 7);
      if (!lastReview || (lastReview.period < thisPeriod && lastReview.status === 'published')) {
        obs.push({ id: `rev_${cid}`, signal: 'review_due', module: 'Partnerships', subjectId: cid, subject: c.name, changed: `${c.name}'s monthly review isn't sent yet`, why: 'the review is the moment that proves your value and retains them', action: `Draft ${c.name}'s monthly review`, impact: 'retention', confidence: 'high', go: 'growth', refId: pid });
      }
      const hot = (s.recsByP[pid] || []).find((r: any) => r.impact === 'high' && ['suggested', 'shared'].includes(r.status));
      if (hot) obs.push({ id: `rec_${cid}`, signal: 'high_opportunity', module: 'Partnerships', subjectId: cid, subject: c.name, changed: `a high-impact idea is ready for ${c.name}: ${hot.title}`, why: 'a strong opportunity is queued and unpitched', action: `Pitch ${c.name}: ${hot.title}`, impact: 'growth', confidence: (Number(hot.confidence) >= 85) ? 'high' : 'medium', go: 'growth', refId: pid });
    }

    if (c.renews_at) {
      const du = _daysUntil(c.renews_at);
      if (du !== null && du >= 0 && du <= 45) obs.push({ id: `renew_${cid}`, signal: 'renewal_window', module: 'Clients', subjectId: cid, subject: c.name, changed: `${c.name} renews in ${du}d`, why: 'a proactive touch before renewal locks in the relationship', action: `Prepare ${c.name}'s renewal conversation`, impact: c.monthly_amount ? `$${c.monthly_amount}/mo` : 'renewal', confidence: 'medium', go: 'hub', refId: cid, magnitude: _money(c.monthly_amount) });
    }
  }
  return obs;
}

// ── Inbox collector (leads who raised a hand) ──
function collectInbox(s: PlatformSnapshot): Observation[] {
  const obs: Observation[] = [];
  for (const l of (s.leads || [])) {
    const needsReply = l.status === 'new' || (l.unread && l.last_actor === 'them');
    if (!needsReply) continue;
    const wd = _daysAgo(l.created_at) ?? 0;
    obs.push({ id: `lead_${l.id}`, signal: 'waiting_on_eric', module: 'Inbox', subjectId: String(l.id), subject: l.name || l.email || 'New lead', changed: `${l.name || 'a new lead'} is waiting on a reply${wd ? `, ${wd}d` : ''}`, why: 'they reached out first, which is the warmest a lead ever gets', action: `Reply to ${l.name || 'the lead'}`, impact: 'new business', confidence: 'high', go: 'leads', refId: String(l.id), canDraft: true });
  }
  return obs;
}

// ── Opportunities collector (discovery: audit runs, GATED by fit + intent) ──
// Not every audit run is an opportunity. The gate is what protects the calm:
// fresh, left an email, scored in the helpable band, still open. Below the bar
// → ingested as background, never surfaced.
function collectOpportunities(s: PlatformSnapshot): Observation[] {
  const obs: Observation[] = [];
  const liveStages = new Set(['', 'new', 'lead', 'qualified', 'contacted']);
  let surfaced = 0;
  for (const a of (s.auditLeads || [])) {
    const score = Number(a.score);
    const stage = String(a.pipeline_stage || a.status || '').toLowerCase();
    const fresh = (_daysAgo(a.created_at) ?? 999) <= 30;
    const hasIntent = !!a.client_email;
    const inBand = !isNaN(score) && score >= 35 && score <= 72;
    const stillOpen = liveStages.has(stage) && !['won', 'dead', 'client'].includes(stage);
    if (!(fresh && hasIntent && inBand && stillOpen)) continue;
    surfaced++;
    if (surfaced > 8) break;
    const conf: Confidence = score <= 55 ? 'high' : 'medium';
    obs.push({ id: `opp_${a.id}`, signal: 'high_opportunity', module: 'Opportunities', subjectId: String(a.id), subject: a.business_name || a.url || 'A business', changed: `${a.business_name || a.url} ran your review and scored ${score}`, why: 'a low score plus a left email is a business that knows it needs help and reached toward you', action: `Look at ${a.business_name || a.url} and open a conversation`, impact: 'new project', confidence: conf, go: 'prospects', refId: String(a.id), magnitude: 72 - score });
  }
  return obs;
}

// ── Proposals collector (sent quotes going cold) ──
// A quote that was sent (responded by Eric with an amount) but the client hasn't
// acted on in a while is a proposal at risk of dying quietly. The likelihood of
// closing decays with age, so the freshest large ones are the ones to chase.
function collectProposals(s: PlatformSnapshot): Observation[] {
  const obs: Observation[] = [];
  for (const q of (s.quotes || [])) {
    const status = String(q.status || '').toLowerCase();
    // a live proposal = priced and sent, not yet accepted/declined
    const isOpen = ['responded', 'sent', 'pending', 'quoted'].includes(status);
    if (!isOpen) continue;
    const sentAt = q.responded_at || q.created_at;
    const age = _daysAgo(sentAt) ?? 0;
    if (age < 3) continue; // give it a few days before it's "going cold"
    const who = s.clientByPartnership[String(q.partnership_id)] || { clientId: '', name: 'a client' };
    const amt = _money(q.amount);
    // older = more at risk of dying; bigger = more worth saving. magnitude blends both.
    const conf: Confidence = age <= 14 ? 'high' : age <= 30 ? 'medium' : 'low';
    obs.push({
      id: `prop_${q.id}`, signal: 'proposal_stale', module: 'Proposals',
      subjectId: who.clientId || `quote_${q.id}`, subject: who.name,
      changed: `${who.name}'s ${amt ? '$' + amt.toLocaleString() + ' ' : ''}proposal has sat ${age}d unanswered`,
      why: 'a sent quote loses momentum every day it sits, and a gentle nudge often revives it',
      action: `Follow up with ${who.name} on their proposal`,
      impact: amt ? `$${amt.toLocaleString()} potential` : 'potential project',
      confidence: conf, go: 'growth', refId: String(q.partnership_id || ''),
      magnitude: amt + Math.max(0, 30 - age) * 50,
    });
  }
  return obs;
}

// The collector registry. A future module (Domains, SEO, Tasks) plugs in here
// with one line; the interpreter and every query consume it for free. This is
// the extensibility contract.
const COLLECTORS: Array<(s: PlatformSnapshot) => Observation[]> = [
  collectClientCare,
  collectInbox,
  collectOpportunities,
  collectProposals,
];

// ════════════════════════════════════════════════════════════════════════════
//  LAYER 2 — INTERPRETER. Deterministic. The only place ranking happens.
// ════════════════════════════════════════════════════════════════════════════

const _CONF_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

// Turn raw observations into ranked AttentionItems. Clusters multiple
// observations on the same subject (the cross-module connection a human makes:
// "the overdue invoice AND the silence are one story about Bacchus"), ranks by
// the weight table, breaks ties by confidence then magnitude. Fully inspectable.
function interpret(observations: Observation[]): AttentionItem[] {
  // cluster by subject so one business surfaces once, with its strongest signal
  // leading and the rest noted as 'also'.
  const bySubject: Record<string, Observation[]> = {};
  for (const o of observations) { (bySubject[o.subjectId] ||= []).push(o); }

  const items: AttentionItem[] = [];
  for (const subjectId of Object.keys(bySubject)) {
    const group = bySubject[subjectId];
    // dominant observation = highest weight
    group.sort((a, b) => (ATTENTION_SIGNALS[b.signal]?.weight || 0) - (ATTENTION_SIGNALS[a.signal]?.weight || 0));
    const top = group[0];
    const weight = ATTENTION_SIGNALS[top.signal]?.weight || 0;
    // clustering bonus: each additional real signal on the same subject adds a
    // little urgency (capped), because compounding problems deserve attention.
    const score = weight + Math.min(group.length - 1, 3) * 4;
    items.push({
      ...top,
      weight,
      kind: ATTENTION_SIGNALS[top.signal]?.kind || 'cadence',
      also: group.slice(1, 3).map((o) => o.changed),
      score,
    });
  }

  // final deterministic ordering: score, then confidence, then magnitude
  items.sort((a, b) =>
    (b.score - a.score) ||
    (_CONF_RANK[b.confidence] - _CONF_RANK[a.confidence]) ||
    ((b.magnitude || 0) - (a.magnitude || 0))
  );
  return items;
}

// Rank observations WITHOUT clustering — every observation becomes its own
// item. The clustered interpret() answers attention questions ("who needs me",
// where one subject should surface once). rankFlat() answers module and subject
// questions ("which proposal", "everything about this client"), where each
// signal must be individually visible. Same deterministic ordering; same weight
// table; the only difference is clustering. Both are pure and inspectable.
function rankFlat(observations: Observation[]): AttentionItem[] {
  const items: AttentionItem[] = observations.map((o) => {
    const weight = ATTENTION_SIGNALS[o.signal]?.weight || 0;
    return { ...o, weight, kind: ATTENTION_SIGNALS[o.signal]?.kind || 'cadence', score: weight };
  });
  items.sort((a, b) =>
    (b.score - a.score) ||
    (_CONF_RANK[b.confidence] - _CONF_RANK[a.confidence]) ||
    ((b.magnitude || 0) - (a.magnitude || 0))
  );
  return items;
}
function briefConfidence(s: PlatformSnapshot): { level: Confidence; reason: string } {
  const depth = (s.clients || []).length + (s.leads || []).length + (s.auditLeads || []).length;
  const ac = (s.clients || []).length, ld = (s.leads || []).length, al = (s.auditLeads || []).length;
  let level: Confidence = 'low';
  if (depth >= 12) level = 'high';
  else if (depth >= 4) level = 'medium';
  const reason = depth < 4
    ? `Early read. Watching ${ac} client${ac === 1 ? '' : 's'}, ${ld} lead${ld === 1 ? '' : 's'} and ${al} audit run${al === 1 ? '' : 's'} so far, so take the ranking as a first pass.`
    : `Based on ${ac} active client${ac === 1 ? '' : 's'}, ${ld} lead${ld === 1 ? '' : 's'}, and ${al} audit run${al === 1 ? '' : 's'} across the platform.`;
  return { level, reason };
}

// ════════════════════════════════════════════════════════════════════════════
//  LAYER 3 — NARRATOR (AI on top, never instead). Grounded, disposable.
// ════════════════════════════════════════════════════════════════════════════

// One AI sentence that frames the ranked items. Always validated; on any failure
// the deterministic fallback the caller supplies is used instead. The AI never
// sees raw rows it could hallucinate from — only the already-decided facts.
async function narrateHeadline(items: AttentionItem[], deterministicFallback: string, persona = 'chief of staff'): Promise<{ text: string; ai: boolean }> {
  if (!ANTHROPIC_KEY || !items.length) return { text: deterministicFallback, ai: false };
  try {
    const facts = items.slice(0, 5).map((i) => `- [${i.module}] ${i.changed} (why: ${i.why})`).join('\n');
    const sys = `You are the ${persona} for Eric Davis, who runs Davis Digital Studio solo. Below are the few things that genuinely need him this morning, already ranked by importance. Write ONE warm, calm sentence that captures the shape of his morning and points at where to start. Rules: under 24 words. No em dashes. No corporate filler. Address him as Eric. Never invent anything not in the facts. Read the situation like a trusted colleague would, do not just count items. Respond with ONLY the sentence, no quotes, no preamble.`;
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 80, system: sys, messages: [{ role: 'user', content: facts }] }),
      signal: AbortSignal.timeout(8000),
    });
    const aiData = await aiRes.json();
    if (Array.isArray(aiData?.content)) {
      const t = aiData.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ').trim().replace(/^["']|["']$/g, '').replace(/\u2014/g, ', ');
      if (t && t.length <= 200 && t.split(/[.!?]/).filter(Boolean).length <= 2) return { text: t, ai: true };
    }
  } catch (_) { /* fall through to deterministic */ }
  return { text: deterministicFallback, ai: false };
}

// optional deeper AI: connect-the-dots across the ranked items (patterns, the
// one strategic framing). Disposable; returns null on any failure.
async function narratePattern(items: AttentionItem[]): Promise<string | null> {
  if (!ANTHROPIC_KEY || items.length < 2) return null;
  try {
    const facts = items.slice(0, 8).map((i) => `- [${i.module}] ${i.subject}: ${i.changed}`).join('\n');
    const sys = `You are the chief of staff for Eric Davis (Davis Digital Studio, solo). Below are today's ranked attention items across his whole business. In ONE sentence under 26 words, name the single most useful pattern or strategic framing you see (e.g. "two of today's three risks are the same client, so one call resolves both"). If there is no real pattern, respond with exactly: NONE. No em dashes. Never invent anything.`;
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 70, system: sys, messages: [{ role: 'user', content: facts }] }),
      signal: AbortSignal.timeout(8000),
    });
    const aiData = await aiRes.json();
    if (Array.isArray(aiData?.content)) {
      const t = aiData.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ').trim().replace(/\u2014/g, ', ');
      if (t && t.toUpperCase() !== 'NONE' && t.length <= 220) return t;
    }
  } catch (_) { /* disposable */ }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
//  THE QUERYABLE INTERFACE — reason(question, opts). One brain, many questions.
//
//  Intents are a REGISTRY, not a switch. Each intent declaratively says: what
//  scope it runs at (the whole portfolio, or one subject), which observations
//  answer it, how to phrase the deterministic answer, and which AI persona
//  narrates it. Adding a question = adding one registry entry. The ranking,
//  collection, narration, and confidence machinery never change. This is what
//  makes the engine reusable infrastructure rather than a Brief with branches.
// ════════════════════════════════════════════════════════════════════════════

type QuestionIntent =
  | 'who_needs_attention'    // What deserves my attention today?      (Brief)
  | 'what_changed'           // What changed?                          (Brief)
  | 'what_can_wait'          // What can safely wait?                  (Brief)
  | 'most_at_risk'           // Which client is most at risk?          (Clients)
  | 'clients_attention'      // Which of my clients needs attention?    (Clients)
  | 'strongest_opportunity'  // Which opportunity is strongest?        (Opportunities)
  | 'proposal_most_likely'   // Which proposal is most likely to close?(Proposals)
  | 'needs_outreach'         // Which client needs proactive outreach? (Clients)
  | 'recommend_for_client'   // What should I recommend to THIS client?(subject-scoped)
  | 'relationship_health'    // Is THIS relationship unhealthy?        (subject-scoped)
  | 'emerging_patterns'      // What patterns are emerging?            (cross-business)
  | 'anything_unusual';      // Is anything unusual?                   (anomaly scan)

interface ReasonResult {
  intent: QuestionIntent;
  scope: 'portfolio' | 'subject';
  subject_id: string | null;  // set when the question was about one entity
  answer: string;             // human-readable headline answer
  answer_is_ai: boolean;      // AI-narrated vs deterministic
  items: AttentionItem[];     // structured reasoning (ranked)
  pattern: string | null;     // optional cross-item AI insight
  confidence: Confidence;     // honest confidence
  confidence_reason: string;
  meta: Record<string, any>;  // counts + context, never work
}

// Context handed to every intent definition so it can select/phrase its answer
// without re-deriving anything.
interface IntentCtx {
  ranked: AttentionItem[];          // clustered + ranked, one per subject (attention view)
  allItems: AttentionItem[];        // every observation, un-clustered + ranked (module view)
  snapshot: PlatformSnapshot;
  conf: { level: Confidence; reason: string };
  subjectId: string | null;         // the focused entity, if subject-scoped
  cap: number;                      // attention cap (the "few")
  waitGroups: Array<{ module: string; count: number }>;
}

interface IntentDef {
  scope: 'portfolio' | 'subject';
  // which interpreted items answer this question
  select: (ctx: IntentCtx) => AttentionItem[];
  // the deterministic, always-correct answer sentence (AI-free baseline)
  answer: (items: AttentionItem[], ctx: IntentCtx) => string;
  persona: string;                  // AI voice when narrating this intent
  wantsPattern?: boolean;           // surface a cross-item pattern insight
  narrate?: boolean;                // false = deterministic only (e.g. what_can_wait)
}

const _KIND_RISK = (i: AttentionItem) => i.kind === 'risk';
const _KIND_OPP = (i: AttentionItem) => i.kind === 'opportunity';

const INTENT_REGISTRY: Record<QuestionIntent, IntentDef> = {

  who_needs_attention: {
    scope: 'portfolio',
    select: (c) => c.ranked.slice(0, c.cap),
    persona: 'chief of staff',
    wantsPattern: true,
    answer: (items) => {
      if (!items.length) return 'Quiet morning, Eric. Nothing across the studio needs you right now.';
      const risks = items.filter(_KIND_RISK);
      const owed = items.filter((i) => i.kind === 'owed');
      if (risks.length) return `${risks.length} thing${risks.length > 1 ? 's' : ''} to protect today, Eric. Start there before anything else.`;
      if (owed.length) return `${owed.length} ${owed.length > 1 ? 'people are' : 'person is'} waiting on you. Clearing those keeps everything moving.`;
      return `No fires this morning. The best use of your time is ${items[0].action.toLowerCase()}.`;
    },
  },

  what_changed: {
    scope: 'portfolio',
    select: (c) => c.ranked,
    persona: 'chief of staff',
    wantsPattern: true,
    answer: (items) => items.length ? `${items.length} thing${items.length > 1 ? 's' : ''} changed across the studio. The biggest: ${items[0].changed}.` : 'Nothing material changed across the studio.',
  },

  what_can_wait: {
    scope: 'portfolio',
    narrate: false,
    select: (c) => c.ranked.slice(c.cap),
    persona: 'chief of staff',
    answer: (_items, c) => {
      if (!c.waitGroups.length) return 'Nothing is waiting in the background, everything surfaced is already in front of you.';
      const parts = c.waitGroups.map((g) => `${g.count} ${g.module.toLowerCase()}`);
      const phrase = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
      return `Also today, handled: ${phrase}. Nothing here needs you right now.`;
    },
  },

  most_at_risk: {
    scope: 'portfolio',
    select: (c) => c.ranked.filter(_KIND_RISK),
    persona: 'client-success lead',
    answer: (items) => items.length ? `${items[0].subject} is most at risk: ${items[0].changed}.` : 'No clients are at risk right now. The book is healthy.',
  },

  // "Which of my CLIENTS needs attention?" — the Clients landing view. Selects
  // the clustered items whose subject is an active client (Clients / Billing /
  // Partnerships / Proposals modules, all keyed by client id), excluding leads
  // and discovery opportunities which belong to the Inbox and Opportunities
  // surfaces. One registry entry; no new logic.
  clients_attention: {
    scope: 'portfolio',
    select: (c) => c.ranked.filter((i) => ['Clients', 'Billing', 'Partnerships', 'Proposals'].includes(i.module)),
    persona: 'client-success lead',
    wantsPattern: true,
    answer: (items) => {
      if (!items.length) return 'Every client is in a good place right now, Eric. Nothing needs you.';
      const risks = items.filter(_KIND_RISK);
      if (risks.length) return `${risks.length} relationship${risks.length > 1 ? 's need' : ' needs'} care today. ${items[0].subject} is the one to start with.`;
      return `No client is at risk. The one most worth a touch today is ${items[0].subject}: ${items[0].changed}.`;
    },
  },

  strongest_opportunity: {
    scope: 'portfolio',
    select: (c) => c.allItems.filter(_KIND_OPP),
    persona: 'growth strategist',
    answer: (items) => items.length ? `${items[0].subject} is the strongest opportunity: ${items[0].changed}.` : 'No open opportunities are surfaced yet. Run an audit or add a business to start.',
  },

  proposal_most_likely: {
    scope: 'portfolio',
    select: (c) => c.allItems.filter((i) => i.signal === 'proposal_stale' || i.module === 'Proposals'),
    persona: 'sales strategist',
    answer: (items) => items.length ? `${items[0].subject} is the proposal to push: ${items[0].changed}.` : 'No open proposals right now.',
  },

  needs_outreach: {
    scope: 'portfolio',
    select: (c) => c.allItems.filter((i) => i.signal === 'churn_risk' || i.signal === 'renewal_window'),
    persona: 'relationship manager',
    answer: (items) => items.length ? `${items[0].subject} most needs a proactive touch: ${items[0].changed}.` : 'No clients need proactive outreach today. Cadence is healthy.',
  },

  recommend_for_client: {
    scope: 'subject',
    select: (c) => c.subjectId ? c.allItems.filter((i) => i.subjectId === c.subjectId) : [],
    persona: 'growth strategist',
    wantsPattern: true,
    answer: (items, c) => {
      if (!c.subjectId) return 'Name a client to get a recommendation.';
      if (!items.length) return 'Nothing pressing for this client right now. A good moment for a proactive value-add idea.';
      const opp = items.find(_KIND_OPP);
      if (opp) return `For ${items[0].subject}, the move is: ${opp.action}.`;
      return `For ${items[0].subject}, start with: ${items[0].action}.`;
    },
  },

  relationship_health: {
    scope: 'subject',
    select: (c) => c.subjectId ? c.allItems.filter((i) => i.subjectId === c.subjectId) : [],
    persona: 'client-success lead',
    answer: (items, c) => {
      if (!c.subjectId) return 'Name a client to assess relationship health.';
      const risks = items.filter(_KIND_RISK);
      const owed = items.filter((i) => i.kind === 'owed');
      if (risks.length) return `This relationship needs care: ${risks[0].changed}.`;
      if (owed.length) return `This relationship is fine but you owe a reply: ${owed[0].changed}.`;
      if (!items.length) return 'This relationship looks healthy. No risk signals right now.';
      return `Mostly healthy. One thing to note: ${items[0].changed}.`;
    },
  },

  emerging_patterns: {
    scope: 'portfolio',
    select: (c) => c.ranked,
    persona: 'chief of staff',
    wantsPattern: true,
    answer: (items) => {
      if (items.length < 2) return 'Not enough activity to see a pattern yet.';
      // deterministic pattern fallbacks before AI: same-subject clustering, kind concentration
      const byKind: Record<string, number> = {};
      for (const i of items) byKind[i.kind] = (byKind[i.kind] || 0) + 1;
      const topKind = Object.entries(byKind).sort((a, b) => b[1] - a[1])[0];
      if (topKind && topKind[1] >= 2) return `A cluster of ${topKind[0]} signals is the theme right now (${topKind[1]} of ${items.length} items).`;
      return `Activity is spread evenly across the business. No single theme dominates.`;
    },
  },

  anything_unusual: {
    scope: 'portfolio',
    select: (c) => c.ranked.filter((i) => i.kind === 'risk' || (i.also && i.also.length > 0)),
    persona: 'chief of staff',
    answer: (items) => items.length ? `Worth a look: ${items[0].subject}, ${items[0].changed}.` : 'Nothing unusual. The studio is running normally.',
  },
};

// The single entry point every module calls. Deterministic ranking always;
// AI narration on top, always disposable. Pass polish:false to skip all AI,
// subjectId to scope a question to one entity.
async function reason(intent: QuestionIntent, opts: { polish?: boolean; snapshot?: PlatformSnapshot; subjectId?: string } = {}): Promise<ReasonResult> {
  const def = INTENT_REGISTRY[intent];
  if (!def) throw new Error(`unknown intent: ${intent}`);
  const s = opts.snapshot || await gatherSnapshot();
  const polish = opts.polish !== false;
  const subjectId = opts.subjectId || null;

  // LAYER 1: collect every observation across every module
  const observations: Observation[] = [];
  for (const collect of COLLECTORS) { try { observations.push(...collect(s)); } catch (_) { /* one module failing never breaks the brain */ } }

  // LAYER 2: deterministic interpretation + ranking (identical for every intent)
  const ranked = interpret(observations);    // clustered: one per subject (attention view)
  const allItems = rankFlat(observations);   // un-clustered: every signal (module/subject view)
  const conf = briefConfidence(s);
  const NEEDS_CAP = 5;

  // what_can_wait needs the module rollup of the remainder
  const remainder = ranked.slice(NEEDS_CAP);
  const byModule: Record<string, number> = {};
  for (const r of remainder) byModule[r.module] = (byModule[r.module] || 0) + 1;
  const waitGroups = Object.entries(byModule).map(([m, n]) => ({ module: m, count: n }));

  const ctx: IntentCtx = { ranked, allItems, snapshot: s, conf, subjectId, cap: NEEDS_CAP, waitGroups };

  // the intent decides which items answer it (ranking itself is fixed)
  const items = def.select(ctx);

  // LAYER 3: deterministic answer, then optional AI narration on top
  const detAnswer = def.answer(items, ctx);
  let answer = detAnswer; let answerIsAi = false; let pattern: string | null = null;
  if (polish && def.narrate !== false && items.length) {
    const h = await narrateHeadline(items, detAnswer, def.persona);
    answer = h.text; answerIsAi = h.ai;
    if (def.wantsPattern) pattern = await narratePattern(items);
  }

  return {
    intent,
    scope: def.scope,
    subject_id: subjectId,
    answer,
    answer_is_ai: answerIsAi,
    items,
    pattern,
    confidence: conf.level,
    confidence_reason: conf.reason,
    meta: {
      total_observed: observations.length,
      total_ranked: ranked.length,
      active_clients: (s.clients || []).length,
      waiting_on_others: _arr(s.projects).filter((p: any) => p.ball_in_court === 'client').length,
      can_wait: waitGroups,
      cap: NEEDS_CAP,
    },
  };
}


// ===== inserted: client reasoning engine (sibling brain to reason()) =====
// ════════════════════════════════════════════════════════════════════════════
//  CLIENT REASONING ENGINE  —  the client-facing intelligence layer
//
//  ARCHITECTURE (mirrors the Admin brain's pattern, NOT its content):
//  - ONE synthesizer: clientReason(snapshot) returns a structured ClientBrief.
//  - THIN consumers: client_hq and every future client room call it and render.
//  - NO duplicated business logic: a room never re-interprets signals itself.
//
//  WHY IT IS A SEPARATE BRAIN FROM reason():
//  The Admin brain's currency is ATTENTION. It ranks AttentionItems, caps to
//  "the few," and answers "who needs me / what's at risk / what can wait." Its
//  whole shape is triage. Pointing that lens at a client would frame the
//  relationship as a risk queue. The Client brain's currency is CONFIDENCE. It
//  answers a different set of questions and its job is to assemble EVIDENCE that
//  the client's business, investment, and decision to hire DDS are paying off.
//  Same operating system, opposite responsibility (Constitution: two seats).
//
//  THE SEVEN QUESTIONS (the entire contract; every room consumes these answers):
//    Q1 going    — How are things going?        -> status, interpreted, honest
//    Q2 changed  — What changed since I left?    -> a curated diff, not a feed
//    Q3 done     — What have we accomplished?    -> plain-English proof of work
//    Q4 todo     — What do I need to do?         -> finite client actions, or none
//    Q5 next     — What are you recommending?    -> the expert's forward view
//    Q6 calm     — What can I stop worrying about?-> explicit, named, handled
//    Q7 confident— Why should I feel confident?  -> the evidence, assembled
//
//  PHILOSOPHY (enforced in code below):
//  - Interpret before presenting. Every answer is a conclusion, not raw data.
//  - The literal artifact lives beneath the interpretation (each section carries
//    a `source` the room can deep-link to: the real number, file, invoice, doc).
//  - Confidence is built from EVIDENCE, never assertion. We never emit "you made
//    a great choice"; we emit the specific facts that let the client conclude it.
//  - Honesty outranks confidence. On a bad month we say so plainly, calmly, with
//    a plan. Untested calm is decoration (Constitution II.8 / VIII.33).
// ════════════════════════════════════════════════════════════════════════════

// One client's full client-safe picture, gathered once.
interface ClientSnapshot {
  client: any;                 // clients row (name, business_type, city, created_at, launched_at)
  contactName: string;
  partnership: any;
  signals: any[];              // scope=client_visible only
  work: any[];                 // work_log, newest first
  project: any | null;         // active project (stage, ball_in_court, progress)
  events: any[];               // recent events
  recs: any[];                 // client_visible recommendations
  reviews: any[];              // published monthly_reviews
  approvals: any[];            // open client approvals (the only true to-do source)
  invoices: any[];             // client invoices (literal money, never interpreted away)
  files: any[];                // delivered/shared files (literal artifacts)
  messages: any[];             // unread/recent messages from the studio
  lastVisit: number | null;    // epoch ms of the client's previous visit
}

// Each answer carries its interpretation AND a pointer to the literal artifact
// beneath it. Rooms render `text`; the "show me the real thing" affordance uses
// `source`. This is how "literal beneath interpreted" is structural, not a habit.
interface ClientAnswer {
  text: string;                       // the interpreted, human conclusion
  detail?: string | null;             // optional supporting line
  source?: {                          // the literal artifact one tap beneath
    kind: 'metric' | 'file' | 'invoice' | 'approval' | 'message' | 'doc' | 'project' | 'review' | 'none';
    ref?: string | null;              // id / metric name / route the room deep-links to
    label?: string | null;            // what the user taps ("See the numbers")
  } | null;
  tone?: 'good' | 'calm' | 'watch' | 'action' | 'win'; // drives calm color, never alarm without cause
}

// The structured brief every client room consumes. A room picks the sections it
// needs; it never recomputes them.
interface ClientBrief {
  generated_at: string;
  state: 'onboarding' | 'active' | 'no_partnership';
  business: { name: string; type: string | null; city: string | null };
  contact_first: string | null;

  // THE HEADLINE — the single most important thing right now, in priority order:
  // an action the client owes > an honest problem we're handling > a real win >
  // calm reassurance. (Same "one thing first" rule as the Admin Brief.)
  headline: ClientAnswer;

  // THE SEVEN QUESTIONS
  going:     ClientAnswer;            // Q1
  changed:   ClientAnswer[];          // Q2 — curated diff since last visit (may be empty)
  done:      ClientAnswer[];          // Q3 — accomplishments (proof of work)
  todo:      ClientAnswer[];          // Q4 — the only real to-do list (may be empty = good)
  next:      ClientAnswer[];          // Q5 — recommendations (forward view)
  calm:      ClientAnswer[];          // Q6 — what they can stop worrying about
  confidence: {                       // Q7 — assembled evidence + honest level
    level: 'strong' | 'steady' | 'building' | 'watch';
    line: string;                     // the interpreted confidence statement
    evidence: ClientAnswer[];         // the FACTS that justify it (never assertion)
  };

  // Honest status of the underlying business this period, calm by default.
  health: { word: string; line: string; tone: 'good' | 'calm' | 'watch' };
  meta: Record<string, any>;
}

// ── small, shared helpers (pure) ────────────────────────────────────────────
function ce(s: any): string { return String(s == null ? '' : s); } // safe string

// ════════════════════════════════════════════════════════════════════════════
//  THE BRAIN.  Deterministic baseline first (always correct, AI-free). Every
//  section is a CONCLUSION drawn from real data, with the literal source kept.
// ════════════════════════════════════════════════════════════════════════════
function clientReason(s: ClientSnapshot): ClientBrief {
  const c = s.client || { name: 'your business' };
  const firstName = (s.contactName || '').split(' ')[0] || null;

  // signal helpers (newest-first per metric)
  const series = (m: string) => (s.signals || [])
    .filter((x: any) => x.metric === m)
    .sort((a: any, b: any) => new Date(b.observed_at).getTime() - new Date(a.observed_at).getTime());
  const latest = (m: string) => { const r = series(m); return r.length ? r[0] : null; };
  const val = (m: string) => { const r = latest(m); return r ? Number(r.value) : null; };

  // lifecycle
  const ageDays = c.created_at ? Math.floor((Date.now() - new Date(c.created_at).getTime()) / 86400000) : 999;
  const hasHistory = (s.work || []).length > 0 || (s.signals || []).length > 0;
  const isOnboarding = ageDays < 14 && !hasHistory;

  const openApprovals = (s.approvals || []).filter((a: any) => a && (a.status === 'pending' || a.status === 'open' || !a.status));
  const lv = s.lastVisit;

  // ── Q3 DONE — accomplishments (proof of work), newest first ────────────────
  // Evidence, in plain English. Each item points at the work itself.
  const doneWork = (s.work || []).filter((w: any) => w.done_at);
  const done: ClientAnswer[] = doneWork.slice(0, 5).map((w: any) => ({
    text: ce(w.title),
    source: { kind: 'project', ref: w.id ? String(w.id) : null, label: 'See the work' },
    tone: 'good',
  }));

  // ── Q2 CHANGED — curated diff since last visit (judgment, not a changelog) ──
  // The engine DECIDES what was significant enough to mention. Silence on the
  // trivial is the feature. Newest, most meaningful first.
  const changed: ClientAnswer[] = [];
  if (lv) {
    // work delivered since last visit
    doneWork.filter((w: any) => new Date(w.done_at).getTime() > lv).slice(0, 4).forEach((w: any) => {
      changed.push({ text: `We finished ${ce(w.title).toLowerCase()}.`, source: { kind: 'project', ref: w.id ? String(w.id) : null, label: 'See it' }, tone: 'good' });
    });
    // files delivered since last visit
    (s.files || []).filter((f: any) => f.created_at && new Date(f.created_at).getTime() > lv && f.uploaded_by !== 'client').slice(0, 3).forEach((f: any) => {
      changed.push({ text: `${ce(f.name)} is ready for you.`, source: { kind: 'file', ref: f.id ? String(f.id) : null, label: 'Open it' }, tone: 'good' });
    });
    // a metric that moved meaningfully since last visit
    ['gbp_calls', 'conversions', 'search_clicks', 'sessions'].forEach((m) => {
      const r = series(m);
      if (r.length >= 2) {
        const now = Number(r[0].value), prev = Number(r[1].value);
        if (prev > 0 && Math.abs(now - prev) / prev >= 0.15) { // >=15% move is worth noting
          const up = now > prev;
          changed.push({
            text: up ? `More people are finding you than last time.` : `One of your numbers softened, and we're already on it.`,
            source: { kind: 'metric', ref: m, label: 'See the numbers' },
            tone: up ? 'win' : 'watch',
          });
        }
      }
    });
    // a new message from the studio since last visit (point to it, never paraphrase it)
    (s.messages || []).filter((m: any) => m.created_at && new Date(m.created_at).getTime() > lv && m.from_who === 'studio').slice(0, 1).forEach(() => {
      changed.push({ text: `Eric left you a note.`, source: { kind: 'message', ref: null, label: 'Read it' }, tone: 'calm' });
    });
  }

  // ── Q4 TODO — the only real to-do list. Empty is the best answer. ──────────
  const todo: ClientAnswer[] = [];
  openApprovals.slice(0, 5).forEach((a: any) => {
    todo.push({
      text: a.title ? `Review and approve: ${ce(a.title)}` : 'Something is ready for your review.',
      source: { kind: 'approval', ref: a.id ? String(a.id) : null, label: 'Review now' },
      tone: 'action',
    });
  });
  // a recommendation that explicitly needs the client's input
  (s.recs || []).filter((r: any) => r.status === 'shared' && r.needs_client_input).slice(0, 2).forEach((r: any) => {
    todo.push({ text: `We need a quick bit of input on ${ce(r.title).toLowerCase()}.`, source: { kind: 'message', ref: null, label: 'Tell us' }, tone: 'action' });
  });
  // an unpaid invoice that's actually due (literal money, never interpreted away)
  (s.invoices || []).filter((i: any) => (i.status === 'due' || i.status === 'unpaid' || i.status === 'open')).slice(0, 1).forEach((i: any) => {
    todo.push({ text: `A payment is ready when you are.`, detail: i.amount != null ? null : null, source: { kind: 'invoice', ref: i.id ? String(i.id) : null, label: 'View invoice' }, tone: 'action' });
  });

  // ── Q5 NEXT — recommendations, the expert's forward view ───────────────────
  const next: ClientAnswer[] = (s.recs || [])
    .filter((r: any) => ['suggested', 'shared'].includes(r.status))
    .slice(0, 3)
    .map((r: any) => ({
      text: ce(r.title),
      detail: r.impact ? `Why it matters: ${ce(r.impact)}` : null,
      source: { kind: 'doc', ref: r.id ? String(r.id) : null, label: 'See the plan' },
      tone: 'calm',
    }));
  if (!next.length && s.project && s.project.stage && s.project.stage !== 'complete') {
    next.push({ text: `Finishing ${ce(s.project.name || 'your project')}.`, source: { kind: 'project', ref: null, label: 'See progress' }, tone: 'calm' });
  }

  // ── Q1 GOING — honest status, interpreted. Calm by default, never sedating. ─
  // Honesty outranks confidence: if something is genuinely off, say it plainly
  // with the fact that we're handling it. (Bad-news mode, Constitution VIII.33.)
  let healthWord = 'healthy', healthLine = `Your business is healthy and we're actively on it.`, healthTone: 'good' | 'calm' | 'watch' = 'good';
  {
    const perf = val('psi_performance');
    const concerns: string[] = [];
    if (perf != null && perf < 55) concerns.push('site speed');
    // a real metric drop is an honest concern, surfaced calmly
    const dropped = ['gbp_calls', 'conversions', 'sessions'].some((m) => {
      const r = series(m); return r.length >= 2 && Number(r[1].value) > 0 && Number(r[0].value) < Number(r[1].value) * 0.85;
    });
    if (dropped) { healthWord = 'being looked after'; healthLine = `One of your numbers dipped this period. We've already noticed and we're on it.`; healthTone = 'watch'; }
    else if (concerns.length) { healthWord = 'in good shape'; healthLine = `Your business is in good shape. We're polishing ${concerns[0]} right now.`; healthTone = 'calm'; }
    if (isOnboarding) { healthWord = 'getting started'; healthLine = `We've already begun building. Your results will show here as the work takes effect.`; healthTone = 'calm'; }
  }
  const going: ClientAnswer = { text: healthLine, source: null, tone: healthTone === 'good' ? 'good' : (healthTone === 'watch' ? 'watch' : 'calm') };

  // ── Q6 CALM — what they can stop worrying about. The trust closer. ─────────
  // Each item is something genuinely handled, phrased to quietly validate the
  // decision to hire DDS ("...so that's off your plate").
  const calm: ClientAnswer[] = [];
  if (val('psi_performance') != null && Number(val('psi_performance')) >= 80) {
    calm.push({ text: `Your website is fast and healthy. That's handled.`, source: { kind: 'metric', ref: 'psi_performance', label: 'See the score' }, tone: 'calm' });
  }
  if (val('uptime') == null || (val('uptime') != null && Number(val('uptime')) >= 99)) {
    calm.push({ text: `Your site is up and being watched around the clock.`, source: null, tone: 'calm' });
  }
  if (!openApprovals.length) {
    calm.push({ text: `Nothing is waiting on you. You're all caught up.`, source: null, tone: 'calm' });
  }
  if (doneWork.length) {
    calm.push({ text: `The day-to-day upkeep of your online presence is on us, not you.`, source: null, tone: 'calm' });
  }

  // ── Q7 CONFIDENCE — assembled EVIDENCE + an honest level. Never assertion. ─
  // We emit the facts. The client draws the conclusion. The level is honest:
  // 'watch' when something genuinely dipped, never glossed.
  const evidence: ClientAnswer[] = [];
  // proof 1: work shipped
  if (doneWork.length) evidence.push({ text: `${doneWork.length} ${doneWork.length === 1 ? 'improvement' : 'improvements'} delivered for you recently.`, source: { kind: 'project', ref: null, label: 'See the work' }, tone: 'good' });
  // proof 2: a real, measured growth signal (only if real)
  const growth = ['gbp_calls', 'conversions', 'search_clicks', 'sessions'].map((m) => {
    const r = series(m); if (r.length >= 2 && Number(r[1].value) > 0 && Number(r[0].value) > Number(r[1].value)) return { m, now: Number(r[0].value), prev: Number(r[1].value) }; return null;
  }).filter(Boolean)[0] as any;
  if (growth) evidence.push({ text: `More people are finding and contacting you than last period.`, source: { kind: 'metric', ref: growth.m, label: 'See the numbers' }, tone: 'win' });
  // proof 3: responsiveness / active care
  if (s.project && s.project.stage && s.project.stage !== 'complete' && s.project.ball_in_court !== 'client') {
    evidence.push({ text: `Work is actively moving on your project right now.`, source: { kind: 'project', ref: null, label: 'See progress' }, tone: 'good' });
  }
  // proof 4: a published review exists (a strategist looked at the whole picture)
  if ((s.reviews || []).length) evidence.push({ text: `Your latest progress review is ready.`, source: { kind: 'review', ref: (s.reviews[0] && s.reviews[0].period) || null, label: 'Read it' }, tone: 'good' });

  // honest confidence level
  let level: 'strong' | 'steady' | 'building' | 'watch' = 'building';
  let confLine = `We're building your momentum, and the early signs are good.`;
  const anyDip = healthTone === 'watch';
  if (anyDip) { level = 'watch'; confLine = `We're staying close to your numbers this period and actively working the soft spots. You're in good hands precisely when it matters.`; }
  else if (growth && doneWork.length) { level = 'strong'; confLine = `Your investment is showing up in real results: work delivered and more people finding you.`; }
  else if (doneWork.length) { level = 'steady'; confLine = `Steady progress. We're consistently moving your business forward, and the results build from here.`; }

  // ── THE HEADLINE — one thing first, priority order ────────────────────────
  let headline: ClientAnswer;
  if (todo.length) {
    headline = { text: `You have ${todo.length === 1 ? 'one thing' : todo.length + ' things'} to look at when you have a moment.`, source: todo[0].source, tone: 'action' };
  } else if (anyDip) {
    // honest, non-scary, with a plan — the bad-news headline builds trust
    headline = { text: `One of your numbers softened this period. We've already noticed and we're on it.`, source: { kind: 'metric', ref: null, label: 'See what we mean' }, tone: 'watch' };
  } else if (growth) {
    headline = { text: `More people found and contacted you this period.`, source: { kind: 'metric', ref: growth.m, label: 'See the numbers' }, tone: 'win' };
  } else if (s.project && s.project.stage && s.project.stage !== 'complete') {
    headline = { text: `We're actively working on your project. Nothing needs you right now.`, source: { kind: 'project', ref: null, label: 'See progress' }, tone: 'calm' };
  } else {
    headline = { text: `Everything's running smoothly. We're actively managing your business.`, source: null, tone: 'calm' };
  }

  return {
    generated_at: new Date().toISOString(),
    state: isOnboarding ? 'onboarding' : 'active',
    business: { name: c.name || 'your business', type: c.business_type || null, city: c.city || null },
    contact_first: firstName,
    headline,
    going,
    changed,
    done,
    todo,
    next,
    calm,
    confidence: { level, line: confLine, evidence },
    health: { word: healthWord, line: healthLine, tone: healthTone },
    meta: {
      since_last_visit: !!lv,
      counts: { done: done.length, todo: todo.length, next: next.length, changed: changed.length, calm: calm.length, evidence: evidence.length },
    },
  };
}


// ════════════════════════════════════════════════════════════════════════════
//  DECISIONS  —  the client's only true action surface, as a decision experience
//
//  Same brain, same philosophy: the engine interprets the SITUATION around each
//  decision; the decision item itself stays literal and exact. It answers the
//  seven decision questions for each open approval:
//    - What needs my decision?        -> the literal title (verbatim)
//    - Why does this matter?          -> interpreted, plain business stakes
//    - What exactly am I approving?    -> the literal description (verbatim, never paraphrased)
//    - What should I look at first?    -> interpreted review pointer + the real file room
//    - What happens after I decide?    -> interpreted, concrete next step
//    - What if I need changes?         -> interpreted, reassuring, no penalty
//    - What can I stop worrying about? -> interpreted, the worry this closes
//
//  CONFIDENCE: a decision experience builds confidence by making the act crisp
//  and the consequences clear, so the client never feels they're guessing.
// ════════════════════════════════════════════════════════════════════════════

interface Decision {
  id: string;
  // LITERAL (verbatim, never interpreted):
  title: string;                 // exactly what Eric titled it
  description: string | null;    // exactly what Eric wrote, or null
  created_at: string | null;
  waiting_days: number;          // factual age, for gentle ordering only

  // INTERPRETED (the situation around the literal item):
  why: string;                   // why this matters, in plain business terms
  review: { line: string; source: { kind: string; ref: string | null; label: string } | null }; // what to look at + where the real artifact is
  after_approve: string;         // what concretely happens when they approve
  after_changes: string;         // what happens if they ask for changes (reassuring)
  closes: string;                // the worry approving this puts to rest
  note: { from: string; text: string } | null; // Eric's human note — verbatim, never paraphrased
}

interface DecisionsBrief {
  generated_at: string;
  count: number;
  // the calm framing line for the whole room (interpreted)
  intro: string;
  // when there are none — an explicit, confidence-building all-clear
  clear: boolean;
  clear_line: string;
  decisions: Decision[];
}

// Plain-English stakes derived from the decision's own words. We read the title
// for category cues; we never invent specifics the item doesn't contain.
function decisionWhy(title: string, desc: string): string {
  const t = (title + ' ' + (desc || '')).toLowerCase();
  if (/(home ?page|homepage|landing|hero)/.test(t)) return 'This is often the first thing a new customer sees, so getting it right shapes their first impression of your business.';
  if (/(logo|brand|identity|color|colours|colors)/.test(t)) return 'This is part of how customers recognize and remember you, so it is worth a careful look.';
  if (/(photo|image|gallery|picture)/.test(t)) return 'Strong visuals help customers picture what they are getting, which makes them more likely to act.';
  if (/(copy|text|content|words|wording|headline|tagline)/.test(t)) return 'The words on your site do the quiet work of convincing visitors, so your voice here matters.';
  if (/(menu|product|pricing|price|service)/.test(t)) return 'This is what customers actually choose from, so clarity here turns visitors into customers.';
  if (/(seo|search|google|listing|map)/.test(t)) return 'This affects how easily new customers find you when they search, which brings in business over time.';
  if (/(book|booking|form|contact|checkout|cart)/.test(t)) return 'This is how customers take action, so a smooth experience here directly affects how much business you win.';
  return 'This is part of the work moving your business forward, and your sign-off keeps it moving.';
}

function decisionAfterApprove(title: string): string {
  const t = title.toLowerCase();
  if (/(home ?page|homepage|design|page|layout)/.test(t)) return 'Once you approve, we move it into the build and it becomes part of your live site.';
  if (/(copy|content|text)/.test(t)) return 'Once you approve, we put this wording in place across the relevant pages.';
  if (/(photo|image|gallery)/.test(t)) return 'Once you approve, these go live where they belong on your site.';
  return 'Once you approve, we carry this straight into the next step of the work, no waiting.';
}

function decisionsFor(s: ClientSnapshot): DecisionsBrief {
  const open = (s.approvals || [])
    .filter((a: any) => a && (a.status === 'pending' || a.status === 'open' || !a.status))
    .sort((a: any, b: any) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()); // oldest first, gently

  // match a recent studio message to an approval by title, so Eric's human note
  // can ride along with the item — VERBATIM, never paraphrased.
  const studioNotes = (s.messages || []).filter((m: any) => m && m.from_who === 'studio' && (m.text || m.body));

  const decisions: Decision[] = open.slice(0, 10).map((a: any) => {
    const title = ce(a.title) || 'A deliverable to review';
    const description = a.description ? ce(a.description) : null;
    const created = a.created_at || null;
    const waiting = created ? Math.max(0, Math.floor((Date.now() - new Date(created).getTime()) / 86400000)) : 0;

    // Eric's note: only attach if one plainly references this item; keep it exact.
    let note: { from: string; text: string } | null = null;
    const hit = studioNotes.find((m: any) => {
      const txt = ce(m.text || m.body);
      return title && txt && txt.toLowerCase().indexOf(title.toLowerCase().slice(0, 18)) > -1;
    });
    if (hit) note = { from: 'Eric', text: ce(hit.text || hit.body) }; // VERBATIM

    return {
      id: String(a.id || ''),
      title,                                   // literal
      description,                             // literal (verbatim)
      created_at: created,
      waiting_days: waiting,
      why: decisionWhy(title, description || ''),
      review: {
        line: description
          ? 'Read the description below, then open the files to see the actual work before you decide.'
          : 'Open the files to see the actual work before you decide.',
        source: { kind: 'file', ref: null, label: 'Open the files' }, // the literal artifact lives in Files
      },
      after_approve: decisionAfterApprove(title),
      after_changes: 'If anything is off, just tell us what to change. There is no penalty and no awkwardness. We will revise it and bring it back to you. That is a normal part of the process.',
      closes: 'Once you approve, this is fully off your plate and back in our hands to finish.',
      note,
    };
  });

  const count = decisions.length;
  return {
    generated_at: new Date().toISOString(),
    count,
    intro: count === 0
      ? ''
      : (count === 1
          ? 'There is one thing waiting for your decision. Take your time. Here is everything you need to decide with confidence.'
          : `There are ${count} things waiting for your decision. No rush. Here is everything you need for each one.`),
    clear: count === 0,
    clear_line: 'Nothing needs your decision right now. You are completely caught up, and we are actively handling everything on our side.',
    decisions,
  };
}


// ════════════════════════════════════════════════════════════════════════════
//  DELIVERIES  —  the Files room as a delivery experience, not a repository.
//
//  The engine interprets the SITUATION around each delivery from Eric: what it
//  is, why the client is receiving it, what to look at first, what to do next,
//  which version is current, and what can be ignored. The FILE itself stays
//  literal: exact name, exact type, exact download path. We never rename it,
//  never summarize its contents, never alter the asset (Constitution V.17).
//
//  Questions answered per delivery:
//    - What is this?           -> interpreted kind, from the real extension/name
//    - Why am I receiving it?  -> interpreted purpose
//    - What changed?           -> interpreted (new since last visit / a new version)
//    - What should I look at first? -> the engine names ONE primary file to open
//    - What should I do next?  -> interpreted next step
//    - Which version is current? -> interpreted (newest of a same-named set)
//    - What can I ignore?      -> superseded versions, marked, not deleted
// ════════════════════════════════════════════════════════════════════════════

interface DeliveryFile {
  // LITERAL (verbatim, unchanged):
  id: string;
  name: string;            // exact filename
  type: string | null;     // exact extension/type
  size: string | null;     // exact size
  storage_path: string | null; // exact path used by the existing signed-URL download
  created_at: string | null;
  from_who: string;        // 'eric' | 'client'
  status: string | null;

  // INTERPRETED (context around the literal file):
  kind: string;            // human label: "Design", "Document", "Photos", etc.
  is_current: boolean;     // newest in its version group
  superseded: boolean;     // an older version of something newer (ignorable, not deleted)
  is_new: boolean;         // arrived since the client's last visit
}

interface Delivery {
  // a delivery groups one logical thing (its current file + any older versions)
  key: string;
  title: string;           // the current file's exact name (literal)
  kind: string;            // interpreted kind label
  why: string;             // interpreted: why you're receiving this
  what_changed: string | null; // interpreted: new, or a new version, or null
  look_first: boolean;     // is this the ONE thing to open first across all deliveries
  next_step: string;       // interpreted: what to do with it
  delivered_at: string | null;
  current: DeliveryFile;   // the literal current file (open this)
  older: DeliveryFile[];   // superseded versions — present, exact, marked ignorable
}

interface DeliveriesBrief {
  generated_at: string;
  intro: string;                 // interpreted framing for the whole room
  has_deliveries: boolean;
  empty_line: string;            // confidence-building empty state copy
  primary_id: string | null;     // the ONE file to look at first (by current.id)
  deliveries: Delivery[];        // Eric's deliveries, newest first
  your_uploads: DeliveryFile[];  // client's own files — literal, no interpretation
}

// derive a human "kind" from the real extension/name — describing, never rewriting.
function fileKind(name: string, type: string): string {
  const n = (name + ' ' + (type || '')).toLowerCase();
  if (/\.(png|jpg|jpeg|gif|webp|svg|heic)$|photo|image|logo/.test(n)) return 'Image';
  if (/\.(pdf)$|proposal|contract|agreement|invoice|report/.test(n)) return 'Document';
  if (/\.(doc|docx|txt|rtf|pages)$|copy|content|draft/.test(n)) return 'Document';
  if (/\.(ppt|pptx|key)$|deck|presentation|slides/.test(n)) return 'Presentation';
  if (/\.(mp4|mov|webm|avi)$|video/.test(n)) return 'Video';
  if (/\.(fig|sketch|xd|psd|ai)$|design|mockup|wireframe/.test(n)) return 'Design';
  if (/\.(zip|rar|7z)$/.test(n)) return 'Bundle';
  return 'File';
}

// why is the client receiving this — interpreted from the kind, never invented detail.
function deliveryWhy(kind: string, name: string): string {
  const n = name.toLowerCase();
  if (/logo|brand/.test(n)) return 'These are your brand assets, ready for you to keep and use anywhere you need them.';
  if (/proposal|quote|estimate/.test(n)) return 'This lays out what we are proposing so you can review it on your own time.';
  if (/contract|agreement/.test(n)) return 'This is for your records. It is the agreement covering our work together.';
  if (/invoice|receipt/.test(n)) return 'This is for your records and accounting.';
  if (/report|review|summary/.test(n)) return 'This walks through where things stand so you have the full picture.';
  if (kind === 'Design') return 'This is design work for you to look over and react to.';
  if (kind === 'Image') return 'These are visuals we have prepared for your site or brand.';
  if (kind === 'Presentation') return 'This is a walkthrough we have put together for you.';
  return 'We have completed this and are sharing it with you.';
}

function deliveryNext(kind: string, name: string): string {
  const n = name.toLowerCase();
  if (/logo|brand|asset/.test(n)) return 'Download and keep these somewhere safe. Nothing else is needed from you.';
  if (/proposal|quote|estimate/.test(n)) return 'Have a look when you have a moment. We can talk it through whenever you are ready.';
  if (/contract|agreement|invoice|receipt/.test(n)) return 'Save it for your records. Nothing else is needed from you.';
  if (kind === 'Design') return 'Open it and let us know what you think. If you would like changes, just tell us.';
  return 'Open it whenever you are ready. We are here if you have any questions.';
}

// normalize a filename to a version-group key: strip "v2", "(1)", "final", dates.
function versionKey(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')                 // extension
    .replace(/[ _-]*v?\d+(\.\d+)?\b/g, '')        // v2, 3, 1.2
    .replace(/[ _-]*\(\d+\)/g, '')                // (1)
    .replace(/[ _-]*(final|draft|copy|latest|new|rev\d*)\b/g, '') // qualifiers
    .replace(/[ _-]*\d{4}[-_]?\d{2}[-_]?\d{2}/g, '') // dates
    .replace(/[^a-z0-9]+/g, ' ')
    .trim() || (name || '').toLowerCase();
}

function deliveriesFor(s: ClientSnapshot): DeliveriesBrief {
  const all = (s.files || []);
  const lv = s.lastVisit;
  const mk = (f: any, current: boolean, superseded: boolean): DeliveryFile => ({
    id: String(f.id || ''),
    name: ce(f.name) || 'file',                  // literal
    type: f.type ? ce(f.type) : null,            // literal
    size: f.size ? ce(f.size) : null,            // literal
    storage_path: f.storage_path ? ce(f.storage_path) : null, // literal, drives existing download
    created_at: f.created_at || null,
    from_who: ce(f.from_who) || 'eric',
    status: f.status ? ce(f.status) : null,
    kind: fileKind(ce(f.name), ce(f.type)),
    is_current: current,
    superseded,
    is_new: !!(lv && f.created_at && new Date(f.created_at).getTime() > lv),
  });

  // ── Eric's deliveries: group by version key, newest = current ──
  const fromEric = all.filter((f: any) => (f.from_who || 'eric') === 'eric')
    .sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  const groups: Record<string, any[]> = {};
  for (const f of fromEric) { const k = versionKey(ce(f.name)); (groups[k] = groups[k] || []).push(f); }

  const deliveries: Delivery[] = Object.keys(groups).map((k) => {
    const versions = groups[k]; // newest first
    const cur = versions[0];
    const older = versions.slice(1);
    const kind = fileKind(ce(cur.name), ce(cur.type));
    const isNew = !!(lv && cur.created_at && new Date(cur.created_at).getTime() > lv);
    const hasNewerVersion = versions.length > 1;
    return {
      key: k,
      title: ce(cur.name),                       // literal
      kind,
      why: deliveryWhy(kind, ce(cur.name)),
      what_changed: hasNewerVersion
        ? 'This is an updated version. The previous one is kept below in case you need it.'
        : (isNew ? 'New since you were last here.' : null),
      look_first: false,                         // set after we pick the primary
      next_step: deliveryNext(kind, ce(cur.name)),
      delivered_at: cur.created_at || null,
      current: mk(cur, true, false),
      older: older.map((f: any) => mk(f, false, true)),
    };
  }).sort((a, b) => new Date(b.delivered_at || 0).getTime() - new Date(a.delivered_at || 0).getTime());

  // ── pick the ONE thing to look at first: newest new delivery, else newest ──
  let primary: Delivery | null = null;
  primary = deliveries.find((d) => d.current.is_new) || deliveries[0] || null;
  if (primary) primary.look_first = true;

  // ── client's own uploads: literal, no interpretation, just kept tidy ──
  const yours = all.filter((f: any) => f.from_who === 'client')
    .sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .map((f: any) => mk(f, true, false));

  const count = deliveries.length;
  return {
    generated_at: new Date().toISOString(),
    intro: count === 0
      ? ''
      : (primary && primary.current.is_new
          ? 'Here is the work we have delivered. Start with the one marked for you, then the rest whenever you like.'
          : 'Here is everything we have delivered for you, newest first. Open anything whenever you are ready.'),
    has_deliveries: count > 0,
    empty_line: 'Nothing has been delivered yet. As we complete work, it will appear here, with a clear note on what it is and what to do with it.',
    primary_id: primary ? primary.current.id : null,
    deliveries,
    your_uploads: yours,
  };
}


// ════════════════════════════════════════════════════════════════════════════
//  CONVERSATION  —  the ongoing relationship, not an inbox.
//
//  THE HARD RULE (Constitution VI.21): Eric's words are never rewritten,
//  summarized, paraphrased, or spoken for. No generated replies. No chatbot.
//  The literal thread is the source of truth and renders verbatim in the room.
//
//  The engine's ONLY job here is to ORIENT the client before they read: to point
//  at what is unread, what is waiting on them, what is already handled. It points
//  AT messages; it never restates their content. Every orienting line refers to a
//  message by position/role/time, never by quoting or summarizing what it said.
//
//  Questions answered (orientation only):
//    - What do I need to know?       -> count of new since last visit (pointer)
//    - What is waiting for me?       -> messages from Eric that look like they
//                                       expect a reply (heuristic, never content)
//    - What has Eric asked me?       -> a pointer to those, by time, not text
//    - What have I already responded to? -> threads where the client sent the last word
//    - What conversations are complete?  -> quiet, no open question
//    - What should I do next?        -> reply, or nothing
//    - Where do I read it exactly?   -> the literal thread, always present below
// ════════════════════════════════════════════════════════════════════════════

interface ConversationOrient {
  generated_at: string;
  total: number;                 // total messages (factual)
  unread_since_visit: number;    // new from Eric since last visit (factual count)
  // the orienting status line — about the SHAPE of the conversation, never content
  status: { tone: 'action' | 'calm' | 'good'; line: string };
  waiting_on_you: boolean;       // Eric sent the last message and it looks like it wants a reply
  waiting_pointer: string | null; // e.g. "Eric's most recent message, sent 2 days ago" — a POINTER, no content
  you_responded: boolean;        // the client sent the most recent message
  next_step: string;             // "reply when you're ready" / "nothing needed" — orientation, not words
  // a gentle anchor telling the client where the literal record is
  read_anchor: string;
}

// Does a message from Eric look like it expects a reply? We judge ONLY by
// surface shape (ends in a question mark, or is the most recent and unanswered).
// We never read meaning or restate anything. This stays a structural heuristic.
function looksLikeQuestion(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  return /\?\s*$/.test(t) || /\?[^?]{0,40}$/.test(t);
}

function conversationFor(s: ClientSnapshot): ConversationOrient {
  // messages come in with from_who, created_at, text — we use from_who + timing
  // + the bare question-mark shape ONLY. We never store or echo the text here.
  const msgs = (s.messages || [])
    .slice()
    .sort((a: any, b: any) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
  const total = msgs.length;
  const lv = s.lastVisit;

  const last = msgs.length ? msgs[msgs.length - 1] : null;
  const lastFromEric = !!(last && (last.from_who === 'studio' || last.from_who === 'eric'));
  const youRespondedLast = !!(last && last.from_who === 'client');

  const unreadSinceVisit = lv
    ? msgs.filter((m: any) => (m.from_who === 'studio' || m.from_who === 'eric') && m.created_at && new Date(m.created_at).getTime() > lv).length
    : 0;

  // waiting on you: Eric sent the last word AND it has the shape of a question,
  // OR there is genuinely new unread from Eric. (Shape only, never content.)
  const lastText = last ? ce(last.text || last.body) : '';
  const waitingOnYou = lastFromEric && (looksLikeQuestion(lastText) || unreadSinceVisit > 0);

  // a POINTER to the waiting message — by time, never by content
  let waitingPointer: string | null = null;
  if (waitingOnYou && last && last.created_at) {
    const days = Math.floor((Date.now() - new Date(last.created_at).getTime()) / 86400000);
    const when = days <= 0 ? 'today' : (days === 1 ? 'yesterday' : `${days} days ago`);
    waitingPointer = `Eric\u2019s most recent message, sent ${when}`;
  }

  // status line — describes the STATE of the relationship, not any message text
  let status: { tone: 'action' | 'calm' | 'good'; line: string };
  if (total === 0) {
    status = { tone: 'calm', line: 'This is where you and Eric stay in touch. Say hello whenever you like.' };
  } else if (waitingOnYou) {
    status = { tone: 'action', line: 'Eric is waiting to hear back from you when you have a moment.' };
  } else if (youRespondedLast) {
    status = { tone: 'good', line: 'You\u2019re all caught up. Eric has your latest message and will follow up.' };
  } else {
    status = { tone: 'calm', line: 'You\u2019re up to date. Nothing here needs you right now.' };
  }

  const nextStep = waitingOnYou
    ? 'Read Eric\u2019s message below and reply when you\u2019re ready. No rush.'
    : (total === 0
        ? 'Send Eric a note any time. He typically replies within a day.'
        : 'Nothing is needed from you here. Send a note any time you have a question.');

  return {
    generated_at: new Date().toISOString(),
    total,
    unread_since_visit: unreadSinceVisit,
    status,
    waiting_on_you: waitingOnYou,
    waiting_pointer: waitingPointer,
    you_responded: youRespondedLast,
    next_step: nextStep,
    read_anchor: 'Your full conversation is below, exactly as it happened.',
  };
}


// ════════════════════════════════════════════════════════════════════════════
//  BILLING  —  the last high-stakes room. Calm, exact, trustworthy.
//
//  THE HARD RULE: the engine interprets ONLY the situation (are you paid up, is
//  anything due, what's next). It NEVER touches money. It does not sum amounts,
//  reformat them, or restate them. Every amount, date, status, and payment link
//  is passed through LITERAL and exact, straight from the invoice rows, for the
//  room to render verbatim (Constitution: money is exact; no AI substitute for an
//  invoice; no vague financial language; no manufactured urgency).
//
//  The engine reads only invoice STATUS (paid / pending / due) and due dates to
//  pick a calm status line. It reports counts, never computed totals. Confidence
//  is built through clarity, not reassurance about numbers it invented.
//
//  Questions answered (situation only):
//    - Am I paid up?        -> status line, from counts of paid vs pending
//    - Is anything due?      -> yes/no, from pending count
//    - What is due next?     -> a POINTER to the next pending invoice (literal row)
//    - When is it due?       -> the literal due_date, passed through unchanged
//    - What have I paid?      -> a POINTER to the paid invoices (literal rows)
//    - What does it cover?    -> the literal invoice name/description (verbatim)
//    - What can I stop worrying about? -> if all paid, an explicit all-clear
// ════════════════════════════════════════════════════════════════════════════

interface BillingSituation {
  generated_at: string;
  // counts only — NEVER summed amounts (the room renders literal amounts itself)
  total_invoices: number;
  paid_count: number;
  due_count: number;
  // the calm status line — about the SITUATION, never the money
  status: { tone: 'good' | 'calm' | 'action'; line: string };
  // a POINTER to the next thing due (by id) — the room renders its literal row
  next_due_id: string | null;
  next_due_when: string | null;     // the literal due_date string, passed through
  // what you can stop worrying about, only when genuinely all-clear
  all_clear: boolean;
  all_clear_line: string | null;
  // a calm note for "nothing scheduled / paid as we go" cases
  next_note: string | null;
}

// classify a row's status WITHOUT touching its amount. We only read the status
// field and normalize the vocabulary.
function invIsPaid(s: string): boolean { const x = (s || '').toLowerCase(); return x === 'paid' || x === 'complete' || x === 'completed'; }
function invIsDue(s: string): boolean { const x = (s || '').toLowerCase(); return x === 'pending' || x === 'due' || x === 'unpaid' || x === 'open' || x === 'overdue'; }

function billingFor(s: ClientSnapshot): BillingSituation {
  const rows = (s.invoices || []);
  const total = rows.length;
  const paid = rows.filter((i: any) => invIsPaid(ce(i.status)));
  const due = rows.filter((i: any) => invIsDue(ce(i.status)));

  // the next thing due: earliest due_date among pending, else first pending.
  // We point at it by id and pass its due_date through LITERAL. No amount read.
  let nextDue: any = null;
  if (due.length) {
    const withDates = due.filter((i: any) => i.due_date);
    if (withDates.length) {
      nextDue = withDates.slice().sort((a: any, b: any) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())[0];
    } else {
      nextDue = due[0];
    }
  }

  // calm status line — describes the SITUATION, never a number.
  let status: { tone: 'good' | 'calm' | 'action'; line: string };
  let allClear = false, allClearLine: string | null = null, nextNote: string | null = null;

  if (total === 0) {
    status = { tone: 'calm', line: 'Nothing has been billed yet. When there is something to pay, it will appear here, clear and itemized.' };
    nextNote = 'Your next payment will show up here when it is due. Nothing is needed from you right now.';
  } else if (due.length === 0) {
    // everything paid
    status = { tone: 'good', line: 'You\u2019re all paid up.' };
    allClear = true;
    allClearLine = 'There is nothing outstanding. Your account is fully settled, and we will let you know here whenever the next payment is due.';
  } else if (due.length === 1) {
    status = { tone: 'action', line: 'One invoice is due.' };
    nextNote = nextDue && nextDue.due_date
      ? null  // the literal due date is shown on the invoice row itself
      : 'You can pay it below whenever you are ready.';
  } else {
    status = { tone: 'action', line: `${due.length} invoices are due.` };
  }

  return {
    generated_at: new Date().toISOString(),
    total_invoices: total,
    paid_count: paid.length,
    due_count: due.length,
    status,
    next_due_id: nextDue ? String(nextDue.id || '') : null,
    next_due_when: nextDue && nextDue.due_date ? ce(nextDue.due_date) : null, // literal pass-through
    all_clear: allClear,
    all_clear_line: allClearLine,
    next_note: nextNote,
  };
}


// ════════════════════════════════════════════════════════════════════════════
//  PROGRESS  —  the client's Progress experience (formerly "Project").
//
//  A progress BRIEFING, not a roadmap. It builds confidence by making the
//  CURRENT focus primary, collapsing completed work into concise milestones, and
//  previewing what's next without overwhelming. Human language only — never
//  "Phase 2", "Week 3-4", "Sprint", "Day 45".
//
//  Constitution: build confidence; interpret before presenting; the literal
//  artifact (real stage, real events, real progress) sits beneath; keep the
//  timeline HONEST; never manufacture progress; never exaggerate certainty;
//  never overwhelm.
//
//  Questions answered:
//    - How far have we come?       -> a calm, honest position (not a false %)
//    - What are we working on now?  -> the current stage, primary, present tense
//    - What have we completed?      -> finished stages, collapsed to milestones
//    - What's coming next?          -> the next stage, previewed plainly
//    - Do you need anything from me? -> ball_in_court + open approvals
//    - Why feel confident?          -> momentum: work done, steady movement
//    - Since I was last here?        -> meaningful events/work since last visit
// ════════════════════════════════════════════════════════════════════════════

// the honest, ordered journey. labels are human; we never expose stage keys.
const PROGRESS_STAGES: Array<{ key: string; label: string; doing: string; coming: string }> = [
  { key: 'kickoff', label: 'Getting started',        doing: 'getting your project underway and lining everything up', coming: 'We\u2019ll kick things off and get aligned on the plan.' },
  { key: 'content', label: 'Gathering your content', doing: 'gathering and shaping the content for your site',          coming: 'Next we\u2019ll gather the words and assets your site needs.' },
  { key: 'design',  label: 'Designing',              doing: 'designing how your site will look and feel',               coming: 'Next we\u2019ll design how everything looks.' },
  { key: 'build',   label: 'Building',               doing: 'building your site and putting the pieces together',       coming: 'Next we\u2019ll build it out for real.' },
  { key: 'review',  label: 'Your review',            doing: 'putting the final touches on, ready for your eyes',        coming: 'Next you\u2019ll get to review everything.' },
  { key: 'launch',  label: 'Launching',              doing: 'preparing to take your site live',                         coming: 'Next we\u2019ll take it live.' },
  { key: 'complete',label: 'Complete',               doing: 'keeping everything running smoothly',                      coming: '' },
];

interface ProgressMilestone { label: string; done: boolean; current: boolean; upcoming: boolean; }
interface ProgressBrief {
  generated_at: string;
  has_project: boolean;
  project_name: string | null;

  // the confidence headline — honest position, no manufactured precision
  headline: { tone: 'good' | 'calm' | 'action' | 'win'; line: string };

  // CURRENT FOCUS — the primary element of the page
  current: { label: string; line: string; is_complete: boolean } | null;

  // do you need anything from me — the single clearest signal
  needs_you: { yes: boolean; line: string };

  // completed work, collapsed into concise milestones
  completed: ProgressMilestone[];
  // what's coming next, previewed plainly (one step, not the whole map)
  next: { label: string; line: string } | null;

  // the honest ordered journey (for a calm, lightweight stepper beneath)
  journey: ProgressMilestone[];

  // since your last visit — meaningful movement only (may be empty)
  since: string[];

  // confidence — momentum evidence, never assertion
  confidence: { line: string; points: string[] };

  // literal recent updates, plain-English, beneath the interpretation
  updates: Array<{ text: string; when: string | null }>;
}

function progressStageIndex(stage: string): number {
  const i = PROGRESS_STAGES.findIndex((x) => x.key === (stage || '').toLowerCase());
  return i < 0 ? 0 : i;
}

// turn one event into a plain-English line (no PM jargon, no stage keys)
function progressEventLine(ev: any): string {
  const p = ev.payload || {};
  const t = ev.type || '';
  if (t === 'project.stage_advanced') {
    const idx = PROGRESS_STAGES.findIndex((x) => x.key === (p.to_stage || '').toLowerCase());
    const label = idx >= 0 ? PROGRESS_STAGES[idx].label : 'the next step';
    return p.note ? `Moved into ${label.toLowerCase()}. ${ce(p.note)}` : `Moved into ${label.toLowerCase()}.`;
  }
  if (t === 'project.launched') return 'Your site went live.';
  return ce(t).replace(/[._]/g, ' ');
}

function progressFor(s: ClientSnapshot): ProgressBrief {
  const proj = s.project || null;
  const events = (s.events || []);
  const lv = s.lastVisit;

  if (!proj || !proj.stage) {
    // honest "no active project" — calm, not a dead end
    return {
      generated_at: new Date().toISOString(),
      has_project: false,
      project_name: proj ? (ce(proj.name) || null) : null,
      headline: { tone: 'calm', line: 'We\u2019re managing your business behind the scenes. When there\u2019s an active project, its progress will live here.' },
      current: null,
      needs_you: { yes: false, line: 'Nothing needs you right now.' },
      completed: [],
      next: null,
      journey: [],
      since: [],
      confidence: { line: 'We\u2019re actively looking after your online presence.', points: [] },
      updates: [],
    };
  }

  const stage = ce(proj.stage).toLowerCase();
  const idx = progressStageIndex(stage);
  const isComplete = stage === 'complete';
  const cur = PROGRESS_STAGES[idx];
  const ballClient = (proj.ball_in_court || '') === 'client';
  const openApprovals = (s.approvals || []).filter((a: any) => a && (a.status === 'pending' || a.status === 'open' || !a.status));

  // ── JOURNEY + COMPLETED MILESTONES (honest, collapsed) ──
  const journey: ProgressMilestone[] = PROGRESS_STAGES.map((st, i) => ({
    label: st.label,
    done: i < idx || isComplete,
    current: i === idx && !isComplete,
    upcoming: i > idx && !isComplete,
  }));
  const completed: ProgressMilestone[] = journey.filter((m) => m.done && !m.current);

  // ── CURRENT FOCUS (primary, present tense, honest) ──
  const current = {
    label: cur.label,
    line: isComplete
      ? 'Your project is complete. We\u2019re now keeping everything running smoothly and watching for ways to help you grow.'
      : `Right now, we\u2019re ${cur.doing}.`,
    is_complete: isComplete,
  };

  // ── NEXT (one step ahead, previewed plainly) ──
  let next: { label: string; line: string } | null = null;
  if (!isComplete && idx + 1 < PROGRESS_STAGES.length) {
    const nx = PROGRESS_STAGES[idx + 1];
    next = { label: nx.label, line: nx.coming };
  }

  // ── NEEDS YOU (the single clearest signal) ──
  let needsYou: { yes: boolean; line: string };
  if (openApprovals.length) {
    needsYou = { yes: true, line: openApprovals.length === 1
      ? 'There\u2019s one thing waiting for your review. You\u2019ll find it under Your decisions.'
      : `There are ${openApprovals.length} things waiting for your review, under Your decisions.` };
  } else if (ballClient) {
    needsYou = { yes: true, line: 'We\u2019re waiting on something small from you to keep moving. Check your conversation with Eric for what\u2019s needed.' };
  } else {
    needsYou = { yes: false, line: 'Nothing needed from you today. We\u2019re on it.' };
  }

  // ── SINCE LAST VISIT (meaningful movement only) ──
  const since: string[] = [];
  if (lv) {
    events.filter((e: any) => e.created_at && new Date(e.created_at).getTime() > lv)
      .slice(0, 4)
      .forEach((e: any) => since.push(progressEventLine(e)));
    (s.work || []).filter((w: any) => w.done_at && new Date(w.done_at).getTime() > lv)
      .slice(0, 3)
      .forEach((w: any) => since.push(`We finished ${ce(w.title).toLowerCase()}.`));
  }

  // ── HEADLINE (confidence-first, honest position, no false %) ──
  let headline: { tone: 'good' | 'calm' | 'action' | 'win'; line: string };
  if (isComplete) {
    headline = { tone: 'win', line: 'Your project is complete, and your site is live.' };
  } else if (needsYou.yes) {
    headline = { tone: 'action', line: `We\u2019re ${cur.doing}. There\u2019s one thing that needs you.` };
  } else if (completed.length >= Math.ceil(PROGRESS_STAGES.length / 2)) {
    headline = { tone: 'good', line: `Good momentum. We\u2019re well along, currently ${cur.doing}.` };
  } else {
    headline = { tone: 'calm', line: `We\u2019re underway and actively ${cur.doing}.` };
  }

  // ── CONFIDENCE (evidence: movement made, steady progress) ──
  const points: string[] = [];
  if (completed.length) points.push(`${completed.length} ${completed.length === 1 ? 'stage' : 'stages'} completed so far.`);
  const recentDone = (s.work || []).filter((w: any) => w.done_at).length;
  if (recentDone) points.push(`${recentDone} ${recentDone === 1 ? 'piece' : 'pieces'} of work delivered.`);
  if (!ballClient && !isComplete) points.push('Work is actively moving on your side of the table right now.');
  const confidence = {
    line: isComplete
      ? 'The work is done and your site is live. We\u2019re here for whatever comes next.'
      : (completed.length
          ? 'You can see the progress stacking up. We\u2019re moving steadily and the work speaks for itself.'
          : 'We\u2019ve started strong and we\u2019re actively moving your project forward.'),
    points,
  };

  // ── LITERAL UPDATES (plain English, beneath the interpretation) ──
  const updates = events.slice(0, 6).map((e: any) => ({
    text: progressEventLine(e),
    when: e.created_at || null,
  }));

  return {
    generated_at: new Date().toISOString(),
    has_project: true,
    project_name: ce(proj.name) || null,
    headline,
    current,
    needs_you: needsYou,
    completed,
    next,
    journey,
    since,
    confidence,
    updates,
  };
}

// ===== end client reasoning engine =====




serve(async (req) => {
  const reqCors = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: reqCors });

  try {
    // Most routes are POST with a JSON body. OAuth redirects (e.g. Google) arrive
    // as GET with ?type=...&code=...&state=... and no body — handle both.
    let body: any = {};
    const _url = new URL(req.url);
    if (req.method === 'GET') {
      body = Object.fromEntries(_url.searchParams.entries());
    } else {
      try { body = await req.json(); } catch { body = {}; }
      if (!body || !body.type) { const qt = _url.searchParams.get('type'); if (qt) body.type = qt; }
    }
    const { type } = body;

    // ═══════════════════════════════════════════════════════════════════════
    //  SINGLE FAIL-CLOSED AUTHORIZATION GATE (Part 2a)
    //  Runs once, up front. Privileged routes (ROUTE_MIN_ROLE) require a real
    //  membership row AND sufficient role. Everything else falls through to its
    //  own handling (public routes, client-portal routes, secret-gated jobs).
    //  The inline `verifyAdminJwt` checks still present in routes below are now
    //  redundant but harmless; they delegate to the same fail-closed logic.
    // ═══════════════════════════════════════════════════════════════════════
    {
      const minRole = ROUTE_MIN_ROLE[type as string];
      if (minRole) {
        const staff = await verifyStaff(req);
        if (!staff) return json({ error: 'unauthorized' }, 401, reqCors);
        if (!atLeast(staff.role, minRole)) return json({ error: 'forbidden' }, 403, reqCors);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  WHOAMI — lightweight identity check (not gated; safe for anyone logged in)
    //  Returns the caller's role if they're a team member, or role:null if not.
    //  Used by set-password.html to send team members to the admin panel and
    //  clients to the client portal. Reveals nothing an attacker couldn't learn
    //  by trying to log in; it only reflects the caller's own membership.
    // ═══════════════════════════════════════════════════════════════════════
    if (type === 'whoami') {
      const staff = await verifyStaff(req);
      if (!staff) return json({ role: null, isTeam: false }, 200, reqCors);
      return json({ role: staff.role, isTeam: true, email: staff.email }, 200, reqCors);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  EVENT SPINE ROUTES
    // ═══════════════════════════════════════════════════════════════════════
    const DDS_AGENCY = TENANT_ID;

    const emitEvent = async (args: {
      type: string;
      actor?: 'admin' | 'client' | 'system';
      contact?: string | null;
      project?: string | null;
      payload?: Record<string, unknown>;
      clientVisible?: boolean;
    }) => {
      if (!SB_SERVICE) return { error: 'no service key' };
      const r = await fetch(`${SB_URL}/rest/v1/rpc/emit`, {
        method: 'POST',
        headers: {
          'apikey': SB_SERVICE,
          'Authorization': `Bearer ${SB_SERVICE}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_agency: DDS_AGENCY,
          p_type: args.type,
          p_actor: args.actor || 'system',
          p_contact: args.contact ?? null,
          p_project: args.project ?? null,
          p_payload: args.payload || {},
          p_client_visible: args.clientVisible ?? false,
        }),
      });
      const text = await r.text();
      let data: unknown = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      return r.ok ? { id: data } : { error: data };
    };

    const CLIENT_EMAIL_EVENTS = new Set([
      'project.stage_advanced', 'message.sent', 'approval.requested',
      'invoice.sent', 'file.shared', 'project.launched',
    ]);
    const STAGE_LABELS: Record<string, string> = {
      kickoff: 'Kickoff', content: 'Gathering your content', design: 'Design',
      build: 'Building your site', review: 'Your review', launch: 'Launch', complete: 'Complete',
    };
    const PORTAL_URL = 'https://davisdigitalstudio.com/portal';
    const contactEmail = async (contactId: string) => {
      try {
        const r = await fetch(`${SB_URL}/rest/v1/contacts?id=eq.${encodeURIComponent(contactId)}&select=email,name&limit=1`,
          { headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` } });
        const rows = r.ok ? await r.json() : [];
        if (Array.isArray(rows) && rows.length && rows[0].email) return { email: String(rows[0].email), name: rows[0].name || 'there' };
      } catch (_) { /* ignore */ }
      return null;
    };
    const notifyClientOfEvent = async (
      eventType: string,
      contactId: string | null | undefined,
      payload: Record<string, any> = {},
    ): Promise<{ emailed: boolean; reason?: string }> => {
      try {
        if (!eventType || !CLIENT_EMAIL_EVENTS.has(eventType)) return { emailed: false, reason: 'not_a_client_email_event' };
        if (!contactId) {
          // The action saved, but we have no contact to email. Make this loud:
          // tell Eric so a client never silently misses a portal notification.
          console.error('[email] client notify skipped — no contactId for event', eventType);
          try {
            await sendEmail(ERIC, `Heads up: a client notification could not be sent`, notifyShell(
              `A "${eventType}" update wasn't emailed`,
              [
                `You just performed a <strong>${eventType}</strong> action in the portal, but it isn't linked to a client contact, so no notification email went out.`,
                `The action itself is saved. The client simply wasn't emailed.`,
                `Fix: open the client record and make sure their contact (and email) is linked, then re-send if needed.`,
              ],
              { label: 'Open admin', href: 'https://davisdigitalstudio.com/dds-studio-manage-9k2p' },
            ));
          } catch (_) { /* best-effort */ }
          return { emailed: false, reason: 'no_contact_linked' };
        }
        const c = await contactEmail(contactId);
        if (!c) {
          console.error('[email] client notify skipped — contact', contactId, 'has no email for event', eventType);
          try {
            await sendEmail(ERIC, `Heads up: a client notification could not be sent`, notifyShell(
              `A "${eventType}" update wasn't emailed`,
              [
                `You just performed a <strong>${eventType}</strong> action, but the linked contact has no email on file, so no notification went out.`,
                `The action itself is saved. Add an email to the contact to enable notifications.`,
              ],
              { label: 'Open admin', href: 'https://davisdigitalstudio.com/dds-studio-manage-9k2p' },
            ));
          } catch (_) { /* best-effort */ }
          return { emailed: false, reason: 'contact_has_no_email' };
        }
        const name = c.name || 'there';
        let subject = 'An update on your project';
        let heading = 'An update on your project';
        let lines: string[] = [];
        let cta = { label: 'Open your portal →', href: PORTAL_URL };

        if (eventType === 'project.stage_advanced') {
          const stage = STAGE_LABELS[payload.to_stage] || payload.to_stage || 'the next step';
          const yourTurn = payload.ball_in_court === 'client';
          subject = yourTurn ? `${name}, your project needs you` : `Your project moved to ${stage}`;
          heading = yourTurn ? `It’s your turn, ${name}` : `Progress on your project`;
          lines = yourTurn
            ? [
                `Your project just moved to <strong>${stage}</strong>, and I need something from you to keep going.`,
                payload.note ? String(payload.note) : `Check your portal for what’s needed.`,
                `Whenever you get a chance, it keeps us right on schedule.`,
              ]
            : [
                `Quick update: your project just moved to <strong>${stage}</strong>.`,
                payload.note ? String(payload.note) : `Everything’s moving along. Nothing is needed from you right now.`,
              ];
        } else if (eventType === 'message.sent') {
          subject = `New message from Eric`;
          heading = `You have a new message`;
          lines = [ payload.preview ? String(payload.preview) : `Eric sent you a message in your portal.` ];
        } else if (eventType === 'approval.requested') {
          subject = `Something’s ready for your approval`;
          heading = `Ready for your review`;
          lines = [ payload.title ? `“${payload.title}” is ready for you to approve.` : `Something’s ready for your approval in the portal.` ];
        } else if (eventType === 'invoice.sent') {
          subject = `Your invoice from Davis Digital Studio`;
          heading = `A new invoice`;
          lines = [ payload.amount ? `An invoice for $${payload.amount} is ready in your portal.` : `A new invoice is ready in your portal.` ];
        } else if (eventType === 'file.shared') {
          subject = `Eric shared a file with you`;
          heading = `A new file for you`;
          lines = [ payload.name ? `“${payload.name}” was just added to your portal.` : `A new file is waiting in your portal.` ];
        } else if (eventType === 'project.launched') {
          subject = `Your site is live 🎉`;
          heading = `Congratulations, ${name}!`;
          lines = [ `Your site just launched. It’s been a genuine pleasure building this with you.` ];
        }
        const sent = await emailOk(c.email, subject, notifyShell(heading, lines, cta));
        return { emailed: sent, reason: sent ? undefined : 'resend_send_failed' };
      } catch (e) {
        console.error('[email] notifyClientOfEvent threw', String(e));
        return { emailed: false, reason: 'exception' };
      }
    };

    if (type === 'emit_event') {
      // Gate already enforced staff + role. Inline check kept (harmless, fail-closed).
      if (!(await verifyAdminJwt(req))) return json({ error: 'unauthorized' }, 401, reqCors);
      const { eventType, actor, contact, project, payload, clientVisible } = body;
      if (!eventType) return json({ error: 'eventType required' }, 400, reqCors);
      const out = await emitEvent({ type: eventType, actor, contact, project, payload, clientVisible });
      let notify: { emailed: boolean; reason?: string } = { emailed: false, reason: 'not_attempted' };
      if (!out.error && contact) {
        notify = await notifyClientOfEvent(eventType, contact, payload || {});
      } else if (!out.error && !contact && CLIENT_EMAIL_EVENTS.has(eventType)) {
        // event saved but no contact passed → warn Eric, report it back
        notify = await notifyClientOfEvent(eventType, null, payload || {});
      }
      return out.error
        ? json({ error: out.error }, 200, reqCors)
        : json({ ok: true, id: out.id, emailed: notify.emailed, notify_reason: notify.reason || null }, 200, reqCors);
    }

    if (type === 'advance_stage') {
      if (!(await verifyAdminJwt(req))) return json({ error: 'unauthorized' }, 401, reqCors);
      const { projectId, contactId, toStage, ballInCourt, progress, note } = body;
      if (!projectId || !toStage) return json({ error: 'projectId and toStage required' }, 400, reqCors);
      const out = await emitEvent({
        type: 'project.stage_advanced',
        actor: 'admin',
        contact: contactId || null,
        project: projectId,
        payload: { to_stage: toStage, ball_in_court: ballInCourt || 'agency', progress, note },
        clientVisible: true,
      });
      if (!out.error) {
        let cid = contactId || null;
        if (!cid) {
          try {
            const pr = await fetch(`${SB_URL}/rest/v1/projects?id=eq.${encodeURIComponent(projectId)}&select=contact_id&limit=1`,
              { headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` } });
            const rows = pr.ok ? await pr.json() : [];
            if (Array.isArray(rows) && rows.length) cid = rows[0].contact_id;
          } catch (_) { /* ignore */ }
        }
        if (cid) {
          await notifyClientOfEvent('project.stage_advanced', cid, { to_stage: toStage, ball_in_court: ballInCourt || 'agency', note });
        }
      }
      return out.error ? json({ error: out.error }, 200, reqCors) : json({ ok: true, id: out.id }, 200, reqCors);
    }

    if (type === 'client_feed') {
      const { contactId } = body;
      if (!contactId) return json({ error: 'contactId required' }, 400, reqCors);
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const r = await fetch(
        `${SB_URL}/rest/v1/events?contact_id=eq.${encodeURIComponent(contactId)}&client_visible=eq.true&select=type,actor,payload,created_at&order=created_at.desc&limit=50`,
        { headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` } },
      );
      const data = await r.json();
      return json({ data }, 200, reqCors);
    }

    if (type === 'client_project') {
      // Refactored to lean on RLS. Reads run under the CALLER'S identity
      // (anon key + their JWT), so Postgres returns only rows the logged-in
      // contact owns — the "see only your own project" policies from Step 2.
      // The function no longer hand-matches ownership; the database enforces it.
      //
      // Defense in depth for the client experience: if the contact lookup comes
      // back empty despite a valid session (e.g. a contact whose auth_user_id
      // was never linked), we fall back ONCE to a service-role lookup so a real
      // client never sees a blank portal from a data-linkage gap. That fallback
      // is logged so Eric can fix the link, and it still only returns that one
      // contact's own rows.
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const jwt = req.headers.get('x-dds-user-jwt') || '';
      if (!jwt) return json({ error: 'unauthorized' }, 401, reqCors);

      // Validate the session.
      const uRes = await fetch(`${SB_URL}/auth/v1/user`, {
        headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${jwt}` },
      });
      if (!uRes.ok) return json({ error: 'unauthorized' }, 401, reqCors);
      const user = await uRes.json();
      const email = (user && user.email ? String(user.email) : '').toLowerCase();
      const uid = user && user.id ? String(user.id) : '';
      if (!email && !uid) return json({ error: 'unauthorized' }, 401, reqCors);

      // Reads as the CALLER (anon key + their JWT) → RLS scopes every row.
      const asUser = SB_ANON
        ? { 'apikey': SB_ANON, 'Authorization': `Bearer ${jwt}` }
        : null;

      // ── Primary path: RLS-scoped reads under the caller's identity ──
      let contact: any = null;
      let project: any = null;
      let feed: any[] = [];

      if (asUser) {
        try {
          // contacts_self_read policy → returns only the caller's own contact row
          const cr = await fetch(`${SB_URL}/rest/v1/contacts?select=id,name,stage&limit=1`, { headers: asUser });
          const rows = cr.ok ? await cr.json() : [];
          if (Array.isArray(rows) && rows.length) contact = rows[0];
        } catch (_) { /* fall through to service fallback */ }

        if (contact) {
          // projects_client_read + events_client_read scope these to the caller.
          try {
            const pr = await fetch(`${SB_URL}/rest/v1/projects?select=id,name,stage,ball_in_court,progress,launched_at&order=created_at.desc&limit=1`, { headers: asUser });
            const rows = pr.ok ? await pr.json() : [];
            if (Array.isArray(rows) && rows.length) project = rows[0];
          } catch (_) { /* none */ }
          try {
            const fr = await fetch(`${SB_URL}/rest/v1/events?client_visible=eq.true&select=type,actor,payload,created_at&order=created_at.desc&limit=30`, { headers: asUser });
            feed = fr.ok ? await fr.json() : [];
            if (!Array.isArray(feed)) feed = [];
          } catch (_) { feed = []; }

          return json({ data: { contact: { id: contact.id, name: contact.name }, project, feed } }, 200, reqCors);
        }
      }

      // ── Fallback: contact not found via RLS (or no anon key configured) ──
      // Look the contact up with the service role so a linkage gap doesn't show
      // the client a blank portal. Logged so the missing auth_user_id link can
      // be fixed. Still scoped to THIS user's own contact only.
      console.warn('client_project: RLS read returned no contact; using service fallback for', email || uid);
      const svc = { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` };
      try {
        if (uid) {
          const cr = await fetch(`${SB_URL}/rest/v1/contacts?auth_user_id=eq.${encodeURIComponent(uid)}&deleted_at=is.null&select=id,name,stage&limit=1`, { headers: svc });
          const rows = cr.ok ? await cr.json() : [];
          if (Array.isArray(rows) && rows.length) contact = rows[0];
        }
        if (!contact && email) {
          const cr = await fetch(`${SB_URL}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&deleted_at=is.null&select=id,name,stage&limit=1`, { headers: svc });
          const rows = cr.ok ? await cr.json() : [];
          if (Array.isArray(rows) && rows.length) contact = rows[0];
        }
      } catch (_) { /* fall through */ }
      if (!contact) return json({ data: { project: null, feed: [] } }, 200, reqCors);

      try {
        const pr = await fetch(`${SB_URL}/rest/v1/projects?contact_id=eq.${encodeURIComponent(contact.id)}&select=id,name,stage,ball_in_court,progress,launched_at&order=created_at.desc&limit=1`, { headers: svc });
        const rows = pr.ok ? await pr.json() : [];
        if (Array.isArray(rows) && rows.length) project = rows[0];
      } catch (_) { /* none */ }
      try {
        const fr = await fetch(`${SB_URL}/rest/v1/events?contact_id=eq.${encodeURIComponent(contact.id)}&client_visible=eq.true&select=type,actor,payload,created_at&order=created_at.desc&limit=30`, { headers: svc });
        feed = fr.ok ? await fr.json() : [];
        if (!Array.isArray(feed)) feed = [];
      } catch (_) { feed = []; }

      return json({ data: { contact: { id: contact.id, name: contact.name }, project, feed } }, 200, reqCors);
    }
    // ═══════════════════════════════════════════════════════════════════════
    //  END EVENT SPINE ROUTES
    // ═══════════════════════════════════════════════════════════════════════

    if (RATE_LIMITED_TYPES.has(type) && isRateLimited(req)) {
      return json({ error: 'rate_limited', message: 'Too many requests. Please wait a minute and try again.' }, 429, reqCors);
    }

    // ── PSI PROXY ──
    if (type === 'psi_fetch') {
      const { url } = body;
      if (!url) return json({ error: 'No URL provided' }, 400);
      const strategy = body.strategy === 'desktop' ? 'desktop' : 'mobile';
      const ALLOWED_CATS = ['performance', 'seo', 'accessibility', 'best-practices'];
      let cats = Array.isArray(body.categories) ? body.categories.filter((c) => ALLOWED_CATS.includes(c)) : [];
      if (cats.length === 0) cats = ['performance', 'seo', 'accessibility'];
      const catParams = cats.map((c) => `&category=${c}`).join('');
      const psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}${catParams}&key=${PSI_KEY}`;
      try {
        const psiRes = await fetch(psiUrl, { signal: AbortSignal.timeout(90000) });
        const psiData = await psiRes.json();
        if (psiData.error) return json({ error: psiData.error.message || 'PSI error', code: psiData.error.code });
        return json({ data: psiData });
      } catch (psiErr) {
        const isTimeout = psiErr instanceof Error && (psiErr.name === 'TimeoutError' || psiErr.message.includes('timeout'));
        return json({ error: isTimeout ? 'timeout' : 'fetch_failed', message: String(psiErr) });
      }
    }

    // ── DEEP AUDIT ──
    if (type === 'deep_audit') {
      const { url } = body;
      if (!url) return json({ error: 'No URL provided' }, 400);
      try { return json({ data: await deepAudit(url) }); }
      catch (e) { return json({ error: 'deep_audit_failed', message: String(e) }); }
    }

    // ── CREATE CLIENT AUTH USER ── (gate: admin)
    if (type === 'create_client_auth') {
      const { email, password } = body;
      if (!email || !password) return json({ error: 'email and password required' }, 400);
      if (!SB_SERVICE) return json({ error: 'Server missing SERVICE_ROLE_KEY secret' }, 500);
      try {
        const res = await fetch(`${SB_URL}/auth/v1/admin/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` },
          body: JSON.stringify({ email, password, email_confirm: true }),
        });
        const data = await res.json();
        if (!res.ok) {
          return json({ error: data.msg || data.message || data.error_description || 'Could not create login', status: res.status }, 200);
        }
        return json({ ok: true, user_id: data.id || (data.user && data.user.id) || null });
      } catch (e) {
        return json({ error: 'auth_create_failed', message: String(e) }, 200);
      }
    }

    // ── ADMIN DB PROXY ── (gate: staff)
    if (type === 'admin_db') {
      if (!(await verifyAdminJwt(req))) return json({ error: 'unauthorized' }, 401, reqCors);
      if (!SB_SERVICE) return json({ error: 'Server missing SERVICE_ROLE_KEY secret' }, 500, reqCors);
      const path = String(body.path || '');
      const method = String(body.method || 'GET').toUpperCase();
      const payload = body.payload || null;
      if (!path) return json({ error: 'path required' }, 400, reqCors);
      const table = path.split('?')[0].split('/')[0];
      if (!ADMIN_DB_TABLES.has(table)) {
        return json({ error: 'table_not_allowed', detail: table }, 403, reqCors);
      }
      if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) {
        return json({ error: 'method_not_allowed', detail: method }, 405, reqCors);
      }
      try {
        const headers: Record<string, string> = {
          'apikey': SB_SERVICE,
          'Authorization': `Bearer ${SB_SERVICE}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        };
        const init: RequestInit = { method, headers };
        if (payload !== null && method !== 'GET' && method !== 'DELETE') {
          init.body = JSON.stringify(payload);
        }
        const res = await fetch(`${SB_URL}/rest/v1/${path}`, init);
        const text = await res.text();
        let data: unknown = null;
        try { data = text ? JSON.parse(text) : null; } catch (_e) { data = text; }
        if (!res.ok) {
          return json({ error: 'db_error', status: res.status, detail: data }, 200, reqCors);
        }
        return json({ data }, 200, reqCors);
      } catch (e) {
        return json({ error: 'admin_db_failed', detail: String(e) }, 200, reqCors);
      }
    }

    // ════════════════════════════════════════════════════════════════════
    //  RELEASE 0.4 — CLIENT ARCHIVE SYSTEM (routes)
    //  Gates enforced centrally: archive/restore/list/trail=admin, purge=owner.
    // ════════════════════════════════════════════════════════════════════

    // ── client_archive ── stamp deleted_at across the whole graph
    // ── Digital Headquarters: client home ──
    if (type === 'client_hq') {
      // THIN CALLER. All client intelligence comes from clientReason(); this
      // route only: (1) authenticates, (2) resolves the caller's partnership,
      // (3) gathers the client-safe snapshot once, (4) asks the brain, (5) maps
      // the structured ClientBrief to the front-end contract. No interpretation
      // lives here. Every future client room calls this same brain the same way.
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const jwt = req.headers.get('x-dds-user-jwt') || '';
      if (!jwt) return json({ error: 'unauthorized' }, 401, reqCors);
      const uRes = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${jwt}` } });
      if (!uRes.ok) return json({ error: 'unauthorized' }, 401, reqCors);
      const user = await uRes.json();
      const uid = user?.id ? String(user.id) : '';
      const email = (user?.email ? String(user.email) : '').toLowerCase();
      if (!uid && !email) return json({ error: 'unauthorized' }, 401, reqCors);

      const hqDb = async (path: string) => {
        try {
          const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` } });
          if (!r.ok) return { ok: false, data: [] };
          return { ok: true, data: await r.json() };
        } catch { return { ok: false, data: [] }; }
      };

      // resolve THIS caller's partnership only
      let contactId = '', contactName = '';
      if (uid) { const c = await hqDb(`contacts?auth_user_id=eq.${encodeURIComponent(uid)}&select=id,name&limit=1`); if (c.ok && c.data?.length) { contactId = c.data[0].id; contactName = c.data[0].name || ''; } }
      if (!contactId && email) { const c = await hqDb(`contacts?email=eq.${encodeURIComponent(email)}&select=id,name&limit=1`); if (c.ok && c.data?.length) { contactId = c.data[0].id; contactName = c.data[0].name || ''; } }
      let partnership: any = null, clientId = '';
      if (contactId) {
        const pp = await hqDb(`partnerships?contact_id=eq.${contactId}&deleted_at=is.null&select=*&limit=1`);
        if (pp.ok && pp.data?.length) { partnership = pp.data[0]; clientId = String(partnership.client_id || ''); }
      }
      if (!partnership || !clientId) return json({ data: { state: 'no_partnership' } }, 200, reqCors);
      const pid = partnership.id;

      const svc = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` };
      const read = async (p: string) => { try { const r = await fetch(`${SB_URL}/rest/v1/${p}`, { headers: svc }); return r.ok ? await r.json() : []; } catch { return []; } };

      // ── gather the client-safe snapshot ONCE (the engine never fetches) ──
      const lastVisit = body.lastVisit ? new Date(body.lastVisit).getTime() : null;
      const [client, signals, work, project, events, recs, reviews, approvals, invoices, files, messages] = await Promise.all([
        read(`clients?id=eq.${encodeURIComponent(clientId)}&select=name,business_type,city,created_at,launched_at&limit=1`),
        read(`signals?client_id=eq.${encodeURIComponent(clientId)}&scope=eq.client_visible&select=metric,value,unit,observed_at,confidence&order=observed_at.desc&limit=200`),
        read(`work_log?partnership_id=eq.${pid}&select=id,title,done_at&order=done_at.desc&limit=12`),
        contactId ? read(`projects?contact_id=eq.${contactId}&deleted_at=is.null&select=name,stage,ball_in_court,progress&order=created_at.desc&limit=1`) : Promise.resolve([]),
        contactId ? read(`events?contact_id=eq.${contactId}&select=type,payload,created_at&order=created_at.desc&limit=20`) : Promise.resolve([]),
        pid ? read(`recommendations?partnership_id=eq.${pid}&client_visible=eq.true&select=id,title,status,impact,needs_client_input&order=created_at.desc&limit=10`) : Promise.resolve([]),
        pid ? read(`monthly_reviews?partnership_id=eq.${pid}&status=eq.published&select=period,summary&order=period.desc&limit=1`) : Promise.resolve([]),
        contactId ? read(`approvals?contact_id=eq.${contactId}&select=id,title,status&order=created_at.desc&limit=10`) : Promise.resolve([]),
        clientId ? read(`invoices?client_id=eq.${encodeURIComponent(clientId)}&select=id,amount,status&order=created_at.desc&limit=10`) : Promise.resolve([]),
        contactId ? read(`files?contact_id=eq.${contactId}&select=id,name,created_at,uploaded_by&order=created_at.desc&limit=20`) : Promise.resolve([]),
        contactId ? read(`messages?contact_id=eq.${contactId}&select=id,from_who,created_at&order=created_at.desc&limit=20`) : Promise.resolve([]),
      ]);

      // ── ask the ONE brain ──
      const brief = clientReason({
        client: (client || [])[0] || { name: 'your business' },
        contactName, partnership,
        signals: signals || [], work: work || [], project: (project || [])[0] || null,
        events: events || [], recs: recs || [], reviews: reviews || [],
        approvals: approvals || [], invoices: invoices || [], files: files || [], messages: messages || [],
        lastVisit,
      });

      // ── map ClientBrief -> front-end contract ──
      // (a) NEW seven-question structure, consumed by current + future rooms.
      // (b) BACK-COMPAT keys so today's portal renderHQ keeps working unchanged.
      const pulse = (brief.confidence.evidence || []).map((e: any) => ({ headline: e.text, value: '', change: null }));
      return json({ data: {
        // new structured brief (the contract every room consumes)
        brief: {
          generated_at: brief.generated_at,
          headline: brief.headline,
          going: brief.going,
          changed: brief.changed,
          done: brief.done,
          todo: brief.todo,
          next: brief.next,
          calm: brief.calm,
          confidence: brief.confidence,
          health: brief.health,
          meta: brief.meta,
        },
        // ---- back-compat (existing renderHQ fields) ----
        state: brief.state,
        headline: { text: brief.headline.text, kind: (brief.headline.tone === 'action' ? 'action' : (brief.headline.tone === 'win' ? 'win' : 'calm')), cta: (brief.headline.source && brief.headline.source.kind === 'approval') ? 'approvals' : ((brief.headline.tone === 'action') ? 'messages' : null) },
        business: brief.business,
        contact_first: brief.contact_first,
        confidence: { word: brief.health.word, line: brief.health.line },
        trust: { intro: (brief.meta.since_last_visit && brief.changed.length ? 'Since you were last here, we' : 'Recently, we'), items: (brief.done || []).map((d: any) => d.text) },
        active_care: (brief.next && brief.next[0]) ? brief.next[0].text.replace(/\.$/, '').toLowerCase() : null,
        momentum: (brief.confidence.evidence && brief.confidence.evidence[0]) ? { headline: brief.confidence.evidence[0].text, sub: brief.confidence.line, measured: false, building: brief.confidence.level === 'building' } : null,
        pulse,
        pulse_summary: brief.confidence.line,
        doing_now: (brief.next && brief.next[0]) ? brief.next[0].text.replace(/\.$/, '').toLowerCase() : null,
        website_health: (brief.calm.find((x: any) => x.source && x.source.ref === 'psi_performance')) ? { line: 'Your website is fast and healthy.' } : null,
        partnership: { next: (brief.next && brief.next[0]) ? brief.next[0].text : null, roadmap: (brief.next || []).map((n: any) => n.text) },
        latest_review: (reviews || [])[0] ? { period: reviews[0].period, summary: reviews[0].summary } : null,
      } }, 200, reqCors);
    }

    // ── Decisions: the client's only true action surface, interpreted ──
    if (type === 'client_decisions') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const jwt = req.headers.get('x-dds-user-jwt') || '';
      if (!jwt) return json({ error: 'unauthorized' }, 401, reqCors);
      const uRes = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${jwt}` } });
      if (!uRes.ok) return json({ error: 'unauthorized' }, 401, reqCors);
      const user = await uRes.json();
      const uid = user?.id ? String(user.id) : '';
      const email = (user?.email ? String(user.email) : '').toLowerCase();
      if (!uid && !email) return json({ error: 'unauthorized' }, 401, reqCors);

      const dDb = async (path: string) => {
        try { const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` } });
          if (!r.ok) return []; return await r.json(); } catch { return []; }
      };
      // resolve caller -> contact + client
      let contactId = '', contactName = '', clientId = '';
      if (uid) { const c = await dDb(`contacts?auth_user_id=eq.${encodeURIComponent(uid)}&select=id,name&limit=1`); if (c?.length) { contactId = c[0].id; contactName = c[0].name || ''; } }
      if (!contactId && email) { const c = await dDb(`contacts?email=eq.${encodeURIComponent(email)}&select=id,name&limit=1`); if (c?.length) { contactId = c[0].id; contactName = c[0].name || ''; } }
      if (contactId) { const pp = await dDb(`partnerships?contact_id=eq.${contactId}&deleted_at=is.null&select=client_id&limit=1`); if (pp?.length) clientId = String(pp[0].client_id || ''); }
      // approvals are keyed by client_id in this schema
      const approvals = clientId ? await dDb(`approvals?client_id=eq.${encodeURIComponent(clientId)}&deleted_at=is.null&select=id,title,description,status,created_at&order=created_at.asc&limit=20`) : [];
      const messages = contactId ? await dDb(`messages?contact_id=eq.${contactId}&select=id,from_who,text,body,created_at&order=created_at.desc&limit=30`) : [];

      // THIN: hand the literal rows to the brain; it interprets the situation only.
      const brief = decisionsFor({
        client: {}, contactName, partnership: null,
        signals: [], work: [], project: null, events: [], recs: [], reviews: [],
        approvals: approvals || [], invoices: [], files: [], messages: messages || [],
        lastVisit: null,
      } as any);

      return json({ data: brief }, 200, reqCors);
    }

    // ── Deliveries: the Files room as a delivery experience, interpreted ──
    if (type === 'client_deliveries') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const jwt = req.headers.get('x-dds-user-jwt') || '';
      if (!jwt) return json({ error: 'unauthorized' }, 401, reqCors);
      const uRes = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${jwt}` } });
      if (!uRes.ok) return json({ error: 'unauthorized' }, 401, reqCors);
      const user = await uRes.json();
      const uid = user?.id ? String(user.id) : '';
      const email = (user?.email ? String(user.email) : '').toLowerCase();
      if (!uid && !email) return json({ error: 'unauthorized' }, 401, reqCors);

      const fDb = async (path: string) => {
        try { const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` } });
          if (!r.ok) return []; return await r.json(); } catch { return []; }
      };
      let contactId = '', clientId = '';
      if (uid) { const c = await fDb(`contacts?auth_user_id=eq.${encodeURIComponent(uid)}&select=id&limit=1`); if (c?.length) contactId = c[0].id; }
      if (!contactId && email) { const c = await fDb(`contacts?email=eq.${encodeURIComponent(email)}&select=id&limit=1`); if (c?.length) contactId = c[0].id; }
      if (contactId) { const pp = await fDb(`partnerships?contact_id=eq.${contactId}&deleted_at=is.null&select=client_id&limit=1`); if (pp?.length) clientId = String(pp[0].client_id || ''); }
      // files are keyed by client_id in this schema
      const files = clientId ? await fDb(`files?client_id=eq.${encodeURIComponent(clientId)}&select=id,name,type,size,from_who,status,storage_path,created_at&order=created_at.desc&limit=100`) : [];

      const lastVisit = body.lastVisit ? new Date(body.lastVisit).getTime() : null;
      const brief = deliveriesFor({
        client: {}, contactName: '', partnership: null,
        signals: [], work: [], project: null, events: [], recs: [], reviews: [],
        approvals: [], invoices: [], files: files || [], messages: [],
        lastVisit,
      } as any);

      return json({ data: brief }, 200, reqCors);
    }

    // ── Conversation: orient before the literal thread (never rewrite words) ──
    if (type === 'client_conversation') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const jwt = req.headers.get('x-dds-user-jwt') || '';
      if (!jwt) return json({ error: 'unauthorized' }, 401, reqCors);
      const uRes = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${jwt}` } });
      if (!uRes.ok) return json({ error: 'unauthorized' }, 401, reqCors);
      const user = await uRes.json();
      const uid = user?.id ? String(user.id) : '';
      const email = (user?.email ? String(user.email) : '').toLowerCase();
      if (!uid && !email) return json({ error: 'unauthorized' }, 401, reqCors);

      const cDb = async (path: string) => {
        try { const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` } });
          if (!r.ok) return []; return await r.json(); } catch { return []; }
      };
      let contactId = '', clientId = '';
      if (uid) { const c = await cDb(`contacts?auth_user_id=eq.${encodeURIComponent(uid)}&select=id&limit=1`); if (c?.length) contactId = c[0].id; }
      if (!contactId && email) { const c = await cDb(`contacts?email=eq.${encodeURIComponent(email)}&select=id&limit=1`); if (c?.length) contactId = c[0].id; }
      if (contactId) { const pp = await cDb(`partnerships?contact_id=eq.${contactId}&deleted_at=is.null&select=client_id&limit=1`); if (pp?.length) clientId = String(pp[0].client_id || ''); }
      // messages keyed by client_id; pull the LITERAL thread verbatim
      const messages = clientId ? await cDb(`messages?client_id=eq.${encodeURIComponent(clientId)}&select=id,from_who,sender_name,text,created_at&order=created_at.asc&limit=500`) : [];

      const lastVisit = body.lastVisit ? new Date(body.lastVisit).getTime() : null;
      // orientation layer (shape only, no content echoed)
      const orient = conversationFor({
        client: {}, contactName: '', partnership: null,
        signals: [], work: [], project: null, events: [], recs: [], reviews: [],
        approvals: [], invoices: [], files: [], messages: messages || [],
        lastVisit,
      } as any);

      // return orientation + the LITERAL messages, untouched, as the source of truth
      return json({ data: { orient, messages: messages || [] } }, 200, reqCors);
    }

    // ── Billing: interpret the situation only; money stays literal ──
    if (type === 'client_billing') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const jwt = req.headers.get('x-dds-user-jwt') || '';
      if (!jwt) return json({ error: 'unauthorized' }, 401, reqCors);
      const uRes = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${jwt}` } });
      if (!uRes.ok) return json({ error: 'unauthorized' }, 401, reqCors);
      const user = await uRes.json();
      const uid = user?.id ? String(user.id) : '';
      const email = (user?.email ? String(user.email) : '').toLowerCase();
      if (!uid && !email) return json({ error: 'unauthorized' }, 401, reqCors);

      const bDb = async (path: string) => {
        try { const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` } });
          if (!r.ok) return []; return await r.json(); } catch { return []; }
      };
      let contactId = '', clientId = '';
      if (uid) { const c = await bDb(`contacts?auth_user_id=eq.${encodeURIComponent(uid)}&select=id&limit=1`); if (c?.length) contactId = c[0].id; }
      if (!contactId && email) { const c = await bDb(`contacts?email=eq.${encodeURIComponent(email)}&select=id&limit=1`); if (c?.length) contactId = c[0].id; }
      if (contactId) { const pp = await bDb(`partnerships?contact_id=eq.${contactId}&deleted_at=is.null&select=client_id&limit=1`); if (pp?.length) clientId = String(pp[0].client_id || ''); }
      // pull the LITERAL invoice rows — amount/date/status/stripe_url passed through exact
      const invoices = clientId ? await bDb(`invoices?client_id=eq.${encodeURIComponent(clientId)}&select=id,name,description,amount,status,due_date,stripe_url,created_at&order=created_at.asc&limit=200`) : [];

      // the engine reads only STATUS to pick a calm situation line; never touches money
      const situation = billingFor({
        client: {}, contactName: '', partnership: null,
        signals: [], work: [], project: null, events: [], recs: [], reviews: [],
        approvals: [], invoices: invoices || [], files: [], messages: [],
        lastVisit: null,
      } as any);

      // return situation + the LITERAL invoice rows, untouched
      return json({ data: { situation, invoices: invoices || [] } }, 200, reqCors);
    }

    // ── Progress: a confidence briefing, not a roadmap ──
    if (type === 'client_progress') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const jwt = req.headers.get('x-dds-user-jwt') || '';
      if (!jwt) return json({ error: 'unauthorized' }, 401, reqCors);
      const uRes = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${jwt}` } });
      if (!uRes.ok) return json({ error: 'unauthorized' }, 401, reqCors);
      const user = await uRes.json();
      const uid = user?.id ? String(user.id) : '';
      const email = (user?.email ? String(user.email) : '').toLowerCase();
      if (!uid && !email) return json({ error: 'unauthorized' }, 401, reqCors);

      const pDb = async (path: string) => {
        try { const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` } });
          if (!r.ok) return []; return await r.json(); } catch { return []; }
      };
      let contactId = '', clientId = '', pid = '';
      if (uid) { const c = await pDb(`contacts?auth_user_id=eq.${encodeURIComponent(uid)}&select=id&limit=1`); if (c?.length) contactId = c[0].id; }
      if (!contactId && email) { const c = await pDb(`contacts?email=eq.${encodeURIComponent(email)}&select=id&limit=1`); if (c?.length) contactId = c[0].id; }
      if (contactId) { const pp = await pDb(`partnerships?contact_id=eq.${contactId}&deleted_at=is.null&select=id,client_id&limit=1`); if (pp?.length) { clientId = String(pp[0].client_id || ''); pid = String(pp[0].id || ''); } }

      const lastVisit = body.lastVisit ? new Date(body.lastVisit).getTime() : null;
      const [project, events, work, approvals] = await Promise.all([
        contactId ? pDb(`projects?contact_id=eq.${encodeURIComponent(contactId)}&deleted_at=is.null&select=id,name,stage,ball_in_court,progress,launched_at&order=created_at.desc&limit=1`) : Promise.resolve([]),
        contactId ? pDb(`events?contact_id=eq.${encodeURIComponent(contactId)}&client_visible=eq.true&select=type,actor,payload,created_at&order=created_at.desc&limit=30`) : Promise.resolve([]),
        pid ? pDb(`work_log?partnership_id=eq.${pid}&select=id,title,done_at&order=done_at.desc&limit=12`) : Promise.resolve([]),
        clientId ? pDb(`approvals?client_id=eq.${encodeURIComponent(clientId)}&deleted_at=is.null&status=eq.pending&select=id,title,status&limit=10`) : Promise.resolve([]),
      ]);

      const brief = progressFor({
        client: {}, contactName: '', partnership: null,
        signals: [], work: work || [], project: (project || [])[0] || null,
        events: events || [], recs: [], reviews: [],
        approvals: approvals || [], invoices: [], files: [], messages: [],
        lastVisit,
      } as any);

      return json({ data: brief }, 200, reqCors);
    }


    // ── Integrations: provider framework routes ──


    // what's connected for a client, and what each provider offers
    if (type === 'integrations_status') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const clientId = String(body.clientId || '');
      if (!clientId) return json({ error: 'clientId required' }, 400, reqCors);
      const svc = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` };
      const r = await fetch(`${SB_URL}/rest/v1/client_integrations?client_id=eq.${encodeURIComponent(clientId)}&select=provider,status,property_id,account_label,connected_at,last_sync_at,error`, { headers: svc });
      const connected = r.ok ? await r.json() : [];
      const byProvider: Record<string, any> = {};
      for (const c of (connected || [])) byProvider[c.provider] = c;
      // pull recent sync_log to derive last-ok / last-fail per provider source
      const sl = await fetch(`${SB_URL}/rest/v1/sync_log?client_id=eq.${encodeURIComponent(clientId)}&select=source,status,signals_written,error,ran_at&order=ran_at.desc&limit=200`, { headers: svc });
      const logs = sl.ok ? await sl.json() : [];
      const lastOk: Record<string, any> = {}, lastFail: Record<string, any> = {};
      for (const l of (logs || [])) {
        if (l.status === 'ok' && !lastOk[l.source]) lastOk[l.source] = l;
        if (l.status === 'error' && !lastFail[l.source]) lastFail[l.source] = l;
      }
      const providers = Object.values(PROVIDERS).map((p) => {
        const ci = byProvider[p.id] || {};
        const status = p.kind === 'internal' ? 'always_on' : (ci.status || 'disconnected');
        // derived health: green (synced ok recently), amber (connected, never/failed sync), red (error/expired), grey (disconnected)
        let health = 'grey';
        if (status === 'connected' || status === 'always_on') {
          if (lastFail[p.id] && (!lastOk[p.id] || new Date(lastFail[p.id].ran_at) > new Date(lastOk[p.id].ran_at))) health = 'red';
          else if (lastOk[p.id]) health = 'green';
          else health = 'amber';
        } else if (status === 'error' || status === 'expired') health = 'red';
        return {
          id: p.id, label: p.label, kind: p.kind, metrics: p.metrics,
          status, health,
          connected_at: ci.connected_at || null,
          account_label: ci.account_label || null,
          property_id: ci.property_id || null,
          last_sync_at: ci.last_sync_at || lastOk[p.id]?.ran_at || null,
          last_success_at: lastOk[p.id]?.ran_at || null,
          last_success_count: lastOk[p.id]?.signals_written ?? null,
          last_failure_at: lastFail[p.id]?.ran_at || null,
          last_failure_error: lastFail[p.id]?.error || ci.error || null,
          next_scheduled: 'nightly', // nightly auto-sync via run_scheduled_jobs cron
        };
      });
      return json({ data: { providers, scheduling: 'nightly' } }, 200, reqCors);
    }

    // sync history for a client (optionally one provider) — the audit trail
    if (type === 'sync_history') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const clientId = String(body.clientId || '');
      if (!clientId) return json({ error: 'clientId required' }, 400, reqCors);
      const provider = body.provider ? String(body.provider) : null;
      const svc = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` };
      let q = `sync_log?client_id=eq.${encodeURIComponent(clientId)}&select=source,status,signals_written,error,ran_at&order=ran_at.desc&limit=50`;
      if (provider) q += `&source=eq.${encodeURIComponent(provider)}`;
      const r = await fetch(`${SB_URL}/rest/v1/${q}`, { headers: svc });
      const history = r.ok ? await r.json() : [];
      return json({ data: { history } }, 200, reqCors);
    }

    // begin connect: oauth → return authUrl; apikey → store property_id directly
    if (type === 'integration_connect') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const clientId = String(body.clientId || ''); const provider = String(body.provider || '');
      const adapter = PROVIDERS[provider];
      if (!clientId || !adapter) return json({ error: 'bad_request' }, 400, reqCors);
      const svc = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` };
      const redirectUri = (body.redirectUri ? String(body.redirectUri) : `${SB_URL}/functions/v1/clever-api`).replace(/\/$/, '');

      if (adapter.kind === 'oauth' && adapter.oauth) {
        if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return json({ error: 'google_oauth_not_configured', message: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET edge-function secrets.' }, 200, reqCors);
        // state encodes client+provider so the callback knows where to store the token
        const state = await signState({ clientId, provider, ts: Date.now() });
        // upsert a pending integration row
        await fetch(`${SB_URL}/rest/v1/client_integrations?on_conflict=client_id,provider`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ client_id: clientId, provider, status: 'connecting', property_id: body.propertyId || null }) });
        return json({ data: { authUrl: adapter.oauth.authUrl(state, redirectUri + '?type=integration_callback') } }, 200, reqCors);
      }
      if (adapter.kind === 'apikey') {
        // apikey providers just need their target stored (e.g. monitored site is already known)
        await fetch(`${SB_URL}/rest/v1/client_integrations?on_conflict=client_id,provider`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ client_id: clientId, provider, status: 'connected', property_id: body.propertyId || null, connected_at: new Date().toISOString() }) });
        return json({ data: { status: 'connected' } }, 200, reqCors);
      }
      return json({ error: 'internal_provider_no_connect' }, 400, reqCors);
    }

    // oauth redirect handler — exchanges code for tokens, stores them
    if (type === 'integration_callback') {
      const url = new URL(req.url);
      const code = url.searchParams.get('code') || (body && body.code) || '';
      const stateRaw = url.searchParams.get('state') || (body && body.state) || '';
      if (!code || !stateRaw) return json({ error: 'missing_code_or_state' }, 400, reqCors);
      const st = await verifyState(stateRaw);
      if (!st) return json({ error: 'invalid_state', message: 'State failed verification (tampered, expired, or signing secret not configured).' }, 400, reqCors);
      const adapter = PROVIDERS[st.provider];
      if (!adapter || !adapter.oauth) return json({ error: 'unknown_provider' }, 400, reqCors);
      const svc = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` };
      const redirectUri = `${SB_URL}/functions/v1/clever-api?type=integration_callback`;
      try {
        const tok = await adapter.oauth.exchange(code, redirectUri);
        let accountLabel: string | null = null;
        try {
          const ui = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tok.access_token}` } });
          if (ui.ok) { const uj = await ui.json(); accountLabel = uj.email || uj.name || null; }
        } catch { /* non-fatal */ }
        await fetch(`${SB_URL}/rest/v1/client_integrations?on_conflict=client_id,provider`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ client_id: st.clientId, provider: st.provider, status: 'connected', access_token: tok.access_token, refresh_token: tok.refresh_token || null, account_label: accountLabel, connected_at: new Date().toISOString(), error: null }) });
        // success: redirect the browser back to a friendly page
        return new Response(`<html><body style="font-family:system-ui;text-align:center;padding:60px"><h2>Connected ✓</h2><p>${adapter.label} is now linked. You can close this window.</p><script>setTimeout(()=>window.close(),1500)</script></body></html>`, { status: 200, headers: { 'Content-Type': 'text/html', ...reqCors } });
      } catch (e) {
        await fetch(`${SB_URL}/rest/v1/client_integrations?on_conflict=client_id,provider`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ client_id: st.clientId, provider: st.provider, status: 'error', error: String(e).slice(0, 300) }) });
        return new Response(`<html><body style="font-family:system-ui;text-align:center;padding:60px"><h2>Connection failed</h2><p>${String(e).slice(0,200)}</p></body></html>`, { status: 200, headers: { 'Content-Type': 'text/html', ...reqCors } });
      }
    }

    // disconnect a provider
    if (type === 'integration_disconnect') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const clientId = String(body.clientId || ''); const provider = String(body.provider || '');
      if (!clientId || !provider) return json({ error: 'bad_request' }, 400, reqCors);
      const svc = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` };
      await fetch(`${SB_URL}/rest/v1/client_integrations?client_id=eq.${encodeURIComponent(clientId)}&provider=eq.${encodeURIComponent(provider)}`, { method: 'PATCH', headers: { ...svc, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }, body: JSON.stringify({ status: 'disconnected', access_token: null, refresh_token: null }) });
      return json({ data: { status: 'disconnected' } }, 200, reqCors);
    }

    // list the properties/sites this connected provider can sync (the picker source)
    if (type === 'integration_list_properties') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const clientId = String(body.clientId || ''); const provider = String(body.provider || '');
      if (!clientId || !provider) return json({ error: 'bad_request' }, 400, reqCors);
      const svc = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` };
      const ir = await fetch(`${SB_URL}/rest/v1/client_integrations?client_id=eq.${encodeURIComponent(clientId)}&provider=eq.${encodeURIComponent(provider)}&select=*&limit=1`, { headers: svc });
      const rows = ir.ok ? await ir.json() : [];
      const integ = (rows || [])[0];
      if (!integ || integ.status !== 'connected') return json({ error: 'not_connected' }, 200, reqCors);

      // refresh-aware fetch helper
      const callG = async (url: string) => {
        let tok = integ.access_token;
        let r = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
        if (r.status === 401 && integ.refresh_token) {
          const fresh = await googleRefresh(integ.refresh_token);
          if (fresh) {
            await fetch(`${SB_URL}/rest/v1/client_integrations?id=eq.${integ.id}`, { method: 'PATCH', headers: { ...svc, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }, body: JSON.stringify({ access_token: fresh }) });
            r = await fetch(url, { headers: { Authorization: `Bearer ${fresh}` } });
          }
        }
        return r;
      };

      try {
        let options: any[] = [];
        if (provider === 'ga4') {
          // GA4 Admin API: account summaries → property summaries
          const r = await callG('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200');
          if (!r.ok) return json({ error: 'list_failed', status: r.status, detail: (await r.text()).slice(0, 400) }, 200, reqCors);
          const j = await r.json();
          for (const acct of (j.accountSummaries || [])) {
            for (const prop of (acct.propertySummaries || [])) {
              // property is like 'properties/123456789' → store the numeric id
              const id = String(prop.property || '').replace('properties/', '');
              options.push({ id, label: `${prop.displayName || id}${acct.displayName ? ' · ' + acct.displayName : ''}` });
            }
          }
        } else if (provider === 'gsc') {
          const r = await callG('https://www.googleapis.com/webmasters/v3/sites');
          if (!r.ok) return json({ error: 'list_failed', status: r.status, detail: (await r.text()).slice(0, 400) }, 200, reqCors);
          const j = await r.json();
          for (const s of (j.siteEntry || [])) {
            options.push({ id: s.siteUrl, label: `${s.siteUrl} (${s.permissionLevel || 'owner'})` });
          }
        } else if (provider === 'gbp') {
          // GBP: list accounts → locations
          const ar = await callG('https://mybusinessaccountmanagement.googleapis.com/v1/accounts');
          if (!ar.ok) return json({ error: 'list_failed', status: ar.status, detail: (await ar.text()).slice(0, 400) }, 200, reqCors);
          const aj = await ar.json();
          for (const acct of (aj.accounts || [])) {
            const lr = await callG(`https://mybusinessbusinessinformation.googleapis.com/v1/${acct.name}/locations?readMask=name,title&pageSize=100`);
            if (!lr.ok) continue;
            const lj = await lr.json();
            for (const loc of (lj.locations || [])) {
              options.push({ id: loc.name, label: loc.title || loc.name });
            }
          }
        } else {
          return json({ error: 'provider_has_no_properties' }, 200, reqCors);
        }
        return json({ data: { options, current: integ.property_id || null } }, 200, reqCors);
      } catch (e) {
        return json({ error: 'list_error', message: String(e).slice(0, 200) }, 200, reqCors);
      }
    }

    // save which property/site to sync for a connected provider
    if (type === 'integration_set_property') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const clientId = String(body.clientId || ''); const provider = String(body.provider || '');
      const propertyId = body.propertyId != null ? String(body.propertyId) : '';
      if (!clientId || !provider || !propertyId) return json({ error: 'bad_request' }, 400, reqCors);
      const svc = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` };
      await fetch(`${SB_URL}/rest/v1/client_integrations?client_id=eq.${encodeURIComponent(clientId)}&provider=eq.${encodeURIComponent(provider)}`, { method: 'PATCH', headers: { ...svc, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }, body: JSON.stringify({ property_id: propertyId }) });
      return json({ data: { status: 'set', property_id: propertyId } }, 200, reqCors);
    }

    // run provider adapters for a client (one provider, or all connected)
    if (type === 'provider_sync') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const clientId = String(body.clientId || '');
      if (!clientId) return json({ error: 'clientId required' }, 400, reqCors);
      const onlyProvider = body.provider ? String(body.provider) : null;
      const results = await syncClientProviders(clientId, onlyProvider);
      return json({ data: { synced: results } }, 200, reqCors);
    }


    // ============================================================================
    //  ADMIN ANALYTICS — the operator's BI engine
    //
    //  Returns everything the admin analytics experience needs for one client:
    //   - time series per metric (for charts)
    //   - the four score trends
    //   - month-over-month comparisons
    //   - computed INTERPRETATION per metric group (what changed / why / meaning / next)
    //
    //  This is analytics WITH decision intelligence on top — not a chart dump.
    //  Gate: admin_analytics: 'staff'
    // ============================================================================

    if (type === 'admin_analytics') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const clientId = String(body.clientId || '');
      if (!clientId) return json({ error: 'clientId required' }, 400, reqCors);
      const svc = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` };

      // optional date range: body.months (3/6/12) limits how far back to read.
      // Default: all history (capped). Filters server-side on observed_at.
      const months = Number(body.months) > 0 ? Number(body.months) : null;
      let rangeFilter = '';
      if (months) {
        const since = new Date(); since.setMonth(since.getMonth() - months);
        rangeFilter = `&observed_at=gte.${since.toISOString()}`;
      }

      // pull signals for this client (capped, newest first), within range if set
      const sr = await fetch(`${SB_URL}/rest/v1/signals?client_id=eq.${encodeURIComponent(clientId)}${rangeFilter}&select=metric,value,unit,period,observed_at,source,confidence,scope&order=observed_at.desc&limit=2000`, { headers: svc });
      const signals = sr.ok ? await sr.json() : [];

      // group into time series per metric: { metric: [{period, value, observed_at, ...}] (oldest→newest) }
      const series: Record<string, any[]> = {};
      for (const s of (signals || [])) {
        (series[s.metric] = series[s.metric] || []).push(s);
      }
      for (const m of Object.keys(series)) {
        // dedupe by period (keep latest observed), sort ascending by period
        const byPeriod: Record<string, any> = {};
        for (const row of series[m]) { const k = row.period || row.observed_at?.slice(0, 7) || ''; if (!byPeriod[k]) byPeriod[k] = row; }
        series[m] = Object.values(byPeriod).sort((a: any, b: any) => String(a.period || a.observed_at).localeCompare(String(b.period || b.observed_at)));
      }

      // helper: latest value + month-over-month delta for a metric
      const summarize = (metric: string) => {
        const rows = series[metric] || [];
        if (!rows.length) return null;
        const latest = rows[rows.length - 1];
        const prev = rows.length >= 2 ? rows[rows.length - 2] : null;
        const cur = Number(latest.value);
        const delta = prev ? cur - Number(prev.value) : null;
        const pct = prev && Number(prev.value) !== 0 ? Math.round(((cur - Number(prev.value)) / Number(prev.value)) * 100) : null;
        return { metric, value: cur, unit: latest.unit, period: latest.period, confidence: latest.confidence, source: latest.source, delta, pct, points: rows.map((r: any) => ({ period: r.period, value: Number(r.value) })) };
      };

      // interpretation builder: turns a metric summary into what-changed / why / meaning / next
      const interpret = (metric: string, label: string, goodWhenUp = true) => {
        const s = summarize(metric);
        if (!s) return { metric, label, status: 'no_data', text: `No ${label.toLowerCase()} data yet.` };
        if (s.delta == null) return { metric, label, status: 'baseline', value: s.value, source: s.source, points: s.points, text: `First month of ${label.toLowerCase()} data (${s.value}${s.unit === 'pct' ? '%' : ''}). Need another month to show a trend.` };
        const improved = goodWhenUp ? s.delta > 0 : s.delta < 0;
        const flat = s.delta === 0;
        const dir = flat ? 'held steady' : (s.delta > 0 ? `rose ${Math.abs(s.delta)}` : `fell ${Math.abs(s.delta)}`);
        const meaning = flat ? `${label} is stable month over month.`
          : improved ? `${label} is moving the right way${s.pct != null ? ` (${s.pct > 0 ? '+' : ''}${s.pct}%)` : ''}.`
          : `${label} moved the wrong way${s.pct != null ? ` (${s.pct > 0 ? '+' : ''}${s.pct}%)` : ''} this month.`;
        const next = flat ? 'Watch next month; no action needed yet.'
          : improved ? 'Keep doing what is working; consider doubling down.'
          : 'Worth investigating the cause and addressing before it compounds.';
        return { metric, label, status: improved ? 'good' : (flat ? 'flat' : 'attention'), value: s.value, delta: s.delta, pct: s.pct, confidence: s.confidence, source: s.source, points: s.points, text: `${label} ${dir} this month. ${meaning} ${next}` };
      };

      // score trends (read derived scores history if stored; else compute current from signals via client_scores logic is heavy — return latest score signals if present)
      const scoreTrend = (metric: string) => {
        const rows = series[metric] || [];
        return rows.map((r: any) => ({ period: r.period, value: Number(r.value) }));
      };

      // ════ EXECUTIVE BRIEF — the intelligence layer above the charts ════
      // Scans every metric to surface the few things that actually matter.
      const META: Record<string, { label: string; goodUp: boolean; kind: string }> = {
        sessions: { label: 'Traffic', goodUp: true, kind: 'growth' },
        conversions: { label: 'Conversions', goodUp: true, kind: 'growth' },
        search_clicks: { label: 'Search clicks', goodUp: true, kind: 'growth' },
        search_impressions: { label: 'Impressions', goodUp: true, kind: 'growth' },
        avg_position: { label: 'Average ranking', goodUp: false, kind: 'seo' },
        gbp_calls: { label: 'Calls', goodUp: true, kind: 'growth' },
        psi_performance: { label: 'Performance score', goodUp: true, kind: 'health' },
        psi_seo: { label: 'SEO score', goodUp: true, kind: 'health' },
        overdue_amount: { label: 'Overdue invoices', goodUp: false, kind: 'risk' },
        open_approvals: { label: 'Open approvals', goodUp: false, kind: 'ops' },
        open_requests: { label: 'Open requests', goodUp: false, kind: 'ops' },
        project_progress: { label: 'Project progress', goodUp: true, kind: 'ops' },
        client_response_rate: { label: 'Client responsiveness', goodUp: true, kind: 'relationship' },
        unanswered_client_msg: { label: 'Unanswered messages', goodUp: false, kind: 'relationship' },
      };
      const moves: any[] = [];
      for (const metric of Object.keys(META)) {
        const s = summarize(metric);
        if (!s || s.delta == null || s.pct == null) continue; // need a real trend (2+ months)
        const m = META[metric];
        const improved = m.goodUp ? s.delta > 0 : s.delta < 0;
        moves.push({ metric, label: m.label, kind: m.kind, value: s.value, delta: s.delta, pct: s.pct, improved, magnitude: Math.abs(s.pct), confidence: s.confidence });
      }
      moves.sort((a, b) => b.magnitude - a.magnitude);

      const biggestChange = moves[0] || null;
      const biggestRisk = moves.filter((m) => !m.improved).sort((a, b) => b.magnitude - a.magnitude)[0] || null;
      const biggestOpportunity = moves.filter((m) => m.improved).sort((a, b) => b.magnitude - a.magnitude)[0] || null;

      // data freshness: most recent observed_at across all signals + per-source last sync
      let freshest = '';
      for (const s of (signals || [])) { if (s.observed_at && s.observed_at > freshest) freshest = s.observed_at; }
      const sourcesSeen = Array.from(new Set((signals || []).map((s: any) => s.source))).filter(Boolean);

      // overall confidence: weakest among the metrics that drove the brief, + history depth
      const periodsCount = Math.max(0, ...Object.values(series).map((rows: any) => rows.length));
      const measuredShare = (signals || []).length ? (signals || []).filter((s: any) => s.confidence === 'measured').length / (signals || []).length : 0;
      let briefConfidence = 'low';
      if (periodsCount >= 3 && measuredShare >= 0.5) briefConfidence = 'high';
      else if (periodsCount >= 2 && measuredShare >= 0.3) briefConfidence = 'medium';

      // what needs more data: metrics present but with <2 periods (can't trend yet)
      const needsMoreData = Object.keys(series)
        .filter((m) => (series[m] || []).length < 2 && META[m])
        .map((m) => META[m].label);

      // recommended next action — derived from the dominant signal
      let nextAction = 'Keep collecting data; trends will sharpen as history builds.';
      if (biggestRisk) nextAction = `Address ${biggestRisk.label.toLowerCase()} — it moved ${biggestRisk.pct > 0 ? '+' : ''}${biggestRisk.pct}% the wrong way and will compound if ignored.`;
      else if (biggestOpportunity) nextAction = `Lean into ${biggestOpportunity.label.toLowerCase()} — up ${Math.abs(biggestOpportunity.pct)}% and worth reinforcing while it has momentum.`;
      else if (needsMoreData.length) nextAction = `Too early to act on ${needsMoreData.slice(0, 3).join(', ')}. Let another month accumulate before drawing conclusions.`;

      const headline = !moves.length
        ? (periodsCount >= 1 ? 'Data is landing, but no metric has two months yet — trends appear next cycle.' : 'No measurable trends yet. Connect sources or wait for the first sync.')
        : biggestChange.improved
          ? `${biggestChange.label} is the story this month: up ${Math.abs(biggestChange.pct)}%.`
          : `${biggestChange.label} needs attention: ${biggestChange.pct > 0 ? '+' : ''}${biggestChange.pct}% this month.`;

      const executive_brief = {
        headline,
        biggest_change: biggestChange,
        biggest_risk: biggestRisk,
        biggest_opportunity: biggestOpportunity,
        next_action: nextAction,
        confidence: briefConfidence,
        confidence_reason: `${periodsCount} month${periodsCount === 1 ? '' : 's'} of history, ${Math.round(measuredShare * 100)}% measured signals.`,
        needs_more_data: needsMoreData,
        freshness: { latest_observed: freshest || null, sources: sourcesSeen },
      };

      // ── assemble the analytics payload, grouped by section ──
      const payload = {
        generated_at: new Date().toISOString(),
        has_any_data: (signals || []).length > 0,
        executive_brief,

        website_analytics: {
          sessions: summarize('sessions'),
          conversions: summarize('conversions'),
          engagement_rate: summarize('engagement_rate'),
          interpretation: [
            interpret('sessions', 'Traffic'),
            interpret('conversions', 'Conversions'),
            interpret('engagement_rate', 'Engagement'),
          ],
        },
        search_analytics: {
          search_clicks: summarize('search_clicks'),
          search_impressions: summarize('search_impressions'),
          search_ctr: summarize('search_ctr'),
          avg_position: summarize('avg_position'),
          interpretation: [
            interpret('search_clicks', 'Search clicks'),
            interpret('search_impressions', 'Impressions'),
            interpret('search_ctr', 'Click-through rate'),
            interpret('avg_position', 'Average ranking', false), // lower position is better
          ],
        },
        website_health: {
          psi_performance: summarize('psi_performance'),
          psi_seo: summarize('psi_seo'),
          psi_accessibility: summarize('psi_accessibility'),
          lcp_ms: summarize('lcp_ms'),
          cls: summarize('cls'),
          https_valid: summarize('https_valid'),
          interpretation: [
            interpret('psi_performance', 'Performance score'),
            interpret('psi_seo', 'SEO score'),
            interpret('psi_accessibility', 'Accessibility'),
            interpret('lcp_ms', 'Largest Contentful Paint', false), // lower ms is better
            interpret('cls', 'Layout shift', false), // lower is better
          ],
        },
        business_profile: {
          gbp_calls: summarize('gbp_calls'),
          gbp_direction_requests: summarize('gbp_direction_requests'),
          gbp_website_clicks: summarize('gbp_website_clicks'),
          interpretation: [
            interpret('gbp_calls', 'Calls'),
            interpret('gbp_direction_requests', 'Direction requests'),
            interpret('gbp_website_clicks', 'Profile website clicks'),
          ],
        },
        engagement_ops: {
          open_approvals: summarize('open_approvals'),
          open_requests: summarize('open_requests'),
          project_progress: summarize('project_progress'),
          client_response_rate: summarize('client_response_rate'),
          interpretation: [
            interpret('open_approvals', 'Open approvals', false),
            interpret('open_requests', 'Open requests', false),
            interpret('project_progress', 'Project progress'),
            interpret('client_response_rate', 'Client responsiveness'),
          ],
        },
        score_trends: {
          business_health: scoreTrend('business_health'),
          growth: scoreTrend('growth_score'),
          relationship_health: scoreTrend('relationship_health'),
          website_health: scoreTrend('website_health_score'),
        },

        // the metrics catalog actually present for this client (so the UI shows only real sections)
        available_metrics: Object.keys(series),
      };

      return json({ data: payload }, 200, reqCors);
    }


    // ── Data Foundation: signals + scores ──
    // ════════════════════════════════════════════════════════════════════════════
    //  ROUTE: signals_rebuild — (re)ingest internal signals for one client or all
    // ════════════════════════════════════════════════════════════════════════════
    if (type === 'signals_rebuild') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const svc = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` };
      const read = async (p: string) => { try { const r = await fetch(`${SB_URL}/rest/v1/${p}`, { headers: svc }); return r.ok ? await r.json() : []; } catch { return []; } };

      let targets: string[] = [];
      if (body.clientId) targets = [String(body.clientId)];
      else { const all = await read(`clients?deleted_at=is.null&select=id&limit=500`); targets = (all || []).map((c: any) => String(c.id)); }

      const results: any[] = [];
      for (const cid of targets) {
        try {
          const written = await ingestInternalSignals(svc, cid);
          await fetch(`${SB_URL}/rest/v1/sync_log`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }, body: JSON.stringify({ client_id: cid, source: 'crm', status: 'ok', signals_written: written }) });
          results.push({ client_id: cid, signals_written: written, status: 'ok' });
        } catch (e) {
          await fetch(`${SB_URL}/rest/v1/sync_log`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }, body: JSON.stringify({ client_id: cid, source: 'crm', status: 'error', error: String(e) }) });
          results.push({ client_id: cid, status: 'error', error: String(e) });
        }
      }
      return json({ data: { rebuilt: results.length, results } }, 200, reqCors);
    }

    // ════════════════════════════════════════════════════════════════════════════
    //  ROUTE: client_scores — read signals → derived scores, fully explained
    // ════════════════════════════════════════════════════════════════════════════
    if (type === 'client_scores') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const clientId = String(body.clientId || body.id || '');
      if (!clientId) return json({ error: 'clientId required' }, 400, reqCors);
      const svc = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` };
      const r = await fetch(`${SB_URL}/rest/v1/signals?client_id=eq.${encodeURIComponent(clientId)}&select=metric,value,unit,period,observed_at,source,confidence,scope&order=observed_at.desc&limit=500`, { headers: svc });
      const signals = r.ok ? await r.json() : [];
      const scores = computeScores(signals || []);
      // optionally persist this computation as history (so trends can start now, not only via nightly)
      if (body.persist) {
        try { const { partnershipId } = await resolveClientGraph(clientId); await persistScores(svc, clientId, partnershipId); } catch (_) { /* non-fatal */ }
      }
      return json({ data: { scores, signal_count: (signals || []).length, computed_at: new Date().toISOString() } }, 200, reqCors);
    }


    // ── Portfolio Intelligence: daily priorities ──
    if (type === 'portfolio_priorities') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const svc = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` };
      const read = async (p: string) => { try { const r = await fetch(`${SB_URL}/rest/v1/${p}`, { headers: svc }); return r.ok ? await r.json() : []; } catch (_) { return []; } };

      // ── one pass over the active portfolio ──
      const [clients, invoices, approvals, projects, messages, recs, reviews, partnerships] = await Promise.all([
        read(`clients?deleted_at=is.null&select=id,name,business_type,industry,city,monthly_amount,status,renews_at&limit=500`),
        read(`invoices?deleted_at=is.null&status=neq.paid&select=client_id,amount,status,due_date&limit=500`),
        read(`approvals?deleted_at=is.null&status=eq.pending&select=client_id,title,created_at&limit=500`),
        read(`projects?deleted_at=is.null&stage=neq.complete&select=contact_id,name,stage,ball_in_court,progress,updated_at&limit=500`),
        read(`messages?deleted_at=is.null&select=client_id,from_who,created_at&order=created_at.desc&limit=1000`),
        read(`recommendations?deleted_at=is.null&select=partnership_id,title,impact,confidence,status,client_visible&limit=1000`),
        read(`monthly_reviews?select=partnership_id,period,status&order=period.desc&limit=500`),
        read(`partnerships?deleted_at=is.null&select=id,client_id,contact_id&limit=500`),
      ]);

      // index helpers
      const byClient = <T extends { client_id?: string }>(rows: T[]) => {
        const m: Record<string, T[]> = {};
        for (const r of rows) { const k = String(r.client_id || ''); if (!k) continue; (m[k] ||= []).push(r); }
        return m;
      };
      const pById: Record<string, any> = {};
      const pByClient: Record<string, any> = {};
      for (const p of (partnerships || [])) { pById[String(p.id)] = p; pByClient[String(p.client_id)] = p; }
      const contactToClient: Record<string, string> = {};
      for (const p of (partnerships || [])) if (p.contact_id) contactToClient[String(p.contact_id)] = String(p.client_id);

      const invByClient = byClient(invoices || []);
      const apprByClient = byClient(approvals || []);
      const msgByClient = byClient(messages || []);
      const recsByPartnership: Record<string, any[]> = {};
      for (const r of (recs || [])) { const k = String(r.partnership_id || ''); if (!k) continue; (recsByPartnership[k] ||= []).push(r); }
      const reviewByPartnership: Record<string, any> = {};
      for (const r of (reviews || [])) { const k = String(r.partnership_id || ''); if (!reviewByPartnership[k]) reviewByPartnership[k] = r; }
      const projByClient: Record<string, any[]> = {};
      for (const pr of (projects || [])) { const cid = contactToClient[String(pr.contact_id || '')]; if (!cid) continue; (projByClient[cid] ||= []).push(pr); }

      const now = Date.now();
      const DAY = 86400000;

      // ── score each client: collect signals, take the dominant one as the headline ──
      const ranked: any[] = [];
      for (const c of (clients || [])) {
        const cid = String(c.id);
        const partnership = pByClient[cid];
        const pid = partnership ? String(partnership.id) : null;
        const signals: any[] = [];

        // revenue at risk — overdue invoice
        const overdue = (invByClient[cid] || []).filter((i: any) => i.due_date && new Date(i.due_date).getTime() < now);
        if (overdue.length) {
          const amt = overdue.reduce((s: number, i: any) => s + (Number(i.amount) || 0), 0);
          const days = Math.floor((now - Math.min(...overdue.map((i: any) => new Date(i.due_date).getTime()))) / DAY);
          signals.push({ type: 'revenue_at_risk', changed: `$${amt} invoice ${days}d overdue`, why: 'unpaid revenue ages and gets harder to collect', action: 'Send a gentle payment nudge', impact: `$${amt} at risk`, confidence: 'high' });
        }

        // churn risk — gone quiet (last message > 21d) on an active client
        const msgs = msgByClient[cid] || [];
        if (msgs.length) {
          const lastDays = Math.floor((now - new Date(msgs[0].created_at).getTime()) / DAY);
          if (lastDays > 21) signals.push({ type: 'churn_risk', changed: `no contact in ${lastDays} days`, why: 'silence often precedes churn', action: 'Send a value-add check-in', impact: c.monthly_amount ? `$${c.monthly_amount}/mo relationship` : 'retention', confidence: 'medium' });
          // waiting on Eric — last message from client, unanswered
          if (msgs[0].from_who === 'client' && lastDays <= 21) signals.push({ type: 'waiting_on_eric', changed: 'client is waiting on your reply', why: 'they reached out and the ball is in your court', action: 'Reply to their message', impact: 'responsiveness', confidence: 'high' });
        }

        // blocked approval — pending approval Eric can chase
        const apprs = apprByClient[cid] || [];
        if (apprs.length) {
          const oldest = Math.floor((now - new Date(apprs[0].created_at).getTime()) / DAY);
          signals.push({ type: 'blocked_approval', changed: `${apprs.length} approval${apprs.length > 1 ? 's' : ''} pending ${oldest}d`, why: 'queued work is blocked until they sign off', action: 'Nudge them to approve', impact: 'unblocks delivery', confidence: 'high' });
        }

        // work near done — project at review/launch stage
        const projs = projByClient[cid] || [];
        const nearDone = projs.find((p: any) => ['review', 'launch'].includes((p.stage || '').toLowerCase()) && p.ball_in_court !== 'client');
        if (nearDone) signals.push({ type: 'work_near_done', changed: `${nearDone.name || 'project'} at ${nearDone.stage}`, why: 'finishing logs a win and frees you for the next client', action: 'Push it over the line', impact: 'completed deliverable', confidence: 'high' });

        // review due — no review for the current period
        if (pid) {
          const lastReview = reviewByPartnership[pid];
          const thisPeriod = new Date().toISOString().slice(0, 7);
          if (!lastReview || (lastReview.period < thisPeriod && lastReview.status === 'published')) {
            signals.push({ type: 'review_due', changed: 'monthly review not sent yet', why: 'the review is the moment that proves your value and retains them', action: 'Draft this month\u2019s review', impact: 'retention', confidence: 'high' });
          }
        }

        // renewal window
        if (c.renews_at) {
          const days = Math.floor((new Date(c.renews_at).getTime() - now) / DAY);
          if (days >= 0 && days <= 45) signals.push({ type: 'renewal_window', changed: `renews in ${days}d`, why: 'a strong proactive touch before renewal locks in the relationship', action: 'Prepare a renewal conversation', impact: c.monthly_amount ? `$${c.monthly_amount}/mo` : 'renewal', confidence: 'medium' });
        }

        // high opportunity — a high-impact rec ready to pitch
        if (pid) {
          const hot = (recsByPartnership[pid] || []).find((r: any) => r.impact === 'high' && ['suggested', 'shared'].includes(r.status));
          if (hot) signals.push({ type: 'high_opportunity', changed: `high-impact idea ready: ${hot.title}`, why: 'a strong opportunity is queued and unpitched', action: `Pitch: ${hot.title}`, impact: 'growth', confidence: hot.confidence >= 85 ? 'high' : 'medium' });
        }

        if (!signals.length) continue; // calm clients don't clutter the decision surface

        // dominant signal = highest-weighted; score = dominant weight + small bonus per extra signal
        signals.sort((a, b) => (ATTENTION_SIGNALS[b.type]?.weight || 0) - (ATTENTION_SIGNALS[a.type]?.weight || 0));
        const top = signals[0];
        const score = (ATTENTION_SIGNALS[top.type]?.weight || 0) + Math.min(signals.length - 1, 3) * 4;

        ranked.push({
          client_id: cid,
          name: c.name,
          type: c.business_type || c.industry || null,
          mrr: c.monthly_amount || null,
          score,
          kind: ATTENTION_SIGNALS[top.type]?.kind || 'cadence',
          headline: top.changed,        // what changed
          why: top.why,                 // why it matters
          action: top.action,           // what to do next
          impact: top.impact,           // expected business impact
          confidence: top.confidence,   // how confident
          also: signals.slice(1, 3).map((s: any) => s.changed), // other reasons, briefly
        });
      }

      ranked.sort((a, b) => b.score - a.score);

      // ── one AI strategic line: the single most valuable framing of today ──
      let strategicLine = '';
      const risks = ranked.filter(r => r.kind === 'risk');
      const owed = ranked.filter(r => r.kind === 'owed' || r.kind === 'unblock');
      if (risks.length) strategicLine = `${risks.length} client${risks.length > 1 ? 's' : ''} need protecting today — start there before opportunities.`;
      else if (owed.length) strategicLine = `${owed.length} client${owed.length > 1 ? 's are' : ' is'} waiting on you — clearing these keeps everything moving.`;
      else if (ranked.length) strategicLine = `No fires today. Best use of your time: ${ranked[0].action.toLowerCase()} for ${ranked[0].name}.`;
      else strategicLine = `Everything's handled. A good day for proactive growth work or new business.`;

      // counts for a single calm context line (NOT widgets)
      const waitingOnOthers = (projects || []).filter((p: any) => p.ball_in_court === 'client').length;

      return json({ data: {
        strategic_line: strategicLine,
        priorities: ranked.slice(0, 12),   // the ranked decision — Eric's day, in order
        waiting_on_others: waitingOnOthers, // reassurance count, not a work queue
        total_active: (clients || []).length,
        needs_attention: ranked.length,
      } }, 200, reqCors);
    }


    // ════════════════════════════════════════════════════════════════════════════
    //  ROUTE: studio_brief — THE BRIEF
    //  The intelligence layer above every module. Reads the whole platform,
    //  interprets each observation, ranks what deserves attention ACROSS modules
    //  (a churn risk outranks a cold lead even though they live in different
    //  tables), and returns a narrated read modeled on the Analytics executive
    //  brief. Answers six questions every morning:
    //    1 what changed  2 what deserves attention  3 who needs me most
    //    4 what to do next  5 what can wait  6 why
    //
    //  Design covenant (inherited from Analytics):
    //   • interpret before presenting   • state confidence, never fake it
    //   • propose, never dispose        • tell me what to IGNORE (the calm-maker)
    //  The intelligence is the assistant's; the judgment is always Eric's.
    // ════════════════════════════════════════════════════════════════════════════
    if (type === 'studio_brief') {
      // The Brief is now a thin CALLER of the shared reasoning engine. It asks
      // the brain "who needs my attention?" and "what can wait?" and maps the
      // structured reasoning to the front-end contract. No bespoke logic lives
      // here anymore; all intelligence comes from reason(). This is the model
      // every module follows: ask the one brain, render the answer.
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      try {
        const snapshot = await gatherSnapshot();              // gather once
        const main = await reason('who_needs_attention', { snapshot, polish: body.polish !== false });
        const wait = await reason('what_can_wait', { snapshot, polish: false }); // deterministic, no AI needed

        const needs = main.items.slice(0, main.meta.cap || 5);
        const top = needs[0] || null;
        const nextAction = top
          ? { title: top.action, action: top.action, go: top.go, refId: top.refId, kind: top.kind, canDraft: !!top.canDraft, subject: top.subject, subjectId: top.subjectId, signal: top.signal, why: top.why, changed: top.changed, module: top.module }
          : null;

        return json({ data: {
          generated_at: new Date().toISOString(),
          greeting: 'Eric',
          headline: main.answer,                 // Q1: the state, AI-narrated on top of deterministic ranking
          headline_is_ai: main.answer_is_ai,
          pattern: main.pattern,                 // optional cross-module insight (the connect-the-dots)
          needs_you: needs,                      // Q2 + Q3: what & who deserves you (deterministically ranked)
          next_action: nextAction,               // Q4: the one next move, teed up
          can_wait: wait.meta.can_wait || [],    // Q5: what can wait (the calm-maker)
          confidence: main.confidence,           // Q6: honest confidence
          confidence_reason: main.confidence_reason,
          context: {
            waiting_on_others: main.meta.waiting_on_others,
            active_clients: main.meta.active_clients,
            total_surfaced: main.meta.total_ranked,
            remainder: Math.max(0, (main.meta.total_ranked || 0) - needs.length),
          },
        } }, 200, reqCors);
      } catch (e) {
        return json({ error: 'studio_brief_failed', message: String(e) }, 200, reqCors);
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  ROUTE: reasoning_query — THE QUERYABLE BRAIN
    //  The single interface every module uses to ask the intelligence layer a
    //  question. The Brief, Opportunities, Clients, Analytics, and every future
    //  module call THIS instead of implementing their own logic. One brain.
    //
    //  Body: { question: QuestionIntent, polish?: boolean }
    //  Returns: structured reasoning (ranked items) + a human-readable answer +
    //  honest confidence + an optional cross-module pattern insight.
    // ════════════════════════════════════════════════════════════════════════
    if (type === 'reasoning_query') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const VALID: Record<string, true> = {
        who_needs_attention: true, what_changed: true, what_can_wait: true,
        most_at_risk: true, clients_attention: true, strongest_opportunity: true, proposal_most_likely: true,
        needs_outreach: true, recommend_for_client: true, relationship_health: true,
        emerging_patterns: true, anything_unusual: true,
      };
      const q = String(body.question || '');
      if (!VALID[q]) {
        return json({ error: 'unknown_question', message: `Ask one of: ${Object.keys(VALID).join(', ')}` }, 400, reqCors);
      }
      try {
        const result = await reason(q as any, { polish: body.polish !== false, subjectId: body.subjectId ? String(body.subjectId) : undefined });
        return json({ data: result }, 200, reqCors);
      } catch (e) {
        return json({ error: 'reasoning_failed', message: String(e) }, 200, reqCors);
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  ROUTE: draft_action — THE ACTIONS LAYER
    //  Turns ONE reasoning-engine recommendation into a ready-to-send message.
    //  The engine already decided WHAT to do (the `action`) and WHY; this route
    //  only PHRASES the doing. It adds no intelligence and no ranking — it is a
    //  thin drafting consumer of reasoning the engine already produced. AI sits
    //  on top, grounded only in the engine's already-decided facts plus light
    //  relationship context (the client's name + most recent message for tone).
    //
    //  Body: { subjectId?, subject, signal, action, why, changed, module, channel? }
    //  Returns: { data: { subject_line?, body, channel, grounded_on } }
    //  Disposable: if AI is unavailable, returns a solid deterministic template.
    // ════════════════════════════════════════════════════════════════════════
    if (type === 'draft_action') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const subjectId = body.subjectId ? String(body.subjectId) : '';
      const subject = String(body.subject || 'the client');
      const signal = String(body.signal || '');
      const action = String(body.action || '');
      const why = String(body.why || '');
      const changed = String(body.changed || '');
      const moduleName = String(body.module || '');
      const channel = body.channel === 'email' ? 'email' : 'message';

      // light, READ-ONLY enrichment: the client's name + their latest inbound
      // message, used only to set tone. Never changes what the action is.
      let clientName = subject;
      let lastInbound = '';
      try {
        if (subjectId) {
          const cr = await fetch(`${SB_URL}/rest/v1/clients?id=eq.${encodeURIComponent(subjectId)}&select=name&limit=1`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` } });
          if (cr.ok) { const cj = await cr.json(); if (Array.isArray(cj) && cj[0] && cj[0].name) clientName = cj[0].name; }
          const mr = await fetch(`${SB_URL}/rest/v1/messages?client_id=eq.${encodeURIComponent(subjectId)}&from_who=eq.client&select=text,created_at&order=created_at.desc&limit=1`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` } });
          if (mr.ok) { const mj = await mr.json(); if (Array.isArray(mj) && mj[0] && mj[0].text) lastInbound = String(mj[0].text).slice(0, 400); }
        }
      } catch (_) { /* enrichment is best-effort; never blocks the draft */ }

      // deterministic fallback templates — always correct, used if AI is absent
      const firstName = clientName.split(/\s+/)[0] || 'there';
      const detTemplates: Record<string, { subj: string; body: string }> = {
        revenue_at_risk: { subj: `Quick note on your invoice`, body: `Hi ${firstName},\n\nHope you're well. Just a gentle reminder that an invoice is open on your account. Whenever you get a moment to take care of it, I'd appreciate it. Happy to resend the details or sort out anything that would make it easier.\n\nThanks so much,\nEric` },
        waiting_on_eric: { subj: `Following up`, body: `Hi ${firstName},\n\nThanks for your patience, getting back to you now. ${lastInbound ? 'On your last note: ' : ''}Let me know if a quick call would be easier than going back and forth.\n\nBest,\nEric` },
        churn_risk: { subj: `Checking in`, body: `Hi ${firstName},\n\nIt's been a little while, so I wanted to check in and see how things are going on your end. Anything you'd like to push on this month? I've got a couple of ideas I think could help if you're open to it.\n\nBest,\nEric` },
        review_due: { subj: `Your monthly review`, body: `Hi ${firstName},\n\nI'm pulling together your monthly review, a quick look at how things performed and what I'd recommend next. I'll have it over to you shortly. If there's anything specific you want me to dig into, just say the word.\n\nBest,\nEric` },
        renewal_window: { subj: `Looking ahead`, body: `Hi ${firstName},\n\nWe're coming up on your renewal, and before we get there I wanted to take a moment to talk through what's working and where we go next. Would a short call this week or next work for you?\n\nBest,\nEric` },
        blocked_approval: { subj: `One quick approval`, body: `Hi ${firstName},\n\nThere's an item waiting on your approval before I can move forward. It's quick, whenever you have a moment to look it over, I'll take it from there.\n\nThanks,\nEric` },
        high_opportunity: { subj: `An idea for you`, body: `Hi ${firstName},\n\nI've been looking at your account and I think there's a strong opportunity worth exploring. ${changed ? changed + '. ' : ''}Happy to walk you through it, want me to put together a quick outline?\n\nBest,\nEric` },
        proposal_stale: { subj: `Following up on your proposal`, body: `Hi ${firstName},\n\nJust circling back on the proposal I sent over. No pressure at all, I know things get busy. If you have any questions or want to adjust anything, I'm glad to. Let me know what you're thinking.\n\nBest,\nEric` },
      };
      const fallback = detTemplates[signal] || { subj: action || `A quick note`, body: `Hi ${firstName},\n\n${action || 'Wanted to reach out.'}\n\nBest,\nEric` };

      // AI draft on top — grounded ONLY in the engine's decided facts + tone context
      let draftBody = fallback.body;
      let draftSubj = fallback.subj;
      let isAi = false;
      if (ANTHROPIC_KEY) {
        try {
          const ctx = [
            `Recommended action (already decided): ${action}`,
            `Why it matters: ${why}`,
            changed ? `What changed: ${changed}` : '',
            `Client: ${clientName}`,
            lastInbound ? `Their most recent message to you: "${lastInbound}"` : '',
            `Channel: ${channel}`,
          ].filter(Boolean).join('\n');
          const sys = `You are drafting a ${channel} that Eric Davis (Davis Digital Studio, a solo web design and SEO studio) will send to a client or prospect. The action to take has ALREADY been decided, your only job is to write the message that carries it out. Write in Eric's voice: warm, plain, direct, never corporate or salesy. No em dashes. Address the recipient by first name. Keep it short, the length a busy person actually reads. Do not invent facts, commitments, dates, dollar amounts, or details not given. Do not over-apologize. ${channel === 'email' ? 'Return a subject line and body.' : 'Return just the message body, no subject.'} Respond as JSON only: ${channel === 'email' ? '{"subject":"...","body":"..."}' : '{"body":"..."}'} and nothing else.`;
          const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 400, system: sys, messages: [{ role: 'user', content: ctx }] }),
            signal: AbortSignal.timeout(9000),
          });
          if (aiRes.ok) {
            const aiData = await aiRes.json();
            const raw = Array.isArray(aiData?.content) ? aiData.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('') : '';
            const cleaned = raw.replace(/```json|```/g, '').trim();
            const parsed = JSON.parse(cleaned);
            if (parsed && typeof parsed.body === 'string' && parsed.body.length > 10) {
              draftBody = parsed.body.replace(/\u2014/g, ', ');
              if (channel === 'email' && parsed.subject) draftSubj = String(parsed.subject).replace(/\u2014/g, ', ');
              isAi = true;
            }
          }
        } catch (_) { /* fall back to deterministic template */ }
      }

      return json({ data: {
        channel,
        subject_line: channel === 'email' ? draftSubj : null,
        body: draftBody,
        is_ai: isAi,
        grounded_on: { subject: clientName, signal, action, module: moduleName },
      } }, 200, reqCors);
    }

    // ── Phase 4B: Client Workspace decision surface ──

    if (type === 'client_decision_surface') {
      if (!SB_SERVICE) return json({ error:'no service key' }, 500, reqCors);
      const clientId = String(body.clientId || body.id || '');
      if (!clientId) return json({ error:'clientId required' }, 400, reqCors);
      const svc = { apikey:SB_SERVICE, Authorization:`Bearer ${SB_SERVICE}` };
      const read = async (p) => { try { const r = await fetch(`${SB_URL}/rest/v1/${p}`, { headers:svc }); return r.ok ? await r.json() : []; } catch(_) { return []; } };

      const clientRows = await read(`clients?id=eq.${encodeURIComponent(clientId)}&deleted_at=is.null&select=*&limit=1`);
      const client = Array.isArray(clientRows) && clientRows.length ? clientRows[0] : null;
      if (!client) return json({ error:'not_found' }, 404, reqCors);
      const { contactId, partnershipId } = await resolveClientGraph(clientId);

      const [project, invoices, messages, approvals, healthRows, recsRows, workLog, events] = await Promise.all([
        contactId ? read(`projects?contact_id=eq.${contactId}&deleted_at=is.null&select=name,stage,ball_in_court,progress,updated_at&order=created_at.desc&limit=1`) : Promise.resolve([]),
        read(`invoices?client_id=eq.${encodeURIComponent(clientId)}&deleted_at=is.null&select=amount,status,due_date&order=created_at.desc&limit=50`),
        read(`messages?client_id=eq.${encodeURIComponent(clientId)}&deleted_at=is.null&select=from_who,created_at&order=created_at.desc&limit=5`),
        read(`approvals?client_id=eq.${encodeURIComponent(clientId)}&deleted_at=is.null&status=eq.pending&select=title,created_at&order=created_at.asc&limit=10`),
        partnershipId ? read(`health_metrics?partnership_id=eq.${partnershipId}&select=period,calls,forms,bookings,visits&order=period.desc&limit=2`) : Promise.resolve([]),
        partnershipId ? read(`recommendations?partnership_id=eq.${partnershipId}&select=*&order=created_at.desc&limit=30`) : Promise.resolve([]),
        partnershipId ? read(`work_log?partnership_id=eq.${partnershipId}&select=title,done_at&order=done_at.desc&limit=10`) : Promise.resolve([]),
        contactId ? read(`events?contact_id=eq.${contactId}&select=type,payload,created_at&order=created_at.desc&limit=12`) : Promise.resolve([]),
      ]);

      const inv = Array.isArray(invoices)?invoices:[];
      const health = Array.isArray(healthRows)?healthRows:[];
      const proj = Array.isArray(project)&&project.length?project[0]:null;

      // ── health + growth (same as overview route) ──
      let healthScore=null, healthDrivers=[];
      {
        const sig=[];
        const overdue=inv.filter(i=>i.status&&i.status!=='paid'&&i.due_date&&new Date(i.due_date)<new Date());
        sig.push(overdue.length===0?100:Math.max(0,100-overdue.length*25));
        if (overdue.length) healthDrivers.push(`${overdue.length} overdue invoice${overdue.length>1?'s':''}`);
        const lastMsg=Array.isArray(messages)&&messages.length?messages[0]:null;
        if (lastMsg){ sig.push(lastMsg.from_who==='client'?60:100); if(lastMsg.from_who==='client') healthDrivers.push('an unanswered client message'); }
        const apprCount=Array.isArray(approvals)?approvals.length:0;
        sig.push(apprCount===0?100:Math.max(40,100-apprCount*15));
        if (apprCount) healthDrivers.push(`${apprCount} pending approval${apprCount>1?'s':''}`);
        if (health.length>=2){ const now=(health[0].calls||0)+(health[0].forms||0)+(health[0].bookings||0); const prev=(health[1].calls||0)+(health[1].forms||0)+(health[1].bookings||0); sig.push(now>=prev?100:70); if(now<prev) healthDrivers.push('business metrics dipped this month'); }
        if (sig.length>=2) healthScore=Math.round(sig.reduce((a,b)=>a+b,0)/sig.length);
      }
      let growthScore=null, growthWhy='';
      if (health.length>=2){
        const now=(health[0].calls||0)+(health[0].forms||0)+(health[0].bookings||0)+(health[0].visits||0);
        const prev=(health[1].calls||0)+(health[1].forms||0)+(health[1].bookings||0)+(health[1].visits||0);
        if (prev>0){ growthScore=Math.round(((now-prev)/prev)*100); growthWhy = growthScore>0?'more people are finding and contacting them':'engagement softened versus last month'; }
        else if (now>0){ growthScore=100; growthWhy='first month of measurable activity'; }
      }
      const clientCtx = { health: healthScore!=null?healthScore:70, stage: client.stage || (proj && proj.stage==='complete' ? 'mature' : proj ? 'growth' : 'onboarding') };

      // ── RANK recommendations through EBV ──
      const activeRecs = (Array.isArray(recsRows)?recsRows:[]).filter(r=>!['done','declined','dismissed'].includes(r.status));
      const ebvInputs = activeRecs.map(r=>({ raw:r, input:recToEbvInput(r) }));
      // field averages for distinctive explanations
      const pre = ebvInputs.map(x=>ebvScore(x.input, clientCtx, null));
      const fkeys = pre.length?Object.keys(pre[0].factors):[];
      const favg={}; fkeys.forEach(k=>{ favg[k]=pre.reduce((s,p)=>s+p.factors[k],0)/(pre.length||1); });
      const ranked = ebvInputs.map(x=>{ const s=ebvScore(x.input, clientCtx, favg); return { raw:x.raw, scored:s }; })
        .sort((a,b)=> b.scored.tier-a.scored.tier || b.scored.critRank-a.scored.critRank || b.scored.score-a.scored.score);

      const insights = ranked.map(x=>recToInsight(x.raw, x.scored));
      const theOneDecision = insights.length ? insights[0] : null;

      // ── typed attention (owner + urgency + cost of delay) ──
      const attention=[];
      (Array.isArray(approvals)?approvals:[]).forEach(a=>attention.push({ owner:'client', urgency:'soon', label:`Approve: ${a.title||'a deliverable'}`, cost:'keeps the related work moving' }));
      inv.filter(i=>i.status&&i.status!=='paid'&&i.due_date&&new Date(i.due_date)<new Date()).forEach(i=>attention.push({ owner:'client', urgency:'urgent', label:`Invoice overdue: $${i.amount}`, cost:'ages further the longer it waits' }));
      if (proj && proj.ball_in_court==='client') attention.push({ owner:'client', urgency:'soon', label:`Project waiting on them: ${proj.stage}`, cost:'work is paused until they respond' });

      // ── in-flight work as VALUE (progress + payoff) ──
      const inFlight=[];
      if (proj && proj.ball_in_court!=='client' && proj.stage && proj.stage!=='complete') inFlight.push({ label:proj.name||'Their project', stage:proj.stage, progress:proj.progress||null, payoff:'moves them toward launch' });
      ranked.filter(x=>['in_progress','approved'].includes(x.raw.status)).slice(0,2).forEach(x=>inFlight.push({ label:x.raw.title, stage:'in progress', progress:null, payoff:x.raw.why||'' }));

      // ── risks (anticipatory) ──
      const risks=[];
      if (growthScore!=null && growthScore < -10) risks.push({ level:'watch', headline:'Engagement is trending down', why:growthWhy, suggestion:'a proactive check-in or a fresh growth play could reverse it before they notice' });
      const overdueR=inv.filter(i=>i.status&&i.status!=='paid'&&i.due_date&&new Date(i.due_date)<new Date());
      if (overdueR.length) risks.push({ level:'attention', headline:'Payment is slipping', why:`${overdueR.length} invoice${overdueR.length>1?'s'              :''} past due`, suggestion:'a gentle nudge now avoids an awkward conversation later' });
      const lastMsgDays = (Array.isArray(messages)&&messages.length) ? Math.floor((Date.now()-new Date(messages[0].created_at))/86400000) : null;
      if (lastMsgDays!=null && lastMsgDays>21) risks.push({ level:'watch', headline:`Quiet for ${lastMsgDays} days`, why:'no contact in three weeks', suggestion:'silence often precedes churn — a quick value-add message keeps the relationship warm' });

      // ── ai insight (one line, derived) ──
      let aiInsight='';
      if (theOneDecision && theOneDecision.urgency==='urgent') aiInsight = `Most important right now: ${theOneDecision.headline.toLowerCase()} — ${theOneDecision.ranking_reason.replace(/^Critical — /,'')}`;
      else if (growthScore!=null && growthScore>5) aiInsight = `Trending up ${growthScore}% this month. ${theOneDecision?'Biggest opportunity: '+theOneDecision.headline.toLowerCase()+'.':''}`;
      else if (theOneDecision) aiInsight = `Highest-value move: ${theOneDecision.headline.toLowerCase()}.`;
      else aiInsight = `Everything's steady — a good window for proactive growth work.`;

      // ── numbers + since-last-look ──
      const paidTotal=inv.filter(i=>i.status==='paid').reduce((s,i)=>s+(Number(i.amount)||0),0);
      const lastViewed = body.lastViewed ? new Date(body.lastViewed) : null;
      const sinceLast = lastViewed ? (Array.isArray(events)?events:[]).filter(e=>new Date(e.created_at)>lastViewed).length : null;

      return json({ data: {
        client: { id:client.id, name:client.name, type:client.business_type||client.industry||null, city:client.city||null, since:client.created_at||client.launched_at||null },
        header: {
          health_score: healthScore, health_drivers: healthDrivers,
          growth_score: growthScore, growth_why: growthWhy,
          status: client.status||'Active', plan: client.plan_label||(client.monthly_amount?`$${client.monthly_amount}/mo`:null),
          last_contact: (Array.isArray(messages)&&messages.length)?messages[0].created_at:null,
        },
        since_last_look: sinceLast,
        ai_insight: aiInsight,
        the_one_decision: theOneDecision,
        decision_queue: insights.slice(1, 6),
        attention,
        in_flight: inFlight,
        risks,
        numbers: { mrr: client.monthly_amount||null, lifetime: paidTotal, open_invoices: inv.filter(i=>i.status&&i.status!=='paid').length },
        engine_version: EBV_ACTIVE,
      } }, 200, reqCors);
    }


    if (type === 'client_archive') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const staff = await verifyStaff(req);
      const clientId = String(body.clientId || body.id || '');
      const reason = String(body.reason || '').slice(0, 500) || null;
      if (!clientId) return json({ error: 'clientId required' }, 400, reqCors);

      let clientName = '';
      try {
        const cr = await fetch(`${SB_URL}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=name&limit=1`,
          { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` } });
        const rows = cr.ok ? await cr.json() : [];
        if (Array.isArray(rows) && rows.length) clientName = rows[0].name || '';
      } catch (_) { /* ignore */ }

      const { contactId, partnershipId } = await resolveClientGraph(clientId);
      const stamp = new Date().toISOString();
      const affected: Record<string, number> = {};
      const failures: string[] = [];

      for (const t of ARCHIVE_GRAPH.direct) {
        const r = await archiveDb(t, 'client_id', clientId, { deleted_at: stamp });
        if (r.ok) affected[t] = r.count; else failures.push(t);
      }
      if (contactId) for (const t of ARCHIVE_GRAPH.byContact) {
        const r = await archiveDb(t, 'contact_id', contactId, { deleted_at: stamp });
        if (r.ok) affected[t] = r.count; else failures.push(t);
      }
      if (partnershipId) for (const t of ARCHIVE_GRAPH.byPartnership) {
        const r = await archiveDb(t, 'partnership_id', partnershipId, { deleted_at: stamp });
        if (r.ok) affected[t] = r.count; else failures.push(t);
      }
      // client row last, with archive metadata (so a failure never leaves the
      // client looking archived while children are still live)
      const head = await archiveDb('clients', 'id', clientId, {
        deleted_at: stamp, archived_at: stamp,
        archived_by: staff?.email || staff?.userId || 'unknown', archive_reason: reason,
      });
      if (!head.ok) return json({ error: 'archive_failed', detail: head.detail, partial: affected }, 200, reqCors);

      await logClientAudit({ clientId, clientName, action: 'archive', actorEmail: staff?.email, actorRole: staff?.role, reason: reason || undefined, affected });
      return json({ ok: true, archived: true, affected, failures }, 200, reqCors);
    }

    // ── client_restore ── un-stamp deleted_at across the graph
    if (type === 'client_restore') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const staff = await verifyStaff(req);
      const clientId = String(body.clientId || body.id || '');
      if (!clientId) return json({ error: 'clientId required' }, 400, reqCors);

      let clientName = '';
      try {
        const cr = await fetch(`${SB_URL}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=name&limit=1`,
          { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` } });
        const rows = cr.ok ? await cr.json() : [];
        if (Array.isArray(rows) && rows.length) clientName = rows[0].name || '';
      } catch (_) { /* ignore */ }

      const { contactId, partnershipId } = await resolveClientGraph(clientId);
      const affected: Record<string, number> = {};
      const failures: string[] = [];

      for (const t of ARCHIVE_GRAPH.direct) {
        const r = await archiveDb(t, 'client_id', clientId, { deleted_at: null });
        if (r.ok) affected[t] = r.count; else failures.push(t);
      }
      if (contactId) for (const t of ARCHIVE_GRAPH.byContact) {
        const r = await archiveDb(t, 'contact_id', contactId, { deleted_at: null });
        if (r.ok) affected[t] = r.count; else failures.push(t);
      }
      if (partnershipId) for (const t of ARCHIVE_GRAPH.byPartnership) {
        const r = await archiveDb(t, 'partnership_id', partnershipId, { deleted_at: null });
        if (r.ok) affected[t] = r.count; else failures.push(t);
      }
      const head = await archiveDb('clients', 'id', clientId, {
        deleted_at: null, archived_at: null, archived_by: null, archive_reason: null,
      });
      if (!head.ok) return json({ error: 'restore_failed', detail: head.detail, partial: affected }, 200, reqCors);

      await logClientAudit({ clientId, clientName, action: 'restore', actorEmail: staff?.email, actorRole: staff?.role, affected });
      return json({ ok: true, restored: true, affected, failures }, 200, reqCors);
    }

    // ── client_purge ── (OWNER) permanent, irreversible. Typed-name confirm.
    if (type === 'client_purge') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const staff = await verifyStaff(req);
      const clientId = String(body.clientId || body.id || '');
      const confirmName = String(body.confirmName || '');
      if (!clientId) return json({ error: 'clientId required' }, 400, reqCors);

      let clientName = '';
      try {
        const cr = await fetch(`${SB_URL}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=name,deleted_at&limit=1`,
          { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` } });
        const rows = cr.ok ? await cr.json() : [];
        if (!Array.isArray(rows) || !rows.length) return json({ error: 'not_found' }, 404, reqCors);
        clientName = rows[0].name || '';
        if (!rows[0].deleted_at) return json({ error: 'must_archive_first' }, 200, reqCors);
      } catch (_) { return json({ error: 'lookup_failed' }, 200, reqCors); }

      if (confirmName.trim() !== clientName.trim()) {
        return json({ error: 'name_mismatch', expected: clientName }, 200, reqCors);
      }

      const { contactId, partnershipId } = await resolveClientGraph(clientId);
      const affected: Record<string, number> = {};
      const failures: string[] = [];

      // children-first so nothing is orphaned mid-operation
      if (partnershipId) for (const t of ARCHIVE_GRAPH.byPartnership) {
        const r = await archiveDb(t, 'partnership_id', partnershipId, null, true);
        if (r.ok) affected[t] = r.count; else failures.push(t);
      }
      if (contactId) for (const t of ARCHIVE_GRAPH.byContact) {
        const r = await archiveDb(t, 'contact_id', contactId, null, true);
        if (r.ok) affected[t] = r.count; else failures.push(t);
      }
      for (const t of ARCHIVE_GRAPH.direct) {
        const r = await archiveDb(t, 'client_id', clientId, null, true);
        if (r.ok) affected[t] = r.count; else failures.push(t);
      }
      const head = await archiveDb('clients', 'id', clientId, null, true);
      if (!head.ok) return json({ error: 'purge_failed', detail: head.detail, partial: affected }, 200, reqCors);

      await logClientAudit({ clientId, clientName, action: 'purge', actorEmail: staff?.email, actorRole: staff?.role, reason: String(body.reason || '').slice(0, 500) || undefined, affected });
      try {
        await sendEmail(ERIC, `Client permanently deleted: ${clientName}`,
          `<p>${clientName} and all related records were permanently purged by ${staff?.email || 'an owner'}. This cannot be undone.</p>`);
      } catch (_) { /* ignore */ }
      return json({ ok: true, purged: true, affected, failures }, 200, reqCors);
    }

    // ── archived_clients_list ── the Recently Archived view
    if (type === 'archived_clients_list') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      try {
        const r = await fetch(
          `${SB_URL}/rest/v1/clients?deleted_at=not.is.null&select=id,name,contact_email,email,archived_at,archived_by,archive_reason&order=archived_at.desc&limit=200`,
          { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` } },
        );
        const data = r.ok ? await r.json() : [];
        return json({ data: Array.isArray(data) ? data : [] }, 200, reqCors);
      } catch (e) {
        return json({ error: 'archived_list_failed', message: String(e) }, 200, reqCors);
      }
    }

    // ── client_audit_trail ── the archive/restore/purge log
    if (type === 'client_audit_trail') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const clientId = String(body.clientId || '');
      const filter = clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '';
      try {
        const r = await fetch(
          `${SB_URL}/rest/v1/client_audit_log?select=*${filter}&order=created_at.desc&limit=200`,
          { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` } },
        );
        const data = r.ok ? await r.json() : [];
        return json({ data: Array.isArray(data) ? data : [] }, 200, reqCors);
      } catch (e) {
        return json({ error: 'audit_trail_failed', message: String(e) }, 200, reqCors);
      }
    }

    // ── DELETE_CLIENT_CASCADE ── (gate: owner) — Part 2c
    // Client deletion needs to remove rows across ~11 child tables. Rather than
    // grant the frontend DELETE on all of them (which would re-open the risk the
    // carve-up closes), the whole cascade happens here, once, owner-gated.
    if (type === 'delete_client_cascade') {
      if (!SB_SERVICE) return json({ error: 'Server missing SERVICE_ROLE_KEY secret' }, 500, reqCors);
      const clientId = String(body.clientId || body.id || '');
      if (!clientId) return json({ error: 'clientId required' }, 400, reqCors);

      const CHILD_TABLES = [
        'file_comments', 'files', 'messages', 'approvals', 'invoices',
        'timeline', 'activity_log', 'notifications', 'client_onboarding',
        'intake_forms', 'client_requests',
      ];
      const svc = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` };
      const failed: string[] = [];
      for (const t of CHILD_TABLES) {
        try {
          const r = await fetch(`${SB_URL}/rest/v1/${t}?client_id=eq.${encodeURIComponent(clientId)}`,
            { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
          if (!r.ok) failed.push(t);
        } catch (_) { failed.push(t); }
      }
      // Finally the client row itself.
      let clientDeleted = false;
      try {
        const r = await fetch(`${SB_URL}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}`,
          { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
        clientDeleted = r.ok;
      } catch (_) { clientDeleted = false; }

      if (!clientDeleted) return json({ error: 'client_delete_failed', childFailures: failed }, 200, reqCors);
      return json({ ok: true, childFailures: failed }, 200, reqCors);
    }

    // ════════════════════════════════════════════════════════════════════
    //  PIPELINE OUTREACH — draft + send (gate: staff)
    //  Two narrow routes so the panel never touches Resend/Anthropic keys.
    //   • prospect_email_draft  → returns { subject, body, generator } where
    //     generator is 'ai' | 'template'. AI is tried first; on any failure
    //     (key missing, timeout, parse error) we fall back to a real template
    //     so the compose window is NEVER empty. Caller can't tell which ran.
    //   • prospect_email_send   → sends via Resend from eric@ with reply-to
    //     eric@ so replies land in Eric's inbox. Returns { ok, id }. It does
    //     NOT write history; the panel logs ONLY on a 2xx, so a failed send
    //     can never create a false "sent" event.
    // ════════════════════════════════════════════════════════════════════

    // Shared: build a grounded, human outreach template from real prospect
    // fields. Used as the AI prompt's source material AND as the deterministic
    // fallback, so both paths reference the same true facts (no invention).
    function buildOutreachTemplate(p: any) {
      const biz = (p.business || p.business_name || 'your business').toString().trim();
      const ownerFull = (p.owner || '').toString().trim();
      const ownerFirst = ownerFull ? ownerFull.split(/\s+/)[0] : '';
      const industryRaw = (p.industry || '').toString().trim();
      const industry = industryRaw ? industryRaw.toLowerCase() : 'local business';
      const location = (p.location || '').toString().trim();
      const website = (p.website || '').toString().trim();
      const notes: string[] = Array.isArray(p.research)
        ? p.research.map((r: any) => (r && r.body ? String(r.body).trim() : '')).filter(Boolean)
        : [];
      const firstNote = notes[0] || '';

      const greeting = ownerFirst ? `Hi ${ownerFirst},` : `Hi there,`;
      const foundLine = location
        ? `I came across ${biz} while looking at ${industry}s around ${location},`
        : `I came across ${biz} while looking at ${industry}s in the area,`;

      let observation: string;
      if (firstNote) {
        observation = `${foundLine} and one thing stood out: ${firstNote.replace(/\u2014/g, ', ')}.`;
      } else if (website) {
        observation = `${foundLine} and took a quick look at ${website}. A couple of small things on there could be quietly sending customers to competitors who rank above you.`;
      } else {
        observation = `${foundLine} and couldn't find a website for you. For a ${industry}, that usually means people searching right now are landing on a competitor instead.`;
      }

      const value = `I run a small studio here in LA and help ${industry}s get found and turn more of those visits into calls and bookings. Not a sales pitch, I just tend to notice this stuff.`;
      const cta = website
        ? `Want me to send over a short, honest list of what I'd change first? No cost, no obligation.`
        : `Happy to put together a quick, no cost plan for getting you showing up in local search. Worth a look?`;

      const subject = website
        ? `A quick thought on ${biz}'s site`
        : `Helping ${biz} show up in local search`;
      const body = `${greeting}\n\n${observation}\n\n${value}\n\n${cta}\n\nEric\nDavis Digital Studio`;
      return { subject, body };
    }

    if (type === 'prospect_email_draft') {
      const p = (body && typeof body.prospect === 'object' && body.prospect) ? body.prospect : body || {};
      // Deterministic fallback is always available.
      const tmpl = buildOutreachTemplate(p);
      let subject = tmpl.subject;
      let draft = tmpl.body;
      let generator: 'ai' | 'template' = 'template';

      if (ANTHROPIC_KEY) {
        try {
          const biz = (p.business || p.business_name || 'the business').toString().trim();
          const facts = [
            `Business: ${biz}`,
            p.industry ? `Industry: ${p.industry}` : '',
            p.location ? `Location: ${p.location}` : '',
            p.website ? `Website: ${p.website}` : `Website: none found`,
            p.owner ? `Owner/contact: ${p.owner}` : '',
            Array.isArray(p.research) && p.research.length
              ? `Things Eric noticed (use ONLY these, do not invent): ${p.research.map((r: any) => (r && r.body ? String(r.body) : '')).filter(Boolean).slice(0, 4).join('; ')}`
              : '',
          ].filter(Boolean).join('\n');

          const sys = `You write cold outreach emails for Eric Davis, who runs Davis Digital Studio, a one person web design and SEO studio in Los Angeles. Eric is emailing a local business he has never spoken to, to offer help.

Write like a real person, not marketing. Rules:
- Open with ONE specific, true observation about THIS business or its website, drawn only from the facts given. Never invent metrics, rankings, dates, or problems.
- Lead with helping, not selling. No hype, no buzzwords, no "I hope this email finds you well", no "boost/skyrocket/unlock/leverage/game-changing".
- Short. The length a busy owner actually reads (about 70 to 110 words of body).
- Warm, plain, direct. First name only if an owner name is given. No em dashes anywhere, use commas instead.
- End with a low pressure CTA offering a free, honest look. No hard ask.
- Sign as "Eric" then "Davis Digital Studio" on the next line.
- The subject must be specific and quiet, not clickbait. Under 6 words.
Respond as JSON only, nothing else: {"subject":"...","body":"..."}`;

          const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, system: sys, messages: [{ role: 'user', content: facts }] }),
            signal: AbortSignal.timeout(9000),
          });
          if (aiRes.ok) {
            const aiData = await aiRes.json();
            const raw = Array.isArray(aiData?.content) ? aiData.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('') : '';
            const cleaned = raw.replace(/```json|```/g, '').trim();
            const parsed = JSON.parse(cleaned);
            if (parsed && typeof parsed.body === 'string' && parsed.body.trim().length > 20 && typeof parsed.subject === 'string' && parsed.subject.trim().length > 2) {
              draft = parsed.body.replace(/\u2014/g, ', ').trim();
              subject = parsed.subject.replace(/\u2014/g, ', ').trim();
              generator = 'ai';
            }
          }
        } catch (_) { /* keep deterministic template */ }
      }

      return json({ data: { subject, body: draft, generator } }, 200, reqCors);
    }

    if (type === 'prospect_email_send') {
      const to = (body.to || '').toString().trim();
      const subject = (body.subject || '').toString().trim();
      const text = (body.body || '').toString();
      // Validate before doing anything that could be mistaken for a send.
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);
      if (!emailOk) return json({ error: 'bad_recipient', detail: 'A valid prospect email is required.' }, 200, reqCors);
      if (!subject) return json({ error: 'missing_subject', detail: 'Subject is required.' }, 200, reqCors);
      if (text.trim().length < 5) return json({ error: 'empty_body', detail: 'Email body is empty.' }, 200, reqCors);
      if (!RESEND_KEY) return json({ error: 'email_not_configured', detail: 'Email service is not configured.' }, 200, reqCors);

      // Plain-text outreach renders as simple HTML (preserve line breaks).
      const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1523;white-space:pre-wrap;">${safe}</div>`;

      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: `Eric Davis <${ERIC}>`,
            to: [to],
            reply_to: ERIC,
            subject,
            html,
            text,
          }),
        });
        if (!r.ok) {
          let detail = '';
          try { detail = await r.text(); } catch (_) { /* ignore */ }
          console.error('Outreach send failed', r.status, 'to', to, detail);
          return json({ error: 'send_failed', status: r.status, detail: 'The email service rejected the send. Nothing was sent.' }, 200, reqCors);
        }
        let id = '';
        try { const j = await r.json(); id = j && j.id ? String(j.id) : ''; } catch (_) { /* id optional */ }
        return json({ data: { ok: true, id } }, 200, reqCors);
      } catch (e) {
        console.error('Outreach send threw to', to, String(e));
        return json({ error: 'send_threw', detail: 'Could not reach the email service. Nothing was sent.' }, 200, reqCors);
      }
    }

    // ── ADMIN_WRITE ── (gate: staff) — Part 2c named mutations
    // Body: { type:'admin_write', table, op:'insert'|'update'|'delete',
    //         payload?, match?:{column:value} }
    // The table's allowed methods are enforced from ADMIN_WRITE_OPS; an op the
    // table doesn't permit is rejected. update/delete REQUIRE a match filter so
    // a missing WHERE can never nuke a whole table.
    if (type === 'admin_write') {
      if (!SB_SERVICE) return json({ error: 'Server missing SERVICE_ROLE_KEY secret' }, 500, reqCors);
      const table = String(body.table || '');
      const op = String(body.op || '').toLowerCase();
      const payload = body.payload ?? null;
      const match = (body.match && typeof body.match === 'object') ? body.match : null;

      const allowed = ADMIN_WRITE_OPS[table];
      if (!allowed) return json({ error: 'table_not_allowed', detail: table }, 403, reqCors);

      const opToMethod: Record<string, string> = { insert: 'POST', update: 'PATCH', delete: 'DELETE' };
      const method = opToMethod[op];
      if (!method) return json({ error: 'bad_op', detail: op }, 400, reqCors);
      if (!allowed.has(method)) return json({ error: 'op_not_allowed_for_table', detail: table + ':' + op }, 403, reqCors);

      // Guardrail: update and delete MUST be filtered. No blanket mutations.
      if ((op === 'update' || op === 'delete') && (!match || !Object.keys(match).length)) {
        return json({ error: 'match_required', detail: op + ' needs a match filter' }, 400, reqCors);
      }
      // insert needs a payload.
      if (op === 'insert' && (payload === null || typeof payload !== 'object')) {
        return json({ error: 'payload_required' }, 400, reqCors);
      }

      // Build a PostgREST querystring from the match filter (eq. only — no
      // operators passed through, so a caller can't smuggle in `or=` tricks).
      let qs = '';
      if (match) {
        const parts: string[] = [];
        for (const k of Object.keys(match)) {
          // column names: letters, digits, underscore only.
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) {
            return json({ error: 'bad_match_column', detail: k }, 400, reqCors);
          }
          const v = (match as any)[k];
          // Reject empty/null match values: `id=eq.` would match EVERY row and
          // turn a single-row update/delete into a table-wide one. Hard no.
          if (v === null || v === undefined || String(v) === '') {
            return json({ error: 'empty_match_value', detail: k }, 400, reqCors);
          }
          parts.push(`${k}=eq.${encodeURIComponent(String(v))}`);
        }
        qs = '?' + parts.join('&');
      }

      try {
        const headers: Record<string, string> = {
          'apikey': SB_SERVICE,
          'Authorization': `Bearer ${SB_SERVICE}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        };
        const init: RequestInit = { method, headers };
        if (op === 'insert' || op === 'update') init.body = JSON.stringify(payload);
        const res = await fetch(`${SB_URL}/rest/v1/${table}${qs}`, init);
        const text = await res.text();
        let data: unknown = null;
        try { data = text ? JSON.parse(text) : null; } catch (_e) { data = text; }
        if (!res.ok) return json({ error: 'db_error', status: res.status, detail: data }, 200, reqCors);
        return json({ data }, 200, reqCors);
      } catch (e) {
        return json({ error: 'admin_write_failed', detail: String(e) }, 200, reqCors);
      }
    }

    // ── ADMIN_QUERY ── (gate: staff) — Part 2c GET-only reads
    // Body: { type:'admin_query', path:'table?select=...&filter' }
    // Identical query power to admin_db's GET, but the method is hard-coded to
    // GET here, so this surface can NEVER mutate, regardless of caller input.
    if (type === 'admin_query') {
      if (!SB_SERVICE) return json({ error: 'Server missing SERVICE_ROLE_KEY secret' }, 500, reqCors);
      const path = String(body.path || '');
      if (!path) return json({ error: 'path required' }, 400, reqCors);
      const table = path.split('?')[0].split('/')[0];
      if (!ADMIN_READ_TABLES.has(table)) {
        return json({ error: 'table_not_allowed', detail: table }, 403, reqCors);
      }
      try {
        const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
          method: 'GET', // hard-coded — this route cannot mutate
          headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` },
        });
        const text = await res.text();
        let data: unknown = null;
        try { data = text ? JSON.parse(text) : null; } catch (_e) { data = text; }
        if (!res.ok) return json({ error: 'db_error', status: res.status, detail: data }, 200, reqCors);
        return json({ data }, 200, reqCors);
      } catch (e) {
        return json({ error: 'admin_query_failed', detail: String(e) }, 200, reqCors);
      }
    }

    // ── DELETE CLIENT AUTH USER ── (gate: owner)
    if (type === 'delete_client_auth') {
      if (!(await verifyAdminJwt(req))) return json({ error: 'unauthorized' }, 401, reqCors);
      if (!SB_SERVICE) return json({ error: 'Server missing SERVICE_ROLE_KEY secret' }, 500, reqCors);
      const email = String(body.email || '').trim().toLowerCase();
      if (!email) return json({ error: 'email required' }, 400, reqCors);
      try {
        let matchId: string | null = null;
        for (let page = 1; page <= 5 && !matchId; page++) {
          const listRes = await fetch(
            `${SB_URL}/auth/v1/admin/users?page=${page}&per_page=200`,
            { headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` } },
          );
          if (!listRes.ok) break;
          const listData = await listRes.json();
          const users = Array.isArray(listData) ? listData : (listData.users || []);
          if (!users.length) break;
          const match = users.find((u: any) => (u.email || '').toLowerCase() === email);
          if (match && match.id) matchId = match.id;
          if (users.length < 200) break;
        }
        if (!matchId) {
          return json({ ok: true, deleted: false, note: 'no matching auth user' }, 200, reqCors);
        }
        const delRes = await fetch(`${SB_URL}/auth/v1/admin/users/${matchId}`, {
          method: 'DELETE',
          headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` },
        });
        if (!delRes.ok) {
          const detail = await delRes.text();
          return json({ error: 'delete_failed', status: delRes.status, detail }, 200, reqCors);
        }
        return json({ ok: true, deleted: true }, 200, reqCors);
      } catch (e) {
        return json({ error: 'delete_client_auth_failed', detail: String(e) }, 200, reqCors);
      }
    }

    // ── INVITE CLIENT ── (gate: admin)
    if (type === 'invite_client') {
      const { email, name } = body;
      if (!email) return json({ error: 'email required' }, 400);
      if (!SB_SERVICE) return json({ error: 'Server missing SERVICE_ROLE_KEY secret' }, 500);
      try {
        const res = await fetch(`${SB_URL}/auth/v1/invite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` },
          body: JSON.stringify({
            email,
            data: name ? { full_name: name } : {},
            redirect_to: 'https://davisdigitalstudio.com/set-password.html',
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          return json({ error: data.msg || data.message || data.error_description || 'Could not send invite', status: res.status }, 200);
        }
        return json({ ok: true, user_id: data.id || (data.user && data.user.id) || null });
      } catch (e) {
        return json({ error: 'invite_failed', message: String(e) }, 200);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  TEAM MANAGEMENT (owner only — gated above at 'owner')
    //  Add/list/role/remove staff members. A "member" = a row in `memberships`
    //  that grants someone access to the admin panel at a given role. This is
    //  the in-app replacement for hand-editing the memberships table in SQL.
    //  Clients are contacts, NOT members — they never appear here.
    // ═══════════════════════════════════════════════════════════════════════
    const VALID_ROLES = new Set(['admin', 'staff', 'readonly']); // owner is not assignable via UI

    // ── TEAM LIST: every member with email + role ──
    if (type === 'team_list') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      try {
        // memberships for this tenant
        const mr = await fetch(
          `${SB_URL}/rest/v1/memberships?tenant_id=eq.${encodeURIComponent(TENANT_ID)}&select=id,user_id,role,created_at&order=created_at.asc`,
          { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` } },
        );
        const members = mr.ok ? await mr.json() : [];
        // resolve emails from auth.users (admin list API)
        const out: any[] = [];
        for (const m of (Array.isArray(members) ? members : [])) {
          let email = '';
          try {
            const ur = await fetch(`${SB_URL}/auth/v1/admin/users/${encodeURIComponent(m.user_id)}`,
              { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` } });
            if (ur.ok) { const u = await ur.json(); email = (u && u.email) ? String(u.email) : ''; }
          } catch (_) { /* leave email blank */ }
          out.push({ id: m.id, user_id: m.user_id, email, role: m.role, created_at: m.created_at });
        }
        return json({ data: out }, 200, reqCors);
      } catch (e) {
        return json({ error: 'team_list_failed', message: String(e) }, 200, reqCors);
      }
    }

    // ── TEAM INVITE: invite by email + assign a role ──
    // If the email already has an auth user, we just (re)assign their role.
    // Otherwise we send a Supabase invite, then create their membership so they
    // land already assigned. Either way they end up as a member at `role`.
    if (type === 'team_invite') {
      if (!SB_SERVICE) return json({ error: 'Server missing SERVICE_ROLE_KEY secret' }, 500, reqCors);
      const email = String(body.email || '').trim().toLowerCase();
      const name = String(body.name || '').trim();
      const role = String(body.role || 'staff');
      if (!email) return json({ error: 'email required' }, 400, reqCors);
      if (!VALID_ROLES.has(role)) return json({ error: 'invalid role' }, 400, reqCors);

      const svc = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' };

      // 1) Does an auth user already exist for this email?
      let userId: string | null = null;
      try {
        for (let page = 1; page <= 5 && !userId; page++) {
          const lr = await fetch(`${SB_URL}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: svc });
          if (!lr.ok) break;
          const ld = await lr.json();
          const users = Array.isArray(ld) ? ld : (ld.users || []);
          if (!users.length) break;
          const hit = users.find((u: any) => (u.email || '').toLowerCase() === email);
          if (hit && hit.id) userId = String(hit.id);
          if (users.length < 200) break;
        }
      } catch (_) { /* fall through to invite */ }

      // 2) If no user yet, send the invite (reuses the set-password flow).
      let invited = false;
      if (!userId) {
        try {
          const ir = await fetch(`${SB_URL}/auth/v1/invite`, {
            method: 'POST', headers: svc,
            body: JSON.stringify({
              email,
              data: name ? { full_name: name } : {},
              redirect_to: 'https://davisdigitalstudio.com/set-password.html',
            }),
          });
          const id = await ir.json();
          if (!ir.ok) return json({ error: id.msg || id.message || 'Could not send invite', status: ir.status }, 200, reqCors);
          userId = id.id || (id.user && id.user.id) || null;
          invited = true;
        } catch (e) {
          return json({ error: 'invite_failed', message: String(e) }, 200, reqCors);
        }
      }

      if (!userId) return json({ error: 'could not resolve or create user' }, 200, reqCors);

      // 3) Create/update their membership at the chosen role.
      try {
        const up = await fetch(`${SB_URL}/rest/v1/memberships`, {
          method: 'POST',
          headers: { ...svc, Prefer: 'resolution=merge-duplicates,return=representation' },
          body: JSON.stringify({ tenant_id: TENANT_ID, user_id: userId, role }),
        });
        if (!up.ok) {
          const d = await up.text();
          return json({ error: 'membership_failed', detail: d }, 200, reqCors);
        }
      } catch (e) {
        return json({ error: 'membership_failed', message: String(e) }, 200, reqCors);
      }

      // 4) Notify Eric for the record.
      try {
        await sendEmail(ERIC, `Team member ${invited ? 'invited' : 'added'}: ${email}`,
          notifyShell(`Team ${invited ? 'invite sent' : 'access granted'}`,
            [`${name || email} was ${invited ? 'invited and ' : ''}given <strong>${role}</strong> access.`]));
      } catch (_) {}

      return json({ ok: true, invited, role }, 200, reqCors);
    }

    // ── TEAM SET ROLE: change an existing member's role ──
    if (type === 'team_set_role') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const memberId = String(body.id || '');
      const role = String(body.role || '');
      if (!memberId || !VALID_ROLES.has(role)) return json({ error: 'id and valid role required' }, 400, reqCors);
      // Guard: never let the UI demote the last owner or set someone to owner.
      try {
        const r = await fetch(`${SB_URL}/rest/v1/memberships?id=eq.${encodeURIComponent(memberId)}&select=role&limit=1`,
          { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` } });
        const rows = r.ok ? await r.json() : [];
        if (Array.isArray(rows) && rows.length && rows[0].role === 'owner') {
          return json({ error: 'cannot change an owner from here' }, 200, reqCors);
        }
      } catch (_) {}
      try {
        const up = await fetch(`${SB_URL}/rest/v1/memberships?id=eq.${encodeURIComponent(memberId)}`, {
          method: 'PATCH',
          headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ role }),
        });
        if (!up.ok) return json({ error: 'set_role_failed', status: up.status }, 200, reqCors);
        return json({ ok: true }, 200, reqCors);
      } catch (e) {
        return json({ error: 'set_role_failed', message: String(e) }, 200, reqCors);
      }
    }

    // ── TEAM REMOVE: revoke a member's access (removes the membership row) ──
    // This instantly cuts off admin access (verifyStaff finds no row). It does
    // NOT delete their auth login; pass purgeLogin:true to also delete the user.
    if (type === 'team_remove') {
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
      const memberId = String(body.id || '');
      if (!memberId) return json({ error: 'id required' }, 400, reqCors);
      const svc = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` };

      // Look up the row; refuse to remove an owner from here.
      let userId = '';
      try {
        const r = await fetch(`${SB_URL}/rest/v1/memberships?id=eq.${encodeURIComponent(memberId)}&select=user_id,role&limit=1`, { headers: svc });
        const rows = r.ok ? await r.json() : [];
        if (Array.isArray(rows) && rows.length) {
          if (rows[0].role === 'owner') return json({ error: 'cannot remove an owner from here' }, 200, reqCors);
          userId = String(rows[0].user_id || '');
        }
      } catch (_) {}

      try {
        const dr = await fetch(`${SB_URL}/rest/v1/memberships?id=eq.${encodeURIComponent(memberId)}`, {
          method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' },
        });
        if (!dr.ok) return json({ error: 'remove_failed', status: dr.status }, 200, reqCors);
      } catch (e) {
        return json({ error: 'remove_failed', message: String(e) }, 200, reqCors);
      }

      // Optional: also delete their auth login.
      if (body.purgeLogin && userId) {
        try {
          await fetch(`${SB_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE', headers: svc });
        } catch (_) {}
      }
      return json({ ok: true }, 200, reqCors);
    }
    // ═══════════════════════════════════════════════════════════════════════
    //  END TEAM MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════

    // ── PASSWORD RESET ── (public, rate-limited; Supabase only emails the real owner)
    if (type === 'reset_password') {
      const { email } = body;
      if (!email) return json({ error: 'email required' }, 400);
      if (!SB_SERVICE) return json({ error: 'Server missing SERVICE_ROLE_KEY secret' }, 500);
      try {
        const res = await fetch(`${SB_URL}/auth/v1/recover`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` },
          body: JSON.stringify({
            email,
            redirect_to: 'https://davisdigitalstudio.com/set-password.html',
          }),
        });
        if (!res.ok) {
          let data: any = {}; try { data = await res.json(); } catch (_) {}
          return json({ error: data.msg || data.message || 'Could not send reset email', status: res.status }, 200);
        }
        return json({ ok: true });
      } catch (e) {
        return json({ error: 'reset_failed', message: String(e) }, 200);
      }
    }

    // ── AUDIT LEAD ── (public)
    if (type === 'audit_lead') {
      const { clientName, clientEmail, meta = {} } = body;
      const { url, bizType, city, score, perf, seo, a11y, lcp, fcp, cls, tbt, topIssues = [], userConfirmHtml, notifyHtml, fallback, pillars, deep, psiSkipped, tool } = meta;

      try {
        const key = SB_SERVICE || Deno.env.get('SUPABASE_ANON_KEY') || '';
        if (key) {
          await fetch(`${SB_URL}/rest/v1/audit_leads`, {
            method: 'POST',
            headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({
              tool: tool || 'audit', business_name: clientName || null, client_email: clientEmail || null,
              url: url || null, city: city || null, business_type: bizType || null,
              score: typeof score === 'number' ? score : null, pillars: pillars || null,
              core_web_vitals: (lcp || fcp || cls || tbt) ? { lcp, fcp, cls, tbt } : null,
              deep_audit: deep || null, findings: topIssues && topIssues.length ? topIssues : null,
              psi_skipped: !!psiSkipped,
            }),
          });
        }
      } catch (dbErr) { console.error('audit_leads insert failed (continuing with email):', dbErr); }

      const scoreColor = score < 45 ? '#e05555' : score < 65 ? '#f0b429' : '#6abf69';
      const ericHtml = notifyHtml || emailWrap(`
        <div style="max-width:580px;margin:0 auto;padding:32px 24px;">
          <a href="https://davisdigitalstudio.com" style="font-family:Georgia,serif;font-size:18px;color:#fff;text-decoration:none;display:block;margin-bottom:20px;">Davis<span style="color:#c4aee8;">Digital</span> Studio</a>
          <div style="background:#1e1338;border-radius:16px;padding:28px;">
            <div style="font-size:11px;color:#c4aee8;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">New Audit Lead</div>
            <h1 style="font-family:Georgia,serif;font-size:22px;font-weight:400;color:#fff;margin:0 0 4px;">${clientName}</h1>
            <a href="${url}" target="_blank" style="display:block;color:#c4aee8;text-decoration:none;font-size:13px;margin-bottom:18px;">${url}</a>
            <table style="width:100%;border-collapse:collapse;margin-bottom:18px;font-size:13px;">
              <tr><td style="padding:5px 0;color:rgba(255,255,255,0.4);width:80px;">Email</td><td><a href="mailto:${clientEmail}" style="color:#c4aee8;">${clientEmail}</a></td></tr>
              <tr><td style="padding:5px 0;color:rgba(255,255,255,0.4);">Type</td><td style="color:#fff;">${bizType || '—'}</td></tr>
              <tr><td style="padding:5px 0;color:rgba(255,255,255,0.4);">City</td><td style="color:#fff;">${city || '—'}</td></tr>
              <tr><td style="padding:5px 0;color:rgba(255,255,255,0.4);">Source</td><td style="color:#fff;">${fallback ? 'heuristic fallback' : 'PSI + deep audit'}</td></tr>
            </table>
            <div style="display:flex;gap:10px;margin-bottom:16px;">
              <div style="flex:1;background:rgba(255,255,255,0.05);border-radius:10px;padding:14px;text-align:center;"><div style="font-size:32px;font-weight:700;color:${scoreColor};">${score}</div><div style="font-size:11px;color:rgba(255,255,255,0.35);">Overall</div></div>
            </div>
            ${topIssues.length ? `<div style="font-size:10px;color:rgba(255,255,255,0.25);margin-bottom:10px;letter-spacing:1px;text-transform:uppercase;">Top issues</div>${topIssues.map((i: any, n: number) => `<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:12px;color:rgba(255,255,255,0.5);"><span style="color:${i.sev==='high'?'#e05555':i.sev==='medium'?'#f0b429':'#6abf69'};font-weight:700;">${n+1}. </span>${i.title}</div>`).join('')}` : ''}
            <div style="text-align:center;margin-top:20px;">
              <a href="mailto:${clientEmail}" style="display:inline-block;background:#5b3fa0;color:#fff;font-size:13px;font-weight:600;padding:10px 22px;border-radius:100px;text-decoration:none;margin-right:8px;">Reply to lead →</a>
              <a href="${url}" target="_blank" style="display:inline-block;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.6);font-size:13px;font-weight:600;padding:10px 22px;border-radius:100px;text-decoration:none;">Visit site →</a>
            </div>
          </div>
        </div>
      `);
      const ericEmailed = await emailOk(ERIC, `New Audit Lead: ${clientName} (${url}) — ${score}/100`, ericHtml);
      let leadEmailed = false;
      if (clientEmail && userConfirmHtml) leadEmailed = await emailOk(clientEmail, `Your free site score for ${clientName}`, userConfirmHtml);
      return json({ ok: true, emailed: ericEmailed, lead_emailed: leadEmailed });
    }

    // ── PROJECT COMPLETE ──
    if (type === 'project_complete') {
      const name = body.clientName || (body.client && body.client.name) || 'there';
      const email = body.clientEmail || (body.client && (body.client.contact_email || body.client.email)) || '';
      const surveyUrl = (body.meta && body.meta.survey_url) || body.message || 'https://davisdigitalstudio.com/project-survey';
      if (!email) return json({ error: 'no client email' }, 400);
      const html = notifyShell(
        `Your project is live, ${name} 🎉`,
        [
          `It's official, your project is complete and live. It's been a genuine pleasure building this with you.`,
          `Before you go, would you take one minute to tell me how it went? Your honest feedback helps me get better, and as a growing studio it means the world coming from someone I actually built for.`,
          `The survey is short, I promise, just a few quick questions.`,
        ],
        { label: 'Share your feedback →', href: surveyUrl }
      );
      const clientEmailed = await emailOk(email, `Your project is live 🎉 — one quick favor`, html);
      const ericEmailed = await emailOk(ERIC, `Project complete: ${name}`, notifyShell(`Project marked complete`, [`${name} (${email}) was marked complete and sent the satisfaction survey.`]));
      return json({ ok: true, emailed: clientEmailed, admin_emailed: ericEmailed });
    }

    if (type === 'welcome') {
      const name = body.clientName || (body.client && body.client.name) || 'there';
      const email = body.clientEmail || (body.client && (body.client.contact_email || body.client.email)) || '';
      const pass = (body.meta && body.meta.password) || (body.creds && body.creds.password) || '';
      if (!email) return json({ error: 'no client email' }, 400);
      const html = notifyShell(
        `Welcome to your project portal, ${name}`,
        [
          `Your client portal is ready. This is where you'll see project progress, share files, approve work, message me, and view invoices, all in one place.`,
          `<strong>Your login</strong><br>Email: ${email}<br>Password: ${pass || '(set in your welcome details)'}`,
          `Sign in any time at the link below. I'd recommend changing your password after your first login.`,
        ],
        { label: 'Open your portal →', href: 'https://davisdigitalstudio.com/portal' }
      );
      const clientEmailed = await emailOk(email, `Your Davis Digital Studio portal is ready`, html);
      const ericEmailed = await emailOk(ERIC, `Portal created: ${name}`, notifyShell(`New client portal created`, [`${name} (${email}) now has a portal.`]));
      return json({ ok: true, emailed: clientEmailed, admin_emailed: ericEmailed });
    }

    // ── CONTACT REPLY ──
    if (type === 'contact_reply') {
      const to = body.to || body.clientEmail;
      const name = body.name || body.clientName || 'there';
      const service = body.service || 'your project';
      if (!to) return json({ error: 'no recipient' }, 400);
      const html = notifyShell(
        `Thanks for reaching out, ${name}`,
        [
          `I got your message about ${service} and I'll get back to you personally within one business day.`,
          `In the meantime, feel free to reply to this email with anything else you'd like me to know.`,
          `— Eric Davis, Davis Digital Studio`,
        ],
        { label: 'See my work →', href: 'https://davisdigitalstudio.com/work' }
      );
      await sendEmail(to, `Thanks for reaching out to Davis Digital Studio`, html);
      return json({ ok: true });
    }

    // ===== STUDIO OS — CUSTOMERS MODULE ROUTES =====
    // lead_intake is PUBLIC; all other lead_* + home_snapshot are gated (staff)
    // at the top. The inline verifyAdminJwt checks below are kept (fail-closed,
    // redundant). Expects leads + lead_messages.

    if (type === 'lead_intake' || type === 'lead_list' || type === 'lead_detail' ||
        type === 'lead_reply' || type === 'lead_status' || type === 'lead_ai_draft' ||
        type === 'lead_delete' || type === 'home_snapshot') {

      const leadDb = async (path: string, method = 'GET', payload: unknown = null) => {
        const headers: Record<string, string> = {
          'apikey': SB_SERVICE,
          'Authorization': `Bearer ${SB_SERVICE}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        };
        const init: RequestInit = { method, headers };
        if (payload !== null && method !== 'GET' && method !== 'DELETE') init.body = JSON.stringify(payload);
        const res = await fetch(`${SB_URL}/rest/v1/${path}`, init);
        const text = await res.text();
        let data: unknown = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        return res.ok ? { ok: true, data } : { ok: false, status: res.status, detail: data };
      };

      // ── LEAD INTAKE (PUBLIC) ──
      if (type === 'lead_intake') {
        if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
        const lname    = String(body.name || '').slice(0, 200) || null;
        const lemail   = String(body.email || '').slice(0, 200) || null;
        const lphone   = String(body.phone || '').slice(0, 60) || null;
        const lsource  = ['website_form','instagram','google','phone','email','manual'].includes(body.source) ? body.source : 'website_form';
        const lsubject = String(body.subject || '').slice(0, 200) || null;
        const lmessage = String(body.message || '').slice(0, 4000) || null;
        if (!lmessage && !lsubject) return json({ error: 'message or subject required' }, 400, reqCors);

        const row = {
          name: lname, email: lemail, phone: lphone, source: lsource, subject: lsubject, message: lmessage,
          status: 'new', unread: true,
          last_message: (lmessage || lsubject || '').slice(0, 160),
          last_actor: 'them',
        };
        const created = await leadDb('leads', 'POST', row);
        if (!created.ok) return json({ error: 'lead_create_failed', detail: created.detail }, 200, reqCors);
        const lead = Array.isArray(created.data) ? created.data[0] : created.data;

        if (lead && lead.id && (lmessage || lsubject)) {
          await leadDb('lead_messages', 'POST', { lead_id: lead.id, who: 'them', body: lmessage || lsubject });
        }
        try { await sendEmail(ERIC, `New lead: ${lname || lemail || 'someone'}`,
          notifyShell('New lead in your inbox', [
            `${lname || 'Someone'} just reached out${lsubject ? ` about “${lsubject}”` : ''}.`,
            lmessage ? lmessage.slice(0, 300) : '',
          ], { label: 'Open Studio OS →', href: 'https://davisdigitalstudio.com/portal' })); } catch (_) {}

        return json({ ok: true, id: lead && lead.id }, 200, reqCors);
      }

      // ── LEAD LIST (admin) ──
      if (type === 'lead_list') {
        if (!(await verifyAdminJwt(req))) return json({ error: 'unauthorized' }, 401, reqCors);
        if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
        const lstatus = ['new','replied','won','lost'].includes(body.status) ? body.status : null;
        const filter = lstatus ? `&status=eq.${lstatus}` : '';
        const r = await leadDb(`leads?select=id,name,email,source,subject,tag,status,value_note,unread,last_message,last_actor,created_at,updated_at${filter}&order=updated_at.desc&limit=100`);
        if (!r.ok) return json({ error: 'lead_list_failed', detail: r.detail }, 200, reqCors);
        const leadsArr = Array.isArray(r.data) ? r.data : [];
        const needsYou = leadsArr.filter((l: any) => l.status === 'new').length;
        return json({ data: leadsArr, needsYou }, 200, reqCors);
      }

      // ── LEAD DETAIL (admin) ──
      if (type === 'lead_detail') {
        if (!(await verifyAdminJwt(req))) return json({ error: 'unauthorized' }, 401, reqCors);
        if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
        const id = String(body.id || '');
        if (!id) return json({ error: 'id required' }, 400, reqCors);

        const lr = await leadDb(`leads?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
        if (!lr.ok) return json({ error: 'lead_read_failed', detail: lr.detail }, 200, reqCors);
        const lead = Array.isArray(lr.data) && lr.data.length ? lr.data[0] : null;
        if (!lead) return json({ error: 'not_found' }, 404, reqCors);

        const mr = await leadDb(`lead_messages?lead_id=eq.${encodeURIComponent(id)}&select=who,body,from_ai,created_at&order=created_at.asc&limit=200`);
        const messages = mr.ok && Array.isArray(mr.data) ? mr.data : [];

        if (lead.unread) { leadDb(`leads?id=eq.${encodeURIComponent(id)}`, 'PATCH', { unread: false }).catch(() => {}); }

        return json({ data: { lead, messages } }, 200, reqCors);
      }

      // ── LEAD REPLY (admin) ──
      if (type === 'lead_reply') {
        if (!(await verifyAdminJwt(req))) return json({ error: 'unauthorized' }, 401, reqCors);
        if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
        const id   = String(body.id || '');
        const text = String(body.body || '').slice(0, 6000);
        const fromAi = !!body.from_ai;
        if (!id || !text) return json({ error: 'id and body required' }, 400, reqCors);

        const m = await leadDb('lead_messages', 'POST', { lead_id: id, who: 'me', body: text, from_ai: fromAi });
        if (!m.ok) return json({ error: 'reply_failed', detail: m.detail }, 200, reqCors);

        const lr = await leadDb(`leads?id=eq.${encodeURIComponent(id)}&select=status,replied_at,email,name&limit=1`);
        const cur = lr.ok && Array.isArray(lr.data) && lr.data.length ? lr.data[0] : {};
        const patch: Record<string, unknown> = {
          last_message: 'You: ' + text.slice(0, 150),
          last_actor: 'me',
          unread: false,
        };
        if (cur.status === 'new' || cur.status === 'replied') patch.status = 'replied';
        if (!cur.replied_at) patch.replied_at = new Date().toISOString();
        await leadDb(`leads?id=eq.${encodeURIComponent(id)}`, 'PATCH', patch);

        if (cur.email) {
          try {
            await sendEmail(cur.email, `Re: your message to Davis Digital Studio`,
              notifyShell(`A reply from Davis Digital Studio`, [text.replace(/\n/g, '<br>')]));
          } catch (_) { /* never block on email */ }
        }

        return json({ ok: true }, 200, reqCors);
      }

      // ── LEAD STATUS (admin) ──
      if (type === 'lead_status') {
        if (!(await verifyAdminJwt(req))) return json({ error: 'unauthorized' }, 401, reqCors);
        if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
        const id = String(body.id || '');
        const lstatus = body.status;
        if (!id || !['new','replied','won','lost'].includes(lstatus)) {
          return json({ error: 'id and valid status required' }, 400, reqCors);
        }
        const r = await leadDb(`leads?id=eq.${encodeURIComponent(id)}`, 'PATCH', { status: lstatus });
        if (!r.ok) return json({ error: 'status_failed', detail: r.detail }, 200, reqCors);
        return json({ ok: true }, 200, reqCors);
      }

      // ── LEAD DELETE (admin) ──
      // Removes a form lead and its conversation. Supports single id or a batch
      // of ids (for clearing out test/diagnostic rows in bulk). Deletes child
      // lead_messages first so nothing is orphaned.
      if (type === 'lead_delete') {
        if (!(await verifyAdminJwt(req))) return json({ error: 'unauthorized' }, 401, reqCors);
        if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
        let ids: string[] = [];
        if (Array.isArray(body.ids)) ids = body.ids.map((x: any) => String(x)).filter(Boolean);
        else if (body.id) ids = [String(body.id)];
        if (!ids.length) return json({ error: 'id or ids required' }, 400, reqCors);
        if (ids.length > 500) return json({ error: 'too many ids (max 500)' }, 400, reqCors);

        // PostgREST in.(...) list — encode each id.
        const inList = ids.map((x) => encodeURIComponent(x)).join(',');
        // 1) child messages first
        const mr = await leadDb(`lead_messages?lead_id=in.(${inList})`, 'DELETE');
        if (!mr.ok) return json({ error: 'messages_delete_failed', detail: mr.detail }, 200, reqCors);
        // 2) the leads themselves
        const dr = await leadDb(`leads?id=in.(${inList})`, 'DELETE');
        if (!dr.ok) return json({ error: 'lead_delete_failed', detail: dr.detail }, 200, reqCors);
        return json({ ok: true, deleted: ids.length }, 200, reqCors);
      }

      // ── LEAD AI DRAFT (admin) ──
      if (type === 'lead_ai_draft') {
        if (!(await verifyAdminJwt(req))) return json({ error: 'unauthorized' }, 401, reqCors);
        if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
        if (!ANTHROPIC_KEY) return json({ error: 'Server missing ANTHROPIC_KEY secret' }, 500, reqCors);
        const id = String(body.id || '');
        const steer = String(body.steer || '').slice(0, 600);
        if (!id) return json({ error: 'id required' }, 400, reqCors);

        const lr = await leadDb(`leads?id=eq.${encodeURIComponent(id)}&select=name,subject,tag,value_note,source&limit=1`);
        const lead = lr.ok && Array.isArray(lr.data) && lr.data.length ? lr.data[0] : {};
        const mr = await leadDb(`lead_messages?lead_id=eq.${encodeURIComponent(id)}&select=who,body&order=created_at.asc&limit=40`);
        const thread = mr.ok && Array.isArray(mr.data) ? mr.data : [];

        const system = `You are helping Eric Davis, owner of Davis Digital Studio, reply to a new customer lead in his Studio OS inbox. Write in Eric's voice: plain, warm, professional, direct. No em dashes. No corporate filler. Concise and human. Do not invent prices, dates, or commitments that aren't supported by the context, use [brackets] for anything Eric must fill in. Output ONLY the reply text, no preamble or quotes.`;
        const ctx = {
          customer: lead.name || 'the customer',
          about: lead.subject || lead.tag || 'their inquiry',
          source: lead.source,
          value: lead.value_note,
          conversation: thread.map((mm: any) => `${mm.who === 'them' ? 'Customer' : 'Eric'}: ${mm.body}`),
        };
        const userMsg = `CONTEXT (JSON):\n${JSON.stringify(ctx).slice(0, 6000)}\n\n${steer ? 'STEER: ' + steer : 'Draft a helpful first reply to the customer\'s most recent message.'}`;

        try {
          const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 700, system, messages: [{ role: 'user', content: userMsg }] }),
            signal: AbortSignal.timeout(30000),
          });
          const aiData = await aiRes.json();
          if (aiData.error) return json({ error: aiData.error.message || 'ai_error' }, 200, reqCors);
          let draft = '';
          if (Array.isArray(aiData.content)) draft = aiData.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
          draft = (draft || '').trim();

          await leadDb(`lead_messages?lead_id=eq.${encodeURIComponent(id)}&who=eq.ai_draft`, 'DELETE');
          if (draft) await leadDb('lead_messages', 'POST', { lead_id: id, who: 'ai_draft', body: draft, from_ai: true });

          return json({ draft }, 200, reqCors);
        } catch (e) {
          return json({ error: 'lead_ai_draft_failed', message: String(e) }, 200, reqCors);
        }
      }

      // ── HOME SNAPSHOT (admin) ──
      if (type === 'home_snapshot') {
        if (!(await verifyAdminJwt(req))) return json({ error: 'unauthorized' }, 401, reqCors);
        if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
        const since = new Date(Date.now() - 7 * 86400000).toISOString();

        const [all, weekNew, won] = await Promise.all([
          leadDb(`leads?select=status,unread,created_at`),
          leadDb(`leads?select=id&created_at=gte.${since}`),
          leadDb(`leads?select=id&status=eq.won&updated_at=gte.${since}`),
        ]);
        const leadsArr = all.ok && Array.isArray(all.data) ? all.data : [];
        const needsYou = leadsArr.filter((l: any) => l.status === 'new').length;
        const newThisWeek = weekNew.ok && Array.isArray(weekNew.data) ? weekNew.data.length : 0;
        const wonThisWeek = won.ok && Array.isArray(won.data) ? won.data.length : 0;

        return json({ data: {
          needsYou,
          newThisWeek,
          wonThisWeek,
          totalOpen: leadsArr.filter((l: any) => l.status === 'new' || l.status === 'replied').length,
        } }, 200, reqCors);
      }
    }
    // ===== END STUDIO OS — CUSTOMERS MODULE ROUTES =====

    // ===== AI MANAGER — HOME BRIEFING ===== (gate: staff)
    // Reads across leads + invoices + projects SERVER-SIDE, grounds the AI in
    // real rows, returns a prioritized briefing.
    if (type === 'home_brief') {
      if (!(await verifyAdminJwt(req))) return json({ error: 'unauthorized' }, 401, reqCors);
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);

      const svc = { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` };
      const readTable = async (path: string) => {
        try {
          const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: svc });
          if (!r.ok) return [];
          const d = await r.json();
          return Array.isArray(d) ? d : [];
        } catch (_) { return []; }
      };

      const since7 = new Date(Date.now() - 7 * 86400000).toISOString();
      const [leadsRows, invoiceRows, projectRows, approvalRows, messageRows, clientRows] = await Promise.all([
        readTable(`leads?select=id,name,email,subject,status,unread,last_actor,last_message,created_at,updated_at&order=updated_at.desc&limit=100`),
        readTable(`invoices?select=id,amount,status,due_date,created_at,clients(name,contact_email)&deleted_at=is.null&order=created_at.desc&limit=100`),
        readTable(`projects?select=id,name,stage,ball_in_court,progress,updated_at,contacts(name,email)&stage=neq.complete&deleted_at=is.null&order=updated_at.asc&limit=100`),
        readTable(`approvals?select=id,client_id,title,status,created_at&status=eq.pending&deleted_at=is.null&order=created_at.asc&limit=100`),
        readTable(`messages?select=id,client_id,from_who,text,created_at&deleted_at=is.null&order=created_at.desc&limit=200`),
        readTable(`clients?select=id,name&deleted_at=is.null&limit=200`),
      ]);

      const now = Date.now();
      const daysSince = (iso: string) => iso ? Math.floor((now - new Date(iso).getTime()) / 86400000) : null;
      const clientName = (cid: any) => {
        const c = clientRows.find((x: any) => String(x.id) === String(cid));
        return (c && c.name) || 'Client';
      };

      const leadsNeedingReply = leadsRows
        .filter((l: any) => l.status === 'new' || (l.unread && l.last_actor === 'them'))
        .map((l: any) => ({ id: l.id, name: l.name || l.email || 'Lead', subject: l.subject || '', waitingDays: daysSince(l.created_at), kind: 'lead' }));

      const invoicesOutstanding = invoiceRows
        .filter((i: any) => i.status && i.status !== 'paid')
        .map((i: any) => {
          const od = i.due_date ? daysSince(i.due_date) : null;
          return {
            id: i.id, client: (i.clients && i.clients.name) || 'Client', amount: i.amount,
            status: i.status, overdueDays: (od !== null && od > 0) ? od : 0, isOverdue: (od !== null && od > 0), kind: 'invoice',
          };
        })
        .sort((a: any, b: any) => b.overdueDays - a.overdueDays);

      const projectsStalled = projectRows
        .map((p: any) => ({
          id: p.id, name: p.name || ((p.contacts && p.contacts.name) ? p.contacts.name + "'s project" : 'Project'),
          stage: p.stage, ballInCourt: p.ball_in_court, idleDays: daysSince(p.updated_at), kind: 'project',
        }))
        .filter((p: any) => p.idleDays !== null && p.idleDays >= 3);

      const approvalsWaiting = approvalRows.map((a: any) => ({
        id: a.id, client: clientName(a.client_id), title: a.title || 'Deliverable',
        waitingDays: daysSince(a.created_at), kind: 'approval',
      }));

      const latestByClient: Record<string, any> = {};
      messageRows.forEach((m: any) => { if (!latestByClient[m.client_id]) latestByClient[m.client_id] = m; });
      const messagesNeedingReply = Object.values(latestByClient)
        .filter((m: any) => m.from_who === 'client')
        .map((m: any) => ({
          id: m.client_id, client: clientName(m.client_id),
          preview: String(m.text || '').slice(0, 80), waitingDays: daysSince(m.created_at), kind: 'message',
        }));

      const snapshot = {
        today: new Date().toISOString().slice(0, 10),
        counts: {
          leadsNeedingReply: leadsNeedingReply.length,
          invoicesOutstanding: invoicesOutstanding.length,
          invoicesOverdue: invoicesOutstanding.filter((i: any) => i.isOverdue).length,
          projectsStalled: projectsStalled.length,
          approvalsWaiting: approvalsWaiting.length,
          messagesNeedingReply: messagesNeedingReply.length,
        },
        leadsNeedingReply: leadsNeedingReply.slice(0, 12),
        invoicesOutstanding: invoicesOutstanding.slice(0, 12),
        projectsStalled: projectsStalled.slice(0, 12),
        approvalsWaiting: approvalsWaiting.slice(0, 12),
        messagesNeedingReply: messagesNeedingReply.slice(0, 12),
      };

      const totalNeedsYou = leadsNeedingReply.length + invoicesOutstanding.length + projectsStalled.length
        + approvalsWaiting.length + messagesNeedingReply.length;
      if (totalNeedsYou === 0) {
        return json({ data: {
          verdict: "You're all caught up. Nothing needs you right now.",
          items: [],
          counts: snapshot.counts,
        } }, 200, reqCors);
      }

      if (!ANTHROPIC_KEY) {
        const items: any[] = [];
        leadsNeedingReply.slice(0, 4).forEach((l: any) => items.push({
          title: `Reply to ${l.name}`, detail: l.subject ? `About: ${l.subject}` : 'New inquiry waiting',
          go: 'leads', refId: l.id, canDraft: true, kind: 'lead',
        }));
        messagesNeedingReply.slice(0, 3).forEach((m: any) => items.push({
          title: `${m.client} is waiting on a reply`, detail: m.preview || 'Sent you a message',
          go: 'messages', refId: '', canDraft: false, kind: 'message',
        }));
        invoicesOutstanding.slice(0, 3).forEach((i: any) => items.push({
          title: `Invoice for ${i.client}`, detail: i.isOverdue ? `${i.overdueDays} days overdue` : `${i.status}`,
          go: 'invoices', refId: i.id, canDraft: false, kind: 'invoice',
        }));
        approvalsWaiting.slice(0, 2).forEach((a: any) => items.push({
          title: `${a.client}: ${a.title}`, detail: `Waiting on their review${a.waitingDays ? `, ${a.waitingDays}d` : ''}`,
          go: 'approvals', refId: '', canDraft: false, kind: 'approval',
        }));
        projectsStalled.slice(0, 2).forEach((p: any) => items.push({
          title: `${p.name} is stalled`, detail: `Stage ${p.stage}, idle ${p.idleDays}d, ball in ${p.ballInCourt || 'your'} court`,
          go: 'projects', refId: p.id, canDraft: false, kind: 'project',
        }));
        return json({ data: {
          verdict: `You have ${totalNeedsYou} thing${totalNeedsYou > 1 ? 's' : ''} that need you today.`,
          items: items.slice(0, 6), counts: snapshot.counts,
        } }, 200, reqCors);
      }

      const system = `You are the operations manager for Eric Davis, who runs Davis Digital Studio solo. You are given a factual snapshot of his whole business right now: leads needing replies, client messages awaiting his reply, outstanding and overdue invoices, deliverables awaiting client approval, and stalled projects. Your job: write a short, calm briefing of what actually needs him today.

Voice: warm, direct, human. You are his manager, not a dashboard. No em dashes. No corporate filler. Never invent anything not in the snapshot.

Presentation rule for a busy day: surface the 3 to 5 MOST important items as their own rows, and roll up everything else into the verdict sentence (e.g. "...plus 3 more invoices and 2 stalled projects"). Do not list more than 5 items even if there are more; the verdict carries the rest.

Priority order (highest first): 1) overdue invoices (the more days overdue, the more urgent), 2) leads needing a reply, 3) client messages awaiting reply, 4) approvals the client has left sitting, 5) stalled projects, 6) non-overdue unpaid invoices.

Respond with ONLY a JSON object, no markdown, no backticks, in EXACTLY this shape:
{
  "verdict": "one warm sentence; if there are more items than you listed, summarize the remainder here",
  "items": [
    {
      "title": "short action, under 8 words",
      "detail": "one specific line grounded in the snapshot",
      "go": "leads | invoices | projects | approvals | messages",
      "refId": "the id from the snapshot this points to, or empty string",
      "canDraft": true or false,
      "kind": "lead | invoice | project | approval | message"
    }
  ]
}
Rules: at most 5 items. "go" and "kind" must match the source. "refId" must be a real id from the snapshot, or empty string. Set "canDraft" true ONLY for leads. For overdue invoices, state the days overdue in the detail. If something is fine, leave it out.`;

      const userMsg = `SNAPSHOT (JSON):\n${JSON.stringify(snapshot).slice(0, 6500)}`;

      try {
        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1000, system, messages: [{ role: 'user', content: userMsg }] }),
          signal: AbortSignal.timeout(30000),
        });
        const aiData = await aiRes.json();
        if (aiData.error) return json({ error: aiData.error.message || 'ai_error', counts: snapshot.counts }, 200, reqCors);
        let text = '';
        if (Array.isArray(aiData.content)) text = aiData.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
        text = (text || '').trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
        let parsed: any = null;
        try { parsed = JSON.parse(text); } catch (_e) { parsed = null; }
        if (!parsed || !Array.isArray(parsed.items)) {
          return json({ data: { verdict: `You have ${totalNeedsYou} thing${totalNeedsYou > 1 ? 's' : ''} that need you today.`, items: [], counts: snapshot.counts } }, 200, reqCors);
        }
        const ALLOWED_GO = new Set(['leads', 'invoices', 'projects', 'approvals', 'messages']);
        const ALLOWED_KIND = ['lead', 'invoice', 'project', 'approval', 'message'];
        const validIds = new Set([
          ...leadsNeedingReply.map((l: any) => String(l.id)),
          ...invoicesOutstanding.map((i: any) => String(i.id)),
          ...projectsStalled.map((p: any) => String(p.id)),
        ]);
        parsed.items = parsed.items.slice(0, 5).map((it: any) => {
          const refId = it.refId && validIds.has(String(it.refId)) ? String(it.refId) : '';
          return {
            title: String(it.title || '').slice(0, 120),
            detail: String(it.detail || '').slice(0, 220),
            go: ALLOWED_GO.has(it.go) ? it.go : '',
            refId,
            canDraft: it.kind === 'lead' && !!refId,
            kind: ALLOWED_KIND.includes(it.kind) ? it.kind : '',
          };
        });
        return json({ data: {
          verdict: String(parsed.verdict || '').slice(0, 280) || `You have ${totalNeedsYou} thing${totalNeedsYou > 1 ? 's' : ''} that need you today.`,
          items: parsed.items,
          counts: snapshot.counts,
        } }, 200, reqCors);
      } catch (e) {
        return json({ error: 'home_brief_failed', message: String(e), counts: snapshot.counts }, 200, reqCors);
      }
    }
    // ===== END AI MANAGER — HOME BRIEFING =====

    // ===== VISIBILITY — SITE HEALTH MONITORING ===== (gate: staff)
    if (type === 'visibility_list' || type === 'visibility_check' ||
        type === 'visibility_add' || type === 'visibility_remove' || type === 'visibility_sync_clients') {
      if (!(await verifyAdminJwt(req))) return json({ error: 'unauthorized' }, 401, reqCors);
      if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);

      const visSvc = { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' };
      const visDb = async (path: string, method = 'GET', payload: any = null) => {
        try {
          const opts: any = { method, headers: { ...visSvc, 'Prefer': 'return=representation' } };
          if (payload) opts.body = JSON.stringify(payload);
          const r = await fetch(`${SB_URL}/rest/v1/${path}`, opts);
          const d = await r.json().catch(() => null);
          return { ok: r.ok, status: r.status, data: d, detail: r.ok ? null : d };
        } catch (e) { return { ok: false, status: 0, data: null, detail: String(e) }; }
      };

      // ── LIST: every monitored site with its latest two checks (for trend) ──
      if (type === 'visibility_list') {
        const sr = await visDb(`monitored_sites?select=*&order=created_at.asc`);
        if (!sr.ok) return json({ error: 'sites_read_failed', detail: sr.detail }, 200, reqCors);
        const sites = Array.isArray(sr.data) ? sr.data : [];
        const out: any[] = [];
        for (const s of sites) {
          const cr = await visDb(`site_checks?site_id=eq.${s.id}&select=overall,performance,mobile,visibility,local,https,ok,error,checked_at&order=checked_at.desc&limit=2`);
          const checks = (cr.ok && Array.isArray(cr.data)) ? cr.data : [];
          out.push({ site: s, latest: checks[0] || null, previous: checks[1] || null });
        }
        return json({ data: out }, 200, reqCors);
      }

      // ── ADD: a site to the watchlist (manual) ──
      if (type === 'visibility_add') {
        let url = String(body.url || '').trim();
        const label = String(body.label || '').trim();
        if (!url) return json({ error: 'url required' }, 400, reqCors);
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url.replace(/^\/+/, '');
        const row = { label: label || url.replace(/^https?:\/\//, '').replace(/\/.*$/, ''), url, source: body.source === 'self' ? 'self' : 'manual', client_id: body.client_id || null };
        const ir = await visDb(`monitored_sites`, 'POST', row);
        if (!ir.ok) {
          const dup = ir.detail && JSON.stringify(ir.detail).includes('duplicate');
          return json({ error: dup ? 'already_watching' : 'add_failed', detail: ir.detail }, 200, reqCors);
        }
        return json({ data: Array.isArray(ir.data) ? ir.data[0] : ir.data }, 200, reqCors);
      }

      // ── REMOVE: drop a site (cascade removes its checks) ──
      if (type === 'visibility_remove') {
        const id = String(body.id || '');
        if (!id) return json({ error: 'id required' }, 400, reqCors);
        const dr = await visDb(`monitored_sites?id=eq.${encodeURIComponent(id)}`, 'DELETE');
        if (!dr.ok) return json({ error: 'remove_failed', detail: dr.detail }, 200, reqCors);
        return json({ ok: true }, 200, reqCors);
      }

      // ── SYNC CLIENTS: ensure every client with a site is on the watchlist ──
      if (type === 'visibility_sync_clients') {
        const cr = await fetch(`${SB_URL}/rest/v1/clients?select=id,name,website,url,site_url,domain&deleted_at=is.null&limit=500`, { headers: visSvc });
        const clients = cr.ok ? (await cr.json().catch(() => [])) : [];
        const existing = await visDb(`monitored_sites?select=url,client_id`);
        const have = new Set((existing.ok && Array.isArray(existing.data) ? existing.data : []).map((x: any) => String(x.url || '').toLowerCase()));
        let added = 0;
        for (const c of (Array.isArray(clients) ? clients : [])) {
          let u = c.website || c.url || c.site_url || c.domain || '';
          if (!u) continue;
          u = String(u).trim();
          if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
          if (have.has(u.toLowerCase())) continue;
          const ir = await visDb(`monitored_sites`, 'POST', { label: c.name || u, url: u, source: 'client', client_id: c.id });
          if (ir.ok) { added++; have.add(u.toLowerCase()); }
        }
        return json({ data: { added } }, 200, reqCors);
      }

      // ── CHECK: run a real health audit on one site, store the result ──
      if (type === 'visibility_check') {
        const id = String(body.id || '');
        if (!id) return json({ error: 'id required' }, 400, reqCors);
        const sr = await visDb(`monitored_sites?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
        const site = (sr.ok && Array.isArray(sr.data) && sr.data[0]) ? sr.data[0] : null;
        if (!site) return json({ error: 'site_not_found' }, 200, reqCors);
        const url = site.url;

        let perfScore: number | null = null, seoScore: number | null = null, a11yScore: number | null = null;
        let lcp: string | null = null, cls: string | null = null;
        if (PSI_KEY) {
          try {
            const psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance&category=seo&category=accessibility&key=${PSI_KEY}`;
            const pr = await fetch(psiUrl, { signal: AbortSignal.timeout(90000) });
            const pd = await pr.json();
            if (!pd.error && pd.lighthouseResult) {
              const cats = pd.lighthouseResult.categories || {};
              perfScore = cats.performance ? Math.round(cats.performance.score * 100) : null;
              seoScore = cats.seo ? Math.round(cats.seo.score * 100) : null;
              a11yScore = cats.accessibility ? Math.round(cats.accessibility.score * 100) : null;
              const audits = pd.lighthouseResult.audits || {};
              lcp = audits['largest-contentful-paint'] ? audits['largest-contentful-paint'].displayValue : null;
              cls = audits['cumulative-layout-shift'] ? audits['cumulative-layout-shift'].displayValue : null;
            }
          } catch (_) { /* PSI may time out; pillars below still compute from deepAudit */ }
        }

        let audit: any = null;
        try { audit = await deepAudit(url); } catch (_) { audit = null; }

        if (perfScore === null && !audit) {
          const fail = { site_id: id, ok: false, error: 'Could not reach site or score it (PSI + fetch both failed).' };
          await visDb(`site_checks`, 'POST', fail);
          await visDb(`monitored_sites?id=eq.${encodeURIComponent(id)}`, 'PATCH', { updated_at: new Date().toISOString() });
          return json({ data: { ok: false, error: fail.error } }, 200, reqCors);
        }

        const op = (audit && audit.onPage) || {};
        const sc = (audit && audit.schema) || {};
        const lc = (audit && audit.local) || {};
        const dc = (audit && audit.discoverability) || {};
        const https = audit ? !!audit.https : null;

        const performance = perfScore;
        const mobile = a11yScore;

        const onPageSignals = [
          op.titleLength >= 25 && op.titleLength <= 65,
          op.metaDescriptionLength >= 80 && op.metaDescriptionLength <= 170,
          op.h1Count === 1,
          !!op.canonical,
          (op.wordCount || 0) >= 200,
          !!(op.ogTitle && op.ogDescription && op.ogImage),
          !!dc.sitemapXml,
          !!dc.robotsTxt && !dc.robotsTxtBlocksAll,
        ];
        const onPagePct = Math.round((onPageSignals.filter(Boolean).length / onPageSignals.length) * 100);
        const visibility = (seoScore !== null) ? Math.round(seoScore * 0.6 + onPagePct * 0.4) : onPagePct;

        const localSignals = [
          !!lc.phoneOnPage,
          !!lc.zipOnPage,
          !!lc.hoursMentioned,
          !!lc.googleMapsEmbed,
          (lc.socialLinks || []).length >= 2,
          !!sc.hasLocalBusiness,
          !!https,
        ];
        const local = Math.round((localSignals.filter(Boolean).length / localSignals.length) * 100);

        const present = [performance, mobile, visibility, local].filter((x) => typeof x === 'number') as number[];
        const overall = present.length ? Math.round(present.reduce((a, b) => a + b, 0) / present.length) : null;

        const findings: any[] = [];
        if (performance !== null && performance < 50) findings.push({ sev: 'high', title: 'Slow page load on mobile' });
        if (https === false) findings.push({ sev: 'high', title: 'Not served over HTTPS' });
        if (op.h1Count !== 1) findings.push({ sev: 'medium', title: `H1 count is ${op.h1Count || 0} (should be 1)` });
        if (!op.canonical) findings.push({ sev: 'low', title: 'Missing canonical tag' });
        if (!sc.hasLocalBusiness) findings.push({ sev: 'medium', title: 'No LocalBusiness schema' });
        if (!dc.sitemapXml) findings.push({ sev: 'low', title: 'No sitemap.xml found' });

        const checkRow = {
          site_id: id, overall, performance, mobile, visibility, local, https,
          findings: findings.slice(0, 8),
          raw: { psi: { perfScore, seoScore, a11yScore, lcp, cls }, onPagePct },
          ok: true, error: null,
        };
        const ins = await visDb(`site_checks`, 'POST', checkRow);
        if (!ins.ok) return json({ error: 'check_store_failed', detail: ins.detail }, 200, reqCors);
        await visDb(`monitored_sites?id=eq.${encodeURIComponent(id)}`, 'PATCH', { updated_at: new Date().toISOString() });
        return json({ data: { ok: true, overall, performance, mobile, visibility, local, https, findings: checkRow.findings } }, 200, reqCors);
      }
    }
    // ===== END VISIBILITY — SITE HEALTH MONITORING =====

    // ── GENERIC NOTIFY ──
    if (type && (body.clientName !== undefined || body.message !== undefined || body.subject !== undefined)) {
      const name = body.clientName || (body.client && body.client.name) || 'A client';
      const subject = body.subject || '';
      const message = body.message || '';
      const pretty = String(type).replace(/_/g, ' ');
      const toClient = String(type).startsWith('eric_') || type === 'approval_needed' || type === 'invoice_reminder';
      const recipient = toClient
        ? (body.clientEmail || (body.client && (body.client.contact_email || body.client.email)) || '')
        : ERIC;
      if (!recipient) return json({ ok: true, skipped: 'no recipient' });
      const heading = toClient ? `Update on your project` : `${name}: ${pretty}`;
      const lines = [
        subject ? `<strong>${subject}</strong>` : '',
        message ? message.replace(/\n/g, '<br>') : '',
      ].filter(Boolean);
      const cta = toClient
        ? { label: 'Open your portal →', href: 'https://davisdigitalstudio.com/portal' }
        : { label: 'Open admin →', href: 'https://davisdigitalstudio.com/dds-studio-manage-9k2p' };
      await sendEmail(recipient, toClient ? `Update on your project` : `${pretty} — ${name}`, notifyShell(heading, lines.length ? lines : ['(no details)'], cta));
      return json({ ok: true });
    }

    // ===== AI WEBSITE REVIEW + CONCIERGE ROUTES ===== (public)
    if (type === 'ai_critique') {
      const { url, businessType, goal } = body;
      if (!url) return json({ error: 'No URL provided' }, 400);
      if (!ANTHROPIC_KEY) return json({ error: 'Server missing ANTHROPIC_KEY secret' }, 500);
      try {
        const data = await aiCritique(url, businessType || 'a small business', goal || 'getting more customers');
        if (data.error) return json({ error: data.error, message: data.message || null });
        try {
          const key = SB_SERVICE || Deno.env.get('SUPABASE_ANON_KEY') || '';
          if (key) {
            await fetch(`${SB_URL}/rest/v1/audit_leads`, {
              method: 'POST',
              headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
              body: JSON.stringify({
                tool: 'ai_critique',
                business_name: (data && data.domain) ? data.domain : null,
                url: url || null,
                business_type: businessType || null,
                findings: { goal: goal || null, summary: (data && data.summary) ? data.summary : null },
              }),
            });
          }
        } catch (_) { /* never block the review on logging */ }
        return json({ data });
      } catch (e) {
        return json({ error: 'ai_critique_failed', message: String(e) });
      }
    }

    if (type === 'ai_critique_email') {
      const { email, url, result } = body;
      if (!email || !result) return json({ error: 'email and result required' }, 400);
      const domain = (result && result.domain) ? result.domain : (url || 'your site');
      try {
        const visitorEmailed = await emailOk(email, `Your free website review for ${domain}`, critiqueEmailHtml(domain, result));
        const ericEmailed = await emailOk(ERIC, `New AI review run: ${domain}`, notifyShell(
          'Someone just ran a free AI review',
          [
            `Site: ${domain}`,
            `They asked for a copy at: ${email}`,
            `Headline: ${result.headline || '(none)'}`,
          ],
          { label: 'Open admin', href: 'https://davisdigitalstudio.com/dds-studio-manage-9k2p' }
        ));
        return json({ ok: true, emailed: visitorEmailed, admin_emailed: ericEmailed });
      } catch (e) {
        return json({ error: 'email_failed', message: String(e), emailed: false });
      }
    }

    if (type === 'concierge') {
      const { messages } = body;
      if (!Array.isArray(messages)) return json({ error: 'messages array required' }, 400);
      if (!ANTHROPIC_KEY) return json({ error: 'Server missing ANTHROPIC_KEY secret' }, 500);
      try {
        const out = await conciergeChat(messages);
        return json({ data: out });
      } catch (e) {
        return json({ error: 'concierge_failed', message: String(e) });
      }
    }

    // ── DIGITAL REPORT CARD REQUEST ── (public)
    if (type === 'report_card') {
      const name = String(body.name || '').trim();
      const email = String(body.email || '').trim();
      const city = String(body.city || '').trim();
      const url = String(body.url || '').trim();
      if (!email) return json({ error: 'email required' }, 400);

      try {
        const key = SB_SERVICE || Deno.env.get('SUPABASE_ANON_KEY') || '';
        if (key) {
          await fetch(`${SB_URL}/rest/v1/audit_leads`, {
            method: 'POST',
            headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({
              tool: 'report_card',
              business_name: name || null,
              client_email: email,
              url: url || null,
              city: city || null,
            }),
          });
        }
      } catch (_e) { /* lead capture is best-effort */ }

      let visitorEmailed = false;
      try {
        visitorEmailed = await emailOk(
          email,
          'Your Digital Report Card is on the way',
          notifyShell(
            'Your Digital Report Card is on the way',
            [
              `Thanks${name ? ', ' + name : ''}! I've received your request and I'm putting together your free Digital Report Card now.`,
              'Expect it within a few minutes. If you don\'t see it, check your spam folder, or just reply to this email and I\'ll resend it.',
            ],
          ),
        );
      } catch (_e) { /* don't fail the request on visitor email */ }

      let ericEmailed = false;
      try {
        ericEmailed = await emailOk(
          ERIC,
          `Report Card request: ${name || email}`,
          notifyShell(
            'New Digital Report Card request',
            [
              `Business: ${name || '(not provided)'}`,
              `Email: ${email}`,
              `City: ${city || '(not provided)'}`,
              `Website: ${url || '(not provided)'}`,
            ],
            { label: 'Open admin', href: 'https://davisdigitalstudio.com/dds-studio-manage-9k2p' },
          ),
        );
      } catch (_e) { /* don't fail the request on notify email */ }

      return json({ ok: true, emailed: visitorEmailed, admin_emailed: ericEmailed });
    }

    // ── DISCOVERY INTAKE (start.html) ──
    // start.html already writes the intake row directly via PostgREST; this
    // route's job is the email heads-up to Eric + a confirmation to the
    // submitter. Returns a truthful { emailed } flag so the form can show a
    // calm fallback if the notify failed.
    if (type === 'discovery_intake') {
      const name = String(body.clientName || '').trim();
      const email = String(body.clientEmail || '').trim();
      const subject = String(body.subject || '').trim();
      const message = String(body.message || '').trim();

      const lines = message ? message.split('\n').filter((l: string) => l.trim().length) : [];
      let ericEmailed = false;
      try {
        ericEmailed = await emailOk(
          ERIC,
          subject || `New discovery intake: ${name || email || 'a visitor'}`,
          notifyShell(
            'New discovery intake',
            [
              `From: ${name || '(no name)'}${email ? ' · ' + email : ''}`,
              ...(lines.length ? lines : ['(no details provided)']),
            ],
            { label: 'Open admin', href: 'https://davisdigitalstudio.com/dds-studio-manage-9k2p' },
          ),
        );
      } catch (_e) { /* never fail the form on the notify email */ }

      // best-effort confirmation to the submitter (does not affect the result)
      if (email) {
        try {
          await sendEmail(
            email,
            `Thanks${name ? ', ' + name : ''} — I got your project details`,
            notifyShell(
              `Thanks${name ? ', ' + name : ''}`,
              [
                `I've received your project details and I'll be in touch personally within one business day.`,
                `If anything is time-sensitive, just reply to this email and it comes straight to me.`,
              ],
            ),
          );
        } catch (_e) { /* ignore */ }
      }

      // ── Pipeline entry: also create a `leads` row so discovery intakes land
      // in the unified Studio OS pipeline (alongside contact + audit leads),
      // not just the standalone discovery_intake table. The rich structured
      // payload stays in discovery_intake; this is the pipeline-visible record.
      let leadId: string | null = null;
      if (SB_SERVICE && (name || email)) {
        try {
          const r = await fetch(`${SB_URL}/rest/v1/leads`, {
            method: 'POST',
            headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
            body: JSON.stringify({
              name: name || null,
              email: email || null,
              source: 'website_form',
              tag: 'discovery',
              subject: subject || `Discovery intake: ${name || email || 'a visitor'}`,
              message: message || null,
              status: 'new',
              unread: true,
              last_message: (message || subject || '').slice(0, 160),
              last_actor: 'them',
            }),
          });
          if (r.ok) { const rows = await r.json(); leadId = Array.isArray(rows) && rows[0] ? String(rows[0].id) : null; }
          else { console.error('[discovery_intake] leads insert failed', r.status, (await r.text()).slice(0, 200)); }
          if (leadId) {
            await fetch(`${SB_URL}/rest/v1/lead_messages`, {
              method: 'POST',
              headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
              body: JSON.stringify({ lead_id: leadId, who: 'them', body: message || subject || '' }),
            });
          }
        } catch (e) { console.error('[discovery_intake] pipeline entry threw', String(e)); }
      }

      // ok:true means the request was handled; emailed reflects the Eric notify
      return json({ ok: true, emailed: ericEmailed, lead_id: leadId });
    }

    // ── PROJECT SURVEY (project-survey.html) ──
    // Sends the survey responses to Eric. Returns a truthful { emailed } flag.
    if (type === 'survey_response') {
      const name = String(body.clientName || '').trim();
      const email = String(body.clientEmail || '').trim();
      const subject = String(body.subject || '').trim();
      const message = String(body.message || '').trim();

      const lines = message ? message.split('\n').filter((l: string) => l.trim().length) : [];
      let ericEmailed = false;
      try {
        ericEmailed = await emailOk(
          ERIC,
          subject || `New project survey response${name ? ': ' + name : ''}`,
          notifyShell(
            'New project survey response',
            [
              `From: ${name || '(no name)'}${email ? ' · ' + email : ''}`,
              ...(lines.length ? lines : ['(no details provided)']),
            ],
            { label: 'Open admin', href: 'https://davisdigitalstudio.com/dds-studio-manage-9k2p' },
          ),
        );
      } catch (_e) { /* ignore */ }

      return json({ ok: true, emailed: ericEmailed });
    }

    // ── AI: DRAFT A REPLY (admin panel) ── (gate: staff)
    if (type === 'ai_draft_reply') {
      if (!ANTHROPIC_KEY) return json({ error: 'Server missing ANTHROPIC_KEY secret' }, 500);
      const ctx = body.context || {};
      const steer = String(body.steer || '').slice(0, 600);
      const system = `You are helping Eric Davis, owner of Davis Digital Studio (a Los Angeles web design studio), draft a reply to a client in his client portal. Write in Eric's voice: plain, warm, professional, and direct. No em dashes. No corporate filler. Keep it concise and human. Do not invent commitments, prices, dates, or deliverables that are not supported by the context. If something needs Eric's input, write a natural placeholder in [brackets]. Output ONLY the reply text, with no preamble, quotes, or sign-off boilerplate beyond a simple "— Eric" if a sign-off fits.`;
      const userMsg = `CONTEXT (JSON):\n${JSON.stringify(ctx).slice(0, 6000)}\n\n${steer ? 'STEER (what Eric wants this reply to do): ' + steer : 'Draft a helpful, appropriate reply to the most recent client message.'}`;
      try {
        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 700, system, messages: [{ role: 'user', content: userMsg }] }),
          signal: AbortSignal.timeout(30000),
        });
        const aiData = await aiRes.json();
        if (aiData.error) return json({ error: aiData.error.message || 'ai_error' }, 200);
        let text = '';
        if (Array.isArray(aiData.content)) text = aiData.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
        return json({ reply: (text || '').trim() });
      } catch (e) {
        return json({ error: 'ai_draft_failed', message: String(e) }, 200);
      }
    }

    // ── AI: DASHBOARD TRIAGE (admin panel) ── (gate: staff)
    if (type === 'ai_triage') {
      if (!ANTHROPIC_KEY) return json({ error: 'Server missing ANTHROPIC_KEY secret' }, 500);
      const snapshot = body.snapshot || {};
      const system = `You are a sharp operations assistant for Eric Davis, who runs Davis Digital Studio solo. Given a snapshot of his clients, leads, and invoices, identify what actually needs his attention today and put it in priority order. Be specific and brief. No em dashes. Respond with ONLY a JSON object, no markdown, no backticks, in exactly this shape:
{"summary":"one short sentence","items":[{"title":"short action","detail":"one line of why/what","go":"clients|leads|invoices|messages or empty string"}]}
Rules: at most 5 items. "go" must be one of clients, leads, invoices, messages, or an empty string. If nothing is urgent, return a calm summary and an empty items array. Never invent data that is not in the snapshot.`;
      const userMsg = `SNAPSHOT (JSON):\n${JSON.stringify(snapshot).slice(0, 6000)}`;
      try {
        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 700, system, messages: [{ role: 'user', content: userMsg }] }),
          signal: AbortSignal.timeout(30000),
        });
        const aiData = await aiRes.json();
        if (aiData.error) return json({ error: aiData.error.message || 'ai_error' }, 200);
        let text = '';
        if (Array.isArray(aiData.content)) text = aiData.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
        text = (text || '').trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
        let parsed: any = null;
        try { parsed = JSON.parse(text); } catch (_e) { parsed = null; }
        if (!parsed || !Array.isArray(parsed.items)) return json({ summary: '', items: [] });
        const ALLOWED_GO = new Set(['clients', 'leads', 'invoices', 'messages', '']);
        parsed.items = parsed.items.slice(0, 5).map((it: any) => ({
          title: String(it.title || '').slice(0, 140),
          detail: String(it.detail || '').slice(0, 200),
          go: ALLOWED_GO.has(it.go) ? it.go : '',
        }));
        return json({ summary: String(parsed.summary || '').slice(0, 240), items: parsed.items });
      } catch (e) {
        return json({ error: 'ai_triage_failed', message: String(e) }, 200);
      }
    }

    // ── AI: PROJECT HELP (client portal) ── (public to logged-in clients; own context)
    if (type === 'ai_project_help') {
      if (!ANTHROPIC_KEY) return json({ error: 'Server missing ANTHROPIC_KEY secret' }, 500);
      const ctx = body.context || {};
      const history = Array.isArray(body.messages)
        ? body.messages
            .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
            .slice(-10)
            .map((m: any) => ({ role: m.role, content: m.content.slice(0, 1500) }))
        : [];
      const system = `You are the project assistant inside the Davis Digital Studio client portal, helping a specific logged-in client understand the status of their own web project. Eric Davis is the designer. Answer ONLY from the project context provided below. Be warm, plain, and concise. No em dashes. If the answer is not in the context, say so honestly and suggest they message Eric directly from the Messages tab rather than guessing. Never invent timelines, prices, or commitments.

PROJECT CONTEXT (JSON):
${JSON.stringify(ctx).slice(0, 6000)}`;
      const msgs = history.length ? history : [{ role: 'user', content: 'What is the current status of my project?' }];
      try {
        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 600, system, messages: msgs }),
          signal: AbortSignal.timeout(30000),
        });
        const aiData = await aiRes.json();
        if (aiData.error) return json({ error: aiData.error.message || 'ai_error' }, 200);
        let text = '';
        if (Array.isArray(aiData.content)) text = aiData.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
        return json({ reply: (text || '').trim() });
      } catch (e) {
        return json({ error: 'ai_project_help_failed', message: String(e) }, 200);
      }
    }

    // ── SCHEDULED JOBS ── (secret-gated, not role-gated)
    if (type === 'run_scheduled_jobs') {
      if (!SCHEDULER_SECRET || body.secret !== SCHEDULER_SECRET) {
        return json({ error: 'unauthorized' }, 401, reqCors);
      }
      if (!SB_SERVICE) return json({ error: 'Server missing SERVICE_ROLE_KEY secret' }, 500, reqCors);

      const now = Date.now();
      const DAY = 86400000;
      const result = { surveys_sent: 0, nudges_sent: 0, errors: [] as string[] };

      const stampClient = async (id: string, patch: Record<string, unknown>) => {
        await fetch(`${SB_URL}/rest/v1/clients?id=eq.${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify(patch),
        });
      };

      let clients: any[] = [];
      try {
        const r = await fetch(
          `${SB_URL}/rest/v1/clients?select=id,name,contact_email,email,launched_at,survey_sent_at,content_due_at,content_received_at,last_content_nudge_at,automation_paused&deleted_at=is.null`,
          { headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` } },
        );
        if (!r.ok) return json({ error: 'clients_read_failed', status: r.status }, 200, reqCors);
        clients = await r.json();
      } catch (e) {
        return json({ error: 'clients_read_error', message: String(e) }, 200, reqCors);
      }

      for (const c of (Array.isArray(clients) ? clients : [])) {
        const to = c.contact_email || c.email || '';
        if (!to || c.automation_paused) continue;
        const name = c.name || 'there';

        try {
          if (c.launched_at && !c.survey_sent_at) {
            const launchedMs = new Date(c.launched_at).getTime();
            if (!isNaN(launchedMs) && now - launchedMs >= SURVEY_DELAY_DAYS * DAY) {
              const surveyUrl = `https://davisdigitalstudio.com/project-survey?c=${encodeURIComponent(c.id)}&n=${encodeURIComponent(name)}`;
              const lines = [
                `Hope you're enjoying the new site. As a growing studio, a few honest words from someone I actually built for means more than anything I could say about myself.`,
                `Would you take one minute to tell me how it went? The survey is short, I promise.`,
              ];
              if (GOOGLE_REVIEW_LINK) {
                lines.push(`And if you're up for it, a quick Google review helps me more than you'd think: ${GOOGLE_REVIEW_LINK}`);
              }
              lines.push(`If anything fell short, I'd genuinely want to hear that too so I can do better.`);
              await sendEmail(
                to,
                `One quick favor, ${name}`,
                notifyShell(`How did it go, ${name}?`, lines, { label: 'Share your feedback →', href: surveyUrl }),
              );
              await stampClient(c.id, { survey_sent_at: new Date().toISOString() });
              result.surveys_sent++;
            }
          }
        } catch (e) { result.errors.push(`survey ${c.id}: ${String(e)}`); }

        try {
          if (c.content_due_at && !c.content_received_at && !c.launched_at) {
            const dueMs = new Date(c.content_due_at).getTime();
            const lastNudgeMs = c.last_content_nudge_at ? new Date(c.last_content_nudge_at).getTime() : 0;
            const dueSoonOrPast = !isNaN(dueMs) && now >= dueMs - CONTENT_NUDGE_LEAD_DAYS * DAY;
            const spacedOut = now - lastNudgeMs >= CONTENT_NUDGE_EVERY_DAYS * DAY;
            if (dueSoonOrPast && spacedOut) {
              const overdue = now > dueMs;
              const lines = overdue
                ? [
                    `Quick check-in. I'm ready to keep building, and I'm just waiting on the content from your checklist (photos, copy, and the details we talked about).`,
                    `No worries at all if life got busy. Whenever you can get it to me, we pick right back up. Just a heads up that the timeline shifts by however long we're waiting, since I can't build those sections without it.`,
                    `Anything I can do to make it easier, just reply here.`,
                  ]
                : [
                    `Friendly reminder that your project content is due soon. Getting it to me on time keeps us on schedule for your timeline.`,
                    `If you're stuck on any part of the checklist, reply and we'll figure out a plan. No need to wait until it's all perfect.`,
                  ];
              await sendEmail(
                to,
                overdue ? `Still here whenever you're ready, ${name}` : `Quick reminder on your project content`,
                notifyShell(overdue ? `Picking up where we left off` : `Your content checklist`, lines, { label: 'Open your portal →', href: 'https://davisdigitalstudio.com/portal' }),
              );
              await stampClient(c.id, { last_content_nudge_at: new Date().toISOString() });
              result.nudges_sent++;
            }
          }
        } catch (e) { result.errors.push(`nudge ${c.id}: ${String(e)}`); }
      }

      const TURN_REMIND_AFTER_DAYS = 3;
      const TURN_REMIND_EVERY_DAYS = 3;
      (result as any).turn_reminders_sent = 0;
      try {
        const pr = await fetch(
          `${SB_URL}/rest/v1/projects?ball_in_court=eq.client&stage=neq.complete&deleted_at=is.null&select=id,name,stage,ball_in_court,updated_at,last_turn_reminder_at,contact_id,contacts(name,email)`,
          { headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` } },
        );
        const projects = pr.ok ? await pr.json() : [];
        for (const p of (Array.isArray(projects) ? projects : [])) {
          try {
            const contact = p.contacts || {};
            const to = contact.email || '';
            if (!to) continue;
            const cname = contact.name || 'there';
            const movedMs = p.updated_at ? new Date(p.updated_at).getTime() : 0;
            const lastRemindMs = p.last_turn_reminder_at ? new Date(p.last_turn_reminder_at).getTime() : 0;
            const stalledLongEnough = movedMs && (now - movedMs >= TURN_REMIND_AFTER_DAYS * DAY);
            const spacedOut = (now - lastRemindMs) >= TURN_REMIND_EVERY_DAYS * DAY;
            if (stalledLongEnough && spacedOut) {
              await sendEmail(
                to,
                `Still here whenever you’re ready, ${cname}`,
                notifyShell(
                  `A quick nudge on your project`,
                  [
                    `Just a friendly check-in. Your project is waiting on something from you to keep moving.`,
                    `No rush at all if life got busy. Whenever you can get to it, we pick right back up. Anything I can do to make it easier, just reply here.`,
                  ],
                  { label: 'Open your portal →', href: 'https://davisdigitalstudio.com/portal' },
                ),
              );
              await fetch(`${SB_URL}/rest/v1/projects?id=eq.${encodeURIComponent(p.id)}`, {
                method: 'PATCH',
                headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
                body: JSON.stringify({ last_turn_reminder_at: new Date().toISOString() }),
              });
              (result as any).turn_reminders_sent++;
            }
          } catch (e) { result.errors.push(`turn ${p.id}: ${String(e)}`); }
        }
      } catch (e) { result.errors.push(`turn job: ${String(e)}`); }

      // ── NIGHTLY DATA-SOURCE SYNC ──
      // Refresh internal signals + run every connected provider for each client,
      // so scores/insights stay current without anyone pressing Force Sync.
      // Graceful: unconnected providers are skipped; one client's failure never
      // halts the sweep. Each run logs to sync_log and stamps client_integrations
      // (so the Integrations panel shows last-success / last-failure / errors).
      (result as any).clients_synced = 0;
      (result as any).providers_ok = 0;
      (result as any).providers_failed = 0;
      (result as any).providers_skipped = 0;
      for (const c of (Array.isArray(clients) ? clients : [])) {
        if (c.automation_paused) continue;
        try {
          // 1) internal signals (no OAuth needed — keeps scores fresh for everyone)
          try { await ingestInternalSignals({ apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` }, String(c.id)); } catch (e) { result.errors.push(`signals ${c.id}: ${String(e).slice(0,120)}`); }
          // 2) external providers (skips any not connected — safe before Google creds exist)
          const synced = await syncClientProviders(String(c.id), null);
          (result as any).clients_synced++;
          for (const s of synced) {
            if (s.status === 'ok') (result as any).providers_ok++;
            else if (s.status === 'error') { (result as any).providers_failed++; result.errors.push(`sync ${c.id}/${s.provider}: ${String(s.error).slice(0,100)}`); }
            else (result as any).providers_skipped++;
          }
          // 3) persist the derived scores as history (one point per month) so trends populate over time
          try {
            const { partnershipId } = await resolveClientGraph(String(c.id));
            await persistScores({ apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` }, String(c.id), partnershipId);
          } catch (e) { result.errors.push(`scores ${c.id}: ${String(e).slice(0,120)}`); }
        } catch (e) { result.errors.push(`sync_sweep ${c.id}: ${String(e).slice(0,120)}`); }
      }

      return json({ ok: true, ...result }, 200, reqCors);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  GROWTH PARTNERSHIP ROUTES (post-launch client experience)
    //  Added as a drop-in block. Same conventions as the routes above:
    //  reqCors, json(), SB_SERVICE service-role reads, JWT-scoped client reads.
    //  Staff/role enforcement happens at the central gate via ROUTE_MIN_ROLE.
    // ═══════════════════════════════════════════════════════════════════════
//  top of serve(), or inline per block — shown here as a local for clarity.)
const gpDb = async (path: string, method = 'GET', payload: unknown = null) => {
  const headers: Record<string, string> = {
    'apikey': SB_SERVICE,
    'Authorization': `Bearer ${SB_SERVICE}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
  const init: RequestInit = { method, headers };
  if (payload !== null && method !== 'GET' && method !== 'DELETE') init.body = JSON.stringify(payload);
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, init);
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return res.ok ? { ok: true, data } : { ok: false, status: res.status, detail: data };
};
const period = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;


// ════════════════════════════════════════════════════════════════════════════
//  PARTNERSHIPS
// ════════════════════════════════════════════════════════════════════════════

if (type === 'partnership_list') {
  if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
  const seg = ['new_business','established','maintenance','growth'].includes(body.segment) ? body.segment : null;
  const st  = ['onboarding','active','paused','ended'].includes(body.status) ? body.status : null;
  let q = `v_partnership_overview?select=*&order=updated_at.desc&limit=300`;
  if (seg) q += `&segment=eq.${seg}`;
  if (st)  q += `&status=eq.${st}`;
  const r = await gpDb(q);
  if (!r.ok) return json({ error: 'list_failed', detail: r.detail }, 200, reqCors);
  return json({ data: r.data }, 200, reqCors);
}

if (type === 'partnership_get') {
  if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
  const id = String(body.id || '');
  if (!id) return json({ error: 'id required' }, 400, reqCors);
  const [p, goals, recs, tasks, work, content, reviews, notes, health] = await Promise.all([
    gpDb(`v_partnership_overview?id=eq.${id}&select=*&limit=1`),
    gpDb(`partnership_goals?partnership_id=eq.${id}&select=*&order=created_at.desc`),
    gpDb(`recommendations?partnership_id=eq.${id}&select=*&order=created_at.desc`),
    gpDb(`growth_tasks?partnership_id=eq.${id}&select=*&order=priority.asc,created_at.desc`),
    gpDb(`work_log?partnership_id=eq.${id}&select=*&order=done_at.desc&limit=100`),
    gpDb(`content_calendar?partnership_id=eq.${id}&select=*&order=scheduled_for.asc`),
    gpDb(`monthly_reviews?partnership_id=eq.${id}&select=*&order=period.desc`),
    gpDb(`client_notes?partnership_id=eq.${id}&select=*&order=pinned.desc,created_at.desc`),
    gpDb(`health_metrics?partnership_id=eq.${id}&select=*&order=period.desc&limit=12`),
  ]);
  if (!p.ok || !Array.isArray(p.data) || !p.data.length) return json({ error: 'not_found' }, 404, reqCors);
  return json({ data: {
    partnership: p.data[0],
    goals: goals.ok ? goals.data : [],
    recommendations: recs.ok ? recs.data : [],
    tasks: tasks.ok ? tasks.data : [],
    work_log: work.ok ? work.data : [],
    content: content.ok ? content.data : [],
    reviews: reviews.ok ? reviews.data : [],
    notes: notes.ok ? notes.data : [],
    health: health.ok ? health.data : [],
  } }, 200, reqCors);
}

if (type === 'partnership_upsert') {
  if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
  const id = body.id ? String(body.id) : null;
  const allowed = ['client_id','contact_id','segment','status','plan_label',
    'monthly_amount','primary_site','started_at','launched_at','renews_at','health','health_note'];
  const row: Record<string, unknown> = {};
  for (const k of allowed) if (body[k] !== undefined) row[k] = body[k];
  if (!id && !row.client_id && !row.contact_id) return json({ error: 'client_id or contact_id required' }, 400, reqCors);

  let r;
  if (id) r = await gpDb(`partnerships?id=eq.${id}`, 'PATCH', row);
  else {
    // try to backfill launched_at + primary_site from the client's project/site.
    if (!row.launched_at && row.contact_id) {
      const pr = await gpDb(`projects?contact_id=eq.${row.contact_id}&select=launched_at&order=created_at.desc&limit=1`);
      if (pr.ok && Array.isArray(pr.data) && pr.data[0]?.launched_at) row.launched_at = pr.data[0].launched_at;
    }
    r = await gpDb('partnerships', 'POST', row);
  }
  if (!r.ok) return json({ error: 'upsert_failed', detail: r.detail }, 200, reqCors);
  const saved = Array.isArray(r.data) ? r.data[0] : r.data;

  // Onboard side-effects: when a partnership is first created, also add the
  // client's site to the monitoring watchlist (reuses your visibility module).
  if (!id && saved && row.primary_site) {
    let u = String(row.primary_site).trim();
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
    await gpDb('monitored_sites', 'POST', {
      label: saved.client_name || u, url: u, source: 'client', client_id: row.client_id || null,
    }).catch(() => {});
  }
  return json({ data: saved }, 200, reqCors);
}

if (type === 'partnership_delete') {
  if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
  const id = String(body.id || '');
  if (!id) return json({ error: 'id required' }, 400, reqCors);
  const r = await gpDb(`partnerships?id=eq.${id}`, 'DELETE');   // cascades children
  if (!r.ok) return json({ error: 'delete_failed', detail: r.detail }, 200, reqCors);
  return json({ ok: true }, 200, reqCors);
}

// The Growth Partnership dashboard: portfolio-wide snapshot for Eric's home.
if (type === 'partnership_dashboard') {
  if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
  const all = await gpDb(`v_partnership_overview?select=*`);
  const rows: any[] = all.ok && Array.isArray(all.data) ? all.data : [];
  const active = rows.filter(r => r.status === 'active' || r.status === 'onboarding');
  const mrr = active.reduce((s, r) => s + (Number(r.monthly_amount) || 0), 0);
  const bySegment: Record<string, number> = {};
  for (const r of rows) bySegment[r.segment] = (bySegment[r.segment] || 0) + 1;

  // renewals in the next 45 days
  const soon = new Date(Date.now() + 45 * 86400000).toISOString();
  const renewals = rows
    .filter(r => r.renews_at && r.renews_at <= soon && r.status !== 'ended')
    .sort((a, b) => String(a.renews_at).localeCompare(String(b.renews_at)));

  const atRisk = rows.filter(r => r.health === 'yellow' || r.health === 'red');
  const needsReview = rows.filter(r => {
    if (r.status === 'ended') return false;
    return r.last_review_period !== period();      // no review published this month
  });
  const pendingRecs = rows.reduce((s, r) => s + (Number(r.pending_recs) || 0), 0);

  return json({ data: {
    counts: {
      activeClients: active.length,
      mrr,
      renewalsSoon: renewals.length,
      atRisk: atRisk.length,
      needsReviewThisMonth: needsReview.length,
      pendingRecs,
    },
    bySegment,
    renewals: renewals.slice(0, 12),
    atRisk: atRisk.slice(0, 12),
    needsReview: needsReview.slice(0, 12),
  } }, 200, reqCors);
}


// ════════════════════════════════════════════════════════════════════════════
//  GOALS · NOTES · CONTENT · WORK LOG · HEALTH  (simple CRUD, staff-gated)
// ════════════════════════════════════════════════════════════════════════════

const simpleUpsert = async (table: string, allowed: string[]) => {
  const id = body.id ? String(body.id) : null;
  const row: Record<string, unknown> = {};
  for (const k of allowed) if (body[k] !== undefined) row[k] = body[k];
  if (id) return gpDb(`${table}?id=eq.${id}`, 'PATCH', row);
  return gpDb(table, 'POST', row);
};

if (type === 'goal_list') {
  const pid = String(body.partnership_id || '');
  if (!pid) return json({ error: 'partnership_id required' }, 400, reqCors);
  const r = await gpDb(`partnership_goals?partnership_id=eq.${pid}&select=*&order=created_at.desc`);
  return r.ok ? json({ data: r.data }, 200, reqCors) : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}
if (type === 'goal_upsert') {
  const r = await simpleUpsert('partnership_goals',
    ['partnership_id','title','detail','metric','target','status','quarter','client_visible']);
  return r.ok ? json({ data: Array.isArray(r.data) ? r.data[0] : r.data }, 200, reqCors)
              : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}
if (type === 'goal_delete') {
  const id = String(body.id || ''); if (!id) return json({ error: 'id required' }, 400, reqCors);
  const r = await gpDb(`partnership_goals?id=eq.${id}`, 'DELETE');
  return r.ok ? json({ ok: true }, 200, reqCors) : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}

if (type === 'note_list') {
  const pid = String(body.partnership_id || '');
  if (!pid) return json({ error: 'partnership_id required' }, 400, reqCors);
  const r = await gpDb(`client_notes?partnership_id=eq.${pid}&select=*&order=pinned.desc,created_at.desc`);
  return r.ok ? json({ data: r.data }, 200, reqCors) : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}
if (type === 'note_upsert') {
  const r = await simpleUpsert('client_notes', ['partnership_id','kind','body','pinned','remind_at']);
  return r.ok ? json({ data: Array.isArray(r.data) ? r.data[0] : r.data }, 200, reqCors)
              : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}
if (type === 'note_delete') {
  const id = String(body.id || ''); if (!id) return json({ error: 'id required' }, 400, reqCors);
  const r = await gpDb(`client_notes?id=eq.${id}`, 'DELETE');
  return r.ok ? json({ ok: true }, 200, reqCors) : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}

if (type === 'content_list') {
  const pid = String(body.partnership_id || '');
  if (!pid) return json({ error: 'partnership_id required' }, 400, reqCors);
  const r = await gpDb(`content_calendar?partnership_id=eq.${pid}&select=*&order=scheduled_for.asc`);
  return r.ok ? json({ data: r.data }, 200, reqCors) : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}
if (type === 'content_upsert') {
  const r = await simpleUpsert('content_calendar',
    ['partnership_id','title','kind','status','scheduled_for','published_at','notes','client_visible']);
  return r.ok ? json({ data: Array.isArray(r.data) ? r.data[0] : r.data }, 200, reqCors)
              : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}
if (type === 'content_delete') {
  const id = String(body.id || ''); if (!id) return json({ error: 'id required' }, 400, reqCors);
  const r = await gpDb(`content_calendar?id=eq.${id}`, 'DELETE');
  return r.ok ? json({ ok: true }, 200, reqCors) : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}

if (type === 'worklog_list') {
  const pid = String(body.partnership_id || '');
  if (!pid) return json({ error: 'partnership_id required' }, 400, reqCors);
  const r = await gpDb(`work_log?partnership_id=eq.${pid}&select=*&order=done_at.desc&limit=200`);
  return r.ok ? json({ data: r.data }, 200, reqCors) : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}
if (type === 'worklog_upsert') {
  if (body.period === undefined) body.period = period();
  const r = await simpleUpsert('work_log',
    ['partnership_id','title','detail','category','task_id','period','client_visible','done_at']);
  return r.ok ? json({ data: Array.isArray(r.data) ? r.data[0] : r.data }, 200, reqCors)
              : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}

if (type === 'health_upsert') {
  if (body.period === undefined) body.period = period();
  // upsert by (partnership_id, period)
  const pid = String(body.partnership_id || '');
  const per = String(body.period);
  if (!pid) return json({ error: 'partnership_id required' }, 400, reqCors);
  const existing = await gpDb(`health_metrics?partnership_id=eq.${pid}&period=eq.${per}&select=id&limit=1`);
  const row: Record<string, unknown> = {};
  for (const k of ['partnership_id','period','calls','forms','bookings','visits','notes']) if (body[k] !== undefined) row[k] = body[k];
  let r;
  if (existing.ok && Array.isArray(existing.data) && existing.data.length) {
    r = await gpDb(`health_metrics?id=eq.${existing.data[0].id}`, 'PATCH', row);
  } else {
    r = await gpDb('health_metrics', 'POST', row);
  }
  return r.ok ? json({ data: Array.isArray(r.data) ? r.data[0] : r.data }, 200, reqCors)
              : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}


// ════════════════════════════════════════════════════════════════════════════
//  TASKS  (+ generate from recommendation)
// ════════════════════════════════════════════════════════════════════════════

if (type === 'task_list') {
  const pid = body.partnership_id ? String(body.partnership_id) : null;
  const st  = ['todo','doing','done'].includes(body.status) ? body.status : null;
  let q = `growth_tasks?select=*&order=status.asc,priority.asc,created_at.desc&limit=300`;
  if (pid) q += `&partnership_id=eq.${pid}`;
  if (st)  q += `&status=eq.${st}`;
  const r = await gpDb(q);
  return r.ok ? json({ data: r.data }, 200, reqCors) : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}

if (type === 'task_upsert') {
  const wasDone = body.status === 'done';
  const r = await simpleUpsert('growth_tasks',
    ['partnership_id','title','detail','status','priority','due_at','source',
     'recommendation_id','request_id','client_facing_label','completed_at']);
  if (!r.ok) return json({ error: 'failed', detail: r.detail }, 200, reqCors);
  const task = Array.isArray(r.data) ? r.data[0] : r.data;

  // When a task is completed, mirror it into the client-visible work log
  // (the "receipt") — unless one already exists for this task.
  if (wasDone && task && task.partnership_id) {
    const exists = await gpDb(`work_log?task_id=eq.${task.id}&select=id&limit=1`);
    if (!(exists.ok && Array.isArray(exists.data) && exists.data.length)) {
      await gpDb('work_log', 'POST', {
        partnership_id: task.partnership_id,
        title: task.client_facing_label || task.title,
        detail: task.detail || null,
        task_id: task.id,
        period: period(),
        client_visible: true,
      }).catch(() => {});
    }
    if (!task.completed_at) await gpDb(`growth_tasks?id=eq.${task.id}`, 'PATCH', { completed_at: new Date().toISOString() }).catch(() => {});
  }
  return json({ data: task }, 200, reqCors);
}

if (type === 'task_delete') {
  const id = String(body.id || ''); if (!id) return json({ error: 'id required' }, 400, reqCors);
  const r = await gpDb(`growth_tasks?id=eq.${id}`, 'DELETE');
  return r.ok ? json({ ok: true }, 200, reqCors) : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}


// ════════════════════════════════════════════════════════════════════════════
//  RECOMMENDATIONS  (Eric-authored + AI-generated, with the review gate)
// ════════════════════════════════════════════════════════════════════════════

if (type === 'rec_list') {
  const pid = body.partnership_id ? String(body.partnership_id) : null;
  const st  = ['suggested','approved','shared','accepted','declined','done','dismissed'].includes(body.status) ? body.status : null;
  let q = `recommendations?select=*&order=created_at.desc&limit=300`;
  if (pid) q += `&partnership_id=eq.${pid}`;
  if (st)  q += `&status=eq.${st}`;
  const r = await gpDb(q);
  return r.ok ? json({ data: r.data }, 200, reqCors) : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}

if (type === 'rec_upsert') {
  const r = await simpleUpsert('recommendations',
    ['partnership_id','source','category','title','detail','why','effort','impact','status','client_visible']);
  return r.ok ? json({ data: Array.isArray(r.data) ? r.data[0] : r.data }, 200, reqCors)
              : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}

// approve / share / dismiss / mark done — the review gate in one place.
if (type === 'rec_decide') {
  const id = String(body.id || '');
  const decision = String(body.decision || '');
  if (!id || !['approve','share','dismiss','accept','decline','done'].includes(decision)) {
    return json({ error: 'id and valid decision required' }, 400, reqCors);
  }
  const patch: Record<string, unknown> = { decided_at: new Date().toISOString() };
  if (decision === 'approve') patch.status = 'approved';
  if (decision === 'share')   { patch.status = 'shared'; patch.client_visible = true; patch.shared_at = new Date().toISOString(); }
  if (decision === 'dismiss') { patch.status = 'dismissed'; patch.client_visible = false; }
  if (decision === 'accept')  patch.status = 'accepted';
  if (decision === 'decline') patch.status = 'declined';
  if (decision === 'done')    patch.status = 'done';
  const r = await gpDb(`recommendations?id=eq.${id}`, 'PATCH', patch);
  if (!r.ok) return json({ error: 'failed', detail: r.detail }, 200, reqCors);

  // sharing a rec notifies the client (reuses your notify pattern)
  if (decision === 'share') {
    const rec = Array.isArray(r.data) ? r.data[0] : r.data;
    try {
      const pr = await gpDb(`v_partnership_overview?id=eq.${rec.partnership_id}&select=contact_email,client_email,client_name&limit=1`);
      const row = pr.ok && Array.isArray(pr.data) ? pr.data[0] : null;
      const to = row?.contact_email || row?.client_email;
      if (to) {
        await sendEmail(to, `A recommendation from Eric`,
          notifyShell(`I spotted something worth doing`,
            [rec.title, rec.detail || '', rec.why ? `Why it matters: ${rec.why}` : ''].filter(Boolean),
            { label: 'See it in your workspace →', href: 'https://davisdigitalstudio.com/portal' }));
      }
    } catch (_) { /* never block on email */ }
  }
  return json({ data: Array.isArray(r.data) ? r.data[0] : r.data }, 200, reqCors);
}

// promote a recommendation into a task on Eric's queue.
if (type === 'rec_to_task') {
  const id = String(body.id || '');
  if (!id) return json({ error: 'id required' }, 400, reqCors);
  const rr = await gpDb(`recommendations?id=eq.${id}&select=*&limit=1`);
  const rec = rr.ok && Array.isArray(rr.data) && rr.data.length ? rr.data[0] : null;
  if (!rec) return json({ error: 'not_found' }, 404, reqCors);
  const prio = rec.impact === 'high' ? 1 : rec.impact === 'low' ? 3 : 2;
  const t = await gpDb('growth_tasks', 'POST', {
    partnership_id: rec.partnership_id,
    title: rec.title,
    detail: rec.detail,
    source: 'recommendation',
    recommendation_id: rec.id,
    priority: prio,
    client_facing_label: rec.title,
  });
  if (!t.ok) return json({ error: 'task_create_failed', detail: t.detail }, 200, reqCors);
  await gpDb(`recommendations?id=eq.${id}`, 'PATCH', { status: rec.status === 'suggested' ? 'approved' : rec.status }).catch(() => {});
  return json({ data: Array.isArray(t.data) ? t.data[0] : t.data }, 200, reqCors);
}

// ── AI: generate "notices" for a partnership, grounded in real data. ─────────
// Pulls the latest site_check + health metrics + goals, asks the model to
// surface a few specific, plain-English opportunities. They land as
// status='suggested', client_visible=false — Eric's review gate.
if (type === 'rec_generate') {
  if (!ANTHROPIC_KEY) return json({ error: 'Server missing ANTHROPIC_KEY secret' }, 500, reqCors);
  const pid = String(body.partnership_id || '');
  if (!pid) return json({ error: 'partnership_id required' }, 400, reqCors);

  const [p, goals, health, recent] = await Promise.all([
    gpDb(`v_partnership_overview?id=eq.${pid}&select=*&limit=1`),
    gpDb(`partnership_goals?partnership_id=eq.${pid}&status=eq.active&select=title,metric,target`),
    gpDb(`health_metrics?partnership_id=eq.${pid}&select=*&order=period.desc&limit=3`),
    gpDb(`recommendations?partnership_id=eq.${pid}&select=title&order=created_at.desc&limit=20`),
  ]);
  const part = p.ok && Array.isArray(p.data) ? p.data[0] : null;
  if (!part) return json({ error: 'not_found' }, 404, reqCors);

  // latest health check for the site, if we monitor it
  let siteCheck: any = null;
  if (part.primary_site) {
    const ms = await gpDb(`monitored_sites?select=id&url=ilike.*${encodeURIComponent(part.primary_site.replace(/^https?:\/\//,''))}*&limit=1`);
    const sid = ms.ok && Array.isArray(ms.data) && ms.data[0]?.id;
    if (sid) {
      const sc = await gpDb(`site_checks?site_id=eq.${sid}&select=overall,performance,visibility,local,findings,checked_at&order=checked_at.desc&limit=1`);
      siteCheck = sc.ok && Array.isArray(sc.data) ? sc.data[0] : null;
    }
  }

  const snapshot = {
    business: part.client_name,
    segment: part.segment,
    site: part.primary_site,
    goals: goals.ok ? goals.data : [],
    health_trend: health.ok ? health.data : [],
    site_check: siteCheck,
    existing_recs: recent.ok ? (recent.data || []).map((x: any) => x.title) : [],
  };

  const system = `You are the strategist inside Davis Digital Studio's platform, helping Eric Davis spot what's worth doing next for a specific client's website and online presence. You are given a real data snapshot. Surface 3 to 5 SPECIFIC, plain-English opportunities a small-business owner would understand. Think like a digital strategist, not a chatbot. Do NOT repeat anything already in existing_recs. Do NOT invent data not supported by the snapshot; if data is thin, base recs on the segment and goals. No em dashes.

Respond with ONLY a JSON array, no markdown, no preamble:
[
  {
    "category": "visibility|local|demand|competitor|seasonal|content|performance",
    "title": "specific, under 12 words",
    "detail": "2 to 3 plain sentences: what it is and what to do",
    "why": "one sentence on why it matters for THIS business",
    "effort": "low|medium|high",
    "impact": "low|medium|high"
  }
]`;
  const userMsg = `SNAPSHOT (JSON):\n${JSON.stringify(snapshot).slice(0, 6000)}`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1500, system, messages: [{ role: 'user', content: userMsg }] }),
      signal: AbortSignal.timeout(40000),
    });
    const aiData = await aiRes.json();
    if (aiData.error) return json({ error: aiData.error.message || 'ai_error' }, 200, reqCors);
    let text = '';
    if (Array.isArray(aiData.content)) text = aiData.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    text = (text || '').trim().replace(/```json|```/g, '').trim();
    let arr: any[] = [];
    try { arr = JSON.parse(text); } catch (_) { const m = text.match(/\[[\s\S]*\]/); if (m) { try { arr = JSON.parse(m[0]); } catch (_2) {} } }
    if (!Array.isArray(arr) || !arr.length) return json({ error: 'parse_failed' }, 200, reqCors);

    const CATS = new Set(['visibility','local','demand','competitor','seasonal','content','performance']);
    const LV = new Set(['low','medium','high']);
    const inserted: any[] = [];
    for (const x of arr.slice(0, 5)) {
      const row = {
        partnership_id: pid,
        source: 'ai',
        category: CATS.has(x.category) ? x.category : 'visibility',
        title: String(x.title || '').slice(0, 160),
        detail: String(x.detail || '').slice(0, 600),
        why: String(x.why || '').slice(0, 240),
        effort: LV.has(x.effort) ? x.effort : 'medium',
        impact: LV.has(x.impact) ? x.impact : 'medium',
        status: 'suggested',
        client_visible: false,
      };
      if (!row.title) continue;
      const ins = await gpDb('recommendations', 'POST', row);
      if (ins.ok) inserted.push(Array.isArray(ins.data) ? ins.data[0] : ins.data);
    }
    return json({ data: inserted }, 200, reqCors);
  } catch (e) {
    return json({ error: 'rec_generate_failed', message: String(e) }, 200, reqCors);
  }
}


// ════════════════════════════════════════════════════════════════════════════
//  MONTHLY REVIEWS  (list / get / upsert / AI-draft / publish)
// ════════════════════════════════════════════════════════════════════════════

if (type === 'review_list') {
  const pid = String(body.partnership_id || '');
  if (!pid) return json({ error: 'partnership_id required' }, 400, reqCors);
  const r = await gpDb(`monthly_reviews?partnership_id=eq.${pid}&select=*&order=period.desc`);
  return r.ok ? json({ data: r.data }, 200, reqCors) : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}
if (type === 'review_get') {
  const id = String(body.id || '');
  if (!id) return json({ error: 'id required' }, 400, reqCors);
  const r = await gpDb(`monthly_reviews?id=eq.${id}&select=*&limit=1`);
  if (!r.ok || !Array.isArray(r.data) || !r.data.length) return json({ error: 'not_found' }, 404, reqCors);
  return json({ data: r.data[0] }, 200, reqCors);
}
if (type === 'review_upsert') {
  if (body.period === undefined) body.period = period();
  // upsert by (partnership_id, period)
  const pid = String(body.partnership_id || '');
  const per = String(body.period);
  if (!pid) return json({ error: 'partnership_id required' }, 400, reqCors);
  const allowed = ['partnership_id','period','improved','work_done','found','next_up','payoff','headline','intro','metrics','status'];
  const row: Record<string, unknown> = {};
  for (const k of allowed) if (body[k] !== undefined) row[k] = body[k];
  const existing = await gpDb(`monthly_reviews?partnership_id=eq.${pid}&period=eq.${per}&select=id&limit=1`);
  let r;
  if (existing.ok && Array.isArray(existing.data) && existing.data.length) r = await gpDb(`monthly_reviews?id=eq.${existing.data[0].id}`, 'PATCH', row);
  else r = await gpDb('monthly_reviews', 'POST', row);
  return r.ok ? json({ data: Array.isArray(r.data) ? r.data[0] : r.data }, 200, reqCors)
              : json({ error: 'failed', detail: r.detail }, 200, reqCors);
}

// AI-assisted draft: grounds the five sections in this month's real work_log +
// health trend + shared recs. Returns a draft for Eric to edit, never auto-sends.
if (type === 'review_draft') {
  if (!ANTHROPIC_KEY) return json({ error: 'Server missing ANTHROPIC_KEY secret' }, 500, reqCors);
  const pid = String(body.partnership_id || '');
  const per = String(body.period || period());
  if (!pid) return json({ error: 'partnership_id required' }, 400, reqCors);

  const [p, work, health, recs] = await Promise.all([
    gpDb(`v_partnership_overview?id=eq.${pid}&select=*&limit=1`),
    gpDb(`work_log?partnership_id=eq.${pid}&period=eq.${per}&select=title,detail,category`),
    gpDb(`health_metrics?partnership_id=eq.${pid}&select=*&order=period.desc&limit=2`),
    gpDb(`recommendations?partnership_id=eq.${pid}&status=in.(shared,accepted,done)&select=title,why&order=created_at.desc&limit=6`),
  ]);
  const part = p.ok && Array.isArray(p.data) ? p.data[0] : null;
  if (!part) return json({ error: 'not_found' }, 404, reqCors);

  const snapshot = {
    business: part.client_name,
    segment: part.segment,
    month: per,
    work_done: work.ok ? work.data : [],
    health_this_month: health.ok && health.data?.[0] ? health.data[0] : null,
    health_last_month: health.ok && health.data?.[1] ? health.data[1] : null,
    recommendations: recs.ok ? recs.data : [],
  };

  const system = `You are Eric Davis writing the monthly review for a Growth Partnership client. Warm, plain, human, direct. No em dashes. No corporate filler. Never invent numbers not in the snapshot. It is OK and good to say a month was quiet if the data is light. Translate website things into business things (customers, calls, found-you-on-Google), not jargon.

Write the five sections of the review. Respond with ONLY this JSON, no markdown:
{
  "headline": "one warm, specific sentence about the month",
  "intro": "2 to 3 warm sentences setting it up, using their name/business naturally",
  "improved": "what got better, in business terms, grounded in the numbers if present",
  "work_done": "what you did this month, plain list folded into a short paragraph",
  "found": "one opportunity or thing you noticed worth their attention",
  "next_up": "one clear recommendation for next month, ready to act on",
  "payoff": "one honest sentence on how the investment is paying off over time"
}`;
  const userMsg = `SNAPSHOT (JSON):\n${JSON.stringify(snapshot).slice(0, 6000)}`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1400, system, messages: [{ role: 'user', content: userMsg }] }),
      signal: AbortSignal.timeout(40000),
    });
    const aiData = await aiRes.json();
    if (aiData.error) return json({ error: aiData.error.message || 'ai_error' }, 200, reqCors);
    let text = '';
    if (Array.isArray(aiData.content)) text = aiData.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    text = (text || '').trim().replace(/```json|```/g, '').trim();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch (_) { const m = text.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch (_2) {} } }
    if (!parsed) return json({ error: 'parse_failed' }, 200, reqCors);

    // save as a draft (upsert by partnership+period)
    const row = {
      partnership_id: pid, period: per, status: 'draft',
      headline: parsed.headline || '', intro: parsed.intro || '',
      improved: parsed.improved || '', work_done: parsed.work_done || '',
      found: parsed.found || '', next_up: parsed.next_up || '', payoff: parsed.payoff || '',
      metrics: snapshot.health_this_month || {},
    };
    const existing = await gpDb(`monthly_reviews?partnership_id=eq.${pid}&period=eq.${per}&select=id&limit=1`);
    let saved;
    if (existing.ok && Array.isArray(existing.data) && existing.data.length) saved = await gpDb(`monthly_reviews?id=eq.${existing.data[0].id}`, 'PATCH', row);
    else saved = await gpDb('monthly_reviews', 'POST', row);
    return json({ data: Array.isArray(saved.data) ? saved.data[0] : saved.data }, 200, reqCors);
  } catch (e) {
    return json({ error: 'review_draft_failed', message: String(e) }, 200, reqCors);
  }
}

// publish: flips to published + emails the client the review.
if (type === 'review_publish') {
  const id = String(body.id || '');
  if (!id) return json({ error: 'id required' }, 400, reqCors);
  const rr = await gpDb(`monthly_reviews?id=eq.${id}&select=*&limit=1`);
  const review = rr.ok && Array.isArray(rr.data) && rr.data.length ? rr.data[0] : null;
  if (!review) return json({ error: 'not_found' }, 404, reqCors);

  const r = await gpDb(`monthly_reviews?id=eq.${id}`, 'PATCH', { status: 'published', published_at: new Date().toISOString() });
  if (!r.ok) return json({ error: 'publish_failed', detail: r.detail }, 200, reqCors);

  try {
    const pr = await gpDb(`v_partnership_overview?id=eq.${review.partnership_id}&select=contact_email,client_email,client_name,contact_name&limit=1`);
    const row = pr.ok && Array.isArray(pr.data) ? pr.data[0] : null;
    const to = row?.contact_email || row?.client_email;
    if (to) {
      const name = row?.contact_name || row?.client_name || 'there';
      const body = `
        <p style="font-size:14px;color:rgba(255,255,255,0.7);line-height:1.7;margin:0 0 16px;">${review.intro || ''}</p>
        ${[['What got better', review.improved],['What I did', review.work_done],['What I found', review.found],['What we should do next', review.next_up],['How it\'s paying off', review.payoff]]
          .filter(([_, v]) => v).map(([h, v]) => `
            <div style="margin-bottom:16px;"><div style="font-family:Georgia,serif;font-size:16px;color:#fff;margin-bottom:6px;">${h}</div>
            <div style="font-size:14px;color:rgba(255,255,255,0.65);line-height:1.65;">${String(v).replace(/\n/g,'<br>')}</div></div>`).join('')}
      `;
      await sendEmail(to, review.headline || `Your monthly review from Davis Digital Studio`,
        notifyShell(review.headline || `Your month with Davis Digital Studio`, [body],
          { label: 'See it in your workspace →', href: 'https://davisdigitalstudio.com/portal' }));
    }
  } catch (_) { /* never block on email */ }
  return json({ ok: true }, 200, reqCors);
}


// ════════════════════════════════════════════════════════════════════════════
//  RELATIONSHIP REMINDERS  — Eric's "what needs me" across partnerships.
//  Surfaces: due notes/dates, renewals soon, missing reviews, pending recs,
//  at-risk health. One calm, prioritized feed.
// ════════════════════════════════════════════════════════════════════════════
if (type === 'reminders_feed') {
  if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
  const now = new Date();
  const soon = new Date(Date.now() + 14 * 86400000).toISOString();
  const [notes, rows] = await Promise.all([
    gpDb(`client_notes?remind_at=not.is.null&remind_at=lte.${soon}&select=id,partnership_id,body,remind_at&order=remind_at.asc&limit=50`),
    gpDb(`v_partnership_overview?select=*`),
  ]);
  const items: any[] = [];
  for (const n of (notes.ok && Array.isArray(notes.data) ? notes.data : [])) {
    items.push({ kind: 'reminder', partnership_id: n.partnership_id, title: n.body, when: n.remind_at });
  }
  for (const p of (rows.ok && Array.isArray(rows.data) ? rows.data : [])) {
    if (p.status === 'ended') continue;
    if (p.renews_at && p.renews_at <= soon) items.push({ kind: 'renewal', partnership_id: p.id, title: `${p.client_name} renews soon`, when: p.renews_at });
    if (p.health === 'yellow' || p.health === 'red') items.push({ kind: 'at_risk', partnership_id: p.id, title: `${p.client_name} health is ${p.health}`, detail: p.health_note });
    if (p.last_review_period !== period()) items.push({ kind: 'review_due', partnership_id: p.id, title: `${p.client_name} needs this month's review` });
    if (Number(p.pending_recs) > 0) items.push({ kind: 'recs', partnership_id: p.id, title: `${p.pending_recs} AI rec(s) to review for ${p.client_name}` });
  }
  return json({ data: { items: items.slice(0, 40) } }, 200, reqCors);
}


// ════════════════════════════════════════════════════════════════════════════
//  CLIENT-PORTAL ROUTES  (JWT-scoped, guard themselves like client_project)
// ════════════════════════════════════════════════════════════════════════════

// gp_workspace — everything the logged-in client sees, in one call.
// Reads under the caller's identity via RLS (anon key + their JWT), exactly
// like client_project. RLS guarantees they only get their own client-visible
// rows; staff-only tables (notes, tasks, unshared recs) never come back.
if (type === 'gp_workspace') {
  if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
  const jwt = req.headers.get('x-dds-user-jwt') || '';
  if (!jwt) return json({ error: 'unauthorized' }, 401, reqCors);

  // validate session
  const uRes = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${jwt}` } });
  if (!uRes.ok) return json({ error: 'unauthorized' }, 401, reqCors);
  const user = await uRes.json();
  const uid = user?.id ? String(user.id) : '';
  const email = (user?.email ? String(user.email) : '').toLowerCase();
  if (!uid && !email) return json({ error: 'unauthorized' }, 401, reqCors);

  const asUser = SB_ANON ? { apikey: SB_ANON, Authorization: `Bearer ${jwt}` } : null;

  // resolve the caller's partnership. Try RLS first; fall back to service by
  // contact link (same defense-in-depth as client_project).
  let partnership: any = null;
  if (asUser) {
    const pr = await fetch(`${SB_URL}/rest/v1/partnerships?select=*&limit=1`, { headers: asUser });
    const rows = pr.ok ? await pr.json() : [];
    if (Array.isArray(rows) && rows.length) partnership = rows[0];
  }
  if (!partnership) {
    // find contact, then their partnership, with service role
    let contactId = '';
    if (uid) {
      const c = await gpDb(`contacts?auth_user_id=eq.${encodeURIComponent(uid)}&select=id&limit=1`);
      if (c.ok && Array.isArray(c.data) && c.data.length) contactId = c.data[0].id;
    }
    if (!contactId && email) {
      const c = await gpDb(`contacts?email=eq.${encodeURIComponent(email)}&select=id&limit=1`);
      if (c.ok && Array.isArray(c.data) && c.data.length) contactId = c.data[0].id;
    }
    if (contactId) {
      const pp = await gpDb(`partnerships?contact_id=eq.${contactId}&deleted_at=is.null&select=*&limit=1`);
      if (pp.ok && Array.isArray(pp.data) && pp.data.length) partnership = pp.data[0];
    }
  }

  if (!partnership) return json({ data: { partnership: null } }, 200, reqCors);
  const pid = partnership.id;

  // pull all client-visible sections with the service role, explicitly filtered
  // to client_visible so this matches RLS exactly and is robust if anon is unset.
  const [goals, recs, work, content, reviews, health, gTasks, cTasks, quotes, msgCounts] = await Promise.all([
    gpDb(`partnership_goals?partnership_id=eq.${pid}&client_visible=eq.true&select=title,detail,metric,target,status,quarter&order=created_at.desc`),
    gpDb(`recommendations?partnership_id=eq.${pid}&client_visible=eq.true&select=id,category,title,detail,why,effort,impact,status,shared_at,scheduled_for,scheduled_label,declined_at,needs_client_input,client_input_note,started_at,completed_at,confidence,ai_reasoning,ai_bucket&order=shared_at.desc`),
    gpDb(`work_log?partnership_id=eq.${pid}&client_visible=eq.true&select=title,detail,category,period,done_at&order=done_at.desc&limit=60`),
    gpDb(`content_calendar?partnership_id=eq.${pid}&client_visible=eq.true&select=title,kind,status,scheduled_for,published_at&order=scheduled_for.asc`),
    gpDb(`monthly_reviews?partnership_id=eq.${pid}&status=eq.published&select=*&order=period.desc&limit=12`),
    gpDb(`health_metrics?partnership_id=eq.${pid}&select=*&order=period.desc&limit=6`),
    gpDb(`growth_tasks?partnership_id=eq.${pid}&select=id,title,client_facing_label,status,recommendation_id,completed_at&order=created_at.desc&limit=60`),
    gpDb(`client_growth_tasks?partnership_id=eq.${pid}&select=id,title,detail,status,recommendation_id,completed_at&order=created_at.desc&limit=60`),
    gpDb(`growth_quotes?partnership_id=eq.${pid}&select=id,recommendation_id,client_note,status,amount,eric_note,created_at,responded_at&order=created_at.desc&limit=60`),
    gpDb(`growth_messages?partnership_id=eq.${pid}&from_who=eq.eric&is_read=eq.false&select=recommendation_id`),
  ]);

  // build unread map { recommendation_id: count } from Eric's unread messages
  const unread: Record<string, number> = {};
  if (msgCounts.ok && Array.isArray(msgCounts.data)) {
    for (const m of msgCounts.data) { const k = String(m.recommendation_id); unread[k] = (unread[k] || 0) + 1; }
  }

  // requests come from your EXISTING client_requests table.
  const reqs = await gpDb(`client_requests?client_id=eq.${partnership.client_id}&select=*&order=created_at.desc&limit=50`).catch(() => ({ ok: false, data: [] }));
  // latest site check (website health) if monitored
  let siteHealth: any = null;
  if (partnership.primary_site) {
    const ms = await gpDb(`monitored_sites?select=id&url=ilike.*${encodeURIComponent(String(partnership.primary_site).replace(/^https?:\/\//,''))}*&limit=1`);
    const sid = ms.ok && Array.isArray(ms.data) && ms.data[0]?.id;
    if (sid) {
      const sc = await gpDb(`site_checks?site_id=eq.${sid}&select=overall,performance,visibility,local,https,findings,checked_at&order=checked_at.desc&limit=1`);
      siteHealth = sc.ok && Array.isArray(sc.data) ? sc.data[0] : null;
    }
  }

  // ════ GROWTH HEADLINE — the one thing that matters in the partnership now ════
  // Same benchmark as Analytics/HQ: lead with what's most important, in priority
  // order. Client-action-needed > active-work > next-suggestion > reassurance.
  const recsList = recs.ok ? (recs.data || []) : [];
  const cTasksList = cTasks.ok ? (cTasks.data || []) : [];
  let gpHeadline: { text: string; kind: string; ref?: string } | null = null;
  {
    const awaitingClient = recsList.find((r: any) => r.status === 'shared' && r.needs_client_input);
    const openClientTask = cTasksList.find((t: any) => t.status && t.status !== 'done');
    const inProgress = recsList.find((r: any) => ['accepted', 'in_progress'].includes(r.status));
    const suggested = recsList.find((r: any) => r.status === 'suggested' || r.status === 'shared');
    const recentlyDone = recsList.find((r: any) => r.status === 'completed');

    if (awaitingClient) gpHeadline = { text: `We're waiting on your input to move forward with ${String(awaitingClient.title).toLowerCase()}.`, kind: 'action', ref: awaitingClient.id };
    else if (openClientTask) gpHeadline = { text: `There's one thing for you to do: ${String(openClientTask.title || 'a quick task').toLowerCase()}.`, kind: 'action' };
    else if (inProgress) gpHeadline = { text: `We're actively working on ${String(inProgress.title).toLowerCase()} for you right now.`, kind: 'active' };
    else if (suggested) gpHeadline = { text: `We've got a new idea to grow your business: ${String(suggested.title).toLowerCase()}.`, kind: 'suggestion', ref: suggested.id };
    else if (recentlyDone) gpHeadline = { text: `Recently completed: ${String(recentlyDone.title).toLowerCase()}. Results build over the coming weeks.`, kind: 'win' };
    else gpHeadline = { text: `Your growth partnership is active. We're watching for the next opportunity to move your business forward.`, kind: 'calm' };
  }

  return json({ data: {
    headline: gpHeadline,
    partnership: {
      id: partnership.id, segment: partnership.segment, status: partnership.status,
      plan_label: partnership.plan_label, primary_site: partnership.primary_site,
      started_at: partnership.started_at, launched_at: partnership.launched_at,
      client_name: partnership.client_name,
    },
    goals: goals.ok ? goals.data : [],
    recommendations: recs.ok ? recs.data : [],
    work_log: work.ok ? work.data : [],
    content: content.ok ? content.data : [],
    reviews: reviews.ok ? reviews.data : [],
    health: health.ok ? health.data : [],
    requests: reqs.ok ? reqs.data : [],
    site_health: siteHealth,
    // NEW workflow data:
    growth_tasks: gTasks.ok ? gTasks.data : [],
    client_tasks: cTasks.ok ? cTasks.data : [],
    quotes: quotes.ok ? quotes.data : [],
    unread_msgs: unread,
  } }, 200, reqCors);
}

// gp_submit_request — client submits a request. Writes to your EXISTING
// client_requests table, then notifies Eric. (Reuses that table, no dup.)
if (type === 'gp_submit_request') {
  if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
  const jwt = req.headers.get('x-dds-user-jwt') || '';
  if (!jwt) return json({ error: 'unauthorized' }, 401, reqCors);
  const uRes = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${jwt}` } });
  if (!uRes.ok) return json({ error: 'unauthorized' }, 401, reqCors);
  const user = await uRes.json();
  const uid = user?.id ? String(user.id) : '';
  const email = (user?.email ? String(user.email) : '').toLowerCase();

  // resolve client_id from contact
  let contactId = '', clientId = '';
  const c = await gpDb(`contacts?or=(auth_user_id.eq.${encodeURIComponent(uid)},email.eq.${encodeURIComponent(email)})&select=id&limit=1`);
  if (c.ok && Array.isArray(c.data) && c.data.length) contactId = c.data[0].id;
  if (contactId) {
    const pp = await gpDb(`partnerships?contact_id=eq.${contactId}&select=client_id&limit=1`);
    if (pp.ok && Array.isArray(pp.data) && pp.data.length) clientId = pp.data[0].client_id;
  }
  if (!clientId) return json({ error: 'no_partnership' }, 200, reqCors);

  const title = String(body.title || body.message || '').slice(0, 200);
  const detail = String(body.detail || body.message || '').slice(0, 4000);
  if (!title) return json({ error: 'title required' }, 400, reqCors);

  const ins = await gpDb('client_requests', 'POST', {
    client_id: clientId, title, detail, status: 'new',
  });
  if (!ins.ok) return json({ error: 'request_failed', detail: ins.detail }, 200, reqCors);

  try {
    await sendEmail(ERIC, `New request: ${title}`,
      notifyShell('A client submitted a request', [title, detail].filter(Boolean),
        { label: 'Open admin →', href: 'https://davisdigitalstudio.com/dds-studio-manage-9k2p' }));
  } catch (_) {}
  return json({ ok: true, data: Array.isArray(ins.data) ? ins.data[0] : ins.data }, 200, reqCors);
}

// gp_rec_respond — client accepts/declines a SHARED recommendation.
if (type === 'gp_rec_respond') {
  if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
  const jwt = req.headers.get('x-dds-user-jwt') || '';
  if (!jwt) return json({ error: 'unauthorized' }, 401, reqCors);
  const uRes = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${jwt}` } });
  if (!uRes.ok) return json({ error: 'unauthorized' }, 401, reqCors);
  const user = await uRes.json();
  const uid = user?.id ? String(user.id) : '';
  const email = (user?.email ? String(user.email) : '').toLowerCase();

  const recId = String(body.id || '');
  const decision = body.decision === 'accept' ? 'accepted' : body.decision === 'decline' ? 'declined' : '';
  if (!recId || !decision) return json({ error: 'id and decision required' }, 400, reqCors);

  // verify the rec belongs to this caller's partnership AND is shared.
  let contactId = '';
  const c = await gpDb(`contacts?or=(auth_user_id.eq.${encodeURIComponent(uid)},email.eq.${encodeURIComponent(email)})&select=id&limit=1`);
  if (c.ok && Array.isArray(c.data) && c.data.length) contactId = c.data[0].id;
  const rr = await gpDb(`recommendations?id=eq.${recId}&select=partnership_id,client_visible,title&limit=1`);
  const rec = rr.ok && Array.isArray(rr.data) && rr.data.length ? rr.data[0] : null;
  if (!rec || !rec.client_visible) return json({ error: 'not_found' }, 404, reqCors);
  const own = await gpDb(`partnerships?id=eq.${rec.partnership_id}&contact_id=eq.${contactId}&select=id&limit=1`);
  if (!(own.ok && Array.isArray(own.data) && own.data.length)) return json({ error: 'forbidden' }, 403, reqCors);

  await gpDb(`recommendations?id=eq.${recId}`, 'PATCH', { status: decision, decided_at: new Date().toISOString() });
  try {
    await sendEmail(ERIC, `Client ${decision} a recommendation`,
      notifyShell(`A client responded to a recommendation`,
        [`"${rec.title}" was ${decision}.`],
        { label: 'Open admin →', href: 'https://davisdigitalstudio.com/dds-studio-manage-9k2p' }));
  } catch (_) {}
  return json({ ok: true }, 200, reqCors);
}

// ════════════════════════════════════════════════════════════════════════════
//  GROWTH WORKFLOW — 9-action client routes (NEW)
//  Same conventions as gp_rec_respond: JWT-validated, ownership-verified,
//  service-role writes via gpDb(), reqCors responses. These are client-facing
//  and self-guard (not in ROUTE_MIN_ROLE).
// ════════════════════════════════════════════════════════════════════════════

// Shared helper: validate the caller and resolve their contact + partnership.
// Returns { contactId, partnership } or null. (Local to these routes.)
async function gpResolveCaller(req: Request): Promise<{ contactId: string; partnership: any } | null> {
  const jwt = req.headers.get('x-dds-user-jwt') || '';
  if (!jwt) return null;
  const uRes = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${jwt}` } });
  if (!uRes.ok) return null;
  const user = await uRes.json();
  const uid = user?.id ? String(user.id) : '';
  const email = (user?.email ? String(user.email) : '').toLowerCase();
  if (!uid && !email) return null;
  let contactId = '';
  const c = await gpDb(`contacts?or=(auth_user_id.eq.${encodeURIComponent(uid)},email.eq.${encodeURIComponent(email)})&select=id&limit=1`);
  if (c.ok && Array.isArray(c.data) && c.data.length) contactId = c.data[0].id;
  if (!contactId) return null;
  const pp = await gpDb(`partnerships?contact_id=eq.${contactId}&deleted_at=is.null&select=*&limit=1`);
  const partnership = pp.ok && Array.isArray(pp.data) && pp.data.length ? pp.data[0] : null;
  if (!partnership) return null;
  return { contactId, partnership };
}

// gp_rec_action — the unified 9-action handler.
// body: { recommendation_id, action, payload? }
// actions: approve | request_quote | schedule | ask_question | decline | provide_info
if (type === 'gp_rec_action') {
  if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
  const caller = await gpResolveCaller(req);
  if (!caller) return json({ error: 'unauthorized' }, 401, reqCors);

  const recId = String(body.recommendation_id || '');
  const action = String(body.action || '');
  const payload = (body.payload && typeof body.payload === 'object') ? body.payload : {};
  if (!recId || !action) return json({ error: 'recommendation_id and action required' }, 400, reqCors);

  // Verify the rec belongs to this caller's partnership AND is client-visible.
  const rr = await gpDb(`recommendations?id=eq.${recId}&select=*&limit=1`);
  const rec = rr.ok && Array.isArray(rr.data) && rr.data.length ? rr.data[0] : null;
  if (!rec || !rec.client_visible) return json({ error: 'not_found' }, 404, reqCors);
  if (String(rec.partnership_id) !== String(caller.partnership.id)) return json({ error: 'forbidden' }, 403, reqCors);

  const pid = caller.partnership.id;
  const now = new Date().toISOString();
  const impactPriority = rec.impact === 'high' ? 1 : rec.impact === 'low' ? 3 : 2;
  let newStatus = rec.status;
  const emailLines: string[] = [];

  try {
    if (action === 'approve') {
      newStatus = 'approved';
      await gpDb(`recommendations?id=eq.${recId}`, 'PATCH', { status: 'approved', decided_at: now, last_action_at: now });
      // Reuse the EXISTING growth_tasks shape.
      await gpDb('growth_tasks', 'POST', {
        partnership_id: pid, title: rec.title, detail: rec.detail || null,
        source: 'client_approval', recommendation_id: rec.id,
        priority: impactPriority, client_facing_label: rec.title, status: 'todo',
      });
      emailLines.push(`"${rec.title}" was approved. A task was added to your queue.`);

    } else if (action === 'request_quote') {
      newStatus = 'quote_requested';
      await gpDb(`recommendations?id=eq.${recId}`, 'PATCH', { status: 'quote_requested', last_action_at: now });
      await gpDb('growth_quotes', 'POST', {
        partnership_id: pid, recommendation_id: rec.id,
        client_note: String(payload.note || '').slice(0, 2000), status: 'requested',
      });
      emailLines.push(`Quote requested for "${rec.title}".`);

    } else if (action === 'schedule') {
      newStatus = 'scheduled';
      const label = String(payload.label || '').slice(0, 80);
      const when = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.when || '')) ? payload.when : null;
      await gpDb(`recommendations?id=eq.${recId}`, 'PATCH', {
        status: 'scheduled', scheduled_for: when, scheduled_label: label || null, last_action_at: now,
      });
      emailLines.push(`"${rec.title}" was scheduled${label ? ' for ' + label : ''}.`);

    } else if (action === 'ask_question') {
      const qbody = String(payload.body || '').slice(0, 4000);
      if (!qbody) return json({ error: 'question body required' }, 400, reqCors);
      await gpDb('growth_messages', 'POST', {
        partnership_id: pid, recommendation_id: rec.id, from_who: 'client', body: qbody, is_read: false,
      });
      await gpDb(`recommendations?id=eq.${recId}`, 'PATCH', { last_action_at: now });
      emailLines.push(`A question about "${rec.title}": ${qbody.slice(0, 200)}`);

    } else if (action === 'decline') {
      newStatus = 'declined';
      await gpDb(`recommendations?id=eq.${recId}`, 'PATCH', {
        status: 'declined', declined_at: now, declined_reason: String(payload.reason || '').slice(0, 500) || null, last_action_at: now,
      });
      emailLines.push(`"${rec.title}" was set aside (not now).`);

    } else if (action === 'provide_info') {
      await gpDb(`recommendations?id=eq.${recId}`, 'PATCH', { needs_client_input: true, last_action_at: now });
      await gpDb('client_growth_tasks', 'POST', {
        partnership_id: pid, recommendation_id: rec.id,
        title: rec.client_input_note || ('Send Eric what he needs for: ' + rec.title),
        status: 'todo',
      });
      emailLines.push(`Client will provide info for "${rec.title}".`);

    } else {
      return json({ error: 'unknown_action', detail: action }, 400, reqCors);
    }
  } catch (e) {
    return json({ error: 'action_failed', detail: String(e) }, 200, reqCors);
  }

  // Notify Eric (best-effort, never blocks).
  try {
    await sendEmail(ERIC, `Growth: ${action.replace('_', ' ')} — ${caller.partnership.client_name || 'client'}`,
      notifyShell('A client took action on a recommendation', emailLines.length ? emailLines : [action],
        { label: 'Open admin →', href: 'https://davisdigitalstudio.com/dds-studio-manage-9k2p' }));
  } catch (_) {}

  return json({ ok: true, data: { recommendation_id: recId, new_status: newStatus } }, 200, reqCors);
}

// gp_rec_messages — load the Q&A thread for one recommendation (client view).
if (type === 'gp_rec_messages') {
  if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
  const caller = await gpResolveCaller(req);
  if (!caller) return json({ error: 'unauthorized' }, 401, reqCors);
  const recId = String(body.recommendation_id || '');
  if (!recId) return json({ error: 'recommendation_id required' }, 400, reqCors);
  // ownership: rec must belong to caller's partnership
  const rr = await gpDb(`recommendations?id=eq.${recId}&partnership_id=eq.${caller.partnership.id}&select=id&limit=1`);
  if (!(rr.ok && Array.isArray(rr.data) && rr.data.length)) return json({ error: 'forbidden' }, 403, reqCors);
  const mr = await gpDb(`growth_messages?recommendation_id=eq.${recId}&select=from_who,body,is_read,created_at&order=created_at.asc`);
  // mark Eric's messages read for this client
  await gpDb(`growth_messages?recommendation_id=eq.${recId}&from_who=eq.eric&is_read=eq.false`, 'PATCH', { is_read: true }).catch(() => {});
  return json({ data: mr.ok ? mr.data : [] }, 200, reqCors);
}

// gp_client_task_done — client checks off a "provide info" checklist item.
if (type === 'gp_client_task_done') {
  if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
  const caller = await gpResolveCaller(req);
  if (!caller) return json({ error: 'unauthorized' }, 401, reqCors);
  const taskId = String(body.task_id || '');
  if (!taskId) return json({ error: 'task_id required' }, 400, reqCors);
  // ownership
  const tr = await gpDb(`client_growth_tasks?id=eq.${taskId}&partnership_id=eq.${caller.partnership.id}&select=id&limit=1`);
  if (!(tr.ok && Array.isArray(tr.data) && tr.data.length)) return json({ error: 'forbidden' }, 403, reqCors);
  const r = await gpDb(`client_growth_tasks?id=eq.${taskId}`, 'PATCH', { status: 'done', completed_at: new Date().toISOString() });
  if (!r.ok) return json({ error: 'failed', detail: r.detail }, 200, reqCors);
  return json({ ok: true }, 200, reqCors);
}


// ════════════════════════════════════════════════════════════════════════════
//  GROWTH WORKFLOW — admin routes (NEW). Add these to ROUTE_MIN_ROLE as 'staff'
//  (rec_set_status, gp_quote_respond, gp_rec_reply, admin_growth_inbox,
//   rec_ai_evaluate). They run with the service role via gpDb().
// ════════════════════════════════════════════════════════════════════════════

// rec_set_status — Eric advances a recommendation (in_progress / completed / etc).
if (type === 'rec_set_status') {
  const id = String(body.id || '');
  const status = String(body.status || '');
  const ALLOWED = ['shared','approved','in_progress','completed','accepted','declined','done','dismissed','quote_requested','scheduled'];
  if (!id || !ALLOWED.includes(status)) return json({ error: 'id and valid status required' }, 400, reqCors);
  const patch: Record<string, unknown> = { status, last_action_at: new Date().toISOString() };
  if (status === 'in_progress') patch.started_at = new Date().toISOString();
  if (status === 'completed') patch.completed_at = new Date().toISOString();
  const r = await gpDb(`recommendations?id=eq.${id}`, 'PATCH', patch);
  if (!r.ok) return json({ error: 'failed', detail: r.detail }, 200, reqCors);
  // When completed, mark any linked growth_tasks done too.
  if (status === 'completed') {
    await gpDb(`growth_tasks?recommendation_id=eq.${id}`, 'PATCH', { status: 'done', completed_at: new Date().toISOString() }).catch(() => {});
  }
  return json({ ok: true }, 200, reqCors);
}

// gp_quote_respond — Eric answers a quote request.
if (type === 'gp_quote_respond') {
  const quoteId = String(body.quote_id || '');
  if (!quoteId) return json({ error: 'quote_id required' }, 400, reqCors);
  const patch: Record<string, unknown> = {
    status: String(body.status || 'sent'),
    amount: (body.amount !== undefined && body.amount !== null) ? Number(body.amount) : null,
    eric_note: String(body.eric_note || '').slice(0, 2000) || null,
    responded_at: new Date().toISOString(),
  };
  const r = await gpDb(`growth_quotes?id=eq.${quoteId}`, 'PATCH', patch);
  if (!r.ok) return json({ error: 'failed', detail: r.detail }, 200, reqCors);
  // Notify client via your existing notification table, if you want — left as
  // an email to the partnership contact.
  try {
    const q = Array.isArray(r.data) ? r.data[0] : r.data;
    if (q && q.partnership_id) {
      const pr = await gpDb(`v_partnership_overview?id=eq.${q.partnership_id}&select=contact_email,client_email,client_name&limit=1`);
      const row = pr.ok && Array.isArray(pr.data) ? pr.data[0] : null;
      const to = row?.contact_email || row?.client_email;
      if (to) {
        await sendEmail(to, `Your quote from Davis Digital Studio`,
          notifyShell('Here is your quote',
            [patch.amount ? `Price: $${patch.amount}` : '', patch.eric_note || ''].filter(Boolean),
            { label: 'See it in your workspace →', href: 'https://davisdigitalstudio.com/portal' }));
      }
    }
  } catch (_) {}
  return json({ ok: true }, 200, reqCors);
}

// gp_rec_reply — Eric replies to a client question on a recommendation.
if (type === 'gp_rec_reply') {
  const recId = String(body.recommendation_id || '');
  const reply = String(body.body || '').slice(0, 4000);
  if (!recId || !reply) return json({ error: 'recommendation_id and body required' }, 400, reqCors);
  const rr = await gpDb(`recommendations?id=eq.${recId}&select=partnership_id&limit=1`);
  const rec = rr.ok && Array.isArray(rr.data) && rr.data.length ? rr.data[0] : null;
  if (!rec) return json({ error: 'not_found' }, 404, reqCors);
  const ins = await gpDb('growth_messages', 'POST', {
    partnership_id: rec.partnership_id, recommendation_id: recId, from_who: 'eric', body: reply, is_read: false,
  });
  if (!ins.ok) return json({ error: 'failed', detail: ins.detail }, 200, reqCors);
  return json({ ok: true }, 200, reqCors);
}

// admin_growth_inbox — Eric's "what needs me" feed, grouped by workflow state.
if (type === 'admin_growth_inbox') {
  if (!SB_SERVICE) return json({ error: 'no service key' }, 500, reqCors);
  const [approved, needsQuote, scheduledRecs, declinedRecs, inProgress, completed, unreadMsgs] = await Promise.all([
    gpDb(`recommendations?status=eq.approved&select=id,partnership_id,title,impact,effort,last_action_at&order=last_action_at.desc&limit=100`),
    gpDb(`growth_quotes?status=eq.requested&select=id,partnership_id,recommendation_id,client_note,created_at&order=created_at.desc&limit=100`),
    gpDb(`recommendations?status=eq.scheduled&select=id,partnership_id,title,scheduled_for,scheduled_label&order=scheduled_for.asc&limit=100`),
    gpDb(`recommendations?status=eq.declined&select=id,partnership_id,title,declined_at,declined_reason&order=declined_at.desc&limit=100`),
    gpDb(`recommendations?status=eq.in_progress&select=id,partnership_id,title,started_at&order=started_at.desc&limit=100`),
    gpDb(`recommendations?status=eq.completed&select=id,partnership_id,title,completed_at&order=completed_at.desc&limit=50`),
    gpDb(`growth_messages?from_who=eq.client&is_read=eq.false&select=id,partnership_id,recommendation_id,body,created_at&order=created_at.desc&limit=100`),
  ]);
  return json({ data: {
    approved:       approved.ok ? approved.data : [],
    needs_quote:    needsQuote.ok ? needsQuote.data : [],
    needs_response: unreadMsgs.ok ? unreadMsgs.data : [],
    scheduled:      scheduledRecs.ok ? scheduledRecs.data : [],
    declined:       declinedRecs.ok ? declinedRecs.data : [],
    in_progress:    inProgress.ok ? inProgress.data : [],
    completed:      completed.ok ? completed.data : [],
  } }, 200, reqCors);
}

// rec_ai_evaluate — AI annotates recommendations before they're shared.
// NEVER changes status or approves. Only adds ai_bucket, confidence, ai_reasoning.
if (type === 'rec_ai_evaluate') {
  if (!ANTHROPIC_KEY) return json({ error: 'Server missing ANTHROPIC_KEY secret' }, 500, reqCors);
  const pid = String(body.partnership_id || '');
  if (!pid) return json({ error: 'partnership_id required' }, 400, reqCors);

  const [p, recs, work, health] = await Promise.all([
    gpDb(`v_partnership_overview?id=eq.${pid}&select=*&limit=1`),
    gpDb(`recommendations?partnership_id=eq.${pid}&status=in.(suggested,approved,shared)&select=id,category,title,detail,why,effort,impact,status&order=created_at.desc&limit=20`),
    gpDb(`work_log?partnership_id=eq.${pid}&select=title&order=done_at.desc&limit=30`),
    gpDb(`health_metrics?partnership_id=eq.${pid}&select=*&order=period.desc&limit=2`),
  ]);
  const part = p.ok && Array.isArray(p.data) ? p.data[0] : null;
  const recList = recs.ok && Array.isArray(recs.data) ? recs.data : [];
  if (!part) return json({ error: 'not_found' }, 404, reqCors);
  if (!recList.length) return json({ data: { evaluated: 0, flagged: [] } }, 200, reqCors);

  const snapshot = {
    business: part.client_name, segment: part.segment, site: part.primary_site,
    completed_work: (work.ok ? work.data : []).map((w: any) => w.title),
    health: health.ok ? health.data : [],
    recommendations: recList.map((r: any) => ({ id: r.id, category: r.category, title: r.title, detail: r.detail, why: r.why, effort: r.effort, impact: r.impact })),
  };

  const system = `You are the intelligence layer inside Davis Digital Studio's platform. You ENHANCE Eric's recommendations before they reach a small-business client. You never approve work or make decisions; you annotate. For each recommendation in the snapshot, evaluate it against the business context (site, completed work, health, segment).

For each rec, return:
- id (echo it back exactly)
- bucket: one of "urgent" | "high_impact" | "quick_win" | "long_term" | "info"
- confidence: integer 0-100 that this will produce a meaningful result for THIS business
- reasoning: one plain-English sentence a business owner understands, on why this matters NOW (no jargon, no em dashes)
- plain_title: the rec title rewritten in plain English if needed (else echo it)
- duplicate_of: id of another rec this duplicates, or null
- depends_on: short phrase of a prerequisite (e.g. "Google Business Profile must be set up first"), or null
- still_relevant: false if completed_work already covers it, else true

Respond with ONLY a JSON array, no markdown:
[{"id":"...","bucket":"...","confidence":0,"reasoning":"...","plain_title":"...","duplicate_of":null,"depends_on":null,"still_relevant":true}]`;
  const userMsg = `SNAPSHOT (JSON):\n${JSON.stringify(snapshot).slice(0, 6500)}`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2000, system, messages: [{ role: 'user', content: userMsg }] }),
      signal: AbortSignal.timeout(45000),
    });
    const aiData = await aiRes.json();
    if (aiData.error) return json({ error: aiData.error.message || 'ai_error' }, 200, reqCors);
    let text = '';
    if (Array.isArray(aiData.content)) text = aiData.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    text = (text || '').trim().replace(/```json|```/g, '').trim();
    let arr: any[] = [];
    try { arr = JSON.parse(text); } catch (_) { const m = text.match(/\[[\s\S]*\]/); if (m) { try { arr = JSON.parse(m[0]); } catch (_2) {} } }
    if (!Array.isArray(arr)) return json({ error: 'parse_failed' }, 200, reqCors);

    const BUCKETS = new Set(['urgent','high_impact','quick_win','long_term','info']);
    const validIds = new Set(recList.map((r: any) => String(r.id)));
    const flagged: any[] = [];
    let evaluated = 0;
    for (const x of arr) {
      const id = String(x.id || '');
      if (!validIds.has(id)) continue;
      const bucket = BUCKETS.has(x.bucket) ? x.bucket : 'info';
      const confidence = Math.max(0, Math.min(100, parseInt(x.confidence, 10) || 0));
      const reasoning = String(x.reasoning || '').slice(0, 400);
      // Annotate ONLY. Never touch status.
      await gpDb(`recommendations?id=eq.${id}`, 'PATCH', {
        ai_bucket: bucket, confidence, ai_reasoning: reasoning, ai_evaluated_at: new Date().toISOString(),
      });
      evaluated++;
      if (x.duplicate_of || x.depends_on || x.still_relevant === false) {
        flagged.push({ id, duplicate_of: x.duplicate_of || null, depends_on: x.depends_on || null, still_relevant: x.still_relevant !== false });
      }
    }
    return json({ data: { evaluated, flagged } }, 200, reqCors);
  } catch (e) {
    return json({ error: 'rec_ai_evaluate_failed', message: String(e) }, 200, reqCors);
  }
}


    //  END GROWTH PARTNERSHIP ROUTES

    // ===== end routes =====

    return json({ error: 'Unknown type' }, 400);

  } catch (err) {
    console.error('Edge function error:', err);
    return json({ error: String(err) }, 500);
  }
});