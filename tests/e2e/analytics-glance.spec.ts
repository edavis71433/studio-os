import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Bold redesign — Analytics (Nov 2026). The studio's own numbers lead the page:
// revenue this month against last, the win rate, days to close (the median of
// the latest wins) and what the open deals are expected to bring in; then
// revenue by month against the year before, the pipeline as it stands, where
// wins come from, and the five reports one click away. All of it is the one
// /sales/reports read the reports below already make. A number the read can't
// give says so; it is never a zero. The customers' roll-up follows.

const AGENCY_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: true, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null,
} };
const PORTFOLIO = { data: { headline: 'Across 2 customers, here’s what stands out.', client_count: 2, insights: [], websites: [
  { name: 'Juniper Floral Co.', draft_live: 'live', leads_waiting: 1, needs_attention: false },
  { name: 'Blue Finch Café', draft_live: 'live', leads_waiting: 0, needs_attention: false },
] } };
const ROSTER = { data: [
  { site_id: 's1', name: 'Juniper Floral Co.', edition: 'presence', status: 'live', attention: 0, leads_waiting: 1 },
  { site_id: 's2', name: 'Blue Finch Café', edition: 'presence', status: 'live', attention: 0, leads_waiting: 0 },
] };
const PAID = [120000, 95000, 180000, 210000, 160000, 260000, 190000, 310000, 240000, 280000, 50000, 195000];
const LAST = [80000, 70000, 140000, 150000, 175000, 160000, 150000, 210000, 200000, 220000, 160000, 170000];
const months = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(Date.UTC(2025, 11 + i, 1));
  const m = d.toISOString().slice(0, 7);
  return { month: m, label: d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) + ' ' + m.slice(0, 4), this_year: PAID[i], last_year: LAST[i] };
});
const REPORTS = { data: {
  generated_at: '2026-11-09T16:00:00Z',
  revenue: { months, total_this_year: PAID.reduce((a, b) => a + b, 0), total_last_year: LAST.reduce((a, b) => a + b, 0) },
  pipeline: { rows: [
    { stage: 'lead', label: 'New lead', count: 2, value_cents: 330000, chance: 10, expected_cents: 33000, avg_days: 4, longest_days: 9, longest_title: 'Maple & Main' },
    { stage: 'qualified', label: 'Qualified', count: 2, value_cents: 320000, chance: 25, expected_cents: 80000, avg_days: 11, longest_days: 16, longest_title: 'Juniper Floral' },
    { stage: 'proposal', label: 'Proposal sent', count: 1, value_cents: 185000, chance: 50, expected_cents: 92500, avg_days: 5, longest_days: 5, longest_title: 'Blue Finch' },
    { stage: 'contract', label: 'Agreement out', count: 1, value_cents: 140000, chance: 75, expected_cents: 105000, avg_days: 1, longest_days: 1, longest_title: 'Harbor Dental' },
  ], count: 6, value_cents: 975000, expected_cents: 310500, partial: false },
  outcomes: { window_days: 365, won: { count: 5, value_cents: 790000 }, lost: { count: 1, value_cents: 60000 }, win_rate_pct: 83,
    won_by_source: [{ label: 'Website enquiry', count: 2, value_cents: 390000 }, { label: 'Added by hand', count: 3, value_cents: 400000 }],
    won_by_found_via: [{ label: 'A referral', count: 3, value_cents: 545000 }, { label: 'Your website', count: 1, value_cents: 195000 }, { label: 'Google', count: 1, value_cents: 50000 }],
    lost_by_reason: [{ label: 'Timing', count: 1, value_cents: 60000 }],
    days_to_close: { median_days: 19, count: 5, prior_median_days: 23 } },
  enquiries: { rows: [{ source: '/contact', last_30: 4, last_365: 31, became_deals: 9 }], last_30: 4, last_365: 31, became_deals: 9 },
  overdue: { rows: [{ id: 'i1', title: 'Balance', deal: 'Kestrel Yoga', amount_cents: 65000, due_date: '2026-10-31', days_overdue: 9 }], total_cents: 65000 },
} };
const API = { '/portal/context': AGENCY_CTX, '/analytics/portfolio': PORTFOLIO, '/agency/portfolio': ROSTER, '/sales/reports': REPORTS };
const nums = (page: Page) => page.locator('#glance .num');
const fresh = (page: Page) => page.addInitScript(() => { try { if (!sessionStorage.getItem('rep-cleared')) { localStorage.removeItem('dds-report'); sessionStorage.setItem('rep-cleared', '1'); } } catch { /* denied */ } });
const withReports = (patch: Record<string, unknown>) => ({ ...API, '/sales/reports': { data: { ...REPORTS.data, ...patch } } });

test.describe('Analytics — the studio’s numbers lead (bold redesign)', () => {
  test('four plain numbers, revenue against the year before, the pipeline, where wins come from', async ({ page }) => {
    await fresh(page);
    await installApp(page, { api: API });
    await page.goto('/analytics.html');
    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
    await expect(page.locator('.subline')).toContainText('How the studio is doing — in plain numbers.');
    await expect(nums(page)).toHaveCount(4);
    await expect(nums(page).nth(0)).toContainText('Revenue · Nov');
    await expect(nums(page).nth(0).locator('.num-v')).toHaveText('$1,950');
    await expect(nums(page).nth(0)).toContainText('$22,900 in the last 12 months');
    await expect(nums(page).nth(1).locator('.num-v')).toHaveText('83%');
    await expect(nums(page).nth(1)).toContainText('5 won · 1 not a fit');
    await expect(nums(page).nth(2).locator('.num-v')).toHaveText('19');
    await expect(nums(page).nth(2)).toContainText('median, last 5 wins');
    await expect(nums(page).nth(3).locator('.num-v')).toHaveText('$3,105');
    await expect(nums(page).nth(3)).toContainText('6 open deals × their chance');
    // the chart's numbers are in its label; the totals in its note
    await expect(page.locator('svg.rev12')).toHaveAttribute('aria-label', /Nov 2026 \$1,950 \(a year before \$1,700\)/);
    await expect(page.locator('#glance .chartnote')).toContainText('last 12 months $22,900 · the year before $18,850');
    // the pipeline as it stands, and where wins come from (by how they found you)
    await expect(page.locator('#glance .gb-pipe')).toHaveText([/New lead · 2\s*\$3,300/, /Qualified · 2\s*\$3,200/, /Proposal sent · 1\s*\$1,850/, /Agreement out · 1\s*\$1,400/]);
    await expect(page.locator('#glance .gwins li').first()).toContainText('A referral');
    await expect(page.locator('#glance .gwins li').first()).toContainText('3 wins · $5,450');
    // the customers follow, under their own heading
    await expect(page.locator('.bandsub .chip')).toHaveText('All customers');
    await expect(page.getByText('Across 2 customers, here’s what stands out.')).toBeVisible();
  });

  test('the changes say which way: more revenue than last month, closing faster', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'a phone keeps the numbers alone (the chips step aside)');
    await installApp(page, { api: API });
    await page.goto('/analytics.html');
    await expect(nums(page).nth(0).locator('.dchip')).toHaveText('+$1,450 vs Oct');
    await expect(nums(page).nth(0).locator('.dchip')).toHaveClass(/good/);
    await expect(nums(page).nth(2).locator('.dchip')).toHaveText('−4 days');
    await expect(nums(page).nth(2).locator('.dchip')).toHaveClass(/good/);
  });

  test('a report link opens that report below, its tab focused', async ({ page }) => {
    await fresh(page);
    await installApp(page, { api: API });
    await page.goto('/analytics.html');
    const links = page.getByRole('group', { name: 'Open a report' }).getByRole('button');
    await expect(links).toHaveText([/Revenue by month/, /Deals by stage/, /Won and not a fit/, /Enquiries by page/, /Overdue invoices/]);
    await links.nth(1).click();
    await expect(page.locator('#rt-pipeline')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#rt-pipeline')).toBeFocused();
    await expect(page.getByRole('tabpanel').getByRole('heading', { name: 'Deals by stage' })).toBeVisible();
  });

  test('Print a report prints the report on its own', async ({ page }) => {
    await fresh(page);
    await page.addInitScript(() => { (window as any).__printed = []; window.print = () => { (window as any).__printed.push(document.body.getAttribute('data-print')); }; });
    await installApp(page, { api: API });
    await page.goto('/analytics.html');
    await expect(page.locator('#repPrint')).toBeVisible();
    await page.locator('#printRep').click();
    expect(await page.evaluate(() => (window as any).__printed)).toEqual(['report']);
  });

  test('honest when there is nothing to count, and never a zero for a failed read', async ({ page }) => {
    await installApp(page, { api: withReports({
      outcomes: { ...REPORTS.data.outcomes, win_rate_pct: null, won: { count: 0, value_cents: 0 }, lost: { count: 0, value_cents: 0 }, won_by_found_via: [], won_by_source: [], days_to_close: { median_days: null, count: 0, prior_median_days: null } },
      revenue: { unavailable: true },
    }) });
    await page.goto('/analytics.html');
    await expect(nums(page).nth(0)).toContainText('Couldn’t load just now');
    await expect(nums(page).nth(1)).toContainText('No deals closed in the last 12 months');
    await expect(nums(page).nth(2)).toContainText('No wins to count yet');
    await expect(page.locator('#glance .gl-rev')).toContainText('This chart couldn’t load just now');
    await expect(page.locator('#glance')).toContainText('No wins yet');
    // the whole read failing: the studio's numbers say so, and no number is drawn
    await page.route('**/functions/v1/presence/sales/reports', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
    await page.reload();
    await expect(page.locator('#glance')).toContainText('Your studio’s numbers couldn’t load just now');
    await expect(nums(page)).toHaveCount(0);
  });

  test('an older server without days to close shows what is overdue in its place', async ({ page }) => {
    const { days_to_close: _gone, ...older } = REPORTS.data.outcomes;
    await installApp(page, { api: withReports({ outcomes: older }) });
    await page.goto('/analytics.html');
    await expect(nums(page).nth(2)).toContainText('Overdue');
    await expect(nums(page).nth(2).locator('.num-v')).toHaveText('$650');
    await expect(nums(page).nth(2)).toContainText('1 invoice past due');
  });

  test('a phone: two by two, six months in the chart, the reports a list', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone layout under test');
    await installApp(page, { api: API });
    await page.goto('/analytics.html');
    await expect(nums(page)).toHaveCount(4);
    const [a, b, c] = await Promise.all([0, 1, 2].map((i) => nums(page).nth(i).boundingBox()));
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);          // side by side
    expect(c!.y).toBeGreaterThan(a!.y + a!.height - 1);      // the next row
    await expect(page.locator('svg.rev6')).toBeVisible();
    await expect(page.locator('svg.rev12')).toBeHidden();
    const rl = page.locator('.replinks .rl');
    const [r0, r1] = await Promise.all([rl.nth(0).boundingBox(), rl.nth(1).boundingBox()]);
    expect(r1!.y).toBeGreaterThan(r0!.y + r0!.height - 2);   // a list, one under the other
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('inside a client there is no studio glance (the studio’s own sales aren’t theirs)', async ({ page }) => {
    await installApp(page, { api: { ...API, '/analytics/dashboard': { data: { period: 'this_month', generated_at: '2026-11-09T16:00:00Z', sales: { pipeline: null, won: null, enquiries: null, support: null, invoices: null, recent_wins: [] }, website: { traffic: null, search: null } } } } });
    await page.goto('/analytics.html?client=aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('#glance')).toHaveCount(0);
  });

  test('no serious/critical axe violations with the studio’s numbers', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/analytics.html');
    await expect(nums(page)).toHaveCount(4);
    const r = await new AxeBuilder({ page }).include('#main').analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(', '))).toEqual([]);
  });
});
