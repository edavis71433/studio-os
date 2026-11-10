import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Sales review, Nov 2026 — batch six:
//   item 31  saved views (filter, search, columns, sort) on Customers, Contacts
//            and Pipeline; pick rows and act on them: Send an update, and Mark.
//   item 32  import customers and deals from a CSV, the contacts importer's way.
//   item 39  the people picked for an update are kept as a list to send to again.

const CUSTOMERS = { data: [
  { client_id: 'c-acme', name: 'Acme Bakery', email: 'a@acme.example', project_id: 'p1', status: 'active', customer_site_id: 'site-acme', open_support: 2, project_count: 1 },
  { client_id: 'c-beta', name: 'Beta Salon', email: 'b@beta.example', project_id: 'p2', status: 'active', customer_site_id: 'site-beta', open_support: 0, project_count: 3 },
  { client_id: 'c-zeta', name: 'Zeta Gym', email: '', project_id: 'p3', status: 'on_hold', customer_site_id: null, open_support: 1, project_count: 1 },
] };
const VIEWS = { data: { customers: [{ id: 'view-0001', name: 'Waiting on us', base: 'attention', q: '', cols: ['name', 'open_support'], sort: { key: 'name', dir: -1 } }], contacts: [], pipeline: [] } };
const pinTable = (key: string) => (page: import('@playwright/test').Page) =>
  page.addInitScript((k) => { try { localStorage.setItem(k, 'table'); } catch { /* denied */ } }, key);
const echoViews = async (page: import('@playwright/test').Page, sink: unknown[]) => {
  await page.route('**/functions/v1/presence/sales/views', (route) => {
    if (route.request().method() !== 'PUT') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VIEWS) });
    const b = route.request().postDataJSON(); sink.push(b);
    const data = { ...VIEWS.data, [b.list]: b.views.map((v: Record<string, unknown>, i: number) => ({ id: v.id || `view-new${i}`, ...v })) };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
  });
};

test.describe('item 31 — Customers: saved views, columns, pick and act', () => {
  test('a saved view sets the filter, columns and sort; Save view stores the current one', async ({ page }) => {
    const puts: any[] = [];
    await pinTable('dds-display:customers')(page);
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    await echoViews(page, puts);
    await page.goto('/customers.html');
    await page.locator('#viewBtn').click();
    await page.locator('#viewMenu [data-saved="view-0001"]').click();
    await expect(page.locator('#viewBtn')).toContainText('Waiting on us');
    await expect(page.locator('tbody tr')).toHaveCount(2);                               // the attention view: open requests only
    await expect(page.locator('tbody tr td:nth-child(2)').first()).toContainText('Zeta Gym');   // name, descending
    await expect(page.locator('thead th.pick input')).toHaveAttribute('aria-label', 'Select all 2 shown');
    await expect(page.locator('thead th:not(.pick)')).toHaveText([/Name/, /Requests/, /Actions/]);   // final pass, batch C: it counts requests
    await page.locator('#saveView').click();
    const dlg = page.getByRole('dialog', { name: 'Save this view' });
    await dlg.getByLabel('Name').fill('Open requests');
    await dlg.getByRole('button', { name: 'Save view' }).click();
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0].list).toBe('customers');
    expect(puts[0].views.map((v: any) => v.name)).toEqual(['Waiting on us', 'Open requests']);
    expect(puts[0].views[1]).toMatchObject({ base: 'attention', q: '', cols: ['name', 'open_support'], sort: { key: 'name', dir: -1 } });
    await expect(page.locator('#viewBtn')).toContainText('Open requests');
  });

  test('Columns hides a column and remembers it on this device', async ({ page }) => {
    await pinTable('dds-display:customers')(page);
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    await page.goto('/customers.html');
    await page.locator('#colsBtn').click();
    await page.getByRole('group', { name: 'Columns to show' }).getByLabel('Email').uncheck();
    await expect(page.locator('thead')).not.toContainText('Email');
    await page.reload();
    await expect(page.locator('thead th').nth(1)).toContainText('Name');
    await expect(page.locator('thead')).not.toContainText('Email');
  });

  test('pick customers: Send an update keeps them as a list and opens the composer on it; Mark sets their project', async ({ page }) => {
    let listBody: any = null; const marks: Array<[string, unknown]> = [];
    await pinTable('dds-display:customers')(page);
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    await page.route('**/functions/v1/presence/broadcasts/lists', (route) => { listBody = route.request().postDataJSON(); return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'list-0042', key: 'list:list-0042', name: 'Picked', count: 1 } }) }); });
    await page.route('**/functions/v1/presence/projects/*/status', (route) => { marks.push([new URL(route.request().url()).pathname.split('/').slice(-2)[0], route.request().postDataJSON()]); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{}}' }); });
    await page.goto('/customers.html');
    await page.getByLabel('Select Acme Bakery').check();
    await page.getByLabel('Select Zeta Gym').check();
    const bar = page.getByRole('region', { name: 'Selected customers' });
    await expect(bar).toContainText('2 selected');
    await bar.getByLabel('Mark the selected customers as').selectOption('on_hold');
    await bar.getByRole('button', { name: 'Yes, mark them' }).click();   // final pass, batch C: it asks first
    await expect.poll(() => marks.length).toBe(2);
    expect(marks).toEqual([['p1', { to: 'on_hold' }], ['p3', { to: 'on_hold' }]]);
    await expect(page.getByRole('region', { name: 'Selected customers' })).toHaveCount(0);   // done: the picks clear
    await page.getByLabel('Select Acme Bakery').check();
    await page.getByLabel('Select Zeta Gym').check();                                   // Zeta has no email: left out
    await page.getByRole('region', { name: 'Selected customers' }).getByRole('button', { name: 'Send an update' }).click();
    await expect(page).toHaveURL(/\/broadcasts\.html\?list=list-0042$/);
    expect(listBody).toEqual({ name: '', people: [{ email: 'a@acme.example', name: 'Acme Bakery' }] });
  });
});

test.describe('item 32 — import customers and deals from a CSV', () => {
  test('customers connect by email: nobody is emailed, no account is made', async ({ page }) => {
    const sent: unknown[] = [];
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    await page.route('**/functions/v1/presence/sales/customers', (route) => { const b = route.request().postDataJSON(); sent.push(b); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: b.email.startsWith('new') ? { mode: 'connect', pending: true } : { mode: 'connect', connected: true } }) }); });
    await page.goto('/customers.html');
    await page.getByRole('button', { name: 'Import CSV' }).click();
    await page.locator('#csvZone input[type=file]').setInputFiles({ name: 'customers.csv', mimeType: 'text/csv', buffer: Buffer.from('Business,Name,Email\nHarbor Lane Bakery,Ana Ruiz,ana@harbor.example\nNorthside Dental,,new@northside.example\nNo email here,Bo,\n') });
    await expect(page.locator('#csvZone')).toContainText('2 customers found');
    await page.locator('#csvZone').getByRole('button', { name: 'Import 2' }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent).toEqual([
      { mode: 'connect', email: 'ana@harbor.example', name: 'Ana Ruiz', business_name: 'Harbor Lane Bakery' },
      { mode: 'connect', email: 'new@northside.example', name: '', business_name: 'Northside Dental' },
    ]);
    await expect(page.locator('#csvZone input[type=file]')).toHaveCount(0);            // the panel closes when it's done
  });

  test('deals: each row makes its contact, then the deal at its open stage; won and lost are skipped', async ({ page }) => {
    const contacts: unknown[] = [], deals: unknown[] = [];
    await installApp(page, { api: { '/sales/deals': { data: [] }, '/sales/summary': { data: { total: 0 } } } });
    await page.route('**/functions/v1/presence/sales/contacts', (route) => { if (route.request().method() !== 'POST') return route.fallback(); contacts.push(route.request().postDataJSON()); return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'ct-' + contacts.length } }) }); });
    await page.route('**/functions/v1/presence/sales/deals', (route) => { if (route.request().method() !== 'POST') return route.fallback(); deals.push(route.request().postDataJSON()); return route.fulfill({ status: 201, contentType: 'application/json', body: '{"data":{}}' }); });
    await page.goto('/pipeline.html');
    // final pass, batch C: on a phone Import CSV lives under More
    if (await page.locator('#moreBtn').isVisible()) { await page.locator('#moreBtn').click(); await page.getByRole('menuitem', { name: 'Import CSV' }).click(); }
    else await page.getByRole('button', { name: 'Import CSV' }).click();
    await page.locator('#csvZone input[type=file]').setInputFiles({ name: 'deals.csv', mimeType: 'text/csv', buffer: Buffer.from('Deal,Amount,Stage,Contact,Email,Close date\nWebsite rebuild,"$2,400",Proposal,Ana Ruiz,ana@harbor.example,2026-12-01\nOld win,500,Closed Won,,,\nLogo refresh,300,,,,\n') });
    await expect(page.locator('#csvZone')).toContainText('3 deals found');
    await page.locator('#csvZone').getByRole('button', { name: 'Import 3' }).click();
    await expect.poll(() => deals.length).toBe(2);
    expect(contacts).toEqual([{ name: 'Ana Ruiz', email: 'ana@harbor.example' }]);
    expect(deals).toContainEqual({ title: 'Website rebuild', stage: 'proposal', expected_value_cents: 240000, contact_id: 'ct-1', expected_close: '2026-12-01', source: 'import' });
    expect(deals).toContainEqual({ title: 'Logo refresh', stage: 'lead', expected_value_cents: 30000, source: 'import' });
  });

  // final pass, batch D: what Excel actually saves — a byte-order mark before the header,
  // CRLF lines, "" inside quotes, a line break inside a cell, and money written 1.200,50
  test('deals from Excel: a byte-order mark, quotes, a line break in a cell, and 1.200,50', async ({ page }) => {
    const contacts: unknown[] = [], deals: unknown[] = [];
    await installApp(page, { api: { '/sales/deals': { data: [] }, '/sales/summary': { data: { total: 0 } } } });
    await page.route('**/functions/v1/presence/sales/contacts', (route) => { if (route.request().method() !== 'POST') return route.fallback(); contacts.push(route.request().postDataJSON()); return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'ct-' + contacts.length } }) }); });
    await page.route('**/functions/v1/presence/sales/deals', (route) => { if (route.request().method() !== 'POST') return route.fallback(); deals.push(route.request().postDataJSON()); return route.fulfill({ status: 201, contentType: 'application/json', body: '{"data":{}}' }); });
    await page.goto('/pipeline.html');
    if (await page.locator('#moreBtn').isVisible()) { await page.locator('#moreBtn').click(); await page.getByRole('menuitem', { name: 'Import CSV' }).click(); }
    else await page.getByRole('button', { name: 'Import CSV' }).click();
    const csv = '\uFEFFDeal,Amount,Stage,Contact,Notes\r\nMenu redesign,"1.200,50",Qualified,"Ana ""Ani"" Ruiz","two lines\r\nof notes"\r\nPhoto day,"€ 950",,,\r\n';
    await page.locator('#csvZone input[type=file]').setInputFiles({ name: 'deals.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
    await expect(page.locator('#csvZone')).toContainText('2 deals found');   // the header was found, and the quoted line break stayed in its row
    await page.locator('#csvZone').getByRole('button', { name: 'Import 2' }).click();
    await expect.poll(() => deals.length).toBe(2);
    expect(contacts).toEqual([{ name: 'Ana "Ani" Ruiz' }]);
    expect(deals).toContainEqual({ title: 'Menu redesign', stage: 'qualified', expected_value_cents: 120050, contact_id: 'ct-1', source: 'import' });
    expect(deals).toContainEqual({ title: 'Photo day', stage: 'lead', expected_value_cents: 95000, source: 'import' });
  });
});

const OPEN = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const WON = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const now = new Date().toISOString();
const PIPE = {
  '/sales/deals': { data: [
    { id: OPEN, title: 'Acme website', stage: 'proposal', expected_value_cents: 50000, contact_id: 'ct-1', converted_client_id: null, updated_at: now },
    { id: WON, title: 'Maple Street Studio', stage: 'won', expected_value_cents: 240000, contact_id: 'ct-2', converted_client_id: 'cl-1', updated_at: now },
  ] },
  '/sales/summary': { data: { total: 2, open: { count: 1, value_cents: 50000 }, won_month: { count: 1, value_cents: 240000 }, win_rate: {}, by_stage: [], ar: {} } },
  '/sales/contacts': { data: [{ id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com' }, { id: 'ct-2', name: 'Dana Lee', email: 'dana@example.com' }] },
  '/sales/templates': { data: [] }, '/sales/services': { data: [] }, '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/identity': { data: { business_name: 'Test Studio' } },
};

test.describe('item 31 — Pipeline: views and pick-and-act in the Table', () => {
  test('Mark as not a fit moves only the open deal; Send an update goes to the deals\' contacts', async ({ page }) => {
    const moved: string[] = []; let listBody: any = null;
    await pinTable('dds-display:pipeline')(page);
    await installApp(page, { api: PIPE });
    await page.route('**/functions/v1/presence/sales/deals/*/stage', (route) => { moved.push(new URL(route.request().url()).pathname.split('/').slice(-2)[0]); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{}}' }); });
    await page.route('**/functions/v1/presence/broadcasts/lists', (route) => { listBody = route.request().postDataJSON(); return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'list-0099' } }) }); });
    // final pass, batch D: the reload must show the move (the old check counted 2 rows before and after)
    await page.route(/\/functions\/v1\/presence\/sales\/deals(\?|$)/, (route) => {
      if (route.request().method() !== 'GET' || !moved.length) return route.fallback();
      const data = PIPE['/sales/deals'].data.map((d) => (moved.includes(d.id) ? { ...d, stage: 'lost' } : d));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
    });
    await page.goto('/pipeline.html');
    await page.getByLabel('Select Acme website').check();
    await page.getByLabel('Select Maple Street Studio').check();
    const bar = page.getByRole('region', { name: 'Selected deals' });
    await expect(bar).toContainText('2 selected');
    await bar.getByRole('button', { name: 'Mark as not a fit' }).click();
    await bar.getByRole('button', { name: 'Yes, mark them' }).click();   // final pass, batch C: it asks first
    await expect(page.getByRole('region', { name: 'Selected deals' })).toHaveCount(0);   // the picks clear the moment it starts
    await expect.poll(() => moved).toEqual([OPEN]);
    await expect(page.locator('#table tbody tr').filter({ hasText: 'Acme website' })).toContainText('Not a fit');   // the reload has painted the move (one word: Not a fit, never Lost)
    await page.getByLabel('Select Acme website').check();
    await page.getByLabel('Select Maple Street Studio').check();
    await page.getByRole('region', { name: 'Selected deals' }).getByRole('button', { name: 'Send an update' }).click();
    await expect(page).toHaveURL(/\/broadcasts\.html\?list=list-0099$/);
    expect(listBody.people).toEqual([{ email: 'sam@example.com', name: 'Sam Rivera' }, { email: 'dana@example.com', name: 'Dana Lee' }]);
  });

  test('Views: Save this view keeps the stage, search, columns and sort', async ({ page }) => {
    const puts: any[] = [];
    await pinTable('dds-display:pipeline')(page);
    await installApp(page, { api: PIPE });
    await echoViews(page, puts);
    await page.goto('/pipeline.html?stage=proposal');
    await page.locator('#dealSearch').fill('acme');
    await page.locator('#pvBtn').click();
    await page.getByRole('menuitem', { name: 'Save this view…' }).click();
    const dlg = page.getByRole('dialog', { name: 'Save this view' });
    await dlg.getByLabel('Name').fill('Acme proposals');
    await dlg.getByRole('button', { name: 'Save view' }).click();
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0]).toMatchObject({ list: 'pipeline', views: [{ name: 'Acme proposals', base: 'proposal', q: 'acme', cols: ['title', 'contact', 'stage', 'value', 'next', 'last'], sort: { key: 'next', dir: 1 } }] });
    await expect(page.locator('#pvBtn')).toContainText('Acme proposals');
  });
});

test.describe('item 39 — a picked list is an audience to send to again', () => {
  const SEGS = { data: { segments: [
    { key: 'contacts', label: 'All contacts', description: '', count: 8 },
    { key: 'list:list-0042', label: 'Picked on Nov 8 · 1 person', description: 'A list you picked · 1 person', count: 1, list: true },
  ] } };
  test('arriving from Send an update picks that list; it can be removed', async ({ page }) => {
    let deleted = '';
    await installApp(page, { api: { '/broadcasts/segments': SEGS, '/broadcasts': { data: { broadcasts: [] } } } });
    await page.route('**/functions/v1/presence/broadcasts/lists/*', (route) => { deleted = route.request().method() + ' ' + new URL(route.request().url()).pathname.split('/').pop(); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{"ok":true}}' }); });
    await page.goto('/broadcasts.html?list=list-0042');
    await expect(page.locator('[data-seg="list:list-0042"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/\/broadcasts\.html$/);                                 // the hand-off is used once
    await page.getByRole('button', { name: 'Remove this list' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove list' }).click();
    await expect.poll(() => deleted).toBe('DELETE list-0042');
  });
});
