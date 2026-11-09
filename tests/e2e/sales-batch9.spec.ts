import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Sales review, Nov 2026 — batch nine:
//   item 38  the Pipeline wears the studio's own names for its open stages
//   item 40  Inbox notice rows say their kind and "opens in its own page" once per run
//   item 41  the record keeps three buttons in front; the rest under More
//   item 42  Customers cards show what's owed and what's waiting
//   item 45  the record's timeline starts beside the record read

const OPEN = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const now = new Date().toISOString();
const RENAMED = { data: { labels: { lead: 'Enquiry', qualified: 'Qualified', proposal: 'Quote sent', contract: 'Agreement out', won: 'Won', lost: 'Not a fit' }, custom: { lead: 'Enquiry', proposal: 'Quote sent' } } };

test.describe('item 38 — the Pipeline uses the studio\'s stage names', () => {
  test('filter chips and board columns say Enquiry and Quote sent', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('dds-display:pipeline', 'board'); } catch { /* denied */ } });
    await installApp(page, { api: {
      '/sales/stages': RENAMED,
      '/sales/deals': { data: [{ id: OPEN, title: 'Acme website', stage: 'proposal', expected_value_cents: 50000, updated_at: now }] },
      '/sales/summary': { data: { total: 1, open: { count: 1, value_cents: 50000 }, won_month: { count: 0, value_cents: 0 }, win_rate: {}, by_stage: [], ar: {} } },
    } });
    await page.goto('/pipeline.html');
    if ((page.viewportSize()?.width || 0) <= 760) {   // a phone shows one stage at a time (bold redesign): the tabs carry the names
      await expect(page.locator('[data-stab="proposal"]')).toContainText('Quote sent');
      await expect(page.locator('[data-stab="lead"]')).toContainText('Enquiry');
    } else {
      await expect(page.getByRole('region', { name: 'Quote sent column' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Enquiry column' })).toBeVisible();
    }
    await page.locator('#viewList').click();
    await expect(page.locator('#filters .chip[data-stage="lead"]')).toHaveText('Enquiry');
    await expect(page.locator('#filters .chip[data-stage="won"]')).toHaveText('Won');
  });
});

test.describe('item 40 — notice rows say their kind once', () => {
  test('two notices: one heading above them, no repeated "Opens in its own page" on each row', async ({ page }) => {
    await installApp(page, { api: { '/portal/feed': { data: { role: 'business_owner', moments: [], pending_approvals: [], client_messages: [], enquiries: [], notices: [
      { id: 'aaaaaaaa-1111-4111-8111-000000000001', kind: 'site_down', headline: 'Your site was slow this morning', body: '', href: '/presence.html' },
      { id: 'aaaaaaaa-1111-4111-8111-000000000002', kind: 'domain_expiring', headline: 'Your domain renews soon', body: '', href: '/presence.html' },
    ] } } } });
    await page.goto('/inbox.html');
    await expect(page.locator('#rows .sysrow')).toHaveCount(2);
    await expect(page.locator('#rows .lgroup')).toHaveCount(1);
    await expect(page.locator('#rows .lgroup')).toContainText('Each opens in its own page');
    await expect(page.locator('#rows .sysrow').first()).not.toContainText('Opens in its own page');
    await expect(page.locator('#rows .sysrow').first()).toHaveAttribute('aria-label', /opens in its own page$/);
  });
});

const CLIENT = '44444444-4444-4444-8444-444444444444';
const DEAL = '55555555-5555-4555-8555-555555555555';
const PROJECT = '66666666-6666-4666-8666-666666666666';
const RECORD = { data: {
  identity: { contact_id: null, deal_id: DEAL, client_id: 'cl-1', customer_site_id: CLIENT, project_id: PROJECT },
  header: { name: 'Maple Street Studio', company: '', email: 'h@example.com', phone: '', status: 'customer' },
  highlights: { value_cents: 0, stage: 'won', owed_cents: 0 },
  sections: { overview: true, messages: true, deal: true, delivery: true },
  default_tab: 'delivery', canonical: { key: 'client', value: CLIENT },
} };
const RECORD_API = {
  '/crm/record': RECORD,
  '/crm/activity': { data: { items: [], upcoming: [] } },
  [`/sales/deals/${DEAL}`]: { data: { deal: { id: DEAL, title: 'Maple Street Studio', stage: 'won', expected_value_cents: 0, converted_client_id: 'cl-1' }, proposals: [], contracts: [], invoices: [] } },
  [`/projects/${PROJECT}`]: { data: { project: { id: PROJECT, name: 'Website rebuild', status: 'active' }, milestones: [], tasks: [], deliverables: [] } },
};

test.describe('item 41 — three buttons on the record', () => {
  test('Send invoice, Message and Log activity in front; Open project under More', async ({ page }) => {
    await installApp(page, { api: RECORD_API });
    await page.goto(`/crm.html?client=${CLIENT}`);
    const bar = page.locator('#actbar');
    await expect(bar.locator(':scope > .abtn')).toHaveText(['Send invoice', 'Message', 'Log activity']);
    await expect(page.locator('#act-menu #act-project')).toHaveCount(1);
  });
});

test.describe('item 45 — the record\'s timeline starts beside the record read', () => {
  test('opened by the customer\'s site, /crm/activity is asked before /crm/record answers', async ({ page }) => {
    // final pass, batch D: an order of events, not a 600 ms race. The record's answer is held
    // until the timeline has been asked for; a page that waited for the record first would
    // reach the 8 s cap with the timeline still unasked, and fail here.
    let asked = false, notify: () => void = () => {};
    const seen = new Promise<void>((r) => { notify = r; });
    page.on('request', (r) => { if (/\/crm\/activity/.test(r.url())) { asked = true; notify(); } });
    await installApp(page, { api: RECORD_API });
    let askedBeforeAnswer = false;
    await page.route('**/functions/v1/presence/crm/record**', async (route) => {
      await Promise.race([seen, new Promise((r) => setTimeout(r, 8000))]);
      askedBeforeAnswer = asked;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RECORD) });
    });
    await page.goto(`/crm.html?client=${CLIENT}`);
    // past the 8 s cap, so a page that waits fails on the line below, not on the heading
    await expect(page.getByRole('heading', { level: 1, name: 'Maple Street Studio' })).toBeVisible({ timeout: 15_000 });
    expect(askedBeforeAnswer).toBe(true);
  });

  test('opened by a deal, the timeline still waits for the record\'s ids', async ({ page }) => {
    const order: string[] = [];
    page.on('request', (r) => { const u = new URL(r.url()).pathname; if (/\/crm\/(record|activity)$/.test(u)) order.push(u.split('/').pop()!); });
    await installApp(page, { api: { ...RECORD_API, '/crm/record': { data: { ...RECORD.data, canonical: { key: 'deal', value: DEAL } } } } });
    await page.goto(`/crm.html?deal=${DEAL}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Maple Street Studio' })).toBeVisible();
    await expect.poll(() => order).toEqual(['record', 'activity']);
  });
});

test.describe('item 42 — Customers cards show a fact', () => {
  test('a card says what they owe and what is waiting; a quiet card says nothing extra', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('dds-display:customers', 'cards'); } catch { /* denied */ } });
    await installApp(page, { api: {
      '/studio/customers': { data: [
        { client_id: 'c-acme', name: 'Acme Bakery', email: 'a@acme.example', project_id: 'p1', project_name: 'Website rebuild', status: 'active', customer_site_id: 'site-acme', open_support: 2, project_count: 1 },
        { client_id: 'c-beta', name: 'Beta Salon', email: 'b@beta.example', project_id: 'p2', status: 'active', customer_site_id: 'site-beta', open_support: 0, project_count: 1 },
      ] },
      '/sales/receivables': { data: { items: [
        { id: 'i1', title: 'Deposit', amount_cents: 120000, state: 'overdue', client_id: 'c-acme' },
        { id: 'i2', title: 'Balance', amount_cents: 30000, state: 'upcoming', client_id: 'c-acme' },
        { id: 'i3', title: 'On its way', amount_cents: 99900, state: 'processing', client_id: 'c-beta' },
      ], total_cents: 150000 } },
    } });
    await page.goto('/customers.html');
    const acme = page.locator('.cust').filter({ hasText: 'Acme Bakery' });
    await expect(acme).toContainText('Owes $1,500');
    await expect(acme).toContainText('2 requests waiting');
    await expect(acme).toContainText('Website rebuild');
    const beta = page.locator('.cust').filter({ hasText: 'Beta Salon' });
    await expect(beta.locator('.facts')).toHaveCount(0);                                  // a payment on its way isn't owed
    await expect(page.locator('#listZone')).not.toContainText('all clear');
    await expect(acme.getByRole('button', { name: 'Open record' })).toHaveCount(1);
    await expect(acme.getByRole('button', { name: 'Open', exact: true })).toHaveCount(0);
  });
});
