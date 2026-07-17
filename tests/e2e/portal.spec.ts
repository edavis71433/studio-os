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
    // action names include the row title (aria-label) so repeated actions stay distinguishable
    await expect(body.getByRole('link', { name: 'Pay — Deposit' })).toBeVisible();
    await expect(body.getByRole('button', { name: 'Review — Homepage design' })).toBeVisible();
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
// degradation: no GSC → no Google tile/section; zero visitors → a gentle
// "ready to be found" state; unpublished / 404 (older function build) → no card.
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
    await expect(card.locator('.wslead b').nth(1)).toHaveText('11 of them reached out');
    await expect(card.locator('.wslead b').nth(2)).toHaveText('Google');
    // three mini tiles (the Google one exists because GSC data does)
    const tiles = card.locator('.wsmini .m');
    await expect(tiles).toHaveCount(3);
    await expect(tiles.nth(0)).toContainText('214');
    await expect(tiles.nth(0)).toContainText('visitors this month');
    await expect(tiles.nth(1)).toContainText('11');
    await expect(tiles.nth(1)).toContainText('reached out or booked');
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
