import { test, expect } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// Sales review, Nov 2026 — batch five:
//   item 29  "My tasks" on Home: next steps, deal to-dos and the studio's own
//            project tasks, each with its due date and a Done.
//   item 30  the Board keeps a collapsed Won column and a Not-a-fit drop zone.
//   item 34  a support request's priority and who has it, on the row and in the pane.
//   item 36  an empty Pipeline walks the four steps to a first customer.

const day = (n: number) => { const d = new Date(Date.now() + n * 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const DEAL = '11111111-1111-4111-8111-111111111111';
const DT = '22222222-2222-4222-8222-222222222222';
const PROJ = '33333333-3333-4333-8333-333333333333';
const PT = '44444444-4444-4444-8444-444444444444';

const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };
const HOME = {
  '/portal/context': STUDIO_CTX,
  '/agency/needs-you': { data: { rows: [], more: 0, rest: [], total: 0, empty_line: 'All quiet.', partial: false, own_site: true, next_by_site: {}, next_by_client: {} } },
  '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', plan: 'agency', branding: {}, email: 'owner@example.com', member_id: 'm1' } },
  '/agency/portfolio': { data: [] },
  '/agency/kits': { data: [] },
  '/studio/customers': { data: [] },
  '/sales/summary': { data: { total: 2, open: { count: 1, value_cents: 90000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: { outstanding_cents: 0, count: 0, overdue_count: 0 } } },
  '/sales/deals': { data: [{ id: DEAL, title: 'Harbor Lane Bakery', stage: 'proposal', expected_value_cents: 90000, next_step: 'Follow up call', next_step_at: day(-2), updated_at: new Date().toISOString() }] },
  '/sales/receivables': { data: { items: [], total_cents: 0 } },
};
const TASKS = (n = 0) => ({ data: { partial: false, total: 4 + n, items: [
  { kind: 'next_step', id: DEAL, parent_id: DEAL, title: 'Follow up call', due: day(-2), context: 'Harbor Lane Bakery', href: `/pipeline.html?deal=${DEAL}`, blocked: false },
  { kind: 'deal_task', id: DT, parent_id: DEAL, title: 'Price the add-ons', due: day(0), context: 'Harbor Lane Bakery', href: `/pipeline.html?deal=${DEAL}`, blocked: false },
  { kind: 'project_task', id: PT, parent_id: PROJ, title: 'Build the pages', due: day(3), context: 'Website rebuild', href: `/projects.html?project=${PROJ}`, blocked: false },
  { kind: 'project_task', id: 'pt-blocked', parent_id: PROJ, title: 'Waiting on hosting', due: null, context: 'Website rebuild', href: `/projects.html?project=${PROJ}`, blocked: true },
  ...Array.from({ length: n }, (_, i) => ({ kind: 'project_task', id: `extra-${i}`, parent_id: PROJ, title: `Extra task ${i + 1}`, due: null, context: 'Website rebuild', href: `/projects.html?project=${PROJ}`, blocked: false })),
] } });

test.describe('item 29 — My tasks on Home', () => {
  test('every kind of task with its date; Done uses the route that owns it and the row leaves', async ({ page }) => {
    const writes: Array<[string, string, unknown]> = [];
    page.on('request', (r) => { if (r.method() === 'PATCH') writes.push([r.method(), new URL(r.url()).pathname.replace(/^.*\/presence/, ''), r.postDataJSON()]); });
    await installApp(page, { api: { ...HOME, '/sales/my-tasks': TASKS() } });
    await page.goto('/agency.html');
    const card = page.locator('#my-tasks');
    await expect(card.locator('.rh')).toHaveText('My tasks · 4');
    await expect(card.locator('.trow')).toHaveCount(4);
    await expect(card.locator('.trow').first()).toContainText('Follow up call');
    await expect(card.locator('.trow').first()).toContainText('Harbor Lane Bakery');
    await expect(card.locator('.trow').first().locator('.late')).toHaveCount(1);              // two days late reads late
    await expect(card.locator('.trow').nth(3)).toContainText('Blocked');
    await expect(card.locator('.trow').nth(3).getByRole('button', { name: /^Done/ })).toHaveCount(0);
    await expect(page.locator('#this-week')).toHaveCount(0);                                   // My tasks replaces This week
    await card.getByRole('button', { name: 'Done: Price the add-ons' }).click();
    await expect(card.locator('.rh')).toHaveText('My tasks · 3');
    await expect(card).not.toContainText('Price the add-ons');
    await card.getByRole('button', { name: 'Done: Build the pages' }).click();
    await expect(card).not.toContainText('Build the pages');
    await card.getByRole('button', { name: 'Done: Follow up call' }).click();
    await expect(card.locator('.rh')).toHaveText('My tasks · 1');
    expect(writes).toEqual([
      ['PATCH', `/sales/deal-tasks/${DT}`, { status: 'done' }],
      ['PATCH', `/projects/${PROJ}/tasks/${PT}`, { status: 'done' }],
      ['PATCH', `/sales/deals/${DEAL}`, { next_step: '', next_step_at: '' }],
    ]);
  });

  test('a failed Done keeps the row and says so', async ({ page }) => {
    await installApp(page, { api: { ...HOME, '/sales/my-tasks': TASKS() } });
    await page.route(`**/functions/v1/presence/sales/deal-tasks/${DT}`, (route) => route.fulfill({ status: 502, contentType: 'application/json', body: '{}' }));
    await page.goto('/agency.html');
    const card = page.locator('#my-tasks');
    await card.getByRole('button', { name: 'Done: Price the add-ons' }).click();
    await expect(card.getByRole('button', { name: 'Done: Price the add-ons' })).toBeEnabled();
    await expect(card.locator('.rh')).toHaveText('My tasks · 4');
  });

  test('more than six: the rest open with Show all', async ({ page }) => {
    await installApp(page, { api: { ...HOME, '/sales/my-tasks': TASKS(4) } });
    await page.goto('/agency.html');
    const card = page.locator('#my-tasks');
    await expect(card.locator('.trow')).toHaveCount(6);
    await card.getByRole('button', { name: 'Show all 8' }).click();
    await expect(card.locator('.trow')).toHaveCount(8);
  });

  test('an older server without the route keeps This week', async ({ page }) => {
    await installApp(page, { api: HOME });
    await page.route('**/functions/v1/presence/sales/my-tasks', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' }));
    await page.goto('/agency.html');
    await expect(page.locator('#this-week')).toContainText('Follow up call');
    await expect(page.locator('#my-tasks')).toHaveCount(0);
  });
});

// ── the Pipeline ──
const OPEN = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const WON = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const LOST = 'cccccccc-3333-4333-8333-cccccccccccc';
const PIPE = (deals: unknown[], wonMonth = { count: 1, value_cents: 240000 }) => ({
  '/sales/deals': { data: deals },
  '/sales/summary': { data: { total: deals.length, open: { count: 1, value_cents: 50000 }, won_month: wonMonth, win_rate: { pct: 50, won: 1, lost: 1 }, by_stage: [], ar: {} } },
  '/sales/contacts': { data: [] }, '/sales/templates': { data: [] }, '/sales/services': { data: [] }, '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/identity': { data: { business_name: 'Test Studio' } },
});
const now = new Date().toISOString();
const DEALS = [
  { id: OPEN, title: 'Acme website', stage: 'proposal', expected_value_cents: 50000, contact_id: null, converted_client_id: null, updated_at: now },
  { id: WON, title: 'Maple Street Studio', stage: 'won', expected_value_cents: 240000, contact_id: null, converted_client_id: 'cl-1', updated_at: now },
  { id: LOST, title: 'Gone cold', stage: 'lost', expected_value_cents: 10000, contact_id: null, converted_client_id: null, updated_at: now },
];
const pinBoard = (page: import('@playwright/test').Page) =>
  page.addInitScript(() => { try { localStorage.setItem('dds-display:pipeline', 'board'); } catch { /* denied */ } });

test.describe('item 30 — the Board keeps Won and Not a fit in view', () => {
  test('Won shows this month\'s count and value and opens the won deals; Not a fit is a drop zone', async ({ page }) => {
    await pinBoard(page);
    await installApp(page, { api: PIPE(DEALS) });
    await page.goto('/pipeline.html');
    const won = page.locator('#wonCol');
    await expect(won.locator('#wonN')).toHaveText('1');
    await expect(won.locator('#wonV')).toHaveText('$2,400');
    const lost = page.locator('#lostCol');
    await expect(lost.locator('.col-n')).toHaveText('1');
    await expect(lost.locator('[data-drop="lost"]')).toHaveCount(1);
    await expect(page.locator('[data-drop="won"]')).toHaveCount(0);
    await won.getByRole('button', { name: 'See won deals →' }).click();
    await expect(page.locator('#filters .chip[data-stage="won"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#viewList')).toHaveAttribute('aria-pressed', 'true');
  });

  test('dragging a deal onto Not a fit closes it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'HTML drag and drop at one width');
    let moved: unknown = null;
    await pinBoard(page);
    await installApp(page, { api: PIPE(DEALS) });
    await page.route(`**/functions/v1/presence/sales/deals/${OPEN}/stage`, (route) => { moved = route.request().postDataJSON(); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{"ok":true}}' }); });
    await page.goto('/pipeline.html');
    // all six columns fit a laptop-width window: the drop zone is on screen, not behind a sideways scroll
    const box = await page.locator('#lostCol').boundingBox();
    expect(box && box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    // the board's own drag handlers, driven with real drag events
    await page.evaluate((id) => {
      const card = document.querySelector(`#board .bcard[data-id="${id}"]`)!;
      const zone = document.querySelector('#lostCol [data-drop="lost"]')!;
      const dt = new DataTransfer();
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, OPEN);
    await expect.poll(() => moved).toEqual({ to: 'lost' });
  });
});

test.describe('item 36 — an empty Pipeline walks the first deal', () => {
  test('List: four steps, and step one opens the New deal form', async ({ page }) => {
    await installApp(page, { api: PIPE([], { count: 0, value_cents: 0 }) });
    await page.goto('/pipeline.html');
    const guide = page.locator('#firstDeal');
    await expect(guide.getByRole('heading', { name: 'Your first deal, in four steps' })).toBeVisible();
    await expect(guide.locator('li')).toHaveCount(4);
    await guide.getByRole('button', { name: 'Add your first deal' }).click();
    await expect(page.locator('#formDlg')).toBeVisible();
  });

  test('Board: the same walkthrough, not empty columns', async ({ page }) => {
    await pinBoard(page);
    await installApp(page, { api: PIPE([], { count: 0, value_cents: 0 }) });
    await page.goto('/pipeline.html');
    await expect(page.locator('#board #firstDeal')).toBeVisible();
    await expect(page.locator('#board .col')).toHaveCount(0);
  });
});

// ── the Inbox ──
const ME_UID = 'dddddddd-4444-4444-8444-dddddddddddd';
const DANA_UID = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
const SUP = 'ffffffff-6666-4666-8666-ffffffffffff';
const inboxApi = (members: unknown[], assigned: string | null) => ({
  '/portal/context': STUDIO_CTX,
  '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null, enquiries: [], client_messages: [
    { type: 'support', id: SUP, subject: 'Site is down', status: 'open', priority: 'urgent', assigned_to: assigned, project: '', client_id: 'c-1', client: 'Maple Street Studio', created_at: now, thread_key: `support:${SUP}`, unread: true, href: '/projects.html' },
  ] } },
  '/forms/inbox': { data: { submissions: [], unread: 0 } },
  '/notifications': { data: [], unread_count: 0 },
  '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', email: 'owner@example.com', member_id: 'm1' } },
  '/agency/members': { data: members },
  [`/support/${SUP}`]: { data: { request: { id: SUP, subject: 'Site is down', status: 'open', priority: 'urgent', assigned_to: assigned, body: 'Nothing loads', created_at: now }, messages: [], is_studio_view: true } },
});
const TEAM = [
  { id: 'm1', email: 'owner@example.com', role: 'owner', status: 'active', user_id: ME_UID },
  { id: 'm2', email: 'dana@example.com', role: 'designer', status: 'active', user_id: DANA_UID },
];

test.describe('item 34 — a support request\'s priority and who has it', () => {
  test('the row says Urgent and who has it; the pane sets both through the triage route', async ({ page }) => {
    const patches: unknown[] = [];
    page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes(`/support/${SUP}`)) patches.push(r.postDataJSON()); });
    await installApp(page, { api: inboxApi(TEAM, DANA_UID) });
    await page.goto('/inbox.html#support');
    const row = page.locator('#rows').getByRole('option').filter({ hasText: 'Maple Street Studio' });
    await expect(row.locator('.prio')).toHaveText('Urgent');
    await expect(row.locator('.asg')).toHaveText('dana');
    await row.click();
    const prio = page.getByLabel('Priority');
    await expect(prio).toHaveValue('urgent');
    const asg = page.getByLabel('Assigned to');
    await expect(asg).toHaveValue(DANA_UID);
    await prio.selectOption('high');
    await expect.poll(() => patches.length).toBe(1);
    await asg.selectOption(ME_UID);
    await expect.poll(() => patches.length).toBe(2);
    expect(patches).toEqual([{ priority: 'high' }, { assigned_to: ME_UID }]);
    if (await page.locator('#paneBack').isVisible()) await page.locator('#paneBack').click();   // phones: the open pane hides the list
    await expect(row.locator('.prio')).toHaveText('High');
    await expect(row.locator('.asg')).toHaveText('Yours');
  });

  test('a one-person studio sets priority but gets no assignee picker; a normal request shows no badge', async ({ page }) => {
    const api = inboxApi(TEAM.slice(0, 1), null);
    (api['/portal/feed'].data.client_messages[0] as { priority: string }).priority = 'normal';
    await installApp(page, { api });
    await page.goto('/inbox.html#support');
    const row = page.locator('#rows').getByRole('option').filter({ hasText: 'Maple Street Studio' });
    await expect(row.locator('.prio')).toHaveCount(0);
    await row.click();
    await expect(page.getByLabel('Priority')).toBeVisible();
    await expect(page.locator('#supTriage')).not.toContainText('Assigned to');
  });
});
