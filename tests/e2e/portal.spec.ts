import { test, expect } from '@playwright/test';
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
