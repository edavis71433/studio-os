import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp } from './helpers/app';

// The client portal (client.html) — a reviewer's calm world: mirror of "needs
// you" (Phase PP Section 4), then approve what's theirs to approve.
const REVIEWER_CTX = { data: {
  site_role: 'client_reviewer', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ['website', 'client_portal'], is_agency: false, is_operator: false,
  sees_full_workspace: false, is_client_portal: true, capabilities: ['view_shared'],
  landing: '/client.html', attention_count: 1, nav: [{ key: 'client', label: 'Your updates', items: [{ key: 'feed', label: 'Updates', href: '/client.html' }] }],
} };

test.describe('Client portal', () => {
  test('Home mirrors "needs you": approval card with actions + recent updates', async ({ page }) => {
    await installApp(page, { api: {
      '/portal/context': REVIEWER_CTX,
      '/portal/feed': { data: { role: 'client_reviewer',
        moments: [{ id: 'm1', headline: 'Your new hours are live', summary: 'Published last week.' }],
        pending_approvals: [{ id: 'p1', kind: 'infrastructure', title: 'Protect your email', summary: 'Add email authentication.', decide_path: '/foundations/plans/p1/decide' }],
        last_published: { created_at: '2026-07-05T00:00:00Z', completed_at: '2026-07-05T00:00:00Z' } } },
    } });
    await page.goto('/client.html');
    await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Protect your email' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Not yet' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent updates' })).toBeVisible();
    await expect(page.getByText('Your new hours are live')).toBeVisible();
  });

  test('approving a change confirms and reloads', async ({ page }) => {
    await installApp(page, { api: {
      '/portal/context': REVIEWER_CTX,
      '/portal/feed': { data: { role: 'client_reviewer', moments: [],
        pending_approvals: [{ id: 'p1', kind: 'infrastructure', title: 'Protect your email', summary: '', decide_path: '/foundations/plans/p1/decide' }],
        last_published: null } },
    } });
    await page.goto('/client.html');
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.locator('#toast')).toContainText('Approved — thank you.');
  });

  test('caught-up state when nothing is pending', async ({ page }) => {
    await installApp(page, { api: {
      '/portal/context': REVIEWER_CTX,
      '/portal/feed': { data: { role: 'client_reviewer', moments: [], pending_approvals: [], last_published: null } },
    } });
    await page.goto('/client.html');
    await expect(page.getByText('You’re all caught up.')).toBeVisible();
    await expect(page.getByText('Nothing needs you right now — we’ll flag anything here the moment it does.')).toBeVisible();
  });

  test('an owner landing here is pointed back to the full workspace', async ({ page }) => {
    await installApp(page); // default context: sees_full_workspace = true
    await page.goto('/client.html');
    await expect(page.getByText('This is the client view.')).toBeVisible();
    await expect(page.getByRole('link', { name: /Open your workspace/ })).toBeVisible();
  });
});

// ── the managed-client persona: Home queue + the project record page ─────────
// A bridged customer with one project — the slice-4 surfaces: the "Needs you"
// queue card (kind chips, unread dots, inline actions), project cards with a
// mini milestone Path, and the drill-in record page (highlights tiles, full
// Path, the activity timeline + composer, approvals with 409 handling).
const PID = '11111111-1111-4111-8111-111111111111';
const CLIENT_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ['website', 'client_portal'], is_agency: false, is_operator: false,
  sees_full_workspace: true, is_client_portal: false, is_managed_client: true, capabilities: ['view_all'],
  landing: '/client.html', attention_count: 1, nav: [{ key: 'client', label: 'Your updates', items: [{ key: 'feed', label: 'Updates', href: '/client.html' }] }],
} };
const CLIENT_API = {
  '/portal/context': CLIENT_CTX,
  '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
  '/client/notifications': { data: [
    { kind: 'approval_requested', label: 'Your approval is requested', href: `/projects/${PID}#approval-a1`, created_at: '2026-07-07T00:00:00Z', read: false },
  ], unread_count: 1 },
  '/client/projects': { data: [{ id: PID, name: 'Website redesign', status: 'active', target_date: '2026-08-01' }] },
  [`/client/projects/${PID}`]: { data: {
    project: { id: PID, name: 'Website redesign', status: 'active', target_date: '2026-08-01' },
    milestones: [
      { id: 'm1', title: 'Design', status: 'complete', completed_at: '2026-07-01T00:00:00Z', sort_order: 1 },
      { id: 'm2', title: 'Build', status: 'open', due_date: '2026-07-20', sort_order: 2 },
      { id: 'm3', title: 'Launch', status: 'open', sort_order: 3 },
    ],
    tasks: [{ id: 't1', title: 'Send your logo', status: 'open', client_action_required: true, derived: { overdue: false } }],
    events: [
      { kind: 'deliverable_added', detail: { title: 'Homepage mockup' }, created_at: '2026-07-06T00:00:00Z' },
      { kind: 'milestone_completed', detail: { title: 'Design' }, created_at: '2026-07-01T00:00:00Z' },
    ],
    deliverables: [{ id: 'd1', title: 'Homepage mockup', note: 'First look', created_at: '2026-07-06T00:00:00Z' }],
    approvals: [{ id: 'a1', subject_type: 'deliverable', title: 'Homepage design', summary: 'The first mockup.', content_hash: 'h1', status: 'pending' }],
    surveys: [],
    progress: { total: 4, done: 1, pct: 25 },
  } },
  [`/client/projects/${PID}/report`]: { data: { summary: {
    progress: { total: 4, done: 1, pct: 25 }, milestones: { total: 3, complete: 1 },
    open_client_actions: 1, overdue_tasks: 0, pending_approvals: 1, shared_files: 1, last_activity_at: '2026-07-06T00:00:00Z', csat: null,
  } } },
  [`/client/projects/${PID}/messages`]: { data: [{ id: 'mg1', body: 'Welcome aboard!', author_kind: 'staff', created_at: '2026-07-05T00:00:00Z' }] },
  '/client/support': { data: [] },
  '/client/documents': { data: { documents: [] } },
  '/client/billing': { data: { invoices: [{ id: 'i1', name: 'Deposit', amount: 500, status: 'open', due_date: '2026-07-20', pay_url: 'https://pay.example/x' }], summary: { open_count: 1, paid_count: 0 } } },
};

test.describe('Client portal — Home queue + project record page', () => {
  test('Home "Needs you" is a queue card: kind chips, unread dot, inline actions', async ({ page }) => {
    await installApp(page, { api: CLIENT_API });
    await page.goto('/client.html');
    await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
    const body = page.locator('#needs-body');
    await expect(body.locator('.qcard')).toBeVisible();
    await expect(body.locator('.kchip', { hasText: 'Approval' })).toBeVisible();
    await expect(body.locator('.kchip', { hasText: 'To-do' })).toBeVisible();
    await expect(body.locator('.kchip', { hasText: 'Invoice' })).toBeVisible();
    await expect(body.getByRole('heading', { name: 'Homepage design' })).toBeVisible();
    await expect(body.getByText('1 thing for you')).toBeVisible();
    // action names include the row title (aria-label) so repeated actions stay
    // distinguishable. Slice 10 (approved mock): the visible CTAs became explicit
    // verbs — "Review & approve" / "View & pay" — and the accessible names follow
    // (label-in-name intact: the visible text starts each name).
    await expect(body.getByRole('link', { name: 'View & pay — Deposit' })).toBeVisible();
    await expect(body.getByRole('button', { name: 'Review & approve — Homepage design' })).toBeVisible();
    // the unread row carries an sr-only "New — " text alternative for its dot
    await expect(body.locator('.qrow.unread .sr-only')).toHaveText('New — ');
    // the unread notification for approval a1 marks its row as new
    await expect(body.locator('.qrow.unread')).toHaveCount(1);
  });

  test('project cards carry a read-only mini milestone Path + the glance line', async ({ page }) => {
    await installApp(page, { api: CLIENT_API });
    await page.goto('/client.html');
    const card = page.locator('[data-proj]');
    await expect(card.locator('.path.mini .pstep.done')).toHaveText(/Design/);
    await expect(card.locator('.path.mini .pstep.current')).toHaveText(/Build/);
    await expect(card.locator('.path.mini .pstep.upcoming')).toHaveText(/Launch/);
    await expect(card.getByText('25% along')).toBeVisible();
  });

  test('drill-in: record header + highlights tiles render the project facts', async ({ page }) => {
    await installApp(page, { api: CLIENT_API });
    await page.goto(`/client.html?project=${PID}`);
    await expect(page.getByRole('heading', { name: 'Website redesign' })).toBeVisible();
    await expect(page.locator('.statuschip')).toHaveText('active');
    const tiles = page.locator('#sec-overview');
    await expect(tiles.locator('.hl-k', { hasText: 'Progress' })).toBeVisible();
    await expect(tiles.locator('.hl-v', { hasText: '25%' })).toBeVisible();
    await expect(tiles.locator('.hl-k', { hasText: 'Waiting on you' })).toBeVisible();
    await expect(tiles.locator('.hl-v', { hasText: '1 of 3' })).toBeVisible();
    await expect(tiles.locator('.hl-k', { hasText: 'Files shared' })).toBeVisible();
    await expect(tiles.locator('.hl-v', { hasText: '2026-08-01' })).toBeVisible();
  });

  test('drill-in: the milestone Path shows done ✓ / current ("You’re here") / upcoming', async ({ page }) => {
    await installApp(page, { api: CLIENT_API });
    await page.goto(`/client.html?project=${PID}`);
    const path = page.locator('#sec-milestones .path');
    await expect(path.locator('.pstep.done')).toHaveText(/✓ Design/);
    await expect(path.locator('.pstep.current')).toHaveText(/Build/);
    await expect(path.locator('.pstep.upcoming')).toHaveText(/Launch/);
    await expect(page.locator('#sec-milestones .path-meta')).toContainText('You’re here');
    await expect(page.locator('#sec-milestones .path-meta')).toContainText('Build');
  });

  test('drill-in: the activity timeline renders bundle events + messages as typed items', async ({ page }) => {
    await installApp(page, { api: CLIENT_API });
    await page.goto(`/client.html?project=${PID}`);
    const tl = page.locator('#ptl');
    await expect(tl.locator('.ti.t-file')).toContainText('Your studio shared a file — Homepage mockup');
    await expect(tl.locator('.ti.t-approve')).toContainText('Milestone complete — Design');
    await expect(tl.locator('.ti.t-message')).toContainText('Your studio sent a message');
    await expect(tl.locator('.ti.t-message .ti-body')).toHaveText('Welcome aboard!');
  });

  test('drill-in: the composer posts the unchanged message body', async ({ page }) => {
    await installApp(page, { api: CLIENT_API });
    // the harness fixture answers ANY method with the GET payload — intercept the
    // POST explicitly (201 + a realistic created row) so the write is truly mocked
    await page.route(`**/functions/v1/presence/client/projects/${PID}/messages`, (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'mg2', body: 'Thanks — looks great!', author_kind: 'client', created_at: '2026-07-08T00:00:00Z' } }) })
        : route.fallback());
    await page.goto(`/client.html?project=${PID}`);
    await page.locator('#msg').fill('Thanks — looks great!');
    const post = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes(`/client/projects/${PID}/messages`));
    await page.getByRole('button', { name: 'Send' }).click();
    expect((await post).postDataJSON()).toEqual({ body: 'Thanks — looks great!' });
  });

  test('drill-in: approving confirms and reloads the record', async ({ page }) => {
    await installApp(page, { api: CLIENT_API });
    // count bundle GETs — registered AFTER installApp so it runs first; fallback()
    // hands the request on to the fixture route. The exact-URL pattern matches only
    // the bundle itself (not /report or /messages).
    let bundleGets = 0;
    await page.route(`**/functions/v1/presence/client/projects/${PID}`, (route) => {
      if (route.request().method() === 'GET') bundleGets++;
      return route.fallback();
    });
    await page.goto(`/client.html?project=${PID}`);
    await expect(page.getByRole('heading', { name: 'Website redesign' })).toBeVisible();
    expect(bundleGets).toBe(1);
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.locator('#toast')).toContainText('Approved — thank you.');
    // the decide really triggered a refetch of the bundle (the record reloaded)
    await expect.poll(() => bundleGets).toBe(2);
    await expect(page.getByRole('heading', { name: 'Website redesign' })).toBeVisible();
  });

  test('drill-in: a 409 (stale version) surfaces the server’s sentence and reloads', async ({ page }) => {
    await installApp(page, { api: CLIENT_API });
    let bundleGets = 0;
    await page.route(`**/functions/v1/presence/client/projects/${PID}`, (route) => {
      if (route.request().method() === 'GET') bundleGets++;
      return route.fallback();
    });
    await page.route('**/functions/v1/presence/client/approvals/a1/decide', (route) =>
      route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'version_mismatch', message: 'This item was updated — reload the latest version before deciding.' }) }));
    await page.goto(`/client.html?project=${PID}`);
    await expect(page.getByRole('heading', { name: 'Waiting for your OK' })).toBeVisible();
    expect(bundleGets).toBe(1);
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.locator('#toast')).toContainText('This item was updated');
    // on 409 the record reloads from the bundle rather than retrying the stale hash
    await expect.poll(() => bundleGets).toBe(2);
    await expect(page.getByRole('heading', { name: 'Waiting for your OK' })).toBeVisible();
  });

  test('context bar (≥720px): studio identity, nav landmark, bell + account chip', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'the context bar only exists at ≥720px');
    await installApp(page, { api: CLIENT_API });
    await page.goto('/client.html');
    await expect(page.locator('.cb-name')).toHaveText('Your studio');
    // page navigation, not tabs: a <nav> landmark with plain buttons; the active
    // one carries aria-current="page" and no tab/tablist roles exist.
    await expect(page.getByRole('navigation', { name: 'Portal sections' })).toBeVisible();
    await expect(page.locator('#tabnav').getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#tabnav [role="tablist"], #tabnav [role="tab"], #tabnav [aria-selected]')).toHaveCount(0);
    await expect(page.locator('#navbell')).toBeVisible();
    await expect(page.locator('#navbell .badge')).toHaveText('1');
    await expect(page.locator('#navacct')).toBeVisible();
    // the account chip routes to Help (where the account card lives)
    await page.locator('#navacct').click();
    await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  });

  test('mobile: the bottom tab bar keeps its six tabs and the Home bell stays', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'bottom bar is the <720px nav');
    await installApp(page, { api: CLIENT_API });
    await page.goto('/client.html');
    await expect(page.locator('#tabnav .tab')).toHaveCount(6);
    await expect(page.locator('.cb-brand')).toBeHidden();
    await expect(page.locator('#navbell')).toBeHidden();
    await expect(page.locator('#bell')).toBeVisible();
  });
});

// ── slice 10: the Home greeting + at-a-glance strip + action-feed rows ───────
// A time-of-day greeting headline over the unchanged sub line; a strip of mini
// tiles (needs your OK · new messages · to pay · project status) built ONLY
// from data Home already loads — a tile hides when its datum is absent, and a
// zero count is real data, never faked. Queue rows carry the action-feed
// anatomy (type icon + explicit CTA) with every existing behavior intact.
test.describe('Client portal — Home greeting + glance strip (slice 10)', () => {
  test('the headline is a time-of-day greeting; the sub line is unchanged', async ({ page }) => {
    await installApp(page, { api: CLIENT_API });
    await page.goto('/client.html');
    await expect(page.locator('#main header h1')).toHaveText(/^Good (morning|afternoon|evening)/);
    await expect(page.getByText('Everything your studio is doing with you, in one place.')).toBeVisible();
  });

  test('the glance strip renders real tiles: needs OK · messages · to pay · project', async ({ page }) => {
    await installApp(page, { api: CLIENT_API });
    await page.goto('/client.html');
    const strip = page.locator('#home-glance');
    await expect(strip).toBeVisible();
    // the SAME definition as the project cards' "need your OK" line: pending
    // approvals + flagged to-dos (a1 + t1) — one count, everywhere on Home
    await expect(strip.locator('#glance-ok .gn')).toHaveText('2');
    await expect(strip.locator('#glance-ok .gl')).toHaveText('need your OK');
    await expect(page.locator(`#glance-${PID}`)).toContainText('2 things need your OK'); // the card agrees
    await expect(strip.locator('#glance-msgs .gn')).toHaveText('0');     // a real zero, not a fake
    await expect(strip.locator('#glance-due .gn')).toHaveText('$500');   // the unpaid Deposit
    await expect(strip.locator('#glance-due .gl')).toHaveText('to pay');
    await expect(strip.locator('#glance-proj .gn')).toHaveText('active');
    await expect(strip.locator('#glance-proj .gl')).toHaveText('Website redesign');
    // and the strip sits ABOVE the Needs-you queue (the website-card adjacency is untouched)
    await expect(page.locator('#home-glance + #home-needs')).toBeVisible();
  });

  test('tiles hide when their datum is absent — a reviewer gets no due/project tiles', async ({ page }) => {
    await installApp(page, { api: {
      '/portal/context': REVIEWER_CTX,
      '/portal/feed': { data: { role: 'client_reviewer', moments: [],
        pending_approvals: [{ id: 'p1', kind: 'infrastructure', title: 'Protect your email', summary: '', decide_path: '/foundations/plans/p1/decide' }],
        last_published: null } },
    } });
    await page.goto('/client.html');
    const strip = page.locator('#home-glance');
    await expect(strip).toBeVisible();
    await expect(strip.locator('#glance-ok .gn')).toHaveText('1');
    await expect(strip.locator('#glance-due')).toHaveCount(0);
    await expect(strip.locator('#glance-proj')).toHaveCount(0);
  });

  test('unread messages count into the tile, and opening the bell re-renders it whole', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'uses the ≥720px context-bar bell');
    await installApp(page, { api: MSG_API });
    await page.goto('/client.html');
    // ONLY the genuine studio message counts — the support_message row derives
    // from support updated_at (it moves on the client's own filing) and must not
    await expect(page.locator('#glance-msgs .gn')).toHaveText('1');
    await expect(page.locator('#glance-msgs .gl')).toHaveText('new message');
    await page.locator('#navbell').click();
    // number AND label move together — never a frozen "0 new message"
    await expect(page.locator('#glance-msgs .gn')).toHaveText('0');
    await expect(page.locator('#glance-msgs .gl')).toHaveText('new messages');
  });

  test('a failed feed read HIDES the needs-OK tile — never a fake zero', async ({ page }) => {
    await installApp(page, { api: CLIENT_API });
    await page.route('**/functions/v1/presence/portal/feed**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) }));
    await page.goto('/client.html');
    await expect(page.locator('#home-glance')).toBeVisible();        // the other sources still answered
    await expect(page.locator('#glance-ok')).toHaveCount(0);         // its source failed → the tile hides
    await expect(page.locator('#glance-msgs .gn')).toHaveText('0');  // notifications succeeded — a REAL zero stays
    await expect(page.locator('#glance-due .gn')).toHaveText('$500');
  });

  test('queue rows carry the action-feed anatomy: type icon + explicit CTA text', async ({ page }) => {
    await installApp(page, { api: CLIENT_API });
    await page.goto('/client.html');
    const body = page.locator('#needs-body');
    await expect(body.locator('.qcard')).toBeVisible();
    await expect(body.locator('.qico')).toHaveCount(3); // approval · to-do · invoice
    await expect(body.locator('.qico').first()).toHaveAttribute('aria-hidden', 'true');
    await expect(body.getByRole('button', { name: 'Review & approve — Homepage design' })).toHaveText('Review & approve');
    await expect(body.getByRole('button', { name: 'Open to-dos — Website redesign' })).toHaveText('Open to-dos');
    await expect(body.getByRole('link', { name: 'View & pay — Deposit' })).toHaveText('View & pay');
  });

  test('the Review & approve CTA still round-trips into the project record', async ({ page }) => {
    await installApp(page, { api: CLIENT_API });
    await page.goto('/client.html');
    await page.getByRole('button', { name: 'Review & approve — Homepage design' }).click();
    await expect(page.getByRole('heading', { name: 'Website redesign' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Waiting for your OK' })).toBeVisible();
  });

  test('mobile: the strip stacks its tiles with no horizontal overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'the stacked-tiles check is the <720px contract');
    await installApp(page, { api: CLIENT_API });
    await page.goto('/client.html');
    await expect(page.locator('#home-glance')).toBeVisible();
    await expect(page.locator('#needs-body .qcard')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('no serious/critical axe violations on the slice-10 Home', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once, on desktop');
    await installApp(page, { api: CLIENT_API });
    await page.goto('/client.html');
    await expect(page.locator('#home-glance')).toBeVisible();
    await expect(page.locator('#needs-body .qcard')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`)).toEqual([]);
  });
});

// ── slice 5: the Messages tab as a split-view console ────────────────────────
// List pane = one listbox row per conversation (project threads + support
// requests, general AND project-scoped) with chips + unread dots from the
// notifications read-state; reading pane = the thread as timeline items with
// the right composer. <720px the panes stack with a back button.
const SUP_GEN = '22222222-2222-4222-8222-222222222222'; // general (project-less) support thread
const SUP_PRJ = '33333333-3333-4333-8333-333333333333'; // project-scoped, resolved
const MSG_API = {
  ...CLIENT_API,
  '/client/notifications': { data: [
    { kind: 'message', label: 'New message', href: `/projects/${PID}#messages`, created_at: '2026-07-07T00:00:00Z', read: false },
    { kind: 'support_message', label: 'Support: Logo tweak', href: `/client.html?support=${SUP_GEN}`, created_at: '2026-07-06T00:00:00Z', read: false },
  ], unread_count: 2 },
  '/client/support': { data: [
    { id: SUP_GEN, subject: 'Logo tweak', status: 'open', project_id: null, updated_at: '2026-07-06T00:00:00Z' },
    { id: SUP_PRJ, subject: 'Copy fixes', status: 'resolved', project_id: PID, updated_at: '2026-07-04T00:00:00Z' },
  ] },
  [`/client/support/${SUP_GEN}`]: { data: {
    request: { id: SUP_GEN, subject: 'Logo tweak', body: 'Could we nudge the logo left?', status: 'open', project_id: null, created_at: '2026-07-05T00:00:00Z' },
    messages: [{ id: 'sm1', body: 'On it — new version tomorrow.', author_kind: 'staff', created_at: '2026-07-06T00:00:00Z' }],
  } },
  [`/client/support/${SUP_PRJ}`]: { data: {
    request: { id: SUP_PRJ, subject: 'Copy fixes', body: 'Some typos on the About page.', status: 'resolved', project_id: PID, created_at: '2026-07-03T00:00:00Z' },
    messages: [],
  } },
};
const openMessagesTab = async (page: import('@playwright/test').Page) => {
  await page.locator('#tabnav [data-tab="messages"]').click();
  await expect(page.locator('#mrows')).toBeVisible();
};

test.describe('Client portal — Messages split view', () => {
  test('list pane: two-line rows with chips + unread dots, newest first', async ({ page }) => {
    await installApp(page, { api: MSG_API });
    await page.goto('/client.html');
    await openMessagesTab(page);
    await expect(page.getByText('3 conversations')).toBeVisible();
    const rows = page.locator('#mrows [role="option"]');
    await expect(rows).toHaveCount(3);
    // newest activity first: open support (07-06) · project thread (07-05) · resolved (07-04)
    await expect(rows.nth(0)).toContainText('Logo tweak');
    await expect(rows.nth(1)).toContainText('Website redesign');
    await expect(rows.nth(2)).toContainText('Copy fixes');
    await expect(rows.nth(0).locator('.kchip')).toHaveText('Support · open');
    await expect(rows.nth(1).locator('.kchip')).toHaveText('Message');
    await expect(rows.nth(2).locator('.kchip')).toHaveText('Support · resolved');
    // the message + support_message notifications light exactly their two rows,
    // each with the sr-only "New — " text alternative for the dot
    await expect(page.locator('.mrow.unread')).toHaveCount(2);
    await expect(page.locator('.mrow.unread .sr-only').first()).toHaveText('New — ');
  });

  test('opening a conversation selects its row and clears its unread dot', async ({ page }) => {
    await installApp(page, { api: MSG_API });
    await page.goto('/client.html');
    await openMessagesTab(page);
    await expect(page.locator('.mrow.unread')).toHaveCount(2);
    await page.locator('.mrow', { hasText: 'Logo tweak' }).click();
    await expect(page.locator('.mrow', { hasText: 'Logo tweak' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.mrow.unread')).toHaveCount(1);
  });

  test('a project conversation renders the thread as timeline items and the composer POSTs {body}', async ({ page }) => {
    await installApp(page, { api: MSG_API });
    // the harness fixture answers ANY method with the GET payload — intercept the
    // POST explicitly (201 + a realistic created row) so the write is truly mocked
    await page.route(`**/functions/v1/presence/client/projects/${PID}/messages`, (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'mg2', body: 'Thanks — looks great!', author_kind: 'client', created_at: '2026-07-08T00:00:00Z' } }) })
        : route.fallback());
    await page.goto('/client.html');
    await openMessagesTab(page);
    // by row id — the resolved support row previews its project name, so a
    // text match on "Website redesign" would be ambiguous
    await page.locator(`[data-mrow="proj:${PID}"]`).click();
    const pane = page.locator('#mpane');
    await expect(pane.locator('.ti.t-message')).toContainText('Your studio sent a message');
    await expect(pane.locator('.ti.t-message .ti-body')).toHaveText('Welcome aboard!');
    await pane.getByLabel('Message your studio').fill('Thanks — looks great!');
    const post = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes(`/client/projects/${PID}/messages`));
    await pane.getByRole('button', { name: 'Send' }).click();
    expect((await post).postDataJSON()).toEqual({ body: 'Thanks — looks great!' });
  });

  test('a support thread shows the request + replies and the reply POSTs', async ({ page }) => {
    await installApp(page, { api: MSG_API });
    await page.goto('/client.html');
    await openMessagesTab(page);
    // the harness fixture answers ANY method with the GET payload — intercept the
    // reply POST explicitly (201 + a realistic created row) so the write is truly mocked
    await page.route(`**/functions/v1/presence/client/support/${SUP_GEN}/messages`, (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'sm2', body: 'Perfect, thank you.', author_kind: 'client', created_at: '2026-07-08T00:00:00Z' } }) })
        : route.fallback());
    await page.locator('.mrow', { hasText: 'Logo tweak' }).click();
    const pane = page.locator('#mpane');
    await expect(pane.locator('.mpname')).toHaveText('Logo tweak');
    await expect(pane.locator('#msupstatus')).toHaveText('open');
    await expect(pane.getByText('You opened this request')).toBeVisible();
    await expect(pane.getByText('Could we nudge the logo left?')).toBeVisible();
    await expect(pane.getByText('Your studio replied')).toBeVisible();
    await pane.getByLabel('Add to this request').fill('Perfect, thank you.');
    const post = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes(`/client/support/${SUP_GEN}/messages`));
    await pane.getByRole('button', { name: 'Send' }).click();
    expect((await post).postDataJSON()).toEqual({ body: 'Perfect, thank you.' });
  });

  test('a resolved support thread is read-only (lock message, no composer)', async ({ page }) => {
    await installApp(page, { api: MSG_API });
    await page.goto('/client.html');
    await openMessagesTab(page);
    await page.locator('.mrow', { hasText: 'Copy fixes' }).click();
    const pane = page.locator('#mpane');
    await expect(pane.getByText('This request is resolved. Open a new one if you need anything else.')).toBeVisible();
    await expect(pane.locator('textarea')).toHaveCount(0);
  });

  test('?support= deep link opens that thread in the Messages pane', async ({ page }) => {
    await installApp(page, { api: MSG_API });
    await page.goto(`/client.html?support=${SUP_GEN}`);
    await expect(page.locator('#tabnav [data-tab="messages"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#mpane')).toContainText('Could we nudge the logo left?');
    await expect(page.locator('.mrow', { hasText: 'Logo tweak' })).toHaveAttribute('aria-selected', 'true');
  });

  test('"Message your studio" composes in the pane; the first line becomes the subject', async ({ page }) => {
    await installApp(page, { api: MSG_API });
    // the list fixture serves GET /client/support; the POST needs a created id back
    await page.route('**/functions/v1/presence/client/support', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: SUP_GEN } }) })
        : route.fallback());
    await page.goto('/client.html');
    await openMessagesTab(page);
    await page.getByRole('button', { name: 'Message your studio' }).click();
    const pane = page.locator('#mpane');
    await pane.getByLabel('Message your studio').fill('Logo question\nWhere is the source file?');
    const post = page.waitForRequest((r) => r.method() === 'POST' && /\/client\/support$/.test(new URL(r.url()).pathname));
    await pane.getByRole('button', { name: 'Send' }).click();
    expect((await post).postDataJSON()).toEqual({ subject: 'Logo question', body: 'Logo question\nWhere is the source file?' });
    await expect(page.locator('#toast')).toContainText('Sent — your studio will get back to you.');
  });

  test('compose failure: a 500 keeps the composer usable (toast + re-enabled button)', async ({ page }) => {
    await installApp(page, { api: MSG_API });
    await page.route('**/functions/v1/presence/client/support', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'write_failed' }) })
        : route.fallback());
    await page.goto('/client.html');
    await openMessagesTab(page);
    await page.getByRole('button', { name: 'Message your studio' }).click();
    const pane = page.locator('#mpane');
    await pane.getByLabel('Message your studio').fill('Hello?');
    await pane.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('#toast')).toContainText('That didn’t send.');
    await expect(pane.getByRole('button', { name: 'Send' })).toBeEnabled();
    await expect(pane.getByLabel('Message your studio')).toHaveValue('Hello?'); // nothing typed is lost
  });

  test('project send failure: the thread is kept, nothing is erased', async ({ page }) => {
    await installApp(page, { api: MSG_API });
    await page.route(`**/functions/v1/presence/client/projects/${PID}/messages`, (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'write_failed' }) })
        : route.fallback());
    await page.goto('/client.html');
    await openMessagesTab(page);
    await page.locator(`[data-mrow="proj:${PID}"]`).click();
    const pane = page.locator('#mpane');
    await expect(pane.locator('.ti.t-message .ti-body')).toHaveText('Welcome aboard!');
    await pane.getByLabel('Message your studio').fill('Anyone there?');
    await pane.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('#toast')).toContainText('That didn’t send.');
    await expect(pane.locator('.ti.t-message .ti-body')).toHaveText('Welcome aboard!'); // the thread survives
    await expect(pane.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  test('support reply refetch-failure: the reply sends, the thread + composer are kept', async ({ page }) => {
    await installApp(page, { api: MSG_API });
    await page.route(`**/functions/v1/presence/client/support/${SUP_GEN}/messages`, (route) =>
      route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'sm2', body: 'Perfect, thank you.', author_kind: 'client', created_at: '2026-07-08T00:00:00Z' } }) }));
    let threadGets = 0;
    await page.route(`**/functions/v1/presence/client/support/${SUP_GEN}`, (route) => {
      // first GET (opening the pane) succeeds; the post-reply refetch fails
      if (route.request().method() === 'GET' && ++threadGets > 1)
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'read_failed' }) });
      return route.fallback();
    });
    await page.goto('/client.html');
    await openMessagesTab(page);
    await page.locator('.mrow', { hasText: 'Logo tweak' }).click();
    const pane = page.locator('#mpane');
    await expect(pane.getByText('Could we nudge the logo left?')).toBeVisible();
    await pane.getByLabel('Add to this request').fill('Perfect, thank you.');
    await pane.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('#toast')).toContainText('this thread will catch up');
    // the refetch failed AFTER a successful reply — the thread and composer survive (no error card)
    await expect(pane.getByText('Could we nudge the logo left?')).toBeVisible();
    await expect(pane.getByText('That request isn’t available right now.')).toHaveCount(0);
    await expect(pane.getByLabel('Add to this request')).toBeVisible();
    await expect(pane.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  test('keyboard: focus + Enter opens the first row, Space opens, the active row survives a send re-sort', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'opening a row moves focus into the stacked pane on mobile');
    await installApp(page, { api: MSG_API });
    // stateful message mock: the POSTed reply shows up in subsequent GETs, so the
    // post-send refetch keeps the project row's recency at the top (like the real API)
    const MSGS = [{ id: 'mg1', body: 'Welcome aboard!', author_kind: 'staff', created_at: '2026-07-05T00:00:00Z' }];
    await page.route(`**/functions/v1/presence/client/projects/${PID}/messages`, (route) => {
      if (route.request().method() === 'POST') {
        MSGS.unshift({ id: 'mg2', body: String(route.request().postDataJSON().body || ''), author_kind: 'client', created_at: '2026-07-08T00:00:00Z' });
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: MSGS[0] }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MSGS }) });
    });
    await page.goto('/client.html');
    await openMessagesTab(page);
    const rows = page.locator('#mrows');
    // Tab-to-focus defaults the active row (no Arrow press needed) — Enter opens it
    await rows.focus();
    await expect(rows).toHaveAttribute('aria-activedescendant', /mrow-/);
    await page.keyboard.press('Enter');
    await expect(page.locator('.mrow', { hasText: 'Logo tweak' })).toHaveAttribute('aria-selected', 'true');
    // Space opens too: rove to the project row and press Space
    await rows.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await expect(page.locator(`[data-mrow="proj:${PID}"]`)).toHaveAttribute('aria-selected', 'true');
    // a send re-sorts the list — the active row must still be THIS conversation
    const pane = page.locator('#mpane');
    await pane.getByLabel('Message your studio').fill('Ready for round two');
    await pane.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('#mrows [role="option"]').first()).toContainText('Website redesign'); // re-sorted to the top
    await expect(rows).toHaveAttribute('aria-activedescendant', `mrow-proj_${PID}`);
    await expect(page.locator(`[data-mrow="proj:${PID}"]`)).toHaveClass(/kfocus/);
  });

  test('mobile: the panes stack — a row pushes the pane in, the back button returns', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'stacked panes are the <720px contract');
    await installApp(page, { api: MSG_API });
    await page.goto('/client.html');
    await openMessagesTab(page);
    await expect(page.locator('.mlist')).toBeVisible();
    await expect(page.locator('#mpane')).toBeHidden();
    await page.locator('.mrow', { hasText: 'Logo tweak' }).click();
    await expect(page.locator('.mlist')).toBeHidden();
    await expect(page.locator('#mpane')).toBeVisible();
    const back = page.getByRole('button', { name: '← Messages' });
    await expect(back).toBeVisible();
    await back.click();
    await expect(page.locator('.mlist')).toBeVisible();
    await expect(page.locator('#mpane')).toBeHidden();
  });

  test('reviewer: the calm empty state, with no list fetches (support OR message fan-out)', async ({ page }) => {
    const listCalls: string[] = [];
    await installApp(page, { api: {
      '/portal/context': REVIEWER_CTX,
      '/portal/feed': { data: { role: 'client_reviewer', moments: [], pending_approvals: [], last_published: null } },
    } });
    page.on('request', (r) => {
      // the support list AND the per-project ?limit=1 preview fan-out must both stay silent
      if (r.url().includes('/client/support') || /\/client\/projects\/[^/?]+\/messages/.test(r.url())) listCalls.push(r.url());
    });
    await page.goto('/client.html');
    await page.locator('#tabnav [data-tab="messages"]').click();
    await expect(page.getByText('Your studio will reach you here. Messaging opens up once they’ve set up your account.')).toBeVisible();
    expect(listCalls).toHaveLength(0);
  });
});

// ── slice 8b: the "Your website" card on Home ────────────────────────────────
// Plain-English site stats between the "Needs you" queue and the project cards:
// a bolded lead sentence built from real numbers, a soft sparkline, mini stat
// tiles, and an in-place "See the full picture →" disclosure. Honest
// degradation: no GSC (or a failed GSC read) → no Google tile/section; zero
// visitors on a SUCCESSFUL read → a gentle "ready to be found" state;
// unpublished / failed month read / 404 (older function build) → no card.
const WS_STATS = { data: { published: true,
  month: {
    visitors: 214, pageviews: 380, actions: 11,
    top_source: { source: 'Google', visits: 88, share: 41 },
    weekly: [3, 2, 4, 3, 6, 5, 8, 7, 12, 10, 14, 16],
    top_pages: [{ path: '/', views: 120 }, { path: '/our-services', views: 64 }, { path: '/contact', views: 41 }],
    sources: [{ source: 'Google', visits: 88, share: 41 }, { source: 'Direct', visits: 60, share: 28 }, { source: 'Instagram', visits: 30, share: 14 }],
    has_data: true,
  },
  search: { clicks: 38, impressions: 900, top_terms: [
    { term: 'wedding photographer austin', clicks: 12, impressions: 300 },
    { term: 'family photos near me', clicks: 6, impressions: 210 },
  ] },
} };
const WS_API = { ...CLIENT_API, '/client/website-stats': WS_STATS };

test.describe('Client portal — the "Your website" card', () => {
  test('renders between "Needs you" and the projects: sentence numbers, sparkline, three tiles', async ({ page }) => {
    await installApp(page, { api: WS_API });
    await page.goto('/client.html');
    // placement: the card slot is the very next section after the needs queue
    const card = page.locator('#home-needs + #home-website .wscard');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'People are finding you.' })).toBeVisible();
    // the lead sentence carries the real numbers, bolded
    await expect(card.locator('.wslead b').nth(0)).toHaveText('214 people');
    await expect(card.locator('.wslead b').nth(1)).toHaveText('11 taps to call, email or book');
    await expect(card.locator('.wslead b').nth(2)).toHaveText('Google');
    // three mini tiles (the Google one exists because GSC data does)
    const tiles = card.locator('.wsmini .m');
    await expect(tiles).toHaveCount(3);
    await expect(tiles.nth(0)).toContainText('214');
    await expect(tiles.nth(0)).toContainText('visitors this month');
    await expect(tiles.nth(1)).toContainText('11');
    await expect(tiles.nth(1)).toContainText('taps to call, email or book');
    await expect(tiles.nth(2)).toContainText('38');
    await expect(tiles.nth(2)).toContainText('clicks from Google search');
    // the sparkline is decorative; its values are present as text
    await expect(card.locator('svg.wsspark').first()).toHaveAttribute('aria-hidden', 'true');
    await expect(card.locator('.sr-only').first()).toContainText('3, 2, 4, 3, 6, 5, 8, 7, 12, 10, 14, 16');
    // the privacy line — verified against the collector (cookie-less, DNT, daily hash)
    await expect(card.locator('.wspriv')).toHaveText('Counted privately — no cookies, no tracking of individual people.');
    // the breakdown is closed by default
    await expect(card.locator('#wsfull')).toBeHidden();
  });

  test('"See the full picture →" grows the same card in place, with sane focus + aria-expanded', async ({ page }) => {
    await installApp(page, { api: WS_API });
    await page.goto('/client.html');
    const card = page.locator('#home-website .wscard');
    const btn = card.locator('#wsmore');   // by id — its accessible name flips to "Show less" when open
    await expect(btn).toHaveText('See the full picture →');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await btn.click();
    // same card, expanded in place — no navigation, no new view
    await expect(card.locator('#wsfull')).toBeVisible();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(btn).toHaveText('Show less');
    await expect(btn).toBeFocused();   // focus never jumps or drops to <body>
    // the friendly breakdown: pages · sources (with %) · Google search terms
    await expect(card.getByRole('heading', { name: 'Visitors, week by week' })).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Your most-visited pages' })).toBeVisible();
    await expect(card.getByText('Home page')).toBeVisible();
    await expect(card.getByText('120 views')).toBeVisible();
    await expect(card.getByText('Our services')).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Where people came from' })).toBeVisible();
    await expect(card.getByText('41%')).toBeVisible();
    await expect(card.getByText('Straight to your site')).toBeVisible();   // 'Direct', in plain English
    await expect(card.getByRole('heading', { name: 'What people searched on Google' })).toBeVisible();
    await expect(card.getByText('“wedding photographer austin”')).toBeVisible();
    await expect(card.getByText('12 clicks')).toBeVisible();
    // and it closes again, focus intact
    await btn.click();
    await expect(card.locator('#wsfull')).toBeHidden();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(btn).toHaveText('See the full picture →');
    await expect(btn).toBeFocused();
  });

  test('no GSC → the Google tile and search section are dropped (no fake zeros)', async ({ page }) => {
    const noGsc = JSON.parse(JSON.stringify(WS_STATS));
    noGsc.data.search = null;
    await installApp(page, { api: { ...CLIENT_API, '/client/website-stats': noGsc } });
    await page.goto('/client.html');
    const card = page.locator('#home-website .wscard');
    await expect(card).toBeVisible();
    await expect(card.locator('.wsmini .m')).toHaveCount(2);
    await expect(card.getByText('clicks from Google search')).toHaveCount(0);
    await card.getByRole('button', { name: 'See the full picture →' }).click();
    await expect(card.getByRole('heading', { name: 'What people searched on Google' })).toHaveCount(0);
    await expect(card.getByRole('heading', { name: 'Where people came from' })).toBeVisible();
  });

  test('zero visitors → the gentle "ready to be found" state, never "0 people"', async ({ page }) => {
    await installApp(page, { api: { ...CLIENT_API, '/client/website-stats': { data: { published: true,
      month: { visitors: 0, pageviews: 0, actions: 0, top_source: null, weekly: [0,0,0,0,0,0,0,0,0,0,0,0], top_pages: [], sources: [], has_data: false }, search: null } } } });
    await page.goto('/client.html');
    const card = page.locator('#home-website .wscard');
    await expect(card.getByRole('heading', { name: 'Your website is ready to be found.' })).toBeVisible();
    await expect(card.getByText('Stats will appear here as people visit')).toBeVisible();
    await expect(card.getByText('0 people')).toHaveCount(0);
    await expect(card.locator('.wsmini')).toHaveCount(0);   // no zero-stuffed tiles
    await expect(card.getByRole('button', { name: 'See the full picture →' })).toHaveCount(0);
  });

  test('actions are events, not people: more taps than visitors still reads true', async ({ page }) => {
    const d = JSON.parse(JSON.stringify(WS_STATS));
    d.data.month.visitors = 1; d.data.month.actions = 3; d.data.month.top_source = null; d.data.search = null;
    await installApp(page, { api: { ...CLIENT_API, '/client/website-stats': d } });
    await page.goto('/client.html');
    const card = page.locator('#home-website .wscard');
    await expect(card.locator('.wslead b').nth(0)).toHaveText('1 person');
    await expect(card.locator('.wslead b').nth(1)).toHaveText('3 taps to call, email or book');
    // never "3 of them reached out" for 1 person — actions are events, not visitors
    await expect(card.locator('.wslead')).not.toContainText('of them');
  });

  test('published but the month read FAILED (month:null) → no card, never the empty story', async ({ page }) => {
    await installApp(page, { api: { ...CLIENT_API, '/client/website-stats': { data: { published: true, month: null, search: null } } } });
    await page.goto('/client.html');
    await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
    // a transient DB failure must never masquerade as "ready to be found"
    await expect(page.locator('#home-website')).toBeHidden();
    await expect(page.locator('.wscard')).toHaveCount(0);
    await expect(page.getByText('ready to be found')).toHaveCount(0);
  });

  test('a FAILED Search Console read (unavailable) drops the Google tile and section, like not-connected', async ({ page }) => {
    const d = JSON.parse(JSON.stringify(WS_STATS));
    d.data.search = { unavailable: true };
    await installApp(page, { api: { ...CLIENT_API, '/client/website-stats': d } });
    await page.goto('/client.html');
    const card = page.locator('#home-website .wscard');
    await expect(card).toBeVisible();
    await expect(card.locator('.wsmini .m')).toHaveCount(2);
    await expect(card.getByText('clicks from Google search')).toHaveCount(0);
    await card.getByRole('button', { name: 'See the full picture →' }).click();
    await expect(card.getByRole('heading', { name: 'What people searched on Google' })).toHaveCount(0);
  });

  test('a hostile search term renders as text, never as markup', async ({ page }) => {
    const d = JSON.parse(JSON.stringify(WS_STATS));
    d.data.search.top_terms = [{ term: '<img src=x onerror=alert(1)>', clicks: 2, impressions: 9 }];
    await installApp(page, { api: { ...CLIENT_API, '/client/website-stats': d } });
    await page.goto('/client.html');
    const card = page.locator('#home-website .wscard');
    await card.getByRole('button', { name: 'See the full picture →' }).click();
    await expect(card.locator('#wsfull')).toBeVisible();
    // the term is visible AS TEXT…
    await expect(card.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    // …and no element was ever injected into the breakdown
    await expect(card.locator('#wsfull img')).toHaveCount(0);
  });

  test('route 404 (older function build) → no card, and Home still works', async ({ page }) => {
    await installApp(page, { api: CLIENT_API });
    await page.route('**/functions/v1/presence/client/website-stats', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) }));
    await page.goto('/client.html');
    // the rest of Home renders normally…
    await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
    await expect(page.locator('#needs-body .qcard')).toBeVisible();
    // …and the website slot stays silently hidden (no error card)
    await expect(page.locator('#home-website')).toBeHidden();
    await expect(page.locator('.wscard')).toHaveCount(0);
  });

  test('unpublished site → the card is hidden entirely', async ({ page }) => {
    await installApp(page, { api: { ...CLIENT_API, '/client/website-stats': { data: { published: false, month: null, search: null } } } });
    await page.goto('/client.html');
    await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
    await expect(page.locator('#home-website')).toBeHidden();
    await expect(page.locator('.wscard')).toHaveCount(0);
  });

  test('mobile: the card renders and the tiles stack without horizontal scroll', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'the stacked-tiles check is the <720px contract');
    await installApp(page, { api: WS_API });
    await page.goto('/client.html');
    const card = page.locator('#home-website .wscard');
    await expect(card).toBeVisible();
    await expect(card.locator('.wsmini .m')).toHaveCount(3);
    // no horizontal overflow from the card or its sparkline
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('no serious/critical axe violations with the card expanded', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once, on desktop');
    await installApp(page, { api: WS_API });
    await page.goto('/client.html');
    await page.locator('#home-website').getByRole('button', { name: 'See the full picture →' }).click();
    await expect(page.locator('#wsfull')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`)).toEqual([]);
  });
});

// ── slice 11: the Requests tab redesign ──────────────────────────────────────
// Quick actions become two side-by-side tiles (Book a call · Something else?),
// the service catalog becomes a two-column card grid (category chip, serif
// name, price, "Request this" → the structured brief), and "Your requests"
// becomes a list view — whole-row buttons (icon + subject + honest "Updated"
// meta + status chip + chevron) behind Open/All filter chips that default to
// All when everything is resolved. Every flow underneath is unchanged:
// openBooking, openSupport(null), openServiceRequest, openMessagesTo.
const SVC_OFFER = '44444444-4444-4444-8444-444444444444'; // a real offering id (uuid-shaped)
const SUP_PROG = '55555555-5555-4555-8555-555555555555';  // an in_progress request
const REQ_API = {
  ...MSG_API,
  '/client/services': { data: [
    { id: SVC_OFFER, name: 'Brand refresh', category: 'Design', description: 'A light refresh of your logo and colors.', price: 'From $800' },
    { id: 'svc:0', name: 'Extra page', category: '', description: '', price: '$150' },
    { id: 'custom', name: 'Custom request', category: '', description: 'Something else in mind? Tell your studio exactly what you’d like and they’ll follow up.', price: '' },
  ] },
  '/client/support': { data: [
    // Modeled on production: the array arrives in the backend's updated_at-DESC
    // order, and EVERY row carries last_activity_at (slice 2 stamps it
    // per-response whenever the batch activity read succeeds — the absent case
    // is an older function build, covered by its own fixture below). All dates
    // are >7 days old so rel() renders exact "Mon D" text, not relative words.
    // New headshots was TOUCHED latest (06-25) but Logo tweak has the freshest
    // ACTIVITY (a studio reply, 07-01) — the page must re-rank by activity.
    { id: SUP_PROG, subject: 'New headshots', status: 'in_progress', project_id: null, updated_at: '2026-06-25T00:00:00Z', last_activity_at: '2026-06-25T00:00:00Z' },
    { id: SUP_GEN, subject: 'Logo tweak', status: 'open', project_id: null, updated_at: '2026-06-20T00:00:00Z', last_activity_at: '2026-07-01T00:00:00Z' },
    { id: SUP_PRJ, subject: 'Copy fixes', status: 'resolved', project_id: PID, updated_at: '2026-06-10T00:00:00Z', last_activity_at: '2026-06-10T00:00:00Z' },
  ] },
  // the SUP_PROG thread — so a row-click test can never be served the LIST
  // fixture by the harness's longest-prefix match on '/client/support'
  [`/client/support/${SUP_PROG}`]: { data: {
    request: { id: SUP_PROG, subject: 'New headshots', body: 'We need fresh team photos.', status: 'in_progress', project_id: null, created_at: '2026-06-24T00:00:00Z' },
    messages: [],
  } },
  // the booking engine behind the "Book a call" tile (fixture round-trip)
  '/client/book': { data: { site_id: 'site-1' } },
  '/book/site-1/types': { data: { enabled: true, intro: 'Pick a time that suits you.', max_days_ahead: 30,
    types: [{ id: 'bt1', name: 'Intro call', duration_min: 30, price_text: '', description: '' }] } },
};
const openRequestsTab = async (page: import('@playwright/test').Page) => {
  await page.locator('#tabnav [data-tab="requests"]').click();
  await expect(page.locator('#main').getByRole('heading', { name: 'Requests', exact: true })).toBeVisible();
};

test.describe('Client portal — Requests tab (slice 11)', () => {
  test('quick-action tiles render, and Book a call round-trips into the booking flow', async ({ page }) => {
    await installApp(page, { api: REQ_API });
    await page.goto('/client.html');
    await openRequestsTab(page);
    await expect(page.locator('.acttile')).toHaveCount(2);
    await expect(page.locator('#bookCall')).toContainText('Book a call');
    await expect(page.locator('#newReq')).toContainText('Something else?');
    // the tile drives the EXISTING openBooking flow: /client/book resolves the
    // site, /book/<site>/types lists the studio's bookable services
    await page.locator('#bookCall').click();
    await expect(page.getByRole('heading', { name: 'Book a call' })).toBeVisible();
    await expect(page.getByText('Pick a time that suits you.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Intro call' })).toBeVisible();
    // and the back link lands on the Requests tab again
    await page.getByRole('link', { name: '← Back to requests' }).click();
    await expect(page.locator('.acttile')).toHaveCount(2);
  });

  test('the Something-else tile opens the free-form message flow (openSupport)', async ({ page }) => {
    await installApp(page, { api: REQ_API });
    await page.goto('/client.html');
    await openRequestsTab(page);
    await page.locator('#newReq').click();
    await expect(page.getByRole('heading', { name: 'Message your studio' })).toBeVisible();
    await expect(page.getByLabel('Subject')).toBeVisible();
  });

  test('the service catalog is a card grid: category chip, name, price — Request this opens the brief and POSTs it', async ({ page }) => {
    await installApp(page, { api: REQ_API });
    // the list fixture serves GET /client/support; the brief POST needs a created id back
    await page.route('**/functions/v1/presence/client/support', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: SUP_GEN } }) })
        : route.fallback());
    await page.goto('/client.html');
    await openRequestsTab(page);
    const grid = page.locator('.svcgrid');
    await expect(grid.locator('.card')).toHaveCount(3);
    const card = grid.locator('.card', { hasText: 'Brand refresh' });
    await expect(card.locator('.kchip')).toHaveText('Design');
    await expect(card.getByRole('heading', { name: 'Brand refresh' })).toBeVisible();
    await expect(card.locator('.svcprice')).toHaveText('From $800');
    // a category-less service simply has no chip
    await expect(grid.locator('.card', { hasText: 'Extra page' }).locator('.kchip')).toHaveCount(0);
    // Request this → the EXISTING structured-brief flow, unchanged payload
    await card.getByRole('button', { name: 'Request this — Brand refresh' }).click();
    await expect(page.getByRole('heading', { name: 'Request: Brand refresh' })).toBeVisible();
    await page.getByLabel('What do you need?').fill('A softer palette.');
    const post = page.waitForRequest((r) => r.method() === 'POST' && /\/client\/support$/.test(new URL(r.url()).pathname));
    await page.getByRole('button', { name: 'Send request' }).click();
    expect((await post).postDataJSON()).toEqual({
      subject: 'Service request: Brand refresh', service: SVC_OFFER,
      brief: { need: 'A softer palette.', timeline: '', budget: '' },
    });
    await expect(page.locator('#toast')).toContainText('Sent — your studio will review');
  });

  test('the requests list is a list view: whole-row buttons with icon, Updated meta, status chip', async ({ page }) => {
    await installApp(page, { api: REQ_API });
    await page.goto('/client.html');
    await openRequestsTab(page);
    const listHost = page.locator('#reqlist');
    // default filter: Open — the resolved request is not shown
    await expect(page.locator('#reqFilterOpen')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#reqFilterAll')).toHaveAttribute('aria-pressed', 'false');
    await expect(listHost.locator('.reqrow')).toHaveCount(2);
    await expect(listHost.getByText('Copy fixes')).toHaveCount(0);
    const row = listHost.locator('.reqrow', { hasText: 'Logo tweak' });
    await expect(row.locator('.qico')).toHaveAttribute('aria-hidden', 'true');
    // the meta is the honest "Updated <rel>" and its recency SOURCE is
    // last_activity_at: this row's own updated_at is Jun 20 — the meta must
    // read the activity stamp (Jul 1). No last-actor field in the payload,
    // so no "your studio replied" claim either.
    await expect(row.locator('.reqmeta')).toHaveText('Updated Jul 1');
    await expect(listHost.locator('.reqrow', { hasText: 'New headshots' }).locator('.reqmeta')).toHaveText('Updated Jun 25');
    await expect(row.locator('.schip')).toHaveText('open');
    await expect(listHost.locator('.reqrow', { hasText: 'New headshots' }).locator('.schip')).toHaveText('in progress');
    // freshest ACTIVITY first — the fixture arrives in backend updated_at order
    // (New headshots first); the page must lead with Logo tweak (activity Jul 1)
    await expect(listHost.locator('.reqrow').nth(0)).toContainText('Logo tweak');
    await expect(listHost.locator('.reqrow').nth(1)).toContainText('New headshots');
    // All shows everything, with the resolved row in the "done" (good) styling
    await page.locator('#reqFilterAll').click();
    await expect(page.locator('#reqFilterAll')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#reqFilterOpen')).toHaveAttribute('aria-pressed', 'false');
    await expect(listHost.locator('.reqrow')).toHaveCount(3);
    // …still in activity order, resolved (oldest activity) last
    await expect(listHost.locator('.reqrow').nth(0)).toContainText('Logo tweak');
    await expect(listHost.locator('.reqrow').nth(2)).toContainText('Copy fixes');
    const done = listHost.locator('.reqrow', { hasText: 'Copy fixes' });
    await expect(done.locator('.schip.done')).toHaveText('resolved');
    await expect(done.locator('.qico.done')).toBeVisible();
    // back to Open — the filter is a pure client-side toggle
    await page.locator('#reqFilterOpen').click();
    await expect(listHost.locator('.reqrow')).toHaveCount(2);
  });

  test('an older function build (rows without last_activity_at) falls back to updated_at for meta AND order', async ({ page }) => {
    await installApp(page, { api: { ...REQ_API, '/client/support': { data: [
      { id: SUP_PROG, subject: 'New headshots', status: 'in_progress', project_id: null, updated_at: '2026-06-25T00:00:00Z' },
      { id: SUP_GEN, subject: 'Logo tweak', status: 'open', project_id: null, updated_at: '2026-06-20T00:00:00Z' },
    ] } } });
    await page.goto('/client.html');
    await openRequestsTab(page);
    const listHost = page.locator('#reqlist');
    await expect(listHost.locator('.reqrow', { hasText: 'New headshots' }).locator('.reqmeta')).toHaveText('Updated Jun 25');
    await expect(listHost.locator('.reqrow', { hasText: 'Logo tweak' }).locator('.reqmeta')).toHaveText('Updated Jun 20');
    await expect(listHost.locator('.reqrow').nth(0)).toContainText('New headshots');
  });

  test('all-resolved: the filter defaults to All so the list is never mysteriously empty', async ({ page }) => {
    await installApp(page, { api: { ...REQ_API, '/client/support': { data: [
      { id: SUP_PRJ, subject: 'Copy fixes', status: 'resolved', project_id: PID, updated_at: '2026-07-04T00:00:00Z' },
    ] } } });
    await page.goto('/client.html');
    await openRequestsTab(page);
    await expect(page.locator('#reqFilterAll')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#reqlist .reqrow', { hasText: 'Copy fixes' })).toBeVisible();
    // Open is still reachable and says so honestly
    await page.locator('#reqFilterOpen').click();
    await expect(page.locator('#reqlist .reqrow')).toHaveCount(0);
    await expect(page.locator('#reqlist')).toContainText('No open requests');
  });

  test('a request row opens its thread in the Messages reading pane', async ({ page }) => {
    await installApp(page, { api: REQ_API });
    await page.goto('/client.html');
    await openRequestsTab(page);
    await page.locator('#reqlist .reqrow', { hasText: 'Logo tweak' }).click();
    // openMessagesTo: the Messages tab activates with the thread in the pane
    await expect(page.locator('#tabnav [data-tab="messages"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#mpane')).toContainText('Could we nudge the logo left?');
  });

  test('no requests yet: the calm empty state, no filter chips', async ({ page }) => {
    await installApp(page, { api: { ...REQ_API, '/client/support': { data: [] } } });
    await page.goto('/client.html');
    await openRequestsTab(page);
    await expect(page.getByText('You haven’t made any requests yet.', { exact: false })).toBeVisible();
    await expect(page.locator('.reqfilter')).toHaveCount(0);
    await expect(page.locator('#reqlist')).toHaveCount(0);
  });

  // ── failure honesty: a failed read must NEVER render the empty-state copy ──
  test('a 502 on the requests read shows the couldn’t-load line — never the empty state', async ({ page }) => {
    await installApp(page, { api: REQ_API });
    await page.route('**/functions/v1/presence/client/support', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'bad_gateway' }) })
        : route.fallback());
    await page.goto('/client.html');
    await openRequestsTab(page);
    await expect(page.getByText('We couldn’t load your requests just now — please try again in a moment.')).toBeVisible();
    await expect(page.getByText('You haven’t made any requests yet.', { exact: false })).toHaveCount(0);
    await expect(page.locator('.reqfilter')).toHaveCount(0);
    // the services read succeeded — that section still renders fully
    await expect(page.locator('.svcgrid .card')).toHaveCount(3);
  });

  test('a 502 on the services read shows the couldn’t-load line — never the no-services copy', async ({ page }) => {
    await installApp(page, { api: REQ_API });
    await page.route('**/functions/v1/presence/client/services', (route) =>
      route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'bad_gateway' }) }));
    await page.goto('/client.html');
    await openRequestsTab(page);
    await expect(page.getByText('We couldn’t load your studio’s services just now — please try again in a moment.')).toBeVisible();
    await expect(page.getByText('hasn’t listed services here yet', { exact: false })).toHaveCount(0);
    // the requests read succeeded — the list still renders
    await expect(page.locator('#reqlist .reqrow')).toHaveCount(2);
  });

  // ── booking-flow depth: date → slots → confirm → the exact POST payload ──
  test('booking depth: pick a day, pick a slot, confirm — the POST carries {type_id, slot_start, name, email}', async ({ page }) => {
    const SLOT = '2026-08-01T10:00:00Z';
    await installApp(page, { api: { ...REQ_API,
      '/book/site-1/slots': { data: { slots: [SLOT, '2026-08-01T11:00:00Z'] } },
    } });
    await page.goto('/client.html');
    await openRequestsTab(page);
    await page.locator('#bookCall').click();
    await page.getByRole('button', { name: 'Choose' }).click();
    await expect(page.getByRole('heading', { name: 'Intro call' })).toBeVisible();
    // pick a day — the change handler refetches slots for THAT date
    const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const slotsReq = page.waitForRequest((r) => r.url().includes('/book/site-1/slots') && r.url().includes(`date=${day}`));
    await page.locator('#bk-date').fill(day);
    await slotsReq;
    // slots render as time buttons; picking one opens the confirm step
    await page.getByRole('button', { name: '10:00' }).click();
    await expect(page.getByRole('heading', { name: 'Confirm your booking' })).toBeVisible();
    await page.getByLabel('Your name').fill('Sam Client');
    await page.getByLabel('Email').fill('sam@example.com');
    const post = page.waitForRequest((r) => r.method() === 'POST' && /\/book\/site-1$/.test(new URL(r.url()).pathname));
    await page.getByRole('button', { name: 'Book it' }).click();
    expect((await post).postDataJSON()).toEqual({ type_id: 'bt1', slot_start: SLOT, name: 'Sam Client', email: 'sam@example.com' });
    // the booked screen + its back link land on the Requests tab again
    await expect(page.getByRole('heading', { name: /You’re booked/ })).toBeVisible();
    await page.getByRole('link', { name: '← Back to requests' }).click();
    await expect(page.locator('.acttile')).toHaveCount(2);
  });

  test('booking fallback: no bookable site → the calm not-set-up state, back to requests', async ({ page }) => {
    await installApp(page, { api: { ...REQ_API, '/client/book': { data: {} } } });
    await page.goto('/client.html');
    await openRequestsTab(page);
    await page.locator('#bookCall').click();
    await expect(page.getByText('Online booking isn’t set up yet', { exact: false })).toBeVisible();
    await page.getByRole('link', { name: '← Back to requests' }).click();
    await expect(page.locator('.acttile')).toHaveCount(2);
  });

  test('booking fallback: engine disabled / no types → the no-times state', async ({ page }) => {
    await installApp(page, { api: { ...REQ_API, '/book/site-1/types': { data: { enabled: false } } } });
    await page.goto('/client.html');
    await openRequestsTab(page);
    await page.locator('#bookCall').click();
    await expect(page.getByText('hasn’t opened any times for booking yet', { exact: false })).toBeVisible();
  });

  // ── degraded (non-UUID) service ids ride the POST untouched ──
  test('Request this on the custom and svc:0 cards POSTs their non-UUID ids as-is', async ({ page }) => {
    await installApp(page, { api: REQ_API });
    await page.route('**/functions/v1/presence/client/support', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: SUP_GEN } }) })
        : route.fallback());
    await page.goto('/client.html');
    await openRequestsTab(page);
    await page.getByRole('button', { name: 'Request this — Custom request' }).click();
    await page.getByLabel('What do you need?').fill('Something bespoke.');
    let post = page.waitForRequest((r) => r.method() === 'POST' && /\/client\/support$/.test(new URL(r.url()).pathname));
    await page.getByRole('button', { name: 'Send request' }).click();
    expect((await post).postDataJSON()).toEqual({
      subject: 'Service request: Custom request', service: 'custom',
      brief: { need: 'Something bespoke.', timeline: '', budget: '' },
    });
    // success re-renders the Requests view — the next card is right there
    await page.getByRole('button', { name: 'Request this — Extra page' }).click();
    await page.getByLabel('What do you need?').fill('One more page please.');
    post = page.waitForRequest((r) => r.method() === 'POST' && /\/client\/support$/.test(new URL(r.url()).pathname));
    await page.getByRole('button', { name: 'Send request' }).click();
    expect((await post).postDataJSON()).toEqual({
      subject: 'Service request: Extra page', service: 'svc:0',
      brief: { need: 'One more page please.', timeline: '', budget: '' },
    });
  });

  test('the brief refuses an empty need: toast, no POST, button still enabled', async ({ page }) => {
    await installApp(page, { api: REQ_API });
    let posts = 0;
    page.on('request', (r) => { if (r.method() === 'POST' && /\/client\/support$/.test(new URL(r.url()).pathname)) posts++; });
    await page.goto('/client.html');
    await openRequestsTab(page);
    await page.getByRole('button', { name: 'Request this — Brand refresh' }).click();
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.locator('#toast')).toContainText('Tell your studio what you need first.');
    expect(posts).toBe(0);
    await expect(page.getByRole('button', { name: 'Send request' })).toBeEnabled();
  });

  test('a failed brief POST keeps the composer: toast + re-enabled button, nothing typed is lost', async ({ page }) => {
    await installApp(page, { api: REQ_API });
    await page.route('**/functions/v1/presence/client/support', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'write_failed' }) })
        : route.fallback());
    await page.goto('/client.html');
    await openRequestsTab(page);
    await page.getByRole('button', { name: 'Request this — Brand refresh' }).click();
    await page.getByLabel('What do you need?').fill('A softer palette.');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.locator('#toast')).toContainText('That didn’t send — please try again.');
    await expect(page.getByRole('button', { name: 'Send request' })).toBeEnabled();
    await expect(page.getByLabel('What do you need?')).toHaveValue('A softer palette.');
  });

  // ── "Something else?" round-trips to the Requests tab (back AND success) ──
  test('Something else? returns to Requests on back and after a successful send — never strands on Home', async ({ page }) => {
    await installApp(page, { api: REQ_API });
    await page.goto('/client.html');
    await openRequestsTab(page);
    await page.locator('#newReq').click();
    await expect(page.getByRole('heading', { name: 'Message your studio' })).toBeVisible();
    // back → the Requests tab, not Home
    await page.getByRole('link', { name: '← Back' }).click();
    await expect(page.locator('.acttile')).toHaveCount(2);
    await expect(page.getByRole('heading', { name: 'Needs you' })).toHaveCount(0);
    // and a successful send lands back on Requests too
    await page.locator('#newReq').click();
    await page.getByLabel('Subject').fill('A quick question');
    await page.getByLabel('What do you need?').fill('Can we add a testimonial?');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('#toast')).toContainText('Sent — your studio will get back to you.');
    await expect(page.locator('.acttile')).toHaveCount(2);
    await expect(page.locator('#tabnav [data-tab="requests"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Needs you' })).toHaveCount(0);
  });

  // ── the Open/All chips are pure client-side, and the choice persists ──
  test('chip clicks trigger zero refetches, and the All choice survives tab-away/back', async ({ page }) => {
    await installApp(page, { api: REQ_API });
    let supportGets = 0;
    await page.route('**/functions/v1/presence/client/support', (route) => {
      if (route.request().method() === 'GET') supportGets++;
      return route.fallback();
    });
    await page.goto('/client.html');
    await openRequestsTab(page);
    await expect(page.locator('#reqlist .reqrow')).toHaveCount(2);
    expect(supportGets).toBe(1);
    await page.locator('#reqFilterAll').click();
    await expect(page.locator('#reqlist .reqrow')).toHaveCount(3);
    await page.locator('#reqFilterOpen').click();
    await expect(page.locator('#reqlist .reqrow')).toHaveCount(2);
    await page.locator('#reqFilterAll').click();
    await expect(page.locator('#reqlist .reqrow')).toHaveCount(3);
    expect(supportGets).toBe(1);   // filtering never refetched
    // tab away and back — the explicit All choice persists for the session
    await page.locator('#tabnav [data-tab="messages"]').click();
    await expect(page.locator('#mrows')).toBeVisible();
    await openRequestsTab(page);
    await expect(page.locator('#reqFilterAll')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#reqlist .reqrow')).toHaveCount(3);
  });

  // NOTE: the two former "reviewer" cases here fed a reviewer populated 200s on
  // /client/services + /client/support — a world the persona can NEVER see
  // (reviewerAllowed() 403s both, workspace.ts:31). Batch A (finding A2) made the
  // Requests tab gate the reviewer BEFORE any fetch, so the honest contract now
  // lives in "Batch A regressions — portal › A2" below (calm card, zero /client/*
  // reads), which also carries the zero-tiles / zero-Request-buttons guards.

  test('mobile: the tiles and service cards stack in one column, no horizontal overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'the stacked layout is the <720px contract');
    await installApp(page, { api: REQ_API });
    await page.goto('/client.html');
    await openRequestsTab(page);
    // the tiles stack: the second tile sits BELOW the first
    const tiles = page.locator('.acttile');
    const t0 = await tiles.nth(0).boundingBox(); const t1 = await tiles.nth(1).boundingBox();
    expect(t1!.y).toBeGreaterThan(t0!.y + t0!.height - 1);
    // the service cards stack too
    const cards = page.locator('.svcgrid .card');
    const c0 = await cards.nth(0).boundingBox(); const c1 = await cards.nth(1).boundingBox();
    expect(c1!.y).toBeGreaterThan(c0!.y + c0!.height - 1);
    await expect(page.locator('#reqlist .reqrow').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('no serious/critical axe violations on the Requests tab', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once, on desktop');
    await installApp(page, { api: REQ_API });
    await page.goto('/client.html');
    await openRequestsTab(page);
    await expect(page.locator('#reqlist .reqrow').first()).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`)).toEqual([]);
  });
});

// ── slice 12: the Files tab redesign ─────────────────────────────────────────
// A dashed share card ("Share a file with your studio") drives the EXISTING
// per-project upload backend: POST upload-url → PUT the bytes → POST uploads.
// Documents and each project's files become list views (icon · title · meta ·
// chip/action). Client-sent files (the server-stamped 'Uploaded by the client.'
// note — the payload's only signal) read "Sent to your studio" + a You-shared
// chip. Failure honesty per read; a reviewer never sees the share card.
const PID2 = '66666666-6666-4666-8666-666666666666'; // second project (the picker case)
// PRODUCTION ORDER: handleClientDocuments sorts created_at DESC (one merged
// list across proposals + contracts) — the fixture models that exactly and the
// spec asserts the rows render in that order. Status variants cover every chip
// the route can emit: signed / sent contract, sent / declined / superseded
// proposal (superseded falls into docRowHtml's default 'Sent' — see the spec).
const FILES_DOCS = { data: { documents: [
  { kind: 'proposal', id: 'pr2', title: 'Care plan proposal', status: 'declined', created_at: '2026-07-14T00:00:00Z', view_url: 'https://docs.example/view/pr2' },
  { kind: 'contract', id: 'c2', title: 'Care plan agreement', status: 'sent', created_at: '2026-07-13T00:00:00Z', view_url: 'https://docs.example/view/c2' },
  { kind: 'proposal', id: 'pr1', title: 'Website redesign proposal', status: 'sent', created_at: '2026-07-08T00:00:00Z', view_url: 'https://docs.example/view/pr1' },
  { kind: 'proposal', id: 'pr0', title: 'First draft proposal', status: 'superseded', created_at: '2026-07-04T00:00:00Z', view_url: 'https://docs.example/view/pr0' },
  { kind: 'contract', id: 'c1', title: 'Service agreement', status: 'signed', signed_at: '2026-07-12T00:00:00Z', created_at: '2026-07-02T00:00:00Z', view_url: 'https://docs.example/view/c1' },
] } };
const FILES_DELIVERABLES = [
  { id: 'd1', title: 'Homepage mock v2.pdf', note: 'First look', created_at: '2026-07-15T00:00:00Z' },
  { id: 'd2', title: 'Brand palette.png', note: '', created_at: '2026-07-12T00:00:00Z' },
  { id: 'd3', title: 'Kitchen photos.zip', note: 'Uploaded by the client.', created_at: '2026-07-16T00:00:00Z' },
  // the studio APPENDED to the server-stamped note — the prefix match keeps the chip
  { id: 'd4', title: 'Site copy draft.pdf', note: 'Uploaded by the client. Filed under content.', created_at: '2026-07-11T00:00:00Z' },
];
const filesBundle = (deliverables: unknown[]) => ({ data: {
  project: { id: PID, name: 'Website redesign', status: 'active' },
  milestones: [], tasks: [], events: [], deliverables, approvals: [], surveys: [],
  progress: { total: 0, done: 0, pct: 0 },
} });
const FILES_API = {
  ...CLIENT_API,
  '/client/documents': FILES_DOCS,
  [`/client/projects/${PID}`]: filesBundle(FILES_DELIVERABLES),
};
const openFilesTab = async (page: import('@playwright/test').Page) => {
  await page.locator('#tabnav [data-tab="files"]').click();
  await expect(page.locator('#main').getByRole('heading', { name: 'Files & documents' })).toBeVisible();
};
// the three fixture routes behind a share-flow send (upload-url → PUT → uploads)
const routeUploadBackend = async (page: import('@playwright/test').Page, opts: { afterUpload?: unknown[] } = {}) => {
  let recorded = false;
  await page.route(`**/functions/v1/presence/client/projects/${PID}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(filesBundle(recorded && opts.afterUpload ? opts.afterUpload : FILES_DELIVERABLES)) }));
  await page.route('**/functions/v1/presence/client/projects/*/upload-url', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: { media_id: 'm-new', upload_url: 'https://storage.example/up/1', storage_path: 'sites/s/m-new' } }) }));
  await page.route('https://storage.example/**', (route) => route.fulfill({ status: 200, body: '' }));
  await page.route('**/functions/v1/presence/client/projects/*/uploads', (route) => {
    recorded = true;
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'nd1' } }) });
  });
};
const SHARE_FILE = { name: 'Team photos.png', mimeType: 'image/png', buffer: Buffer.from('png-bytes') };

test.describe('Client portal — Files tab (slice 12)', () => {
  test('Documents is a list view in production order (created_at desc): icons, meta, every status chip, View links', async ({ page }) => {
    await installApp(page, { api: FILES_API });
    await page.goto('/client.html');
    await openFilesTab(page);
    const docs = page.locator('#fdocs');
    await expect(docs.locator('.frow')).toHaveCount(5);
    // rows render in the route's order — created_at DESC across kinds
    await expect(docs.locator('.frow .fname')).toHaveText([
      'Care plan proposal', 'Care plan agreement', 'Website redesign proposal', 'First draft proposal', 'Service agreement',
    ]);
    // one chip per status the route can emit. NOTE (current behavior, asserted
    // as-is): a SUPERSEDED proposal falls into docRowHtml's default 'Sent' chip —
    // arguably it should read 'Replaced' (a newer proposal supersedes it), but
    // that is a copy decision for its own slice, not a silent change here.
    await expect(docs.locator('.frow .fst')).toHaveText(['Declined', 'Awaiting signature', 'Sent', 'Sent', 'Signed']);
    const signed = docs.locator('.frow', { hasText: 'Service agreement' });
    await expect(signed.locator('.fmeta')).toHaveText('Agreement · signed July 12');
    await expect(signed.locator('.fst.sig')).toHaveText('Signed');   // Signed = the good/green chip
    const unsigned = docs.locator('.frow', { hasText: 'Care plan agreement' });
    await expect(unsigned.locator('.fmeta')).toHaveText('Agreement · sent July 13');
    await expect(unsigned.locator('.fst.sig')).toHaveCount(0);       // …everything else stays purple
    const prop = docs.locator('.frow', { hasText: 'Website redesign proposal' });
    await expect(prop.locator('.fmeta')).toHaveText('Proposal · sent July 8');
    // View keeps the existing behavior: the signed doc-viewer URL, new tab, no opener
    const view = signed.getByRole('link', { name: 'View — Service agreement' });
    await expect(view).toHaveAttribute('href', 'https://docs.example/view/c1');
    await expect(view).toHaveAttribute('target', '_blank');
    await expect(view).toHaveAttribute('rel', 'noopener');
  });

  test('project files are list rows: type icon, honest meta, You-shared chip on client uploads, Download round-trip', async ({ page }) => {
    await installApp(page, { api: FILES_API });
    await page.addInitScript(() => { (window as any).open = (u: string) => { (window as any).__opened = u; return null; }; });
    await page.route('**/functions/v1/presence/client/deliverables/d1/download', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { url: 'https://files.example/dl/1', title: 'Homepage mock v2.pdf' } }) }));
    await page.goto('/client.html');
    await openFilesTab(page);
    const sec = page.locator('section', { has: page.getByRole('heading', { name: 'Website redesign', exact: true }) });
    await expect(sec.locator('.frow')).toHaveCount(4);
    const studio = sec.locator('.frow', { hasText: 'Homepage mock v2.pdf' });
    await expect(studio.locator('.fmeta')).toHaveText('Shared by your studio · July 15');
    await expect(studio.locator('.fyou')).toHaveCount(0);
    // the client's own upload — detected by the server-stamped note — reads the other way
    const mine = sec.locator('.frow', { hasText: 'Kitchen photos.zip' });
    await expect(mine.locator('.fmeta')).toHaveText('Sent to your studio · July 16');
    await expect(mine.locator('.fyou')).toHaveText('You shared');
    // PREFIX detection: a studio-appended note keeps the You-shared chip
    const appended = sec.locator('.frow', { hasText: 'Site copy draft.pdf' });
    await expect(appended.locator('.fyou')).toHaveText('You shared');
    await expect(appended.locator('.fmeta')).toHaveText('Sent to your studio · July 11');
    // Download keeps the wireDownloads round-trip: signed URL fetched, then opened
    await studio.getByRole('button', { name: 'Download — Homepage mock v2.pdf' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__opened)).toBe('https://files.example/dl/1');
  });

  test('share flow end-to-end (one project): auto-selected, title defaults to the filename, 3-step send, re-render shows the You-shared file', async ({ page }) => {
    await installApp(page, { api: FILES_API });
    await routeUploadBackend(page, { afterUpload: [...FILES_DELIVERABLES,
      { id: 'nd1', title: 'Team photos.png', note: 'Uploaded by the client.', created_at: '2026-07-19T00:00:00Z' }] });
    await page.goto('/client.html');
    await openFilesTab(page);
    const share = page.locator('.fshare');
    await expect(share.getByText('Share a file with your studio')).toBeVisible();
    await page.locator('#ffile').setInputFiles(SHARE_FILE);
    // exactly one project → no picker; the optional title defaults to the filename;
    // the pick moves focus into the compose (its title field)
    await expect(page.locator('#fsend')).toBeVisible();
    await expect(page.locator('#fproj')).toHaveCount(0);
    await expect(page.locator('#ftitle')).toHaveValue('Team photos.png');
    await expect(page.locator('#ftitle')).toBeFocused();
    const upUrl = page.waitForRequest((r) => r.method() === 'POST' && /\/client\/projects\/[^/]+\/upload-url$/.test(new URL(r.url()).pathname));
    const put = page.waitForRequest((r) => r.method() === 'PUT' && r.url().startsWith('https://storage.example/up/1'));
    const rec = page.waitForRequest((r) => r.method() === 'POST' && /\/client\/projects\/[^/]+\/uploads$/.test(new URL(r.url()).pathname));
    await page.locator('#fgo').click();
    // step 1: the validated upload-url request carries the real mime/bytes/title
    expect((await upUrl).postDataJSON()).toEqual({ mime: 'image/png', bytes: SHARE_FILE.buffer.length, title: 'Team photos.png' });
    // step 2: the bytes go to the URL the server returned, typed as the file —
    // and the PUT body IS the picked file's bytes, byte for byte
    expect((await put).headers()['content-type']).toBe('image/png');
    expect((await put).postDataBuffer()).toEqual(SHARE_FILE.buffer);
    // step 3: the recording POST ties the media id back
    expect((await rec).postDataJSON()).toEqual({ media_id: 'm-new', title: 'Team photos.png' });
    await expect(page.locator('#toast')).toContainText('Sent to your studio');
    // the re-render shows the new file with its You-shared mark, and focus lands
    // back on the share card's button (the compose is gone)
    const row = page.locator('.frow', { hasText: 'Team photos.png' });
    await expect(row.locator('.fyou')).toHaveText('You shared');
    await expect(page.locator('#fchoose')).toBeFocused();
  });

  test('two projects: steps 1, 2 AND 3 all pin to the PICKED project — then the re-render shows its chip', async ({ page }) => {
    await installApp(page, { api: {
      ...FILES_API,
      '/client/projects': { data: [
        { id: PID, name: 'Website redesign', status: 'active' },
        { id: PID2, name: 'Brand refresh', status: 'active' },
      ] },
    } });
    let recorded = false;
    await page.route(`**/functions/v1/presence/client/projects/${PID2}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {
        project: { id: PID2, name: 'Brand refresh', status: 'active' },
        milestones: [], tasks: [], events: [],
        deliverables: recorded ? [{ id: 'nd2', title: 'Team photos.png', note: 'Uploaded by the client.', created_at: '2026-07-19T00:00:00Z' }] : [],
        approvals: [], surveys: [], progress: { total: 0, done: 0, pct: 0 },
      } }) }));
    // per-project responses: the media id + PUT URL DIFFER per project, so a send
    // that mixes projects across the steps cannot pass by accident
    await page.route('**/functions/v1/presence/client/projects/*/upload-url', (route) => {
      const forP2 = route.request().url().includes(PID2);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {
        media_id: forP2 ? 'm-p2' : 'm-p1', upload_url: forP2 ? 'https://storage.example/up/p2' : 'https://storage.example/up/p1', storage_path: 'p' } }) });
    });
    await page.route('https://storage.example/**', (route) => route.fulfill({ status: 200, body: '' }));
    await page.route('**/functions/v1/presence/client/projects/*/uploads', (route) => {
      recorded = true;
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'nd2' } }) });
    });
    await page.goto('/client.html');
    await openFilesTab(page);
    await page.locator('#ffile').setInputFiles(SHARE_FILE);
    const sel = page.locator('#fproj');
    await expect(sel).toBeVisible();
    await expect(sel.locator('option')).toHaveText(['Website redesign', 'Brand refresh']);
    await sel.selectOption(PID2);
    // steps 1 and 3 are pinned by EXACT pathname to the picked project id — a
    // send that posts either step at any other project never resolves these
    const upUrl = page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname.endsWith(`/client/projects/${PID2}/upload-url`));
    const put = page.waitForRequest((r) => r.method() === 'PUT' && r.url().startsWith('https://storage.example/'));
    const rec = page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname.endsWith(`/client/projects/${PID2}/uploads`));
    await page.locator('#fgo').click();
    await upUrl;
    // step 2 rides the PICKED project's signed URL and carries the real bytes
    expect((await put).url()).toBe('https://storage.example/up/p2');
    expect((await put).postDataBuffer()).toEqual(SHARE_FILE.buffer);
    // step 3 ties the PICKED project's media id back
    expect((await rec).postDataJSON()).toEqual({ media_id: 'm-p2', title: 'Team photos.png' });
    await expect(page.locator('#toast')).toContainText('Sent to your studio');
    const sec = page.locator('section', { has: page.getByRole('heading', { name: 'Brand refresh', exact: true }) });
    await expect(sec.locator('.frow', { hasText: 'Team photos.png' }).locator('.fyou')).toHaveText('You shared');
  });

  test('an edited title rides BOTH the upload-url and the record POST — and Enter in the title submits (the compose is a form)', async ({ page }) => {
    await installApp(page, { api: FILES_API });
    await routeUploadBackend(page);
    await page.goto('/client.html');
    await openFilesTab(page);
    await page.locator('#ffile').setInputFiles(SHARE_FILE);
    await page.locator('#ftitle').fill('Kitchen — final photos');
    const upUrl = page.waitForRequest((r) => r.method() === 'POST' && /\/upload-url$/.test(new URL(r.url()).pathname));
    const rec = page.waitForRequest((r) => r.method() === 'POST' && /\/uploads$/.test(new URL(r.url()).pathname));
    await page.locator('#ftitle').press('Enter');   // no button click — the <form> submits
    expect((await upUrl).postDataJSON()).toEqual({ mime: 'image/png', bytes: SHARE_FILE.buffer.length, title: 'Kitchen — final photos' });
    expect((await rec).postDataJSON()).toEqual({ media_id: 'm-new', title: 'Kitchen — final photos' });
    await expect(page.locator('#toast')).toContainText('Sent to your studio');
  });

  test('a step-3 (record) failure keeps the upload: toast + re-enable, and the retry re-runs ONLY the record step', async ({ page }) => {
    await installApp(page, { api: FILES_API });
    let upCalls = 0, putCalls = 0, recCalls = 0;
    await page.route('**/functions/v1/presence/client/projects/*/upload-url', (route) => { upCalls++;
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: { media_id: 'm-new', upload_url: 'https://storage.example/up/1', storage_path: 'p' } }) }); });
    await page.route('https://storage.example/**', (route) => { putCalls++; return route.fulfill({ status: 200, body: '' }); });
    await page.route('**/functions/v1/presence/client/projects/*/uploads', (route) => { recCalls++;
      if (recCalls === 1) return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'write_failed', message: 'That didn’t save — please try again.' }) });
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'nd1' } }) });
    });
    await page.goto('/client.html');
    await openFilesTab(page);
    await page.locator('#ffile').setInputFiles(SHARE_FILE);
    await page.locator('#fgo').click();
    await expect(page.locator('#toast')).toContainText('That didn’t save — please try again.');
    await expect(page.locator('#fgo')).toBeEnabled();
    await expect(page.locator('#fgo')).toHaveText('Send to your studio');
    await expect(page.locator('#fno')).toBeEnabled();       // the fence lifts with the failure
    await expect(page.locator('#fchoose')).toBeEnabled();
    // the retry re-runs ONLY the record step: the media id was kept, nothing re-uploads
    const rec = page.waitForRequest((r) => r.method() === 'POST' && /\/uploads$/.test(new URL(r.url()).pathname));
    await page.locator('#fgo').click();
    expect((await rec).postDataJSON()).toEqual({ media_id: 'm-new', title: 'Team photos.png' });
    await expect(page.locator('#toast')).toContainText('Sent to your studio');
    expect(upCalls).toBe(1);    // NO second upload-url — no orphaned media per retry
    expect(putCalls).toBe(1);   // …and no second PUT
    expect(recCalls).toBe(2);
  });

  test('a 200 upload-url with NO url is an honest failure: toast, re-enabled button, no PUT', async ({ page }) => {
    await installApp(page, { api: FILES_API });
    await page.route('**/functions/v1/presence/client/projects/*/upload-url', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { media_id: 'm-new' } }) }));
    let puts = 0;
    page.on('request', (r) => { if (r.method() === 'PUT') puts++; });
    await page.goto('/client.html');
    await openFilesTab(page);
    await page.locator('#ffile').setInputFiles(SHARE_FILE);
    await page.locator('#fgo').click();
    await expect(page.locator('#toast')).toContainText('Uploads aren’t available right now.');
    await expect(page.locator('#fgo')).toBeEnabled();
    expect(puts).toBe(0);
  });

  test('in flight: Cancel and Choose-a-file are fenced off until the send settles', async ({ page }) => {
    await installApp(page, { api: FILES_API });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    await page.route('**/functions/v1/presence/client/projects/*/upload-url', async (route) => {
      await gate;
      return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'x', message: 'Not this time.' }) });
    });
    await page.goto('/client.html');
    await openFilesTab(page);
    await page.locator('#ffile').setInputFiles(SHARE_FILE);
    await page.locator('#fgo').click();
    await expect(page.locator('#fgo')).toHaveText('Sending…');
    await expect(page.locator('#fno')).toBeDisabled();
    await expect(page.locator('#fchoose')).toBeDisabled();
    release();
    await expect(page.locator('#toast')).toContainText('Not this time.');
    await expect(page.locator('#fno')).toBeEnabled();
    await expect(page.locator('#fchoose')).toBeEnabled();
  });

  test('Cancel closes the compose, returns focus to the share button, and the SAME file re-picks cleanly', async ({ page }) => {
    await installApp(page, { api: FILES_API });
    await page.goto('/client.html');
    await openFilesTab(page);
    await page.locator('#ffile').setInputFiles(SHARE_FILE);
    await expect(page.locator('#fsend')).toBeVisible();
    await page.locator('#fno').click();
    await expect(page.locator('#fsend')).toBeHidden();
    await expect(page.locator('#fchoose')).toBeFocused();   // focus hands back to the share button
    // the input was cleared on cancel, so picking the SAME file fires change again
    await page.locator('#ffile').setInputFiles(SHARE_FILE);
    await expect(page.locator('#fsend')).toBeVisible();
    await expect(page.locator('#ftitle')).toHaveValue('Team photos.png');
    await expect(page.locator('#ftitle')).toBeFocused();
  });

  test('pre-flight honesty: a type the store can’t take is refused BEFORE any network call', async ({ page }) => {
    await installApp(page, { api: FILES_API });
    let calls = 0;
    page.on('request', (r) => { if (/upload-url|\/uploads$|storage\.example/.test(r.url())) calls++; });
    await page.goto('/client.html');
    await openFilesTab(page);
    // the input itself advertises exactly what the store accepts, and the copy names the caps
    await expect(page.locator('#ffile')).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp,application/pdf');
    await expect(page.locator('.fshare-d')).toContainText('10MB');
    await expect(page.locator('.fshare-d')).toContainText('25MB');
    await page.locator('#ffile').setInputFiles({ name: 'Team photos.zip', mimeType: 'application/zip', buffer: Buffer.from('zip') });
    await expect(page.locator('#toast')).toContainText('a JPEG, PNG or WebP image, or a PDF');
    await expect(page.locator('#fsend')).toBeHidden();      // the compose never opens
    expect(calls).toBe(0);
  });

  test('pre-flight honesty: an over-cap image is refused with the cap named, no network', async ({ page }) => {
    await installApp(page, { api: FILES_API });
    let calls = 0;
    page.on('request', (r) => { if (/upload-url|\/uploads$|storage\.example/.test(r.url())) calls++; });
    await page.goto('/client.html');
    await openFilesTab(page);
    await page.locator('#ffile').setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
    await expect(page.locator('#toast')).toContainText('images can be up to 10MB');
    await expect(page.locator('#fsend')).toBeHidden();
    expect(calls).toBe(0);
  });

  test('portal-voiced 422s: the store’s alt-text ask maps to portal copy; unknown messages stay verbatim', async ({ page }) => {
    await installApp(page, { api: FILES_API });
    await page.route('**/functions/v1/presence/client/projects/*/upload-url', (route) =>
      route.fulfill({ status: 422, contentType: 'application/json',
        body: JSON.stringify({ error: 'alt_required', message: 'Please describe the image (alt text) — it helps customers and search engines.' }) }));
    await page.goto('/client.html');
    await openFilesTab(page);
    await page.locator('#ffile').setInputFiles(SHARE_FILE);
    await page.locator('#fgo').click();
    await expect(page.locator('#toast')).toContainText('Give the file a short name (a few characters helps your studio find it).');
    await expect(page.locator('#fgo')).toBeEnabled();
  });

  test('portal-voiced 422s: the 0-byte case reads "looks empty", never the under-the-cap lie', async ({ page }) => {
    await installApp(page, { api: FILES_API });
    await page.route('**/functions/v1/presence/client/projects/*/upload-url', (route) =>
      route.fulfill({ status: 422, contentType: 'application/json',
        body: JSON.stringify({ error: 'too_large', message: 'Images must be under 10MB.' }) }));
    await page.goto('/client.html');
    await openFilesTab(page);
    await page.locator('#ffile').setInputFiles({ name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) });
    await page.locator('#fgo').click();
    await expect(page.locator('#toast')).toContainText('That file looks empty — pick it again?');
    await expect(page.locator('#fgo')).toBeEnabled();
  });

  test('zero projects: the share card is hidden entirely (uploads are project-scoped)', async ({ page }) => {
    await installApp(page, { api: { ...FILES_API, '/client/projects': { data: [] }, '/client/documents': { data: { documents: [] } } } });
    await page.goto('/client.html');
    await openFilesTab(page);
    await expect(page.locator('.fshare')).toHaveCount(0);
    // a genuine empty still gets the friendly empty card
    await expect(page.getByText('No files yet.', { exact: false })).toBeVisible();
  });

  test('a 422 from upload-url surfaces the server’s own message and re-enables the button', async ({ page }) => {
    await installApp(page, { api: FILES_API });
    await page.route('**/functions/v1/presence/client/projects/*/upload-url', (route) =>
      route.fulfill({ status: 422, contentType: 'application/json',
        body: JSON.stringify({ error: 'validation', message: 'That file is too big — 25 MB is the limit.' }) }));
    await page.goto('/client.html');
    await openFilesTab(page);
    await page.locator('#ffile').setInputFiles(SHARE_FILE);
    await page.locator('#fgo').click();
    await expect(page.locator('#toast')).toContainText('That file is too big — 25 MB is the limit.');
    await expect(page.locator('#fgo')).toBeEnabled();
    await expect(page.locator('#fgo')).toHaveText('Send to your studio');
  });

  test('a failed PUT gets the calm retry toast — never silent', async ({ page }) => {
    await installApp(page, { api: FILES_API });
    await page.route('**/functions/v1/presence/client/projects/*/upload-url', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: { media_id: 'm-new', upload_url: 'https://storage.example/up/1', storage_path: 'p' } }) }));
    await page.route('https://storage.example/**', (route) => route.fulfill({ status: 500, body: '' }));
    let recorded = 0;
    page.on('request', (r) => { if (r.method() === 'POST' && /\/uploads$/.test(new URL(r.url()).pathname)) recorded++; });
    await page.goto('/client.html');
    await openFilesTab(page);
    await page.locator('#ffile').setInputFiles(SHARE_FILE);
    await page.locator('#fgo').click();
    await expect(page.locator('#toast')).toContainText('The upload didn’t finish — please try again.');
    await expect(page.locator('#fgo')).toBeEnabled();
    expect(recorded).toBe(0);   // a dead PUT never records a phantom file
  });

  test('reviewer: /client/* 403s in production — the calm read-only state, no error line, NO Files-tab fetches', async ({ page }) => {
    await installApp(page, { api: {
      '/portal/context': REVIEWER_CTX,
      '/portal/feed': { data: { role: 'client_reviewer', moments: [], pending_approvals: [], last_published: null } },
    } });
    // PRODUCTION shape: every /client/* route answers 403 for a client_reviewer.
    // (The earlier version of this spec fed the reviewer populated 200s — a
    // world the persona can never see; against real 403s it showed the
    // permanent "couldn't load" error line this spec now forbids.)
    await page.route('**/functions/v1/presence/client/**', (route) =>
      route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) }));
    const calls: string[] = [];
    page.on('request', (r) => { if (/\/client\/(documents|projects\/)/.test(r.url())) calls.push(r.url()); });
    await page.goto('/client.html');
    await openFilesTab(page);
    await expect(page.getByText('Your studio’s files and documents will appear here', { exact: false })).toBeVisible();
    await expect(page.locator('.fshare')).toHaveCount(0);
    await expect(page.getByText('We couldn’t load', { exact: false })).toHaveCount(0);   // never the error line
    expect(calls).toHaveLength(0);   // the reviewer render makes NO /client/* reads at all
    // Mutation M1 (dropping the persona clause from the share gate) re-verified:
    // the load() persona derivation makes a reviewer-with-projects UNREPRESENTABLE
    // (any account with projects — or is_managed_client — is persona 'client'),
    // so the enforced reviewer boundary is the persona gate at the TOP of
    // renderFiles, asserted here against the production 403 world; below that
    // gate, share visibility legitimately depends only on projects.length.
  });

  test('a 502 on the documents read shows the couldn’t-load line — never "no documents"', async ({ page }) => {
    await installApp(page, { api: FILES_API });
    await page.route('**/functions/v1/presence/client/documents', (route) =>
      route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'bad_gateway' }) }));
    await page.goto('/client.html');
    await openFilesTab(page);
    await expect(page.getByText('We couldn’t load your documents just now — please try again in a moment.')).toBeVisible();
    // the project files read succeeded — that section still renders fully
    await expect(page.locator('.frow', { hasText: 'Homepage mock v2.pdf' })).toBeVisible();
    await expect(page.getByText('No files yet.', { exact: false })).toHaveCount(0);
  });

  test('a failed project-bundle read shows that project’s couldn’t-load line — never the empty card', async ({ page }) => {
    await installApp(page, { api: { ...FILES_API, '/client/documents': { data: { documents: [] } } } });
    await page.route(`**/functions/v1/presence/client/projects/${PID}`, (route) =>
      route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'bad_gateway' }) }));
    await page.goto('/client.html');
    await openFilesTab(page);
    const sec = page.locator('section', { has: page.getByRole('heading', { name: 'Website redesign', exact: true }) });
    await expect(sec.getByText('We couldn’t load this project’s files just now — please try again in a moment.')).toBeVisible();
    await expect(page.getByText('No files yet.', { exact: false })).toHaveCount(0);
  });

  test('mobile: the share card wraps — the button drops below full-width, rows stay, no horizontal overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'the wrapped share card is the <560px contract');
    await installApp(page, { api: FILES_API });
    await page.goto('/client.html');
    await openFilesTab(page);
    const text = await page.locator('.fshare-m').boundingBox();
    const btn = await page.locator('#fchoose').boundingBox();
    expect(btn!.y).toBeGreaterThan(text!.y + text!.height - 1);   // wrapped below the copy
    const card = await page.locator('.fshare').boundingBox();
    expect(btn!.width).toBeGreaterThan(card!.width * 0.8);        // …at full width
    await expect(page.locator('.frow', { hasText: 'Kitchen photos.zip' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('no serious/critical axe violations with the share flow open', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once, on desktop');
    await installApp(page, { api: FILES_API });
    await page.goto('/client.html');
    await openFilesTab(page);
    await page.locator('#ffile').setInputFiles(SHARE_FILE);
    await expect(page.locator('#fsend')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`)).toEqual([]);
  });
});

// ── Batch A (post-redesign audit) — portal regressions ───────────────────────
// A2: a reviewer on the Requests tab gets the calm read-only state with NO
// /client/* fetches (the renderMessages/renderFiles contract) — never the
// couldn't-load cards a 403 world used to produce. A4: a failed billing read
// says so, and is NOT cached for the session — the next visit retries. A12:
// the drill-in support thread attributes by the server `from` field — a studio
// reply whose author_kind resolves to 'client' must never render as "You".
test.describe('Batch A regressions — portal', () => {
  test('A2 — reviewer Requests: calm state, no /client/support or /client/services fetches', async ({ page }) => {
    const calls: string[] = [];
    await installApp(page, { api: {
      '/portal/context': REVIEWER_CTX,
      '/portal/feed': { data: { role: 'client_reviewer', moments: [], pending_approvals: [], last_published: null } },
    } });
    page.on('request', (r) => {
      if (r.url().includes('/client/support') || r.url().includes('/client/services')) calls.push(r.url());
    });
    await page.goto('/client.html');
    await page.locator('#tabnav [data-tab="requests"]').click();
    await expect(page.getByText('Your studio’s services will appear here once they’ve set up your account.')).toBeVisible();
    // never the couldn't-load cards…
    await expect(page.getByText('We couldn’t load', { exact: false })).toHaveCount(0);
    // …the reviewer gets NO way to act: no catalog cards, no Request buttons, no
    // quick-action tiles (the early persona gate renders none of the acting UI)…
    await expect(page.locator('.svcgrid .card')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Request this/ })).toHaveCount(0);
    await expect(page.locator('.acttile')).toHaveCount(0);
    // …and no reviewer-doomed /client/* reads were fired at all
    expect(calls).toHaveLength(0);
  });

  test('A4 — a failed billing read shows the honest line and is NOT session-cached (the next visit refetches)', async ({ page }) => {
    let calls = 0;
    await installApp(page, { api: CLIENT_API });
    // first TWO reads fail (Home's glance + the first Invoices visit); later ones succeed
    await page.route('**/functions/v1/presence/client/billing', (route) => {
      calls++;
      if (calls <= 2) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { invoices: [
        { id: 'i1', name: 'Deposit', amount: 500, status: 'open', due_date: '2026-07-20', pay_url: 'https://pay.example/x' },
      ] } }) });
    });
    await page.goto('/client.html');
    // Home's glance: the failed read HIDES the to-pay tile (never a fake $0),
    // while the real counts still render their tiles
    await expect(page.locator('#home-glance')).toBeVisible();
    await expect(page.locator('#glance-due')).toHaveCount(0);
    // first Invoices visit: the couldn't-load line — never "No invoices yet"
    await page.locator('#tabnav [data-tab="invoices"]').click();
    await expect(page.getByText('We couldn’t load your invoices just now — please try again in a moment.')).toBeVisible();
    await expect(page.getByText('No invoices yet', { exact: false })).toHaveCount(0);
    // away and back: the failure was NOT cached — the tab refetches and renders
    await page.locator('#tabnav [data-tab="home"]').click();
    await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
    await page.locator('#tabnav [data-tab="invoices"]').click();
    await expect(page.getByRole('heading', { name: 'Deposit' })).toBeVisible();
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  test('A12 — the drill-in support thread attributes by the server `from`: a studio reply never renders as You', async ({ page }) => {
    await installApp(page, { api: { ...MSG_API,
      '/client/support': { data: [
        { id: SUP_PRJ, subject: 'Copy fixes', status: 'open', project_id: PID, updated_at: '2026-07-04T00:00:00Z' },
      ] },
      [`/client/support/${SUP_PRJ}`]: { data: {
        request: { id: SUP_PRJ, subject: 'Copy fixes', body: 'Some typos on the About page.', status: 'open', project_id: PID, created_at: '2026-07-03T00:00:00Z' },
        // the poisoned production shape: the studio operator's reply ALSO stores
        // author_kind 'client' — only the additive server `from` tells the sides
        // apart. The old bubbleHtml path rendered this as "You".
        messages: [{ id: 'x1', body: 'Fixed — take a look.', author_kind: 'client', from: 'studio', created_at: '2026-07-04T00:00:00Z' }],
      } },
    } });
    await page.goto(`/client.html?project=${PID}`);
    await page.locator('#sec-support').getByRole('button', { name: 'View & reply' }).click();
    const thread = page.locator('#sthread');
    const reply = thread.locator('.ti').filter({ hasText: 'Fixed — take a look.' });
    await expect(reply).toContainText('Your studio replied');
    await expect(reply).not.toContainText('You replied');
    // the request body itself stays the client's own ("You opened this request")
    await expect(thread.locator('.ti').filter({ hasText: 'Some typos on the About page.' })).toContainText('You opened this request');
  });
});

// ── PS1 — failed-read honesty sweep: a failed read never masquerades as empty ─
// The remaining portal lies, one theme: every read that can fail says so with a
// calm couldn't-load line — never the empty/all-clear copy its success case
// earns. failed ≠ empty ≠ reviewer-calm: three states, three copies.
test.describe('PS1 — failed-read honesty (portal)', () => {
  const fail500 = (route: import('@playwright/test').Route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });

  test('a failed projects read shows the couldn’t-load line — never the 🚀 first-run card — and keeps the client badge', async ({ page }) => {
    await installApp(page, { api: CLIENT_API });
    // the EXACT list path only — the per-project bundle reads stay untouched
    await page.route('**/functions/v1/presence/client/projects', fail500);
    await page.goto('/client.html');
    const sec = page.locator('section', { has: page.getByRole('heading', { name: 'Your projects' }) });
    await expect(sec.getByText('We couldn’t load your projects just now — please try again in a moment.')).toBeVisible();
    // never the zero-project first-run story (active projects would silently vanish)
    await expect(page.getByText('When your studio starts a project', { exact: false })).toHaveCount(0);
    // the rolebadge derives from the persona, not projects.length — a managed
    // client with a failed read is still in THEIR workspace, not "Client view"
    await expect(page.locator('.rolebadge')).toHaveText(/Your workspace/);
  });

  // a managed client with genuinely nothing going on — the world where a failed
  // read used to masquerade as "You're all caught up." with work outstanding
  const EMPTY_CLIENT_API = {
    ...CLIENT_API,
    '/client/projects': { data: [] },
    '/client/notifications': { data: [], unread_count: 0 },
    '/client/billing': { data: { invoices: [] } },
    '/client/support': { data: [] },
  };

  test('a failed feed read in an otherwise-empty world NEVER claims "You’re all caught up."', async ({ page }) => {
    await installApp(page, { api: EMPTY_CLIENT_API });
    await page.route('**/functions/v1/presence/portal/feed**', fail500);
    await page.goto('/client.html');
    const body = page.locator('#needs-body');
    await expect(body.getByText('We couldn’t check on pending approvals just now — please try again in a moment.')).toBeVisible();
    await expect(page.getByText('You’re all caught up.')).toHaveCount(0);
  });

  test('a failed feed read gates Recent updates: the couldn’t-load line, never "Nothing new to share"', async ({ page }) => {
    await installApp(page, { api: EMPTY_CLIENT_API });
    await page.route('**/functions/v1/presence/portal/feed**', fail500);
    await page.goto('/client.html');
    const sec = page.locator('section', { has: page.getByRole('heading', { name: 'Recent updates' }) });
    await expect(sec.getByText('We couldn’t load recent updates just now — please try again in a moment.')).toBeVisible();
    await expect(page.getByText('Nothing new to share right now', { exact: false })).toHaveCount(0);
  });

  test('only an ALL-sources-ok-and-empty queue earns "You’re all caught up." (the gate does not over-fire)', async ({ page }) => {
    await installApp(page, { api: EMPTY_CLIENT_API });
    await page.goto('/client.html');
    await expect(page.getByText('You’re all caught up.')).toBeVisible();
    await expect(page.getByText('We couldn’t check', { exact: false })).toHaveCount(0);
  });

  test('a failed notifications read: the bell panel says so — and NEVER fires the mark-seen POST', async ({ page }) => {
    await installApp(page, { api: CLIENT_API });
    await page.route('**/functions/v1/presence/client/notifications', (route) =>
      route.request().method() === 'GET' ? fail500(route) : route.fallback());
    let markSeen = 0;
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/client/notifications/read')) markSeen++; });
    await page.goto('/client.html');
    await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
    // whichever bell this viewport shows (Home topbar <720px, context bar above)
    await page.locator('#navbell:visible, #bell:visible').first().click();
    const panel = page.locator('.notifpanel:visible');
    await expect(panel.getByText('We couldn’t check just now — try again in a moment.')).toBeVisible();
    // never the all-clear copy a failed read can't earn…
    await expect(panel.getByText('You’re all caught up — nothing new right now.')).toHaveCount(0);
    // …and nothing was "seen": the last_seen_at cursor POST must not fire on the
    // failed branch (it would silently swallow whatever the read really held)
    expect(markSeen).toBe(0);
  });

  test('a failed billing read: surviving queue rows + its own calm line, due tile hidden — no fake $0', async ({ page }) => {
    await installApp(page, { api: CLIENT_API });
    await page.route('**/functions/v1/presence/client/billing', fail500);
    await page.goto('/client.html');
    const body = page.locator('#needs-body');
    // the OTHER sources' rows survive the billing failure…
    await expect(body.getByRole('button', { name: 'Review & approve — Homepage design' })).toBeVisible();
    await expect(body.getByRole('button', { name: 'Open to-dos — Website redesign' })).toBeVisible();
    // …with billing's one calm per-source line under them — never "caught up"
    await expect(body.getByText('We couldn’t check on invoices just now — please try again in a moment.')).toBeVisible();
    await expect(page.getByText('You’re all caught up.')).toHaveCount(0);
    // the due tile hides BY CONTRACT (billingFailed) — never a fake $0
    await expect(page.locator('#home-glance')).toBeVisible();
    await expect(page.locator('#glance-due')).toHaveCount(0);
    await expect(page.locator('#home-glance')).not.toContainText('$0');
  });
});
