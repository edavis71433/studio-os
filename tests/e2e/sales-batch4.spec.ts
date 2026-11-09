import { test, expect } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Sales review, Nov 2026 — batch four:
//   item 24  a client's Overview leads with the client's facts (project, what
//            waits on them, what they owe, their website), not sales tiles read
//            against the client's own site.
//   item 26  a repeat customer's projects and deals are lists on the record.
//   item 27  one tip per visit; a tip that was shown is retired when the page
//            is left, Got it or not.
//   item 28  every enquiry row says where it stands, and an enquiry takes a
//            private note before it is a deal.

const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const PROJECT = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const PROJECT_2 = 'cccccccc-3333-4333-8333-cccccccccccc';
const DEAL = 'dddddddd-4444-4444-8444-dddddddddddd';
const DEAL_2 = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';

const scopedCtx = (extra: Record<string, unknown> = {}) => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true,
  capabilities: ['edit', 'publish', 'view_all'], landing: '/today.html', attention_count: 0, nav: STUDIO_NAV,
  scope: { site_id: CLIENT, name: 'Maple Street Studio' }, site_live: true, ...extra,
} });
const RECORD = (extra: Record<string, unknown> = {}) => ({ data: {
  identity: { contact_id: null, deal_id: DEAL, client_id: 'cl-1', customer_site_id: CLIENT, project_id: PROJECT },
  header: { name: 'Maple Street Studio', company: '', email: 'hello@example.com', phone: '', status: 'customer' },
  highlights: { value_cents: 240000, stage: 'won', owed_cents: 120000 },
  sections: { overview: true, messages: true, deal: true, delivery: true, details: false },
  default_tab: 'delivery', canonical: { key: 'client', value: CLIENT },
  ...extra,
} });
const PROJ = { data: {
  project: { id: PROJECT, name: 'Website rebuild', status: 'active' },
  progress: { pct: 60 },
  milestones: [], deliverables: [],
  tasks: [
    { id: 't1', title: 'Send the logo', status: 'todo', client_action_required: true },
    { id: 't2', title: 'Approve the menu', status: 'done', client_action_required: true },
    { id: 't3', title: 'Build the pages', status: 'todo', client_action_required: false },
  ],
} };
const QUIET_SUMMARY = { data: { total: 0, open: { count: 0, value_cents: 0 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: { outstanding_cents: 0, count: 0, overdue_count: 0 } } };

test.describe('item 24 — a client\'s Overview leads with the client\'s facts', () => {
  test('project, what waits on them, what they owe and their site; the record under scope, the project at studio level', async ({ page }) => {
    const scopes: Record<string, string> = {};
    page.on('request', (r) => {
      const p = new URL(r.url()).pathname;
      if (p.endsWith('/crm/record')) scopes.record = r.headers()['x-dds-scope-site'] ?? 'none';
      if (p.endsWith(`/projects/${PROJECT}`)) scopes.project = r.headers()['x-dds-scope-site'] ?? 'none';
    });
    await installApp(page, { api: { '/portal/context': scopedCtx(), '/crm/record': RECORD(), [`/projects/${PROJECT}`]: PROJ, '/sales/summary': QUIET_SUMMARY } });
    await page.goto(`/today.html?client=${CLIENT}`);
    const band = page.locator('#client-facts');
    await expect(band).toBeVisible();
    await expect(band.locator('#cf-project')).toContainText('60% along');
    await expect(band.locator('#cf-project')).toContainText('Website rebuild');
    await expect(band.locator('#cf-project')).toHaveAttribute('href', `/projects.html?project=${PROJECT}&client=`);
    await expect(band.locator('#cf-waiting .hl-v')).toHaveText('1');                 // the done task and the studio's own task don't count
    await expect(band.locator('#cf-waiting')).toContainText('1 task for them');
    await expect(band.locator('#cf-owed .hl-v')).toHaveText('$1,200');
    await expect(band.locator('#cf-owed')).toHaveAttribute('href', `/crm.html?client=${CLIENT}&tab=billing`);
    await expect(band.locator('#cf-site .hl-v')).toHaveText('Live');
    await expect(band.locator('#cf-site')).toHaveAttribute('href', `/presence.html?client=${CLIENT}`);
    expect(scopes).toEqual({ record: CLIENT, project: '' });
    // the client's own site has no sales, so its zero tiles are gone
    await expect(page.locator('#stat-owed')).toHaveCount(0);
    await expect(page.locator('#stat-open')).toHaveCount(0);
  });

  test('a watch-plan site reads Hosted elsewhere; no project reads None yet; their own sales still show when they have some', async ({ page }) => {
    const rec = RECORD({ identity: { contact_id: null, deal_id: DEAL, client_id: 'cl-1', customer_site_id: CLIENT, project_id: null }, highlights: {} });
    const busy = { data: { ...QUIET_SUMMARY.data, total: 3, open: { count: 2, value_cents: 90000 } } };
    await installApp(page, { api: { '/portal/context': scopedCtx({ edition: 'monitor', site_live: false }), '/crm/record': rec, '/sales/summary': busy } });
    await page.goto(`/today.html?client=${CLIENT}`);
    const band = page.locator('#client-facts');
    await expect(band.locator('#cf-site .hl-v')).toHaveText('Hosted elsewhere');
    await expect(band.locator('#cf-project .hl-v')).toHaveText('None yet');
    await expect(band.locator('#cf-waiting')).toHaveCount(0);
    await expect(band.locator('#cf-owed .hl-v')).toHaveText('$0');
    await expect(band.locator('#cf-owed')).toContainText('Nothing owed');
    await expect(page.locator('#stat-open')).toContainText('2');
  });

  test('a failed project read drops the project tiles, never a false "nothing waiting"', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': scopedCtx(), '/crm/record': RECORD() } });
    await page.route(`**/functions/v1/presence/projects/${PROJECT}`, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
    await page.goto(`/today.html?client=${CLIENT}`);
    await expect(page.locator('#cf-owed')).toBeVisible();
    await expect(page.locator('#cf-project')).toHaveCount(0);
    await expect(page.locator('#cf-waiting')).toHaveCount(0);
  });

  test('a plain owner\'s Today has no band', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    await expect(page.locator('#greeting')).toBeVisible();
    await expect(page.locator('#client-facts')).toHaveCount(0);
  });
});

test.describe('item 26 — a repeat customer\'s projects and deals are lists', () => {
  const deal = { data: {
    deal: { id: DEAL, title: 'Website rebuild', stage: 'won', expected_value_cents: 240000, converted_client_id: 'cl-1' },
    proposals: [], contracts: [], invoices: [], events: [], timeline: [],
  } };
  const lists = {
    related_projects: [{ id: PROJECT, name: 'Website rebuild', status: 'active' }, { id: PROJECT_2, name: 'First site', status: 'complete' }],
    related_deals: [{ id: DEAL, title: 'Website rebuild', stage: 'won', value_cents: 240000 }, { id: DEAL_2, title: 'Monthly care', stage: 'proposal', value_cents: 30000 }],
  };
  const api = (rec: unknown) => ({ '/crm/record': rec, '/crm/activity': { data: { items: [] } }, [`/projects/${PROJECT}`]: PROJ, [`/sales/deals/${DEAL}`]: deal });

  test('two projects and two deals: each tab lists them all, each opening its own', async ({ page }) => {
    await installApp(page, { api: api(RECORD(lists)) });
    await page.goto(`/crm.html?client=${CLIENT}&tab=delivery`);   // the record opens on Activity since the bold redesign (part B); the project lists live on the Project tab
    const projects = page.locator('#allProjects');
    await expect(projects.locator('h2')).toHaveText('All projects · 2');
    await expect(projects.locator('.rrow')).toHaveCount(2);
    await expect(projects.locator('.rrow').first()).toContainText('shown above');
    await expect(projects.locator('.rrow').nth(1)).toContainText('First site');
    await expect(projects.locator('.rrow').nth(1).getByRole('link', { name: 'Open →' })).toHaveAttribute('href', `/projects.html?project=${PROJECT_2}&client=`);
    await expect(page.locator('.kv')).toContainText('Waiting on them');
    await page.goto(`/crm.html?client=${CLIENT}&tab=deal`);
    const deals = page.locator('#allDeals');
    await expect(deals.locator('h2')).toHaveText('All deals · 2');
    await expect(deals.locator('.rrow').nth(1)).toContainText('Monthly care');
    await expect(deals.locator('.rrow').nth(1).getByRole('link', { name: 'Open →' })).toHaveAttribute('href', `/pipeline.html?deal=${DEAL_2}&client=`);
  });

  test('one of each: no extra list', async ({ page }) => {
    await installApp(page, { api: api(RECORD({ related_projects: lists.related_projects.slice(0, 1), related_deals: lists.related_deals.slice(0, 1) })) });
    await page.goto(`/crm.html?client=${CLIENT}&tab=delivery`);   // the record opens on Activity since the bold redesign (part B); the project lists live on the Project tab
    await expect(page.locator('.kv').first()).toContainText('Waiting on them');
    await expect(page.locator('#allProjects')).toHaveCount(0);
    await page.goto(`/crm.html?client=${CLIENT}&tab=deal`);
    await expect(page.getByRole('link', { name: 'Open in pipeline →' })).toBeVisible();
    await expect(page.locator('#allDeals')).toHaveCount(0);
  });
});

test.describe('item 27 — one tip per visit, retired when the page is left', () => {
  test('the bell tip shows once; leaving without Got it retires it', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    await expect(page.locator('.dds-hint[data-hint="today-bell"]')).toBeVisible();
    // a second tip on the same visit is refused, even after Got it
    await page.locator('.dds-hint[data-hint="today-bell"]').getByRole('button', { name: 'Got it' }).click();
    expect(await page.evaluate(() => (window as unknown as { ddsHint: (k: string, h: string) => boolean }).ddsHint('another-tip', 'Another tip'))).toBe(false);
    // now a tip that is shown but never dismissed: wipe the seen-list on another page
    await page.goto('/pipeline.html');
    await page.evaluate(() => { localStorage.removeItem('dds-hints'); });
    await page.goto('/today.html');
    await expect(page.locator('.dds-hint[data-hint="today-bell"]')).toBeVisible();   // seen-list was wiped: it shows this visit…
    await page.goto('/pipeline.html');                                               // …and leaving retires it, no Got it pressed
    await page.goto('/today.html');
    await expect(page.locator('#greeting')).toBeVisible();
    await expect(page.locator('.dds-hint[data-hint="today-bell"]')).toHaveCount(0);
  });
});

test.describe('item 28 — an enquiry\'s status and a private note', () => {
  test('every enquiry row says where it stands; the note saves alone, without touching the status', async ({ page }) => {
    await installApp(page, { api: { '/forms/inbox': { data: { submissions: [
      { id: 'l1', form_kind: 'quote', name: 'Sam Rivera', email: 'sam@example.com', phone: '', message: 'Can I get a quote for a patio?', source_page: '/contact/', status: 'replied', created_at: '2026-07-07T00:00:00Z', replies: [], note: null },
      { id: 'l2', form_kind: 'contact', name: 'Dana Lee', email: 'dana@example.com', phone: '', message: 'Loved the work!', source_page: '/contact/', status: 'read', created_at: '2026-07-02T00:00:00Z', replies: [], note: { body: 'Old customer, send the spring offer', at: '2026-07-03T00:00:00Z' } },
    ], unread: 0 } } } });
    await page.goto('/inbox.html#enquiries');
    const rows = page.locator('#rows');
    await expect(rows.getByRole('option').filter({ hasText: 'Sam Rivera' }).locator('.rchip')).toHaveText('Quote request · Replied');
    await expect(rows.getByRole('option').filter({ hasText: 'Dana Lee' }).locator('.rchip')).toHaveText('Message · Read');
    // an earlier note is there when the enquiry opens
    await rows.getByRole('option').filter({ hasText: 'Dana Lee' }).click();
    await expect(page.getByLabel(/Your note/)).toHaveValue('Old customer, send the spring offer');
    if (await page.locator('#paneBack').isVisible()) await page.locator('#paneBack').click();   // phones: the open pane hides the list
    await rows.getByRole('option').filter({ hasText: 'Sam Rivera' }).click();
    const note = page.getByLabel(/Your note/);
    await expect(note).toHaveValue('');
    await note.fill('Called back, wants a quote in March');
    const post = page.waitForRequest((r) => r.method() === 'POST' && /\/forms\/inbox\/l1$/.test(new URL(r.url()).pathname));
    await page.getByRole('button', { name: 'Save note' }).click();
    expect((await post).postDataJSON()).toEqual({ note: 'Called back, wants a quote in March' });   // no status rides along
    await expect(page.locator('#leadNoteAt')).toHaveText('Saved just now');
  });
});
