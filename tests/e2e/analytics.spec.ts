import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp } from './helpers/app';

// Slice 8 — analytics.html is the Business dashboard: the Salesforce Lightning
// "Reports & Dashboards" treatment. Two bands (Sales · Your website), an
// "As of" + Refresh header, a session-only Period chip, and per-widget
// honesty: null aggregates render illustration empty states, never fake zeros.
const DASH = { data: {
  period: 'this_month',
  generated_at: '2026-07-17T14:14:00Z',
  sales: {
    pipeline: { open: { count: 7, value_cents: 1240000 }, stages: [
      { stage: 'lead', label: 'New lead', count: 3, value_cents: 520000 },
      { stage: 'qualified', label: 'Qualified', count: 2, value_cents: 360000 },
      { stage: 'proposal', label: 'Proposal sent', count: 1, value_cents: 240000 },
      { stage: 'contract', label: 'Agreement out', count: 1, value_cents: 120000 },
    ] },
    won: { this_month: { count: 2, value_cents: 385000 }, last_month: { count: 1, value_cents: 145000 } },
    enquiries: { count: 9, unanswered: 3, weekly: [2, 1, 3, 2, 4, 3, 5, 4, 6, 5, 7, 6] },
    support: { open: 4, oldest_age_days: 2 },
    invoices: { paid_cents: 270000, sent_cents: 90000, overdue_cents: 25000, outstanding_cents: 115000, paid_count: 3, sent_count: 1, overdue_count: 1 },
    recent_wins: [
      { title: 'Patio rebuild — Sam R.', value_cents: 240000, closed_at: '2026-07-12T00:00:00Z' },
      { title: 'Site refresh — Marlow’s', value_cents: 145000, closed_at: '2026-07-03T00:00:00Z' },
    ],
  },
  website: {
    traffic: {
      visitors: 214, pageviews: 512, actions: 11,
      top_pages: [{ path: '/', views: 231 }, { path: '/services', views: 104 }, { path: '/contact', views: 54 }],
      top_sources: [{ source: 'Google', visits: 88, share: 41 }, { source: 'Direct', visits: 64, share: 30 }, { source: 'Instagram', visits: 34, share: 16 }],
      weekly: [10, 12, 11, 14, 13, 16, 15, 18, 17, 20, 19, 22],
      has_data: true,
    },
    search: { clicks: 38, impressions: 4100, period: '2026-06', top_terms: [
      { term: 'patio builder near me', clicks: 14, impressions: 890 },
      { term: 'davis landscaping', clicks: 11, impressions: 320 },
    ] },
  },
} };

// A visibly different second period, to prove the chip re-fetches + re-renders.
const DASH_30 = JSON.parse(JSON.stringify(DASH));
DASH_30.data.period = 'last_30';
DASH_30.data.sales.pipeline.open = { count: 9, value_cents: 9990000 };   // $99,900
DASH_30.data.website.traffic.visitors = 999;

// Everything-null: the dashboard must render honestly with no data at all.
const DASH_EMPTY = { data: {
  period: 'this_month', generated_at: '2026-07-17T14:14:00Z',
  sales: { pipeline: null, won: null, enquiries: null, support: null, invoices: null, recent_wins: [] },
  website: { traffic: null, search: null },
} };

test.describe('Analytics (Business dashboard)', () => {
  test('renders both bands with KPI values and the stage funnel', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH } });
    await page.goto('/analytics.html');
    await expect(page.locator('#dds-shell .dds-nav')).toContainText('Analytics');
    await expect(page.getByRole('heading', { name: 'Business dashboard' })).toBeVisible();
    await expect(page.getByText(/^As of /)).toBeVisible();
    // both bands
    await expect(page.getByRole('heading', { name: 'Sales', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your website', exact: true })).toBeVisible();
    // Sales KPIs
    await expect(page.getByText('$12,400', { exact: true })).toBeVisible();   // open pipeline
    await expect(page.getByText('7 open deals')).toBeVisible();
    await expect(page.getByText('$3,850', { exact: true })).toBeVisible();    // won this month
    await expect(page.getByText('↑ vs last month')).toBeVisible();
    await expect(page.getByText('3 not yet answered')).toBeVisible();
    await expect(page.getByText('oldest waiting 2 days')).toBeVisible();
    // funnel rows carry label + value·count as real text
    await expect(page.getByText('New lead', { exact: true })).toBeVisible();
    await expect(page.getByText('$5,200 · 3')).toBeVisible();
    await expect(page.getByText('$3,600 · 2')).toBeVisible();
    // Website KPIs + tables
    await expect(page.getByText('214', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('512 page views')).toBeVisible();
    await expect(page.getByText('41% of visits')).toBeVisible();
    await expect(page.getByText('patio builder near me')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Patio rebuild — Sam R.' })).toBeVisible();
    // invoices donut hole total is real DOM text
    await expect(page.getByText('$1,150', { exact: true })).toBeVisible();
    await expect(page.getByText('Overdue · $250')).toBeVisible();
    // charts are SVG (no canvas), hidden from AT — the values are text elsewhere
    await expect(page.locator('canvas')).toHaveCount(0);
    expect(await page.locator('.cb svg[aria-hidden="true"]').count()).toBeGreaterThan(3);
  });

  test('the Period chip is a real popup and switches the data (session-only)', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH } });
    await page.route('**/functions/v1/presence/analytics/dashboard**', (route) => {
      const period = new URL(route.request().url()).searchParams.get('period');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(period === 'last_30' ? DASH_30 : DASH) });
    });
    await page.goto('/analytics.html');
    await expect(page.getByText('$12,400', { exact: true })).toBeVisible();
    const chip = page.locator('#periodBtn');
    await expect(chip).toContainText('This month');            // opens unfiltered (default)
    await expect(chip).toHaveAttribute('aria-expanded', 'false');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#periodMenu')).toBeVisible();
    await page.locator('#periodMenu [data-period="last_30"]').click();
    await expect(page.getByText('$99,900', { exact: true })).toBeVisible();  // re-fetched
    await expect(page.getByText('999', { exact: true }).first()).toBeVisible();
    await expect(page.locator('#periodBtn')).toContainText('Last 30 days');
    // Escape closes the reopened menu and returns focus to the chip
    await page.locator('#periodBtn').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#periodMenu')).toBeHidden();
    await expect(page.locator('#periodBtn')).toBeFocused();
    // outside click closes too
    await page.locator('#periodBtn').click();
    await expect(page.locator('#periodMenu')).toBeVisible();
    await page.getByRole('heading', { name: 'Business dashboard' }).click();
    await expect(page.locator('#periodMenu')).toBeHidden();
  });

  test('Refresh re-fetches the dashboard route', async ({ page }) => {
    let calls = 0;
    await installApp(page, { api: { '/analytics/dashboard': DASH } });
    await page.route('**/functions/v1/presence/analytics/dashboard**', (route) => {
      calls++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DASH) });
    });
    await page.goto('/analytics.html');
    await expect(page.getByText('$12,400', { exact: true })).toBeVisible();
    expect(calls).toBe(1);
    await page.getByRole('button', { name: '↻ Refresh' }).click();
    await expect.poll(() => calls).toBe(2);
    await expect(page.getByText('$12,400', { exact: true })).toBeVisible();
  });

  test('null aggregates render empty states — the invoices card hides, nothing fakes a zero', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH_EMPTY } });
    await page.goto('/analytics.html');
    await expect(page.getByRole('heading', { name: 'Business dashboard' })).toBeVisible();
    // invoices: null → the card is not rendered at all
    await expect(page.getByRole('heading', { name: 'Invoices' })).toHaveCount(0);
    // GSC not connected → honest empty state with a connect path, no invented number
    await expect(page.getByText('Not measured yet').first()).toBeVisible();
    await expect(page.getByText('Connect Search Console to see your Google numbers.')).toBeVisible();
    // widget empty states are headed (SLDS illustration pattern)
    await expect(page.getByText('No open deals')).toBeVisible();
    await expect(page.getByText('No enquiries yet')).toBeVisible();
    await expect(page.getByText('No visits yet').first()).toBeVisible();
  });

  test('deploy-order tolerance: a 404 from an old function is a calm warming-up state', async ({ page }) => {
    await installApp(page);
    await page.route('**/functions/v1/presence/analytics/dashboard**', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) }));
    await page.goto('/analytics.html');
    await expect(page.getByText('This dashboard is warming up.')).toBeVisible();
    await expect(page.getByText('try again shortly')).toBeVisible();
  });

  test('forwards the scope header (SC-1) on its dashboard call', async ({ page }) => {
    const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    let sentScope = '';
    await installApp(page, { api: { '/analytics/dashboard': DASH } });
    await page.route('**/functions/v1/presence/analytics/dashboard**', (route) => {
      sentScope = route.request().headers()['x-dds-scope-site'] || '';
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DASH) });
    });
    await page.goto(`/analytics.html?client=${CLIENT}`);
    await expect(page.getByText('$12,400', { exact: true })).toBeVisible();
    expect(sentScope).toBe(CLIENT);
    // drill links carry the scope through to the report surfaces
    await expect(page.getByRole('link', { name: 'View pipeline →' }).first()).toHaveAttribute('href', `/pipeline.html?client=${CLIENT}`);
  });

  test('mobile: the grid stacks to a single column', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'stacking is a phone-width concern');
    await installApp(page, { api: { '/analytics/dashboard': DASH } });
    await page.goto('/analytics.html');
    await expect(page.getByText('$12,400', { exact: true })).toBeVisible();
    const cards = page.locator('.grid > .card');
    const first = await cards.nth(0).boundingBox();
    const second = await cards.nth(1).boundingBox();
    expect(first && second && Math.abs(first.x - second.x) < 2).toBeTruthy();   // same left edge → stacked
    expect(second!.y).toBeGreaterThan(first!.y + first!.height - 2);            // below, not beside
  });

  test('no serious/critical axe violations on the dashboard', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once, on desktop');
    await installApp(page, { api: { '/analytics/dashboard': DASH } });
    await page.goto('/analytics.html');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Business dashboard' })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(serious.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
  });
});
