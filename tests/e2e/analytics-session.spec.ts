import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Bug hunt C (Nov 10 2026), Analytics.
// C8  the sign-in pass is renewed about every hour; the page now keeps the renewed one
//     (as Inbox, Projects and Send an update do), so Refresh after an hour isn't
//     refused and read as "Sign in to see your analytics"
// C13 a Refresh that fails keeps the last good reports: the tabs still switch

const DASH = { data: {
  period: 'this_month', generated_at: '2026-07-17T14:14:00Z',
  sales: { pipeline: null, won: null, enquiries: null, support: null, invoices: null, recent_wins: [] },
  website: { traffic: null, search: null },
} };
const REPORTS = { data: {
  generated_at: '2026-11-09T16:00:00Z',
  revenue: { months: [], total_this_year: 0, total_last_year: 0 },
  pipeline: { rows: [{ stage: 'lead', label: 'New lead', count: 2, value_cents: 330000, chance: 10, expected_cents: 33000, avg_days: 4, longest_days: 9, longest_title: 'Maple & Main' }], count: 2, value_cents: 330000, expected_cents: 33000, partial: false },
  outcomes: { window_days: 365, won: { count: 0, value_cents: 0 }, lost: { count: 0, value_cents: 0 }, win_rate_pct: null, won_by_source: [], won_by_found_via: [], lost_by_reason: [], days_to_close: null },
  enquiries: { rows: [{ source: '/contact', last_30: 4, last_365: 31, became_deals: 9 }], last_30: 4, last_365: 31, became_deals: 9 },
  overdue: { rows: [], total_cents: 0 },
} };
// the shared stub keeps no auth listener; this one does, so a test can renew the pass
const AUTH_STUB = `window.supabase = { createClient: function () { return { auth: {
  getSession: async function () { return { data: { session: window.__E2E_SESSION || null } }; },
  getUser: async function () { return { data: { user: (window.__E2E_SESSION || {}).user || null } }; },
  onAuthStateChange: function (cb) { (window.__authCbs = window.__authCbs || []).push(cb); return { data: { subscription: { unsubscribe: function () {} } } }; },
  signOut: async function () { return { error: null }; },
} }; } };`;
const json = (status: number, body: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function analytics(page: Page) {
  const state = { refuse: '' as string, failDash: false, failReports: false, jwts: [] as string[] };
  await installApp(page, { api: { '/sales/reports': REPORTS } });
  await page.route(/@supabase\/supabase-js|\/vendor\/supabase-js/, (route) => route.fulfill({ contentType: 'application/javascript', body: AUTH_STUB }));
  await page.route((u) => /\/presence\/(analytics\/dashboard|sales\/reports)$/.test(u.pathname), (route) => {
    const jwt = route.request().headers()['x-dds-user-jwt'] || '';
    const dash = route.request().url().includes('/analytics/dashboard');
    if (dash) state.jwts.push(jwt);
    if (state.refuse && jwt === state.refuse) return route.fulfill(json(401, { error: 'unauthorized' }));
    if (dash) return route.fulfill(state.failDash ? json(500, {}) : json(200, DASH));
    return route.fulfill(state.failReports ? json(500, {}) : json(200, REPORTS));
  });
  return state;
}

test.describe('Analytics — the renewed sign-in pass (bug hunt C8)', () => {
  test('after the pass is renewed, Refresh uses the new one and stays signed in', async ({ page }) => {
    const state = await analytics(page);
    await page.goto('/analytics.html');
    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
    expect(state.jwts.at(-1)).toBe('e2e-token');
    // an hour on: the first pass is refused, and the client has renewed it in the background
    state.refuse = 'e2e-token';
    await page.evaluate(() => { for (const cb of (window as unknown as { __authCbs?: Array<(e: string, s: unknown) => void> }).__authCbs || []) cb('TOKEN_REFRESHED', { access_token: 'renewed-token' }); });
    await page.locator('#refreshBtn').click();
    await expect.poll(() => state.jwts.at(-1)).toBe('renewed-token');
    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
    await expect(page.locator('#main')).not.toContainText('Sign in to see your analytics');
  });
});

test.describe('Analytics — a Refresh that fails keeps the last good reports (bug hunt C13)', () => {
  test('the whole Refresh fails: the tabs still switch', async ({ page }) => {
    const state = await analytics(page);
    await page.goto('/analytics.html');
    await expect(page.locator('#rt-revenue')).toBeVisible();
    state.failDash = true; state.failReports = true;
    await page.locator('#refreshBtn').click();
    await expect(page.locator('.dds-toast', { hasText: 'Couldn’t refresh just now.' })).toBeVisible();
    await page.locator('#rt-enquiries').click();
    await expect(page.locator('#rt-enquiries')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#repPrint')).toContainText('Enquiries by page');
    await expect(page.locator('#repPrint')).toContainText('/contact');
  });

  test('the numbers refresh but the reports don’t: the last good reports stay, with their time', async ({ page }) => {
    const state = await analytics(page);
    await page.goto('/analytics.html');
    await expect(page.locator('#rt-revenue')).toBeVisible();
    state.failReports = true;
    await page.locator('#refreshBtn').click();
    await expect(page.locator('#reportsBody')).not.toContainText('Your reports couldn’t load just now');
    await page.locator('#rt-pipeline').click();
    await expect(page.locator('#repPrint')).toContainText('Deals by stage');
    await expect(page.locator('#repPrint .rep-foot')).toContainText('Figures as of');
    // and when they can be read again, the next Refresh reads them
    state.failReports = false;
    const again = page.waitForRequest((r) => r.url().endsWith('/sales/reports'));
    await page.locator('#refreshBtn').click();
    await again;
  });

  test('the first read failing still says so (there is nothing older to keep)', async ({ page }) => {
    const state = await analytics(page);
    state.failReports = true;
    await page.goto('/analytics.html');
    await expect(page.locator('#reportsBody')).toContainText('Your reports couldn’t load just now');
  });
});
