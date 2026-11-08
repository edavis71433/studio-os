import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Sales review, Nov 2026 — batch seven, item 33: five fixed reports on Analytics,
// one shown at a time, each printable on its own; and the reasons the deal page
// offers when a deal is marked not a fit, so the won/lost report can group them.

const DASH = { data: {
  period: 'this_month', generated_at: '2026-11-08T14:00:00Z',
  sales: { pipeline: null, won: null, enquiries: null, support: null, invoices: null, recent_wins: [] },
  website: { traffic: null, search: null },
} };
const months = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(Date.UTC(2025, 11 + i, 1));
  const m = d.toISOString().slice(0, 7);
  return { month: m, label: d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) + ' ' + m.slice(0, 4), this_year: i === 11 ? 150000 : 0, last_year: i === 11 ? 70000 : 0 };
});
const REPORTS = { data: {
  generated_at: '2026-11-08T14:00:00Z',
  revenue: { months, total_this_year: 150000, total_last_year: 70000 },
  pipeline: { rows: [
    { stage: 'lead', label: 'New lead', count: 1, value_cents: 0, avg_days: 1, longest_days: 1, longest_title: 'Northside Dental' },
    { stage: 'qualified', label: 'Qualified', count: 0, value_cents: 0, avg_days: null, longest_days: null, longest_title: '' },
    { stage: 'proposal', label: 'Proposal sent', count: 2, value_cents: 200000, avg_days: 38, longest_days: 68, longest_title: 'Harbor Lane Bakery' },
    { stage: 'contract', label: 'Agreement out', count: 0, value_cents: 0, avg_days: null, longest_days: null, longest_title: '' },
  ], count: 3, value_cents: 200000, partial: false },
  outcomes: { window_days: 365, won: { count: 2, value_cents: 290000 }, lost: { count: 3, value_cents: 50000 }, win_rate_pct: 40,
    won_by_source: [{ label: 'Website enquiry', count: 1, value_cents: 240000 }, { label: 'Added by hand', count: 1, value_cents: 50000 }],
    lost_by_reason: [{ label: 'Price', count: 2, value_cents: 50000 }, { label: 'No reason given', count: 1, value_cents: 0 }] },
  enquiries: { rows: [{ source: '/contact', last_30: 1, last_365: 2, became_deals: 1 }, { source: 'Home page', last_30: 1, last_365: 1, became_deals: 0 }], last_30: 2, last_365: 3, became_deals: 1 },
  overdue: { rows: [{ id: 'i1', title: 'Deposit', deal: 'Acme website', amount_cents: 120000, due_date: '2026-10-29', days_overdue: 10 }], total_cents: 120000 },
} };
const API = { '/analytics/dashboard': DASH, '/sales/reports': REPORTS, '/business-insights': { data: { groups: [] } } };
// clear the remembered report once per test (a reload must keep the choice it is testing)
const fresh = (page: import('@playwright/test').Page) => page.addInitScript(() => { try { if (!sessionStorage.getItem('rep-cleared')) { localStorage.removeItem('dds-report'); sessionStorage.setItem('rep-cleared', '1'); } } catch { /* denied */ } });

test.describe('item 33 — fixed reports on Analytics', () => {
  test('five reports, one at a time: revenue first, then each tab shows its own table', async ({ page }) => {
    await fresh(page);
    await installApp(page, { api: API });
    await page.goto('/analytics.html');
    const tabs = page.getByRole('tablist', { name: 'Reports' }).getByRole('tab');
    await expect(tabs).toHaveText(['Revenue by month', 'Deals by stage', 'Won and not a fit', 'Enquiries by page', 'Overdue invoices']);
    const panel = page.getByRole('tabpanel');
    await expect(panel.getByRole('heading', { name: 'Revenue by month' })).toBeVisible();
    await expect(panel.locator('tbody tr')).toHaveCount(12);
    await expect(panel.locator('tbody tr').first()).toContainText('Nov 2026');          // newest month on top
    await expect(panel.locator('tbody tr').first()).toContainText('$1,500');
    await expect(panel.locator('tbody tr').first()).toContainText('+$800');
    await tabs.nth(1).click();
    await expect(panel.locator('tbody tr').nth(2)).toContainText('Harbor Lane Bakery · 68 days');
    await tabs.nth(1).press('ArrowRight');                                            // the arrow keys walk the tabs
    await expect(tabs.nth(2)).toBeFocused();
    await expect(panel).toContainText('2 won');
    await expect(panel).toContainText('40% won');
    await expect(panel.getByRole('row', { name: /Price/ })).toContainText('2');
    await tabs.nth(3).click();
    await expect(panel.locator('tfoot')).toContainText('All pages');
    await tabs.nth(4).click();
    await expect(panel.locator('tbody tr').first()).toContainText('Acme website');
    await expect(panel.locator('tbody tr').first()).toContainText('10 days');
    // the choice is remembered on this device
    await page.reload();
    await expect(page.getByRole('tabpanel').getByRole('heading', { name: 'Overdue invoices' })).toBeVisible();
  });

  test('Print this report prints only that report', async ({ page }) => {
    await fresh(page);
    await page.addInitScript(() => { (window as any).__printed = []; window.print = () => { (window as any).__printed.push(document.body.getAttribute('data-print')); }; });
    await installApp(page, { api: API });
    await page.goto('/analytics.html');
    await page.getByRole('button', { name: 'Print this report' }).click();
    expect(await page.evaluate(() => (window as any).__printed)).toEqual(['report']);
    await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-print'))).toBe(null);   // the page comes back
    // what the printer sees: the report, and nothing else with words on it
    await page.evaluate(() => document.body.setAttribute('data-print', 'report'));
    await page.emulateMedia({ media: 'print' });
    expect(await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => getComputedStyle(e).visibility === 'visible' && !e.closest('#repPrint') && (e.textContent || '').trim()).length)).toBe(0);
    await expect(page.locator('#repPrint')).toContainText('Revenue by month');
    await expect(page.locator('#repPrintBtn')).toBeHidden();
  });

  test('a report that couldn\'t be read says so; a failed read never paints zeros', async ({ page }) => {
    await fresh(page);
    await installApp(page, { api: { ...API, '/sales/reports': { data: { ...REPORTS.data, revenue: { unavailable: true } } } } });
    await page.goto('/analytics.html');
    await expect(page.getByRole('tabpanel')).toContainText('This report couldn’t load just now');
    await page.route('**/functions/v1/presence/sales/reports', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
    await page.reload();
    await expect(page.locator('#reportsBody')).toContainText('Your reports couldn’t load just now');
    await expect(page.locator('#reportsBody table')).toHaveCount(0);
  });

  test('inside a client (?client=) there are no studio reports', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/analytics.html?client=aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('#reports')).toHaveCount(0);
  });
});

test.describe('item 33 — the deal page offers reasons when a deal is not a fit', () => {
  const DEAL = '11111111-1111-4111-8111-111111111111';
  const PIPE = {
    '/sales/deals': { data: [{ id: DEAL, title: 'Acme website', stage: 'proposal', expected_value_cents: 50000, contact_id: null, converted_client_id: null, updated_at: new Date().toISOString() }] },
    [`/sales/deals/${DEAL}`]: { data: { deal: { id: DEAL, title: 'Acme website', stage: 'proposal', expected_value_cents: 50000, notes: '', contact_id: null, converted_client_id: null, retainer: null }, contact: null, proposals: [], contracts: [], events: [], timeline: [], invoices: [], last_contacted_at: null } },
    [`/sales/deals/${DEAL}/tasks`]: { data: [] },
    '/sales/summary': { data: { total: 1, open: { count: 1, value_cents: 50000 } } },
    '/sales/contacts': { data: [] }, '/sales/templates': { data: [] }, '/sales/services': { data: [] }, '/sales/receivables': { data: { items: [], total_cents: 0 } },
    '/identity': { data: { business_name: 'Test Studio' } },
  };
  test('five reasons to pick from, your own words still welcome, sent with the move', async ({ page }) => {
    let moved: unknown = null;
    await installApp(page, { api: PIPE });
    await page.route(`**/functions/v1/presence/sales/deals/${DEAL}/stage`, (route) => { moved = route.request().postDataJSON(); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{}}' }); });
    await page.goto(`/pipeline.html?deal=${DEAL}`);
    await page.getByRole('button', { name: 'Mark as lost (not a fit)' }).click();
    const box = page.getByLabel(/^Reason \(optional\)/);
    await expect(box).toHaveAttribute('list', 'lostReasons');
    expect(await page.locator('#lostReasons option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))).toEqual(['Price', 'Timing', 'Went with someone else', 'No reply', 'Not a fit for us']);
    await box.fill('Price');
    await page.locator('#lostForm').getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => moved).toEqual({ to: 'lost', reason: 'Price' });
  });
});
