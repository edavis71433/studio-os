import { test, expect, Page } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Sales item 120: the money shows everywhere. The client's portal names each invoice by
// its number and draws a part payment under the invoice it paid toward, with its own
// receipt, instead of as a second paid invoice; Analytics' revenue says it counts
// retainer payments. (Search by number is the server's: money_everywhere_120_test.mjs.)
const PID = '11111111-1111-4111-8111-111111111111';
const STUDIO = { name: 'Marlow & Co', logo_url: null, accent: '#8c3b2e', is_default: false };
const CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ['website', 'client_portal'], is_agency: false, is_operator: false, sees_full_workspace: true,
  is_client_portal: false, is_managed_client: true, capabilities: ['view_all'], landing: '/client.html', attention_count: 0,
  nav: [], studio: STUDIO, client_first_name: 'Maria',
} };
const ymd = (offsetDays: number) => {
  const t = new Date(Date.now() + offsetDays * 86400000);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};
const INVOICES = [
  { id: 'i13', number: '#0013', name: 'Website build', amount: 1000, status: 'open', due_date: ymd(5), created_at: '2026-11-04T15:00:00Z',
    pay_url: 'https://pay.example/i13', view_url: 'https://docs.example/i13', paid_so_far: 500, total: 1500,
    payments: [{ id: 'p1', amount: 500, paid_at: '2026-11-06T15:00:00Z', method: 'Check', view_url: 'https://docs.example/p1' }] },
  { id: 'i12', number: '#0012', name: 'Deposit', amount: 600, status: 'paid', paid_at: '2026-10-02T15:00:00Z', due_date: '2026-10-05', created_at: '2026-10-01T15:00:00Z', view_url: 'https://docs.example/i12' },
];
const API = {
  '/portal/context': CTX,
  '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
  '/client/notifications': { data: [], unread_count: 0 },
  '/client/projects': { data: [{ id: PID, name: 'Website build', status: 'active' }] },
  [`/client/projects/${PID}`]: { data: { project: { id: PID, name: 'Website build', status: 'active' }, milestones: [], tasks: [], events: [], surveys: [], progress: { total: 0, done: 0, pct: 0 }, deliverables: [], approvals: [] } },
  [`/client/projects/${PID}/report`]: { data: { summary: null } },
  [`/client/projects/${PID}/messages`]: { data: [] },
  '/client/documents': { data: { documents: [] } },
  '/client/billing': { data: { invoices: INVOICES, summary: { open_count: 1, paid_count: 1 } } },
  '/client/reports': { data: { reports: [] } },
  '/client/support': { data: [] },
  '/client/faq': { data: { html: '', faq: { items: [] } } },
  '/client/kit': { data: null },
};
const row = (page: Page, title: string) => page.locator('#shelf .srow', { has: page.getByRole('heading', { name: title, exact: true }) });

test.describe('sales item 120 — the money shows everywhere', () => {
  test('the portal names each invoice by its number, and a part payment sits under its invoice with its receipt', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/client.html');
    await page.locator('#tabnav [data-tab="documents"]').click();
    const wb = row(page, 'Website build');
    await expect(wb).toBeVisible();
    await expect(page.locator('#shelf .srow')).toHaveCount(2);   // the part payment is not a row of its own
    await expect(wb.locator('.fmeta')).toContainText('Invoice #0013');
    await expect(row(page, 'Deposit').locator('.fmeta')).toContainText('Invoice #0012');
    // what is left of the whole, wherever the page shows the amount
    const sz = page.viewportSize();
    const info = (sz && sz.width >= 1000) ? wb.locator('.sinfo') : wb.locator('.sline');
    await expect(info).toContainText('$1,000 left of $1,500');
    const parts = wb.getByRole('list', { name: 'Paid toward this invoice' });
    await expect(parts.getByRole('listitem')).toHaveCount(1);
    await expect(parts.getByRole('listitem')).toContainText(/Part payment · \$500 · paid Nov \d+ · check/);
    await expect(parts.getByRole('link', { name: 'Receipt for the part payment of $500' })).toHaveAttribute('href', 'https://docs.example/p1');
    // the rest can still be paid, and the line on top names the invoice by its number
    await expect(page.locator('#inv-unpaid .owet')).toHaveText('You owe $1,000');
    await expect(page.locator('#inv-unpaid .owes')).toContainText('Website build #0013 · due ');
    // the parts sit under the invoice's name, inside the row, and nothing runs off the screen
    const nameBox = await wb.getByRole('heading', { name: 'Website build' }).boundingBox();
    const partsBox = await parts.boundingBox();
    const rowBox = await wb.boundingBox();
    expect(nameBox && partsBox && rowBox).toBeTruthy();
    expect(partsBox!.y).toBeGreaterThan(nameBox!.y);
    expect(partsBox!.x + partsBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width + 1);
    // the icon, the name and the Pay button keep one line; only the parts go under them
    const iconBox = await wb.locator('.fico').boundingBox();
    const payBox = await wb.getByRole('link', { name: 'Pay — Website build' }).boundingBox();
    expect(Math.abs(iconBox!.y - nameBox!.y)).toBeLessThan(30);
    expect(payBox!.y).toBeLessThan(partsBox!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('Home\'s Needs you row for an unpaid invoice carries its number', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/client.html');
    await expect(page.locator('#main .qrow', { hasText: 'Website build' }).first()).toContainText('#0013 · $1,000');
  });

  test('Analytics: revenue says it counts retainer payments, and how much of it they were', async ({ page }) => {
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(2025, 11 + i, 1));
      const m = d.toISOString().slice(0, 7);
      return { month: m, label: d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) + ' ' + m.slice(0, 4), this_year: i === 11 ? 190000 : 0, last_year: 0, retainer: i === 11 ? 40000 : 0 };
    });
    const REPORTS = { data: { generated_at: '2026-11-08T14:00:00Z', revenue: { months, total_this_year: 190000, total_last_year: 0, retainer_this_year: 40000 },
      pipeline: { unavailable: true }, outcomes: { unavailable: true }, enquiries: { unavailable: true }, overdue: { unavailable: true } } };
    const DASH = { data: { period: 'this_month', generated_at: '2026-11-08T14:00:00Z', sales: { pipeline: null, won: null, enquiries: null, support: null, invoices: null, recent_wins: [] }, website: { traffic: null, search: null } } };
    const STUDIO_CTX = { data: {
      site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
      is_agency: true, is_operator: true, sees_full_workspace: true, is_client_portal: false,
      capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null,
    } };
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/analytics/dashboard': DASH, '/sales/reports': REPORTS, '/business-insights': { data: { groups: [] } } } });
    await page.goto('/analytics.html');
    await expect(page.locator('#glance .chartnote')).toHaveText('Paid invoices and retainer payments by the month they were paid · last 12 months $1,900, $400 of it from retainers · the year before $0');
    await expect(page.getByRole('tabpanel')).toContainText('Paid invoices and retainer payments by the month they were paid, beside the same month a year before.');
  });
});
