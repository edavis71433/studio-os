import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// Final pass on the sales side, batch C (Nov 8 2026): accessibility, wording and the phone.
//   colours     the dark theme's filled buttons and the Urgent badge read clearly
//   picking     the whole cell picks a row, and the count is announced
//   confirms    bulk Not a fit, bulk Mark as… and Remove view ask in place first
//   focus       Save view, Remove view, Done and the import panel give focus back
//   phone       Pipeline folds Manage services, Import and Columns under More; its
//               tiles never cut a number off; the small controls are 44px
//   words       Home is headed Home; one money format; Domain & email for an operator

const isPhone = (page: Page) => (page.viewportSize()?.width || 1200) < 768;
const pinTable = (page: Page, key: string) => page.addInitScript((k) => { try { localStorage.setItem(k, 'table'); } catch { /* denied */ } }, key);
const CUSTOMERS = { data: [
  { client_id: 'c-acme', name: 'Acme Bakery', email: 'a@acme.example', project_id: 'p1', status: 'active', customer_site_id: 'site-acme', open_support: 2, project_count: 1 },
  { client_id: 'c-beta', name: 'Beta Salon', email: 'b@beta.example', project_id: 'p2', status: 'active', customer_site_id: 'site-beta', open_support: 0, project_count: 3 },
] };
const VIEWS = { data: { customers: [{ id: 'view-0001', name: 'Waiting on us', base: 'attention', q: '', cols: ['name', 'open_support'], sort: { key: 'name', dir: -1 } }], contacts: [], pipeline: [] } };
const echoViews = async (page: Page, sink: unknown[]) => {
  await page.route('**/functions/v1/presence/sales/views', (route) => {
    if (route.request().method() !== 'PUT') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VIEWS) });
    const b = route.request().postDataJSON(); sink.push(b);
    const data = { ...VIEWS.data, [b.list]: b.views.map((v: Record<string, unknown>, i: number) => ({ id: v.id || `view-new${i}`, ...v })) };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
  });
};
const OPEN = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const now = new Date().toISOString();
const PIPE = {
  '/sales/deals': { data: [
    { id: OPEN, title: 'Acme website', stage: 'proposal', expected_value_cents: 123450, contact_id: 'ct-1', converted_client_id: null, next_step: 'Send the quote', next_step_at: '2030-08-06', updated_at: now },
  ] },
  '/sales/summary': { data: { total: 3, open: { count: 3, value_cents: 1245050 }, won_month: { count: 2, value_cents: 1245050 }, win_rate: { pct: 50, won: 1, lost: 1, window_days: 3650 }, by_stage: [], ar: { outstanding_cents: 1245050, count: 2, overdue_count: 0 } } },
  '/sales/contacts': { data: [{ id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com' }] },
  '/sales/templates': { data: [] }, '/sales/services': { data: [] }, '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/identity': { data: { business_name: 'Test Studio' } },
};
const day = (n: number) => { const d = new Date(Date.now() + n * 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const ctx = (over: Record<string, unknown> = {}) => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null, ...over,
} });
const HOME = {
  '/portal/context': ctx(),
  '/agency/needs-you': { data: { rows: [], more: 0, rest: [], total: 0, empty_line: 'All quiet.', partial: false, own_site: true, next_by_site: {}, next_by_client: {} } },
  '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', plan: 'agency', branding: {}, email: 'owner@example.com', member_id: 'm1' } },
  '/agency/portfolio': { data: [] }, '/agency/kits': { data: [] }, '/studio/customers': { data: [] },
  '/sales/summary': { data: { total: 0, open: { count: 0, value_cents: 0 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: { outstanding_cents: 0, count: 0, overdue_count: 0 } } },
  '/sales/deals': { data: [] }, '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/sales/my-tasks': { data: { partial: false, total: 2, items: [
    { kind: 'deal_task', id: '22222222-2222-4222-8222-222222222222', parent_id: '11111111-1111-4111-8111-111111111111', title: 'Price the add-ons', due: day(0), context: 'Harbor Lane Bakery', href: '/pipeline.html', blocked: false },
    { kind: 'deal_task', id: '33333333-3333-4333-8333-333333333333', parent_id: '11111111-1111-4111-8111-111111111111', title: 'Send the photos', due: day(1), context: 'Harbor Lane Bakery', href: '/pipeline.html', blocked: false },
  ] } },
};

test.describe('batch C — colours', () => {
  test('dark theme: the bulk bar, the Save view button and a filled button read clearly', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await pinTable(page, 'dds-display:customers');
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    await page.goto('/customers.html');
    await page.getByLabel('Select Acme Bakery').check();
    await expect(page.getByRole('region', { name: 'Selected customers' })).toBeVisible();
    expect((await new AxeBuilder({ page }).include('.dds-bulk').withRules(['color-contrast']).analyze()).violations).toEqual([]);
    await page.locator('#saveView').click();
    await expect(page.getByRole('dialog', { name: 'Save this view' })).toBeVisible();
    expect((await new AxeBuilder({ page }).include('.dds-ask').withRules(['color-contrast']).analyze()).violations).toEqual([]);
    await page.getByRole('dialog', { name: 'Save this view' }).getByRole('button', { name: 'Cancel' }).click();
    const color = await page.evaluate(() => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'x'; document.getElementById('main')!.appendChild(b); const c = getComputedStyle(b).color; b.remove(); return c; });
    expect(color).toBe('rgb(23, 19, 32)');
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`the Inbox's Urgent badge reads clearly (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await installApp(page);
      await page.goto('/inbox.html');
      await page.evaluate(() => { const s = document.createElement('span'); s.className = 'prio urgent'; s.id = 'probe'; s.textContent = 'Urgent'; document.body.appendChild(s); });
      expect((await new AxeBuilder({ page }).include('#probe').withRules(['color-contrast']).analyze()).violations).toEqual([]);
    });
  }
});

test.describe('batch C — picking, confirming and focus', () => {
  test('the whole cell picks a row, and the count is announced', async ({ page }) => {
    await pinTable(page, 'dds-display:customers');
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    await page.goto('/customers.html');
    const cell = page.locator('tbody tr').first().locator('td.pick');
    const box = (await cell.boundingBox())!;
    await page.mouse.click(box.x + 3, box.y + 3);          // the cell, not the checkbox
    await expect(page.getByRole('region', { name: 'Selected customers' })).toContainText('1 selected');
    await expect(page.locator('#dds-sr-status')).toHaveText('1 selected');
    await expect(page).toHaveURL(/customers\.html/);       // picking never opens the customer
    if (isPhone(page)) expect(box.width).toBeGreaterThanOrEqual(44);
  });

  test('Pipeline: Mark as not a fit asks first, and Cancel changes nothing', async ({ page }) => {
    const moved: string[] = [];
    await pinTable(page, 'dds-display:pipeline');
    await installApp(page, { api: PIPE });
    await page.route('**/functions/v1/presence/sales/deals/*/stage', (route) => { moved.push('x'); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{}}' }); });
    await page.goto('/pipeline.html');
    await page.getByLabel('Select Acme website').check();
    const bar = page.getByRole('region', { name: 'Selected deals' });
    await bar.getByRole('button', { name: 'Mark as not a fit' }).click();
    const ask = bar.getByRole('group', { name: 'Mark 1 deal as not a fit?' });
    await expect(ask.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(bar.getByRole('button', { name: 'Mark as not a fit' })).toBeFocused();
    expect(moved).toEqual([]);
    await bar.getByRole('button', { name: 'Mark as not a fit' }).click();
    await bar.getByRole('button', { name: 'Yes, mark them' }).click();
    await expect.poll(() => moved.length).toBe(1);
  });

  test('Customers: Mark as… asks first, and Cancel puts the menu back', async ({ page }) => {
    const marks: string[] = [];
    await pinTable(page, 'dds-display:customers');
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    await page.route('**/functions/v1/presence/projects/*/status', (route) => { marks.push('x'); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{}}' }); });
    await page.goto('/customers.html');
    await page.getByLabel('Select Acme Bakery').check();
    const bar = page.getByRole('region', { name: 'Selected customers' });
    await bar.getByLabel('Mark the selected customers as').selectOption('on_hold');
    await bar.getByRole('group', { name: 'Mark 1 customer on hold?' }).getByRole('button', { name: 'Cancel' }).click();
    await expect(bar.getByLabel('Mark the selected customers as')).toHaveValue('');
    expect(marks).toEqual([]);
    await bar.getByLabel('Mark the selected customers as').selectOption('on_hold');
    await bar.getByRole('button', { name: 'Yes, mark them' }).click();
    await expect.poll(() => marks.length).toBe(1);
  });

  test('Remove view asks first; Save view gives focus back, cancelled or saved', async ({ page }) => {
    const puts: unknown[] = [];
    await pinTable(page, 'dds-display:customers');
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    await echoViews(page, puts);
    await page.goto('/customers.html');
    await page.locator('#viewBtn').click();
    await page.locator('#viewMenu [data-saved="view-0001"]').click();
    await page.locator('#dropView').click();
    await page.getByRole('group', { name: 'Remove “Waiting on us” for everyone?' }).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#dropView')).toBeFocused();
    expect(puts).toEqual([]);
    await page.locator('#saveView').click();
    await page.getByRole('dialog', { name: 'Save this view' }).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#saveView')).toBeFocused();
    await page.locator('#saveView').click();
    const dlg = page.getByRole('dialog', { name: 'Save this view' });
    await dlg.getByLabel('Name').fill('Open requests');
    await dlg.getByRole('button', { name: 'Save view' }).click();
    await expect.poll(() => puts.length).toBe(1);
    await expect(page.locator('#saveView')).toBeFocused();
  });

  test('closing the import gives focus back to Import', async ({ page }) => {
    await pinTable(page, 'dds-display:customers');
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    await page.goto('/customers.html');
    await page.locator('#importCsv').click();
    await page.locator('.dds-csvx').click();
    await expect(page.locator('#importCsv')).toBeFocused();
  });

  test('Home is headed Home, and Done on a to-do moves focus to the next one', async ({ page }) => {
    await installApp(page, { api: HOME });
    await page.goto('/agency.html');
    await expect(page.locator('#pagehead')).toHaveText('Home');
    await page.locator('#qt-tasks').click();   // item 70: My tasks is a tab of Home's list
    const card = page.locator('#my-tasks');
    await card.getByRole('button', { name: 'Done: Price the add-ons' }).click();
    await expect(card.getByRole('button', { name: 'Done: Send the photos' })).toBeFocused();
  });
});

test.describe('batch C — words and numbers', () => {
  test('one money format and one date format on a deal', async ({ page }) => {
    await pinTable(page, 'dds-display:pipeline');
    await installApp(page, { api: PIPE });
    await page.goto('/pipeline.html');
    const row = page.locator('#table tbody tr').first();
    await expect(row).toContainText('$1,234.50');
    await expect(row).not.toContainText(/\$1,234\.5(?!0)/);
    await expect(row).toContainText('Aug 6, 2030');
    await expect(row).not.toContainText('2030-08-06');
  });

  test('Settings: an operator\'s Domain & email is their own site; the platform view is its own card', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': ctx({ is_operator: true }) } });
    await page.goto('/settings.html');
    await expect(page.locator('[data-card="domains"]')).toHaveAttribute('href', /\/presence\.html#domain/);
    await expect(page.locator('[data-card="domains_all"]')).toHaveAttribute('href', '/admin-health.html');
  });

  test('Settings: an owner never sees the platform card', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': ctx() } });
    await page.goto('/settings.html');
    await expect(page.locator('[data-card="domains"]')).toBeVisible();
    await expect(page.locator('[data-card="domains_all"]')).toHaveCount(0);
  });
});

test.describe('batch C — the phone', () => {
  test.beforeEach(({ page }) => { test.skip(!isPhone(page), 'phone sizes only'); });

  test('Pipeline: Manage services, Import and Columns fold under More; no tile cuts a number off', async ({ page }) => {
    await pinTable(page, 'dds-display:pipeline');
    await installApp(page, { api: PIPE });
    await page.goto('/pipeline.html');
    await expect(page.locator('#moreBtn')).toBeVisible();
    await expect(page.locator('#importDeals')).toBeHidden();
    await expect(page.locator('#mngServicesTop')).toBeHidden();
    await page.locator('#moreBtn').click();
    const menu = page.getByRole('menu', { name: 'More' });
    await expect(menu.getByRole('menuitem')).toHaveText(['Manage services', 'Import CSV', 'Columns', 'Show charts', 'Print this list']);   // item 105 adds Charts and Print
    const r = (await menu.boundingBox())!;
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(page.viewportSize()!.width);   // on screen
    await menu.getByRole('menuitem', { name: 'Import CSV' }).click();
    await expect(page.locator('#csvZone')).toContainText('CSV');
    const cut = await page.locator('.stats .v').evaluateAll((vs) => vs.filter((v) => v.scrollWidth > v.clientWidth + 1).map((v) => v.textContent));
    expect(cut).toEqual([]);
    await expect(page.locator('.stats .v').first()).toHaveText('$12,450.50');
  });

  test('the small controls are 44px on a phone', async ({ page }) => {
    await pinTable(page, 'dds-display:customers');
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    await page.goto('/customers.html');
    await page.getByLabel('Select Acme Bakery').check();
    const bar = page.getByRole('region', { name: 'Selected customers' });
    for (const h of await bar.locator('button,select').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(44);
    expect((await page.locator('#saveView').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});
