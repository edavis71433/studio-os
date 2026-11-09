import { test, expect, Page, Request } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// Bold redesign, part 2 — Customers and People. The views are chips with their
// counts, the rows are the default display, and a row opens a preview beside the
// list (laid over it below 1180px, a sheet on a phone): Log call, Message and
// Invoice, what they owe, the deal, the project, the next step and the latest,
// read from the same /crm/record + /crm/activity the record page uses.

const DAY = 86_400_000;
const ymd = (d: number) => { const t = new Date(Date.now() + d * DAY); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const DEAL = 'aaaaaaaa-0000-4000-8000-0000000000d1';
const ADA = 'cccccccc-0000-4000-8000-0000000000a1';
const PRIYA = 'cccccccc-0000-4000-8000-0000000000a2';
const CUSTOMERS = { data: [
  { client_id: 'c-acme', name: 'Acme Bakery', person_name: 'Ada Park', email: 'ada@acme.example', project_id: 'p1', project_name: 'Website rebuild', status: 'active', customer_site_id: 'site-acme', open_support: 2, project_count: 1 },
  { client_id: 'c-beta', name: 'Beta Salon', person_name: 'Bo Reyes', email: 'bo@beta.example', project_id: 'p2', project_name: 'Booking page', status: 'on_hold', customer_site_id: null, open_support: 0, project_count: 1 },
  { client_id: 'c-cedar', name: 'Cedar Garage', person_name: '', email: 'hi@cedar.example', project_id: 'p3', project_name: 'Site', status: 'complete', customer_site_id: 'site-cedar', open_support: 0, project_count: 2 },
] };
const RECEIVABLES = { data: { items: [
  { id: 'i1', title: 'Deposit', amount_cents: 120000, due_date: ymd(-3), status: 'open', state: 'overdue', overdue: true, deal_id: DEAL, client_id: 'c-acme', customer_site_id: 'site-acme' },
  { id: 'i2', title: 'Balance', amount_cents: 30000, due_date: ymd(5), status: 'open', state: 'upcoming', overdue: false, deal_id: DEAL, client_id: 'c-acme', customer_site_id: 'site-acme' },
  { id: 'i3', title: 'Invoice', amount_cents: 50000, due_date: ymd(9), status: 'open', state: 'upcoming', overdue: false, deal_id: 'd-cedar', client_id: 'c-cedar', customer_site_id: 'site-cedar' },
], paid: [], total_cents: 200000, overdue_cents: 120000 } };
const RECORD = { data: {
  identity: { client_id: 'c-acme', customer_site_id: 'site-acme', project_id: 'p1', deal_id: DEAL, contact_id: ADA },
  header: { name: 'Acme Bakery', company: 'Acme Bakery', email: 'ada@acme.example', phone: '', status: 'customer' },
  highlights: { value_cents: 320000, stage: 'proposal', owed_cents: 150000 },
  sections: { overview: true, details: true, deal: true, delivery: true }, default_tab: 'details', canonical: { key: 'client', value: 'site-acme' },
} };
const ACTIVITY = { data: { reply_to: null, reply_support_to: null,
  upcoming: [{ kind: 'task', id: 't1', title: 'Send the revised logo', due: ymd(1), overdue: false, href: null }],
  items: [
    { id: 'a1', kind: 'deal_activity', type: 'call', title: 'You called Ada', body: null, at: ago(2), meta: 'Deal', href: null },
    { id: 'a2', kind: 'deal_event', type: 'system', title: 'Ada opened your proposal', body: null, at: ago(4), meta: 'Deal', href: null },
    { id: 'a3', kind: 'invoice', type: 'system', title: 'Deposit paid', body: null, at: ago(12), meta: 'Billing', href: null },
    { id: 'a4', kind: 'deal_event', type: 'system', title: 'Moved to Proposal sent', body: null, at: ago(20), meta: 'Deal', href: null },
  ] } };
const PEOPLE = { data: [
  { id: ADA, name: 'Ada Park', email: 'ada@acme.example', phone: '', company: 'Acme Bakery', client_id: 'c-acme', updated_at: ago(1) },
  { id: PRIYA, name: 'Priya Shah', email: 'priya@example.com', phone: '', company: '', client_id: null, updated_at: ago(2) },
  { id: 'cccccccc-0000-4000-8000-0000000000a3', name: 'Theo Grant', email: 'theo@example.com', phone: '', company: 'Grant Bikes', client_id: null, updated_at: ago(3) },
] };
// a studio at studio level, so + Create (PR 206) is there for the preview's Log call and Invoice
const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };
const API = {
  '/portal/context': STUDIO_CTX,
  '/studio/customers': CUSTOMERS, '/sales/receivables': RECEIVABLES, '/crm/record': RECORD, '/crm/activity': ACTIVITY, '/sales/contacts': PEOPLE,
  '/sales/deals': { data: [{ id: 'aaaaaaaa-0000-4000-8000-0000000000d9', title: 'Someone else — logo', stage: 'lead', expected_value_cents: 50000, contact_id: null }] },
  [`/sales/deals/${DEAL}`]: { data: { deal: { id: DEAL, title: 'Acme Bakery — website rebuild', stage: 'proposal', expected_value_cents: 320000, contact_id: ADA },
    contact: { id: ADA, name: 'Ada Park', email: 'ada@acme.example', company: 'Acme Bakery' } } },
};
const isModal = (page: Page) => page.locator('#cprev').evaluate((el) => el.matches(':modal'));
const reads = (page: Page, path: string) => { const seen: Request[] = []; page.on('request', (r) => { if (r.method() === 'GET' && new URL(r.url()).pathname.endsWith(path)) seen.push(r); }); return seen; };
const fact = (page: Page, name: string) => page.locator('#cprev .cp-facts > div').filter({ has: page.locator('dt', { hasText: name }) }).locator('dd');
const openAcme = async (page: Page) => {
  await page.locator('.cust').filter({ hasText: 'Acme Bakery' }).getByRole('button', { name: 'Preview Acme Bakery' }).click();
  await expect(page.locator('#cprev').getByRole('heading', { level: 2 })).toHaveText('Acme Bakery');
};

test.describe('Customers — chips, rows and the preview (bold redesign, part 2)', () => {
  test('the views are chips with their counts; one click filters, and the title and the view menu agree', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/customers.html');
    const chips = page.locator('.chips [data-chip]');
    await expect(chips).toHaveText(['All 3', 'Needs you 1', 'Owes you 2', 'Active 1', 'On hold 1', 'Done 1']);
    await expect(chips.first()).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.lmeta')).toContainText('3 customers · $2,000 owed to you');
    await page.locator('[data-chip="owes"]').click();
    await expect(page.locator('[data-chip="owes"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-chip="owes"]')).toBeFocused();
    await expect(page.locator('#viewBtn')).toContainText('Owes you');
    await expect(page.locator('.cust')).toHaveCount(2);
    await expect(page.locator('#listZone')).not.toContainText('Beta Salon');
    await expect(page.locator('.lmeta')).toContainText('2 customers · $2,000 owed to you');
    await page.locator('#viewBtn').click();
    await expect(page.locator('#viewMenu [data-view="owes"]')).toHaveAttribute('aria-selected', 'true');
  });

  test('a chip with nothing in it stays out of the way', async ({ page }) => {
    await installApp(page, { api: { ...API, '/sales/receivables': { data: { items: [], paid: [], total_cents: 0 } } } });
    await page.goto('/customers.html');
    await expect(page.locator('[data-chip="all"]')).toBeVisible();
    await expect(page.locator('[data-chip="owes"]')).toHaveCount(0);
    await expect(page.locator('.lmeta')).not.toContainText('owed');
  });

  test('rows are the default display: an avatar, the person, the project, and only the facts that are true', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/customers.html');
    await expect(page.locator('#dispCards')).toHaveAttribute('aria-pressed', 'true');
    const acme = page.locator('.cust').filter({ hasText: 'Acme Bakery' });
    await expect(acme.locator('.av')).toHaveText('AB');
    await expect(acme).toContainText('Ada Park');
    await expect(acme).toContainText('Website rebuild');
    await expect(acme.locator('.fact.owe')).toHaveText('Owes $1,500');
    await expect(acme.locator('.fact.owe')).toHaveClass(/late/);                       // part of it is overdue
    await expect(acme.locator('.fact.wait')).toHaveText('2 requests waiting');
    await expect(page.locator('.cust').filter({ hasText: 'Beta Salon' }).locator('.facts')).toHaveCount(0);
    await expect(page.locator('.cust').filter({ hasText: 'Cedar Garage' }).locator('.fact.owe')).not.toHaveClass(/late/);
  });

  test('a row opens the preview: what they owe, the deal, the project, the next step, the latest, read in the customer’s scope', async ({ page }) => {
    const rec = reads(page, '/crm/record'), act = reads(page, '/crm/activity');
    await installApp(page, { api: API });
    await page.goto('/customers.html');
    await openAcme(page);
    const pv = page.locator('#cprev');
    await expect(pv).toContainText('Ada Park · ada@acme.example');
    await expect(fact(page, 'Owes you')).toHaveText('$1,500 · $1,200 overdue');
    await expect(fact(page, 'Owes you')).toHaveClass(/bad/);
    await expect(fact(page, 'Deal')).toHaveText('Proposal sent · $3,200');
    await expect(fact(page, 'Deal').getByRole('link')).toHaveAttribute('href', `/pipeline.html?deal=${DEAL}`);
    await expect(fact(page, 'Project')).toHaveText('Website rebuild · In progress');
    await expect(fact(page, 'Next step')).toHaveText('Send the revised logo · tomorrow');
    await expect(fact(page, 'Requests')).toHaveText('2 waiting on you');
    await expect(fact(page, 'Website').getByRole('link')).toHaveAttribute('href', '/presence.html?client=site-acme');
    await expect(pv.locator('.cp-latest li')).toHaveCount(3);                          // the three newest
    await expect(pv.locator('.cp-latest li').first()).toContainText('You called Ada');
    await expect(pv.locator('.cp-latest li').first().locator('time')).toHaveText('2d');
    await expect(pv.getByRole('link', { name: 'Message' })).toHaveAttribute('href', '/crm.html?client=site-acme&act=message');
    await expect(pv.getByRole('link', { name: 'Open full record' })).toHaveAttribute('href', '/crm.html?client=site-acme');
    // the same reads the record page makes, in the customer's own scope
    expect(new URL(rec[0].url()).search).toBe('?client=site-acme');
    expect(rec[0].headers()['x-dds-scope-site']).toBe('site-acme');
    expect(new URL(act[0].url()).searchParams.get('deal')).toBe(DEAL);
    expect(act[0].headers()['x-dds-scope-site']).toBe('site-acme');
    // the row stays lit while it's open
    await expect(page.locator('.cust.pv-on')).toHaveCount(1);
    await expect(page.locator('.cust.pv-on')).toContainText('Acme Bakery');
  });

  test('wide screens keep the list beside it: another row swaps the preview; Escape closes and goes back to the row', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'the side-by-side layout needs 1180px');
    const rec = reads(page, '/crm/record');
    await installApp(page, { api: API });
    await page.goto('/customers.html');
    await openAcme(page);
    const pv = page.locator('#cprev');
    expect(await isModal(page)).toBe(false);                                          // beside the list, not over it: the list still works
    await page.locator('.cust').filter({ hasText: 'Beta Salon' }).getByRole('button', { name: 'Preview Beta Salon' }).click();
    await expect(pv.getByRole('heading', { level: 2 })).toHaveText('Beta Salon');
    expect(new URL(rec[rec.length - 1].url()).search).toBe('?client_id=c-beta');   // no site: by client, unscoped
    expect(rec[rec.length - 1].headers()['x-dds-scope-site']).toBeUndefined();
    await expect(pv.getByRole('link', { name: 'Open full record' })).toHaveAttribute('href', '/crm.html?client_id=c-beta');
    await page.keyboard.press('Escape');
    await expect(pv).toBeHidden();
    await expect(page.getByRole('button', { name: 'Preview Beta Salon' })).toBeFocused();
    await expect(page.locator('.cust.pv-on')).toHaveCount(0);
  });

  test('beside the preview the table drops the email, the project count and the row actions', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'the side-by-side layout needs 1180px');
    await page.addInitScript(() => { try { localStorage.setItem('dds-display:customers', 'table'); } catch (_) { /* */ } });
    await installApp(page, { api: API });
    await page.goto('/customers.html');
    await expect(page.locator('th[data-col="email"]')).toBeVisible();
    await page.locator('tbody tr').first().locator('td').nth(1).click();
    await expect(page.locator('#cprev').getByRole('heading', { level: 2 })).toHaveText('Acme Bakery');
    await expect(page.locator('th[data-col="email"]')).toBeHidden();
    await expect(page.locator('th[data-col="project_count"]')).toBeHidden();
    await expect(page.locator('tbody td.acts').first()).toBeHidden();
    await expect(page.locator('tbody tr').first()).toHaveAttribute('aria-current', 'true');
    const wrap = await page.locator('.tscroll').evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    expect(wrap).toBe(true);                                                          // it fits: no sideways scroll beside the preview
    await page.locator('#cprev').getByRole('button', { name: 'Close preview' }).click();
    await expect(page.locator('th[data-col="email"]')).toBeVisible();
  });

  test('below 1180px it is a modal dialog over the list: Tab never reaches the page behind, a click outside closes it', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 900 });
    await installApp(page, { api: API });
    await page.goto('/customers.html');
    await openAcme(page);
    const pv = page.locator('#cprev');
    expect(await isModal(page)).toBe(true);
    // a native modal: the page behind is inert, so Tab walks the preview and then
    // the browser's own controls (where a real browser loops back) — never the list
    let inside = 0;
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      const where = await page.evaluate(() => { const a = document.activeElement; return !a || a === document.body ? 'browser' : a.closest('#cprev') ? 'preview' : 'page'; });
      expect(where).not.toBe('page');
      if (where === 'preview') inside++;
    }
    expect(inside).toBeGreaterThan(5);
    await page.mouse.click(20, 450);                                                  // the backdrop, left of the box
    await expect(pv).toBeHidden();
    await expect(page.getByRole('button', { name: 'Preview Acme Bakery' })).toBeFocused();
  });

  test('Log call and Invoice open + Create’s form over the preview, on this customer’s deal; closing it comes back', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/customers.html');
    await openAcme(page);
    // what the preview asks + Create for (PR 206 owns the form itself)
    await page.evaluate(() => {
      const w = window as unknown as { ddsOpenCreate: (...a: unknown[]) => boolean; __asked: unknown[] };
      const real = w.ddsOpenCreate; w.__asked = [];
      w.ddsOpenCreate = function (...a: unknown[]) { w.__asked.push([a[0], a[3]]); return real.apply(this, a); };
    });
    const asked = () => page.evaluate(() => (window as unknown as { __asked: unknown[] }).__asked);
    const pv = page.locator('#cprev');
    await pv.getByRole('button', { name: 'Log call' }).click();
    const call = page.getByRole('dialog', { name: 'Log a call' });
    await expect(call).toBeVisible();
    expect(await asked()).toEqual([['call', { deal_id: DEAL }]]);
    await expect(call.locator('#cr-picked')).toContainText('Ada Park');               // started on Acme's deal (read by id: it isn't in the first read)
    // Escape closes the form first; the preview is still there, back on Log call
    await page.keyboard.press('Escape');
    await expect(call).toBeHidden();
    await expect(pv.getByRole('heading', { level: 2 })).toHaveText('Acme Bakery');
    await expect(pv.getByRole('button', { name: 'Log call' })).toBeFocused();
    await pv.getByRole('button', { name: 'Invoice' }).click();
    const inv = page.getByRole('dialog', { name: 'Send an invoice' });
    await expect(inv).toBeVisible();
    expect((await asked())[1]).toEqual(['invoice', { deal_id: DEAL }]);
    await expect(inv.locator('#cr-picked')).toContainText('Ada Park');
  });

  test('something made with + Create brings the list and the open preview up to date', async ({ page }) => {
    const rec = reads(page, '/crm/record'), list = reads(page, '/studio/customers');
    await installApp(page, { api: API });
    await page.goto('/customers.html');
    await openAcme(page);
    await expect(page.locator('#cprev .cp-latest li')).toHaveCount(3);
    const r0 = rec.length, l0 = list.length;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('dds:created', { detail: { kind: 'call' } })));   // what create.js sends after a save
    await expect.poll(() => list.length).toBeGreaterThan(l0);
    await expect.poll(() => rec.length).toBeGreaterThan(r0);
    await expect(page.locator('#cprev').getByRole('heading', { level: 2 })).toHaveText('Acme Bakery');
  });

  test('a tap before the record lands waits for it, then asks + Create for the deal', async ({ page }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    await installApp(page, { api: API });
    await page.route('**/functions/v1/presence/crm/record**', async (route) => { await gate; await route.fallback(); });
    await page.goto('/customers.html');
    await page.evaluate(() => {
      const w = window as unknown as { ddsOpenCreate: (...a: unknown[]) => boolean; __asked: unknown[] };
      w.__asked = []; w.ddsOpenCreate = function (...a: unknown[]) { w.__asked.push([a[0], a[3]]); return true; };
    });
    await page.getByRole('button', { name: 'Preview Acme Bakery' }).click();
    await page.locator('#cprev').getByRole('button', { name: 'Log call' }).click();
    expect(await page.evaluate(() => (window as unknown as { __asked: unknown[] }).__asked)).toEqual([]);   // not yet: no one to start on
    release();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __asked: unknown[] }).__asked)).toEqual([['call', { deal_id: DEAL }]]);
  });

  test('a failed read says so in the preview and tries again in place', async ({ page }) => {
    await installApp(page, { api: API });
    let fail = true;
    await page.route('**/functions/v1/presence/crm/record**', (route) => fail
      ? route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'read_failed' }) })
      : route.fallback());
    await page.goto('/customers.html');
    await openAcme(page);
    const pv = page.locator('#cprev');
    await expect(pv).toContainText('We couldn’t load the latest just now.');
    await expect(fact(page, 'Owes you')).toHaveText('$1,500 · $1,200 overdue');      // what the list already knows still shows
    fail = false;
    await pv.getByRole('button', { name: 'Try again' }).click();
    await expect(pv.locator('.cp-latest li')).toHaveCount(3);
    await expect(fact(page, 'Deal')).toHaveText('Proposal sent · $3,200');
  });
});

test.describe('People — the second tab (bold redesign, part 2)', () => {
  test('People: chips, avatars; someone who isn’t a customer yet previews by contact, a customer’s person previews the customer', async ({ page }) => {
    const rec = reads(page, '/crm/record');
    await installApp(page, { api: API });
    await page.goto('/customers.html?tab=people');
    await expect(page.getByRole('tab', { name: /People/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.lmeta')).toHaveText('3 people · 2 not customers yet');
    await expect(page.locator('[data-pchip]')).toHaveText(['All 3', 'Customers 1', 'Not yet 2']);
    await page.locator('[data-pchip="not"]').click();
    await expect(page.locator('tr[data-person]')).toHaveCount(2);
    await expect(page.locator(`tr[data-person="${PRIYA}"] .av`)).toHaveText('PS');
    await page.locator(`tr[data-person="${PRIYA}"] td[data-col="customer"]`).click();
    const pv = page.locator('#cprev');
    await expect(pv.getByRole('heading', { level: 2 })).toHaveText('Priya Shah');
    expect(new URL(rec[rec.length - 1].url()).search).toBe(`?contact=${PRIYA}`);
    expect(rec[rec.length - 1].headers()['x-dds-scope-site']).toBeUndefined();
    await expect(pv.getByRole('link', { name: 'Open full record' })).toHaveAttribute('href', `/crm.html?contact=${PRIYA}&tab=details`);
    await pv.getByRole('button', { name: 'Close preview' }).click();
    await page.locator('[data-pchip="all"]').click();
    await page.locator(`tr[data-person="${ADA}"]`).press('Enter');
    await expect(pv.getByRole('heading', { level: 2 })).toHaveText('Acme Bakery');      // Ada belongs to Acme
  });
});
