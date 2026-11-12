import { test, expect, type Page } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV, CLIENT_NAV } from './helpers/app';

// Sales item 91: Create also makes a project and a site, and stays inside a client (for that
// client); a brand-new studio's Home says where to start; Home's title sits at the top.
// Sales item 123: "3 due today" in the frame, on every page, opening the day's to-dos.
const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const DEAL = '11111111-1111-4111-8111-111111111111';
const CUST = 'cccccccc-3333-4333-8333-cccccccccccc';
const isPhone = (page: Page) => (page.viewportSize()?.width || 0) <= 760;
const ymd = (n: number) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const TODOS_NAV = [...STUDIO_LEVEL_NAV.slice(0, 2), { key: 'todos', label: 'To-dos', items: [{ key: 'todos', label: 'To-dos', href: '/todos.html' }] }, ...STUDIO_LEVEL_NAV.slice(2)];
const ctx = (extra: Record<string, unknown> = {}) => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'delete', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: TODOS_NAV, scope: null, ...extra,
} });
const task = (id: string, title: string, due: string | null, context: string, kind = 'deal_task') => ({ kind, id, parent_id: DEAL, title, due, context, href: `/pipeline.html?deal=${DEAL}`, blocked: false, later: false, order: null });
const TASKS = { data: { partial: false, total: 5, items: [
  task('t1', 'Send the revised quote', ymd(-2), 'Jordan Lee'),
  task('t2', 'Call back about the photos', ymd(-1), 'Maple & Rye Bakery'),
  task('t3', 'Follow up with Priya', ymd(0), 'Priya Shah'),
  task('t4', 'Book the photo shoot', ymd(3), 'Northside Dental'),
  task('t5', 'Look into a booking add-on', null, 'Your own to-do'),
] } };
const HOME = {
  '/agency/needs-you': { data: { rows: [], more: 0, rest: [], total: 0, empty_line: '', partial: false, own_site: true, next_by_site: {}, next_by_client: {} } },
  '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', plan: 'agency', branding: {}, email: 'owner@example.com', member_id: 'm1' } },
  '/agency/portfolio': { data: [] }, '/agency/kits': { data: [] }, '/studio/customers': { data: [] },
  '/sales/summary': { data: { total: 0, open: { count: 0, value_cents: 0 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: { outstanding_cents: 0, count: 0, overdue_count: 0 } } },
  '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/sales/deals': { data: [] }, '/sales/contacts': { data: [] }, '/sales/stages': { data: { labels: {} } },
};
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

test.describe('Due today, from any page (sales 123)', () => {
  test('the chip counts late and today in your own day, opens the list, and a tick marks one done', async ({ page }) => {
    const sent: Array<{ url: string; body: unknown }> = [];
    await installApp(page, { api: { ...HOME, '/portal/context': ctx(), '/sales/my-tasks': TASKS } });
    await page.route(/\/presence\/sales\/deal-tasks\//, (route) => { sent.push({ url: route.request().url(), body: route.request().postDataJSON() }); return route.fulfill(json({ data: { ok: true } })); });
    await page.goto('/pipeline.html');
    const chip = page.locator('#dds-due');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('aria-label', 'To-dos: 2 late, 1 today');
    await expect(chip).toHaveClass(/late/);
    if (!isPhone(page) ) await expect(chip.locator('.dw')).toHaveText('2 late · 1 today');
    else await expect(chip.locator('.dn')).toHaveText('3');
    await chip.click();
    const pop = page.getByRole('dialog', { name: 'Due today' });
    await expect(pop).toBeVisible();
    await expect(pop.getByRole('listitem')).toHaveCount(3);   // not the one due later, nor the undated one
    await expect(pop.getByRole('listitem').nth(0)).toContainText('Send the revised quote');
    await expect(pop.getByRole('listitem').nth(0)).toContainText('2 days late');
    await expect(pop.getByRole('listitem').nth(1)).toContainText('Yesterday');
    await expect(pop.getByRole('listitem').nth(2)).toContainText('Today');
    await expect(pop.getByRole('link', { name: 'Open To-dos →' })).toHaveAttribute('href', '/todos.html');
    if (isPhone(page)) { const b = await pop.boundingBox(), vp = page.viewportSize(); expect(b && vp && Math.abs(b.y + b.height - vp.height) < 2 && b.width <= vp.width).toBeTruthy(); }
    await pop.getByRole('button', { name: 'Mark done: Send the revised quote' }).click();
    await expect(pop.getByRole('listitem')).toHaveCount(2);
    await expect(chip).toHaveAttribute('aria-label', 'To-dos: 1 late, 1 today');
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].url).toContain('/sales/deal-tasks/t1');
    expect(sent[0].body).toEqual({ status: 'done' });
    await expect(page.locator('.dds-toast', { hasText: 'Done — Send the revised quote' }).getByRole('button', { name: 'Undo' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();
  });

  test('only today: amber words; nothing due: no chip; a failed read shows nothing false', async ({ page }) => {
    await installApp(page, { api: { ...HOME, '/portal/context': ctx(), '/sales/my-tasks': { data: { partial: false, total: 1, items: [task('t3', 'Follow up with Priya', ymd(0), 'Priya Shah')] } } } });
    await page.goto('/pipeline.html');
    await expect(page.locator('#dds-due')).toHaveAttribute('aria-label', 'To-dos: 1 due today');
    await expect(page.locator('#dds-due')).not.toHaveClass(/late/);
    await installApp(page, { api: { ...HOME, '/portal/context': ctx(), '/sales/my-tasks': { data: { partial: false, total: 1, items: [task('t4', 'Book the photo shoot', ymd(3), 'Northside Dental')] } } } });
    await page.evaluate(() => sessionStorage.clear());
    await page.goto('/pipeline.html');
    await expect(page.locator('#dds-shell .dds-nav')).toBeAttached();
    await expect(page.locator('#dds-due')).toBeHidden();
    await installApp(page, { api: { ...HOME, '/portal/context': ctx() } });
    await page.route(/\/presence\/sales\/my-tasks/, (route) => route.fulfill(json({ error: 'x' }, 502)));
    await page.evaluate(() => sessionStorage.clear());
    await page.goto('/pipeline.html');
    await expect(page.locator('#dds-shell .dds-nav')).toBeAttached();
    await expect(page.locator('#dds-due')).toBeHidden();
  });

  test('a business with no To-dos page gets no chip; inside a client it is still the studio’s day, asked without the client', async ({ page }) => {
    let asked = 0;
    await installApp(page);   // a business owner whose menu has no To-dos
    await page.route(/\/presence\/sales\/my-tasks/, (route) => { asked++; return route.fulfill(json(TASKS)); });
    await page.goto('/today.html');
    await expect(page.locator('#dds-shell .dds-nav')).toBeAttached();
    await expect(page.locator('#dds-due')).toBeHidden();
    expect(asked).toBe(0);
    const scopes: string[] = [];
    await installApp(page, { api: { ...HOME, '/portal/context': ctx({ nav: CLIENT_NAV, scope: { site_id: CLIENT, name: 'Joe’s Plumbing' } }) } });
    await page.route(/\/presence\/sales\/my-tasks/, (route) => { scopes.push(route.request().headers()['x-dds-scope-site'] || ''); return route.fulfill(json(TASKS)); });
    await page.goto(`/files.html?client=${CLIENT}`);
    await expect(page.locator('#dds-due')).toHaveAttribute('aria-label', 'To-dos: 2 late, 1 today');
    expect(scopes.every((s) => s === '')).toBeTruthy();
    await page.locator('#dds-due').click();
    await expect(page.getByRole('dialog', { name: 'Due today' }).getByRole('link', { name: 'Open To-dos →' })).toHaveAttribute('href', '/todos.html');   // never re-scoped onto the client
  });
});

test.describe('Create (sales 91)', () => {
  test('New project from Create: name, customer, a start, and it posts to the studio’s projects', async ({ page }) => {
    const posted: unknown[] = [];
    await installApp(page, { api: { ...HOME, '/portal/context': ctx(), '/sales/my-tasks': { data: { items: [] } }, '/studio/customers': { data: [{ client_id: CUST, name: 'Maple & Rye Bakery' }] }, '/projects/templates': { data: { saved: [] } } } });
    await page.route(/\/presence\/projects$/, (route) => { posted.push(route.request().postDataJSON()); return route.fulfill(json({ data: { id: 'p-new' }, templated: true }, 201)); });
    await page.goto('/pipeline.html');
    await page.locator(isPhone(page) ? '#dds-mbar-create' : '#dds-create').click();
    const dlg = page.locator('dialog#dds-cr');
    await dlg.locator('.cr-item', { hasText: 'New project' }).click();
    await expect(dlg.locator('#dds-cr-title')).toHaveText('New project');
    await dlg.getByRole('button', { name: 'Create project' }).click();
    await expect(dlg.locator('.cr-err')).toHaveText('A project needs a name.');
    await dlg.locator('#cr-pjname').fill('Maple & Rye — website rebuild');
    await dlg.locator('#cr-cust').selectOption({ label: 'Maple & Rye Bakery' });
    await dlg.getByRole('button', { name: 'Create project' }).click();
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]).toEqual({ name: 'Maple & Rye — website rebuild', customer_client_id: CUST, template: 'website' });
    await expect(page.locator('.dds-toast', { hasText: 'Project created — Maple & Rye — website rebuild' })).toBeVisible();
  });

  test('New site in the menu opens the New site box on Sites', async ({ page }) => {
    await installApp(page, { api: { ...HOME, '/portal/context': ctx(), '/sales/my-tasks': { data: { items: [] } } } });
    await page.goto('/pipeline.html');
    await page.locator(isPhone(page) ? '#dds-mbar-create' : '#dds-create').click();
    await page.locator('dialog#dds-cr .cr-item', { hasText: 'New site' }).click();
    await expect(page).toHaveURL(/\/sites\.html/);   // Sites opens its New site box on #new, then drops the hash
  });

  test('inside a client: Create is for them, the form starts on their deal, and the write goes to the studio’s book', async ({ page }) => {
    const calls: Array<{ path: string; scope: string; body: unknown }> = [];
    await installApp(page, { api: { ...HOME,
      '/portal/context': ctx({ nav: CLIENT_NAV, scope: { site_id: CLIENT, name: 'Joe’s Plumbing' } }),
      '/sales/my-tasks': { data: { items: [] } },
      '/crm/record': { data: { identity: { contact_id: 'c1', deal_id: DEAL, client_id: CUST, customer_site_id: CLIENT, project_id: null } } },
      '/sales/deals': { data: [{ id: DEAL, title: 'Joe’s Plumbing — site', stage: 'proposal', contact_id: 'c1', expected_value_cents: 250000, updated_at: '2026-11-01T10:00:00Z' }] },
      '/sales/contacts': { data: [{ id: 'c1', name: 'Joe Park', company: 'Joe’s Plumbing', email: 'joe@example.com' }] },
    } });
    await page.route(new RegExp(`/presence/sales/deals/${DEAL}/tasks$`), (route) => { calls.push({ path: 'tasks', scope: route.request().headers()['x-dds-scope-site'] || '', body: route.request().postDataJSON() }); return route.fulfill(json({ data: { id: 'task1' } }, 201)); });
    await page.goto(`/files.html?client=${CLIENT}`);
    await page.locator(isPhone(page) ? '#dds-mbar-create' : '#dds-create').click();
    const dlg = page.locator('dialog#dds-cr');
    await expect(dlg.locator('#dds-cr-title')).toHaveText('Create for Joe’s Plumbing');
    await expect(dlg.locator('.cr-item b')).toHaveText(['Log a call', 'Send an invoice', 'Send a proposal', 'Add a to-do', 'New project', 'New deal']);
    await dlg.locator('.cr-item', { hasText: 'Add a to-do' }).click();
    await expect(dlg.locator('#cr-picked')).toContainText('Joe Park');   // already picked: their deal
    await dlg.locator('#cr-what').fill('Send the logo files');
    await dlg.getByRole('button', { name: 'Add to-do' }).click();
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0].scope).toBe('');   // the studio's own book, not the client's site
    expect((calls[0].body as { title: string }).title).toBe('Send the logo files');
    const open = page.locator('.dds-toast', { hasText: 'To-do added' }).getByRole('button', { name: 'Open' });
    await expect(open).toBeVisible();
    await open.click();
    await expect(page).toHaveURL(new RegExp(`/crm\\.html\\?client=${CLIENT}&deal=${DEAL}&tab=deal`));   // still inside the client
  });
});

test.describe('Home (sales 91)', () => {
  test('the title is at the top, and the table under it is Customers', async ({ page }, testInfo) => {
    await installApp(page, { api: { ...HOME, '/portal/context': ctx(), '/sales/my-tasks': { data: { items: [] } },
      '/agency/portfolio': { data: [{ site_id: CLIENT, client_id: CUST, name: 'Joe’s Plumbing', status: 'live', live: true }] } } });
    await page.goto('/agency.html');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1#pagehead')).toHaveText('Home');
    if (testInfo.project.name !== 'mobile') {
      const title = await page.locator('h1#pagehead').boundingBox(), hero = await page.locator('.top.hero').boundingBox();
      expect(title && hero && title.y < hero.y).toBeTruthy();
    }
    await expect(page.locator('.lhead h2')).toHaveText('Customers');
    await expect(page.locator('.lhead .allc')).toHaveAttribute('href', '/customers.html');
    await expect(page.locator('.lhead .lmeta')).toContainText('1 customer ·');
    await expect(page.getByLabel('Search customers')).toBeVisible();
    await expect(page.locator('#heroChips')).toContainText('All caught up');   // a studio with customers and nothing waiting
  });

  test('a brand-new studio is told where to start, never "All caught up"', async ({ page }) => {
    await installApp(page, { api: { ...HOME, '/portal/context': ctx(), '/sales/my-tasks': { data: { items: [] } } } });
    await page.goto('/agency.html');
    await expect(page.locator('.hero .hi')).toHaveText('Welcome to Studio OS');
    await expect(page.locator('#heroSub')).toHaveText('Nothing needs you yet. Here’s where to start.');
    await expect(page.locator('#heroChips')).not.toContainText('All caught up');
    await expect(page.locator('#needsEmpty .nn')).toHaveText('Nothing needs you yet. Your first customer is the place to start.');
    await expect(page.locator('#needsEmpty').getByRole('link', { name: '+ New site' })).toHaveAttribute('href', '/sites.html#new');
    // with no setup strip on the page, Start here opens Add a customer
    await page.locator('#startHere').click();
    await expect(page.locator('#custDlg')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('#firstCust').click();
    await expect(page.locator('#custDlg')).toBeVisible();
  });
});
