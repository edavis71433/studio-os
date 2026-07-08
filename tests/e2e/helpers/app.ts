import { Page, Route } from '@playwright/test';

// ── The hermetic app harness ─────────────────────────────────────────────────
// Every signed-in page does two network things: (1) loads supabase-js from a CDN
// and calls auth.getSession(), (2) calls the presence Edge Function. We control
// BOTH so the real page JS runs against fixtures — no backend, no credentials.
//
//   installApp(page, { session, api })  → stub Supabase + mock the API, then the
//                                         caller navigates to the page under test.
//
// `session` null → signed-out. `api` overrides/extends the default fixtures,
// keyed by the path AFTER `/presence` (e.g. '/portal/context'). Longest-prefix
// match, so '/forms/inbox/<id>' is served by the '/forms/inbox' entry.

/** A tiny stand-in for the supabase-js global — getSession returns whatever the
 *  test seeded on window.__E2E_SESSION, so we never touch real auth or storage. */
const SUPABASE_STUB = `
window.supabase = {
  createClient: function () {
    return {
      auth: {
        getSession: async function () { return { data: { session: window.__E2E_SESSION || null } }; },
        getUser: async function () { return { data: { user: (window.__E2E_SESSION || {}).user || null } }; },
        onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
        signOut: async function () { window.__E2E_SESSION = null; return { error: null }; },
      },
    };
  },
};
`;

export const OWNER_SESSION = {
  access_token: 'e2e-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: 4102444800, // year 2100 — never "expired" during a test
  refresh_token: 'e2e-refresh',
  user: { id: 'e2e-owner', email: 'owner@example.com', aud: 'authenticated', role: 'authenticated' },
};

// ── the ONE studio_os owner nav (mirrors lib/navigation.ts buildNav) ─────────
export const STUDIO_NAV = [
  { key: 'today', label: 'Today', items: [
    { key: 'today', label: 'Today', href: '/today.html' },
    { key: 'workspace', label: 'Your Presence', href: '/presence.html' },
    { key: 'relationship', label: 'Relationship', href: '/crm.html' },
    { key: 'leads', label: 'Leads', href: '/leads.html' },
  ] },
  { key: 'website', label: 'Website', items: [
    { key: 'content', label: 'Your website', href: '/presence.html' },
    { key: 'business_info', label: 'Business info', href: '/presence.html#business' },
    { key: 'design', label: 'Design', href: '/presence.html#design' },
    { key: 'media', label: 'Photos', href: '/presence.html#media' },
    { key: 'publish', label: 'Publish', href: '/presence.html#publish' },
    { key: 'history', label: 'History & versions', href: '/presence.html#history' },
  ] },
  { key: 'grow', label: 'Grow', items: [
    { key: 'moments', label: 'Business Moments', href: '/today.html' },
    { key: 'growth', label: 'Growth', href: '/presence.html' },
    { key: 'connect', label: 'Connections', href: '/connections.html' },
  ] },
  { key: 'settings', label: 'Settings', items: [{ key: 'settings', label: 'Settings', href: '/presence.html#settings' }] },
  { key: 'help', label: 'Help', items: [{ key: 'help', label: 'Help', href: '/help.html' }] },
];

export const ALL_FEATURES = ['website', 'developer', 'forms', 'business_moments', 'connected', 'ai', 'relationship', 'reports', 'client_portal'];

type Json = Record<string, unknown>;

/** Default fixtures — a studio_os owner with two things needing them. */
function defaults(): Record<string, Json> {
  return {
    '/portal/context': { data: {
      site_role: 'business_owner', edition: 'presence',
      edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
      is_agency: false, is_operator: false, sees_full_workspace: true, is_client_portal: false,
      capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
      landing: '/today.html', attention_count: 2, nav: STUDIO_NAV,
      plan_key: 'presence', upsell: null,
    } },
    '/portal/feed': { data: {
      role: 'business_owner',
      moments: [{ id: 'm1', headline: 'Add your holiday hours', summary: 'Customers check before they visit.', moment_type: 'reminder', created_at: '2026-07-01T00:00:00Z' }],
      notices: [{ id: 'n1', kind: 'lead_followup', headline: 'A quote request is waiting for a reply', body: 'Sam reached out about a day ago.', href: '/leads.html' }],
      pending_approvals: [{ id: 'p1', kind: 'infrastructure', title: 'Protect your email', summary: 'Add email authentication.', decide_path: '/foundations/plans/p1/decide' }],
      last_published: { created_at: '2026-07-05T00:00:00Z', completed_at: '2026-07-05T00:05:00Z' },
    } },
    '/moments': { data: [{ id: 'm1', headline: 'Add your holiday hours', summary: 'Customers check before they visit.', moment_type: 'reminder', tone: 'reminder', dismissable: true }] },
    '/marketplace/features': { data: { features: ['Online menu', 'Booking link'], note: 'These come with your kind of business.' } },
    '/search/health': { data: { verification: { ok: true }, seo_fields: { title: 'Set', description: 'Set' }, links: [] } },
    '/forms/inbox': { data: { submissions: [
      { id: 'l1', form_kind: 'quote', name: 'Sam Rivera', email: 'sam@example.com', phone: '', message: 'Can I get a quote for a patio?', source_page: '/contact/', status: 'new', created_at: '2026-07-07T00:00:00Z' },
      { id: 'l2', form_kind: 'contact', name: 'Dana Lee', email: 'dana@example.com', phone: '', message: 'Loved the work!', source_page: '/contact/', status: 'read', created_at: '2026-07-02T00:00:00Z' },
    ], unread: 1 } },
    '/crm/timeline': { data: { items: [
      { id: 't1', at: '2026-07-07T00:00:00Z', kind: 'lead', audience: 'shared', title: 'Quote request from Sam Rivera', detail: 'Can I get a quote for a patio?' },
      { id: 't2', at: '2026-07-05T00:00:00Z', kind: 'publish', audience: 'shared', title: 'Published the site' },
    ], is_studio_view: true } },
    '/crm/notes': { data: { notes: [], can_write_internal: true } },
    '/crm/profile': { data: { profile: { business_name: 'Marlow’s Kitchen', health: 'healthy', live: true }, summary: 'Marlow’s Kitchen’s website is live.', is_studio_view: true, last_activity_at: '2026-07-07T00:00:00Z' } },
  };
}

export interface AppOptions {
  session?: unknown | null;         // undefined → OWNER_SESSION; null → signed-out
  api?: Record<string, Json>;       // overrides/extends fixtures by path-after-/presence
}

/** Stub Supabase, seed the session, and mock the presence API. Call BEFORE goto. */
export async function installApp(page: Page, opts: AppOptions = {}): Promise<void> {
  const session = opts.session === undefined ? OWNER_SESSION : opts.session;
  const fixtures = { ...defaults(), ...(opts.api || {}) };

  // seed the session before any page script runs
  await page.addInitScript((s) => { (window as unknown as { __E2E_SESSION: unknown }).__E2E_SESSION = s; }, session);

  // serve the supabase-js CDN request with our stub (fully offline)
  await page.route(/@supabase\/supabase-js/, (route: Route) =>
    route.fulfill({ contentType: 'application/javascript', body: SUPABASE_STUB }));

  // mock every presence Edge Function call
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/functions\/v1\/presence/, '') || '/';
    // longest-prefix match so '/forms/inbox/<id>' → '/forms/inbox'
    const key = Object.keys(fixtures).filter((k) => path === k || path.startsWith(k + '/') || path.startsWith(k + '?'))
      .sort((a, b) => b.length - a.length)[0];
    if (key) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixtures[key]) });
    // a write we don't specifically fixture (mark-read, dismiss, decide) → generic OK
    if (route.request().method() !== 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {} }) });
  });
}
