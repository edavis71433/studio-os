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

// ── the ONE studio_os owner nav (mirrors lib/navigation.ts buildNav, v1.0) ───
export const STUDIO_NAV = [
  { key: 'today', label: 'Today', items: [{ key: 'today', label: 'Today', href: '/today.html' }] },
  { key: 'website', label: 'Website', items: [
    { key: 'content', label: 'Website', href: '/presence.html' },
    { key: 'business_info', label: 'Business info', href: '/presence.html#business' },
    { key: 'design', label: 'Design', href: '/presence.html#design' },
    { key: 'publish', label: 'Publish', href: '/presence.html#publish' },
    { key: 'history', label: 'History', href: '/presence.html#history' },
  ] },
  { key: 'customers', label: 'Customers', items: [{ key: 'customers', label: 'Customers', href: '/crm.html' }] },
  { key: 'files', label: 'Files', items: [
    { key: 'files_all', label: 'Files', href: '/files.html' },
    { key: 'files_visual', label: 'Visual Studio', href: '/visual-studio.html' },
  ] },
  { key: 'analytics', label: 'Analytics', items: [{ key: 'analytics', label: 'Analytics', href: '/analytics.html' }] },
  { key: 'inbox', label: 'Inbox', items: [{ key: 'inbox', label: 'Inbox', href: '/inbox.html' }] },
  // utilities — rendered in the profile/overflow menu, not the primary bar
  { key: 'connections', label: 'Connections', utility: true, items: [{ key: 'connect', label: 'Connections', href: '/connections.html' }] },
  { key: 'settings', label: 'Settings', utility: true, items: [{ key: 'settings', label: 'Settings', href: '/presence.html#settings' }] },
  { key: 'help', label: 'Help', utility: true, items: [{ key: 'help', label: 'Help', href: '/help.html' }] },
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
    '/coach/health': { data: { status: 'attention', headline: 'One thing could help.', suggestions: [{ text: 'Someone’s waiting for a reply.', href: '/leads.html' }] } },
    '/coach/journey': { data: { milestones: [
      { key: 'created', label: 'Your presence began', achieved: true, at: '2026-01-01T00:00:00Z', note: 'Your workspace was created — the journey starts here.' },
      { key: 'published', label: 'First published', achieved: true, at: '2026-02-01T00:00:00Z', note: 'Your website went live for the first time. 🎉' },
      { key: 'first_inquiry', label: 'First inquiry', achieved: false, at: null, note: 'Your first message from a visitor will land here.' },
    ], latestCelebration: { key: 'published', label: 'First published', achieved: true, at: '2026-02-01T00:00:00Z', note: 'Your website went live for the first time. 🎉' } } },
    '/coach/memory': { data: { memory: { industry: 'Restaurant', tone: 'warm and local', goals: [], priorities: ['Reply quickly.'], seasonality: 'Holidays drive interest.', stage: 'established' }, sentence: 'I know Restaurant — established, and I keep the tone warm and local.' } },
    '/forms/inbox': { data: { submissions: [
      { id: 'l1', form_kind: 'quote', name: 'Sam Rivera', email: 'sam@example.com', phone: '', message: 'Can I get a quote for a patio?', source_page: '/contact/', status: 'new', created_at: '2026-07-07T00:00:00Z' },
      { id: 'l2', form_kind: 'contact', name: 'Dana Lee', email: 'dana@example.com', phone: '', message: 'Loved the work!', source_page: '/contact/', status: 'read', created_at: '2026-07-02T00:00:00Z' },
    ], unread: 1 } },
    '/crm/timeline': { data: { items: [
      { id: 't1', at: '2026-07-07T00:00:00Z', kind: 'lead', audience: 'shared', title: 'Quote request from Sam Rivera', detail: 'Can I get a quote for a patio?' },
      { id: 't2', at: '2026-07-05T00:00:00Z', kind: 'publish', audience: 'shared', title: 'Published the site' },
    ], is_studio_view: true } },
    '/crm/notes': { data: { notes: [], can_write_internal: true } },
    // client.html iterates this as an array (ensureSnaps); the generic {data:{}}
    // fallback would throw mid-render and strand the "Needs you" skeleton.
    '/client/projects': { data: [] },
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

  // the shell's first-login tour auto-opens (aria-modal, intercepts clicks —
  // reliably so at phone widths) whenever 'dds-toured:<role>' is absent. No spec
  // exercises the tour; mark it seen for every persona the fixtures use so page
  // tests stay deterministic. A future tour spec should clear its own key.
  await page.addInitScript(() => {
    for (const role of ['business_owner', 'client_reviewer', 'member']) {
      try { localStorage.setItem('dds-toured:' + role, '1'); } catch { /* storage may be denied */ }
    }
  });

  // serve the supabase-js request with our stub (fully offline) — matches both
  // the historical CDN URL and the self-hosted /vendor/ copy (#169 vendoring)
  await page.route(/@supabase\/supabase-js|\/vendor\/supabase-js/, (route: Route) =>
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
