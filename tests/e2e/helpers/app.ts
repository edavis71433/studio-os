import { test, expect, Locator, Page, Route } from '@playwright/test';

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
// match, so a read of '/forms/inbox/<id>' is served by the '/forms/inbox' entry.
//
// Saves are answered only when a test planned them (builder item 212). A key with a
// method ('POST /threads/read') answers that method there and below; a plain key
// answers a save only to exactly its own path. Any other save is refused with a 501
// and fails the test, naming it: until Nov 2026 every save got "ok", so a page could
// send the wrong one and still pass.

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

// ── the ONE studio_os owner nav (mirrors lib/navigation.ts buildNav after the
//    Oct 2026 nav cut): the menu lists PLACES; `hidden: true` items are ⌘K-only
//    destinations the shell never draws (the builder's pages, Contacts, Visual
//    Studio, Broadcasts, Sharing, Connections, Help). ─────────────────────────
export const STUDIO_NAV = [
  { key: 'today', label: 'Today', items: [{ key: 'today', label: 'Today', href: '/today.html' }] },
  { key: 'website', label: 'Website', items: [
    { key: 'content', label: 'Website', href: '/presence.html', desc: 'Your site at a glance: what’s live, the health check and recent activity.' },
    { key: 'business_info', label: 'Business info', href: '/presence.html#business', hidden: true },
    { key: 'design', label: 'Design', href: '/presence.html#design', hidden: true },
    { key: 'publish', label: 'Publish', href: '/presence.html#publish', hidden: true },
    { key: 'history', label: 'History', href: '/presence.html#history', hidden: true },
  ] },
  { key: 'customers', label: 'Customers', items: [
    { key: 'customers', label: 'Customers', href: '/customers.html' },
    { key: 'contacts', label: 'Contacts', href: '/contacts.html', hidden: true },
  ] },
  { key: 'pipeline', label: 'Pipeline', items: [{ key: 'pipeline', label: 'Pipeline', href: '/pipeline.html' }] },
  { key: 'projects', label: 'Projects', items: [{ key: 'projects', label: 'Projects', href: '/projects.html' }] },
  { key: 'inbox', label: 'Inbox', items: [
    { key: 'inbox', label: 'Inbox', href: '/inbox.html' },
    { key: 'broadcasts', label: 'Broadcasts', href: '/broadcasts.html', hidden: true },
  ] },
  { key: 'files', label: 'Files', items: [
    { key: 'files_all', label: 'Files', href: '/files.html' },
    { key: 'files_visual', label: 'Visual Studio', href: '/visual-studio.html', hidden: true },
  ] },
  { key: 'analytics', label: 'Analytics', items: [{ key: 'analytics', label: 'Analytics', href: '/analytics.html' }] },
  // utilities — the foot of the sidebar / the account menu, never the primary bar
  { key: 'connections', label: 'Connections', utility: true, items: [{ key: 'connections', label: 'Connections', href: '/connections.html', hidden: true }] },
  { key: 'settings', label: 'Settings', utility: true, items: [
    { key: 'settings', label: 'Settings', href: '/settings.html' },
    { key: 'sharing', label: 'Sharing & access', href: '/sharing.html', hidden: true },
  ] },
  { key: 'help', label: 'Help', utility: true, items: [{ key: 'help', label: 'Help', href: '/help.html', hidden: true }] },
];

// ── an AGENCY member at studio level (buildNav studioLevel): the eight ───────
export const STUDIO_LEVEL_NAV = [
  { key: 'home', label: 'Home', items: [
    { key: 'home', label: 'Home', href: '/agency.html', desc: 'Your studio’s home — every client, what needs you today, your money and your numbers.' },
    { key: 'analytics', label: 'Analytics', href: '/analytics.html', hidden: true },
  ] },
  { key: 'inbox', label: 'Inbox', items: [
    { key: 'inbox', label: 'Inbox', href: '/inbox.html' },
    { key: 'broadcasts', label: 'Broadcasts', href: '/broadcasts.html', hidden: true },
  ] },
  { key: 'customers', label: 'Customers', items: [
    { key: 'customers', label: 'Customers', href: '/customers.html' },
    { key: 'add_client', label: 'Add a customer', href: '/agency.html#add', desc: 'Set up a new client — their workspace, their site and their invitation.', hidden: true },
    { key: 'contacts', label: 'Contacts', href: '/contacts.html', hidden: true },
  ] },
  { key: 'pipeline', label: 'Pipeline', items: [{ key: 'pipeline', label: 'Pipeline', href: '/pipeline.html' }] },
  { key: 'projects', label: 'Projects', items: [{ key: 'projects', label: 'Projects', href: '/projects.html' }] },
  { key: 'files', label: 'Files', items: [
    { key: 'files_all', label: 'Files', href: '/files.html' },
    { key: 'files_visual', label: 'Visual Studio', href: '/visual-studio.html', hidden: true },
  ] },
  { key: 'website', label: 'Your website', utility: true, items: [
    { key: 'content', label: 'Your website', href: '/presence.html' },
    { key: 'business_info', label: 'Business info', href: '/presence.html#business', hidden: true },
    { key: 'design', label: 'Design', href: '/presence.html#design', hidden: true },
    { key: 'add_page', label: 'Add a page', href: '/presence.html#addpage', hidden: true },
    { key: 'domain', label: 'Domain & email', href: '/presence.html#domain', hidden: true },
    { key: 'publish', label: 'Publish', href: '/presence.html#publish', hidden: true },
    { key: 'history', label: 'History', href: '/presence.html#history', hidden: true },
  ] },
  { key: 'settings', label: 'Settings', utility: true, items: [
    { key: 'settings', label: 'Settings', href: '/settings.html' },
    { key: 'sharing', label: 'Sharing & access', href: '/sharing.html', hidden: true },
  ] },
  { key: 'help', label: 'Help', utility: true, items: [{ key: 'help', label: 'Help', href: '/help.html', hidden: true }] },
];

// ── an AGENCY member drilled INTO a client (buildNav clientScoped): the six ──
export const CLIENT_NAV = [
  { key: 'overview', label: 'Overview', items: [{ key: 'overview', label: 'Overview', href: '/today.html' }] },
  { key: 'website', label: 'Website', items: [
    { key: 'content', label: 'Website', href: '/presence.html' },
    { key: 'business_info', label: 'Business info', href: '/presence.html#business', hidden: true },
    { key: 'publish', label: 'Publish', href: '/presence.html#publish', hidden: true },
  ] },
  { key: 'record', label: 'Record', items: [{ key: 'record', label: 'Record', href: '/crm.html' }] },
  { key: 'project', label: 'Project', items: [{ key: 'project', label: 'Project', href: '/projects.html' }] },
  { key: 'messages', label: 'Messages', items: [{ key: 'messages', label: 'Messages', href: '/inbox.html' }] },
  { key: 'files', label: 'Files', items: [
    { key: 'files_all', label: 'Files', href: '/files.html' },
    { key: 'files_visual', label: 'Visual Studio', href: '/visual-studio.html', hidden: true },
  ] },
  { key: 'studio', label: 'Studio', items: [
    { key: 'home', label: 'Studio home', href: '/agency.html', hidden: true },
    { key: 'customers', label: 'All customers', href: '/customers.html', hidden: true },
    { key: 'pipeline', label: 'Pipeline', href: '/pipeline.html', hidden: true },
    { key: 'analytics', label: 'Analytics', href: '/analytics.html', hidden: true },
  ] },
  { key: 'settings', label: 'Settings', utility: true, items: [{ key: 'settings', label: 'Settings', href: '/settings.html', hidden: true }] },
  { key: 'help', label: 'Help', utility: true, items: [{ key: 'help', label: 'Help', href: '/help.html', hidden: true }] },
];

export const ALL_FEATURES = ['website', 'developer', 'forms', 'business_moments', 'connected', 'ai', 'relationship', 'reports', 'client_portal'];

type Json = Record<string, unknown>;
/** A stand-in's answer: fixed, or worked out from what a save sent, as a route that returns
 *  the saved row answers (`(sent) => ({ data: { ...row, ...sent } })`). */
// deno-lint-ignore no-explicit-any
export type Answer = Json | ((sent: any) => Json);

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
      // a REAL notice row: a database uuid + the period/dismissible pair the feed
      // now ships, so Today can decide whether to offer a manual "Done" at all.
      notices: [{ id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', kind: 'lead_followup', period: 'lead:l1', dismissible: true, headline: 'A quote request is waiting for a reply', body: 'Sam reached out about a day ago.', href: '/inbox.html#enquiries?sel=lead:l1' }],
      pending_approvals: [{ id: 'p1', kind: 'infrastructure', title: 'Protect your email', summary: 'Add email authentication.', decide_path: '/foundations/plans/p1/decide' }],
      last_published: { created_at: '2026-07-05T00:00:00Z', completed_at: '2026-07-05T00:05:00Z' },
    } },
    '/moments': { data: [{ id: 'm1', headline: 'Add your holiday hours', summary: 'Customers check before they visit.', moment_type: 'reminder', tone: 'reminder', dismissable: true }] },
    '/marketplace/features': { data: { features: ['Online menu', 'Booking link'], note: 'These come with your kind of business.' } },
    '/search/health': { data: { verification: { ok: true }, seo_fields: { title: 'Set', description: 'Set' }, links: [] } },
    '/coach/health': { data: { status: 'attention', headline: 'One thing could help.', suggestions: [{ text: 'Someone’s waiting for a reply.', href: '/inbox.html#enquiries' }] } },
    '/coach/journey': { data: { milestones: [
      { key: 'created', label: 'Your presence began', achieved: true, at: '2026-01-01T00:00:00Z', note: 'Your workspace was created — the journey starts here.' },
      { key: 'published', label: 'First published', achieved: true, at: '2026-02-01T00:00:00Z', note: 'Your website went live for the first time. 🎉' },
      { key: 'first_inquiry', label: 'First inquiry', achieved: false, at: null, note: 'Your first message from a visitor will land here.' },
    ], latestCelebration: { key: 'published', label: 'First published', achieved: true, at: '2026-02-01T00:00:00Z', note: 'Your website went live for the first time. 🎉' } } },
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
    // the saves a page makes by itself when something is opened, answered as the server
    // answers them (routes/project_comms.ts, routes/client_delivery.ts)
    'POST /threads/read': { data: { ok: true } },
    'POST /notifications/read': { data: { ok: true } },
    'POST /client/notifications/read': { data: { ok: true } },
  };
}

const SAVES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const pathOf = (key: string) => key.slice(key.indexOf('/'));
const under = (path: string, key: string) => path === key || path.startsWith(key + '/');

/** The fixture that answers this call, if any: a key naming its method, or a plain key
 *  (any read at or under it; a save only to exactly it). The longest path wins, and a
 *  plain key wins a tie, since a test wrote it for that very path. */
export function fixtureFor(keys: string[], method: string, path: string): string | undefined {
  const plain = keys.filter((k) => k.startsWith('/') && (SAVES.has(method) ? path === k : under(path, k)));
  const named = keys.filter((k) => k.startsWith(method + ' /') && under(path, pathOf(k)));
  return [...plain, ...named].sort((a, b) => pathOf(b).length - pathOf(a).length)[0];
}

export interface AppOptions {
  session?: unknown | null;         // undefined → OWNER_SESSION; null → signed-out
  api?: Record<string, Answer>;     // overrides/extends fixtures by path-after-/presence ('/path' or 'POST /path')
}

/** Stub Supabase, seed the session, and mock the presence API. Call BEFORE goto. */
export async function installApp(page: Page, opts: AppOptions = {}): Promise<void> {
  const session = opts.session === undefined ? OWNER_SESSION : opts.session;
  const fixtures: Record<string, Answer> = { ...defaults(), ...(opts.api || {}) };

  // the shell keeps the who-am-I answer for the visit (sessionStorage 'dds-ctx:…').
  // A second installApp on a page that has already loaded stands for a different
  // sign-in, so drop the kept copy; the next goto asks the new fixtures.
  if (!/^about:/.test(page.url())) {
    await page.evaluate(() => {
      try { for (const k of Object.keys(sessionStorage)) if (k.startsWith('dds-ctx:')) sessionStorage.removeItem(k); } catch { /* storage may be denied */ }
    }).catch(() => { /* the page is mid-navigation or closed */ });
  }

  // seed the session before any page script runs
  await page.addInitScript((s) => { (window as unknown as { __E2E_SESSION: unknown }).__E2E_SESSION = s; }, session);
  await watchQuiet(page);

  // the shell's first-login tour auto-opens (aria-modal, intercepts clicks —
  // reliably so at phone widths) whenever 'dds-toured:<role>' is absent. No spec
  // exercises the tour; mark it seen for every persona the fixtures use so page
  // tests stay deterministic. A future tour spec should clear its own key.
  await page.addInitScript(() => {
    for (const role of ['business_owner', 'business_staff', 'developer', 'client_reviewer', 'member']) {
      try { localStorage.setItem('dds-toured:' + role, '1'); } catch { /* storage may be denied */ }
    }
  });
  // The editor's one-time tip comes up 0.4 s after the editor opens and sits over the canvas,
  // so every test starts with it seen (builder item 108). A test of the tip itself clears it
  // with showTips(page) before it opens the page.
  await page.addInitScript(() => {
    try {
      if (sessionStorage.getItem('e2e-tips')) return;
      const seen = JSON.parse(localStorage.getItem('dds-hints') || '{}');
      localStorage.setItem('dds-hints', JSON.stringify({ ...seen, 'edit-tap': 1, 'edit-doubleclick': 1 }));
    } catch { /* storage may be denied */ }
  });

  // serve the supabase-js request with our stub (fully offline) — matches both
  // the historical CDN URL and the self-hosted /vendor/ copy (#169 vendoring)
  await page.route(/@supabase\/supabase-js|\/vendor\/supabase-js/, (route: Route) =>
    route.fulfill({ contentType: 'application/javascript', body: SUPABASE_STUB }));

  // builder list item 230: the sign-in service's public settings (does it offer Google?), answered here
  await page.route('**/auth/v1/settings', (route: Route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ external: { email: true, google: false }, disable_signup: false }) }));

  // mock every presence Edge Function call
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/functions\/v1\/presence/, '') || '/';
    const method = route.request().method();
    const key = fixtureFor(Object.keys(fixtures), method, path);
    if (key) {
      const answer = fixtures[key];
      const sent = () => { try { return route.request().postDataJSON(); } catch { return null; } };
      let body = typeof answer === 'function' ? answer(sent()) : answer;
      // builder item 37: GET /site?with=… brings the editor's lists beside the site. The pretend
      // server brings none, so the page reads each list on its own, through whatever answers a
      // test set up for it; a test of the one read answers /site with its own `parts`.
      if (method === 'GET' && path === '/site' && url.searchParams.has('with') && body && typeof body === 'object' && !Array.isArray(body) && !('parts' in body)) body = { ...body, parts: {} };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    }
    if (SAVES.has(method)) {
      const save = `${method} ${path}`;
      try {
        expect.soft(save, `the pretend server was sent a save this test didn't plan for. Answer '${save}' on purpose (a fixture in installApp's api, or a page.route) and check it where it matters`).toBe('a save the test planned');
      } catch { /* the test has already ended */ }
      return route.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ error: 'unplanned_write', message: `The test didn't plan for ${save}.` }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {} }) });
  });
}

// ── A finger or a mouse (builder item 108) ───────────────────────────────────
// The tablet and the phone are touch screens: nothing hovers there. A test that brought a
// section's toolbar up with a hover passed on them while testing nothing a finger can do,
// so it points and presses the way the device does.
/** Whether this test's device is a touch screen (the tablet and phone projects). */
export const touchScreen = () => !!test.info().project.use.hasTouch;
/** Points at something: a finger taps it (a section's toolbar comes with the tap), a mouse rests on it. */
export async function pointAt(target: Locator, opts: { position?: { x: number; y: number }; force?: boolean } = {}): Promise<void> {
  if (touchScreen()) await target.tap(opts); else await target.hover(opts);
}
/** Presses a button: a tap on a touch screen, a click with a mouse. */
export async function pressButton(target: Locator): Promise<void> {
  if (touchScreen()) await target.tap(); else await target.click();
}

/** Lets a test see the editor's one-time tips: call before installApp's page opens. */
export const showTips = (page: Page) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem('e2e-tips')) { sessionStorage.setItem('e2e-tips', '1'); localStorage.removeItem('dds-hints'); } } catch { /* storage may be denied */ }
});

// ── "Nothing left to happen" (builder item 108) ──────────────────────────────
// A test that proves something did NOT happen used to sleep past the page's own wait (a
// save's 1.2 s, a redraw's 350 ms) and then look. Under load the timer could land after
// the sleep, and on a quiet machine the sleep was time thrown away. Instead, every page
// installApp opens counts the timers it has set up to 2 seconds ahead (a toast's 2.2 s
// and longer are left out, as are repeating timers), the work it has left for an idle
// moment, and the requests it has sent and not finished reading. settled(page) waits
// until there are none for 150 ms in a row.
// { requests: false } waits on the timers alone, for a test holding a request on purpose.
export async function watchQuiet(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Quiet = { (requests?: boolean): boolean; pending: () => { timers: number[]; idle: number; requests: number } };
    const w = window as unknown as Record<string, unknown> & { __e2eQuiet?: Quiet };
    if (w.__e2eQuiet) return;
    const later = window.setTimeout.bind(window), stop = window.clearTimeout.bind(window), send = window.fetch.bind(window);
    const timers = new Map<number, number>(), idles = new Set<number>();
    let requests = 0;
    const doneSoon = () => { later(() => { requests--; }, 0); };   // after the caller's own .then has run
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
      const delay = Number(ms) || 0;
      if (typeof fn !== 'function' || delay > 2000) return later(fn, ms, ...args);
      const id: number = later((...a: unknown[]) => { timers.delete(id); (fn as (...x: unknown[]) => void)(...a); }, ms, ...args);
      timers.set(id, delay);
      return id;
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id?: number) => { if (id !== undefined) timers.delete(id); stop(id); }) as typeof window.clearTimeout;
    if (typeof window.requestIdleCallback === 'function') {
      const idle = window.requestIdleCallback.bind(window), unidle = window.cancelIdleCallback.bind(window);
      window.requestIdleCallback = ((fn: IdleRequestCallback, o?: IdleRequestOptions) => {
        const id: number = idle((d) => { idles.delete(id); fn(d); }, o);
        idles.add(id);
        return id;
      }) as typeof window.requestIdleCallback;
      window.cancelIdleCallback = ((id: number) => { idles.delete(id); unidle(id); }) as typeof window.cancelIdleCallback;
    }
    window.fetch = ((...a: Parameters<typeof fetch>) => {
      requests++;
      return send(...a).then((res) => {
        for (const m of ['json', 'text', 'blob', 'arrayBuffer', 'formData'] as const) {
          const own = (res[m] as () => Promise<unknown>).bind(res);
          (res as unknown as Record<string, unknown>)[m] = () => { requests++; return own().finally(doneSoon); };
        }
        doneSoon();
        return res;
      }, (e) => { doneSoon(); throw e; });
    }) as typeof fetch;
    const quiet = ((withRequests = true) => timers.size === 0 && idles.size === 0 && (!withRequests || requests === 0)) as Quiet;
    quiet.pending = () => ({ timers: [...timers.values()], idle: idles.size, requests });
    w.__e2eQuiet = quiet;
  });
}

export async function settled(page: Page, { requests = true, timeout = 10_000 } = {}): Promise<void> {
  const look = () => page.evaluate((r) => {
    const q = (window as unknown as { __e2eQuiet?: ((r: boolean) => boolean) & { pending: () => unknown } }).__e2eQuiet;
    return q ? { quiet: q(r), pending: q.pending() } : null;
  }, requests).catch(() => ({ quiet: false, pending: 'the page was changing' }));
  const end = Date.now() + timeout;
  let calmSince = 0, last: unknown = null;
  for (;;) {
    const now = await look();
    if (now === null) throw new Error('settled() needs the page opened after installApp or watchQuiet');
    last = now.pending;
    if (!now.quiet) calmSince = 0;
    else if (!calmSince) calmSince = Date.now();
    else if (Date.now() - calmSince >= 150) return;
    if (Date.now() > end) throw new Error(`the page still had work pending after ${timeout} ms: ${JSON.stringify(last)}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

// ── request-body spy for binary uploads ──────────────────────────────────────
// Playwright's WebKit does not expose a Blob/File request body to the
// interception layer: `request.postDataBuffer()` is null for a `fetch(url,
// { method: 'PUT', body: file })` that Chromium reports byte for byte. The
// bytes are still observable at the fetch boundary, so a spec that must prove
// "the PUT body IS the picked file" installs this before goto and reads the
// recorded bodies back with `sentBodies(page)`. The real fetch still runs —
// the spy only reads the body it was handed.
export interface SentBody { url: string; method: string; type: string; bytes: number[] }

export async function spyRequestBodies(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __E2E_BODIES: SentBody[]; fetch: typeof fetch };
    w.__E2E_BODIES = [];
    const orig = w.fetch.bind(window);
    w.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init && init.body;
      if (body && typeof (body as Blob).arrayBuffer === 'function') {
        const buf = await (body as Blob).arrayBuffer();
        w.__E2E_BODIES.push({
          url: String(input instanceof Request ? input.url : input),
          method: String((init && init.method) || 'GET').toUpperCase(),
          type: (body as Blob).type || '',
          bytes: Array.from(new Uint8Array(buf)),
        });
      }
      return orig(input, init);
    };
  });
}

/** The bodies recorded by spyRequestBodies, oldest first (bytes as a Buffer). */
export async function sentBodies(page: Page): Promise<Array<{ url: string; method: string; type: string; body: Buffer }>> {
  const raw = await page.evaluate(() => (window as unknown as { __E2E_BODIES?: SentBody[] }).__E2E_BODIES || []);
  return raw.map((b) => ({ url: b.url, method: b.method, type: b.type, body: Buffer.from(b.bytes) }));
}

// List item 33: the builder asks its questions in its own dialog now, not the browser's confirm().
// answerAsks answers each one as it opens by clicking its real button, the way page.on('dialog')
// accepted or dismissed the browser's box, and keeps the words asked (askedSoFar). It covers the
// page already open and any it navigates to; setAsksAnswer changes the answer midway.
export async function answerAsks(page: Page, answer = true): Promise<void> {
  const install = (yes: boolean) => {
    const w = window as unknown as { __askAnswer: boolean; __asked: string[]; __askWatch?: boolean };
    w.__askAnswer = yes; w.__asked = w.__asked || [];
    if (w.__askWatch) return;
    w.__askWatch = true;
    new MutationObserver(() => {
      const d = document.querySelector('dialog.ask-yes[open]:not([data-e2e-answered])');
      if (!d) return;
      d.setAttribute('data-e2e-answered', '');
      w.__asked.push((d.querySelector('.ask-msg')?.textContent || '').trim());
      (d.querySelector(w.__askAnswer ? '.ask-ok' : '.ask-cancel') as HTMLElement).click();
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
  };
  await page.addInitScript(install, answer);
  await page.evaluate(install, answer).catch(() => { /* nothing open yet */ });
}
export const setAsksAnswer = (page: Page, yes: boolean) => page.evaluate((y) => { (window as unknown as { __askAnswer: boolean }).__askAnswer = y; }, yes);
export const askedSoFar = (page: Page) => page.evaluate(() => (window as unknown as { __asked?: string[] }).__asked || []);
