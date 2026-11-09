import { test, expect } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// Sales review, Nov 2026 — one "needs you" list and one Home for a studio:
//   item 11  at studio level the bell's number is Home's list total, and the
//            bell's Needs-you tab lists those same rows (not the nudges about
//            them); news (a payment landed) stays under Updates.
//   item 23  a studio account opening the old Home (today.html) is sent to
//            Customers (agency.html), which now carries Recent wins and the
//            Ask box. A client's Overview (?client=) and a plain owner keep it.

const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 3, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };
const ROWS = [
  { key: 'enquiry:own:e1', kind: 'enquiry', site_id: null, client_id: null, name: 'Harbor Lane Bakery', what: '3 new enquiries through your website', when: '2 days ago', verb: 'Reply', href: '/inbox.html#enquiries?sel=lead:e1' },
  { key: 'support:s1', kind: 'support', site_id: 's1', client_id: 'c1', name: 'Maple Street Studio', what: 'support request: can you update our hours', when: 'Opened Jul 22', verb: 'Reply', href: '/inbox.html#support?sel=sup:s1' },
  { key: 'deal:signed:d1', kind: 'deal', site_id: null, client_id: null, name: 'Willow Day Spa', what: 'signed the agreement — make them a customer', when: 'Agreement signed', verb: 'Convert', href: '/pipeline.html?deal=d1#convert' },
];
const NEEDS = { data: { rows: ROWS, more: 0, rest: [], total: 3, empty_line: '', partial: false, own_site: true, next_by_site: {}, next_by_client: {} } };
const FEED = { data: {
  role: 'business_owner', moments: [], pending_approvals: [], client_messages: [], enquiries: [],
  notices: [
    { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', kind: 'support_aging', period: 'support:s1:w2955', tier: 'needs_you', dismissible: true, headline: 'Waiting on you — can you update our hours', body: '', href: '/projects.html' },
    { id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', kind: 'invoice_paid', period: 'paid:i1', tier: 'update', dismissible: true, headline: 'Paid — Invoice ($500.00)', body: 'The payment landed.', href: '/pipeline.html' },
  ],
} };
const HOME_API = {
  '/portal/context': STUDIO_CTX,
  '/portal/feed': FEED,
  '/agency/needs-you': NEEDS,
  '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', plan: 'agency', branding: {} } },
  '/agency/portfolio': { data: [] },
  '/agency/kits': { data: [] },
  '/studio/customers': { data: [] },
  '/sales/summary': { data: { total: 1, open: { count: 0, value_cents: 0 }, won_month: { count: 1, value_cents: 195000 }, win_rate: { pct: 100, won: 1, lost: 0 }, by_stage: [], ar: { outstanding_cents: 0, count: 0, overdue_count: 0 } } },
  '/sales/deals': { data: [
    { id: 'd9', title: 'Willow Day Spa', stage: 'won', expected_value_cents: 195000, converted_client_id: null, updated_at: new Date(Date.now() - 3 * 86400000).toISOString() },
    { id: 'd8', title: 'An old win', stage: 'won', expected_value_cents: 50000, converted_client_id: 'c8', updated_at: '2025-01-01T00:00:00Z' },
  ] },
  '/sales/receivables': { data: { items: [], total_cents: 0 } },
};

test.describe('item 11 — one number, one list, at studio level', () => {
  test('the badge is Home\'s total; the bell\'s Needs-you tab lists Home\'s rows; news stays under Updates', async ({ page }) => {
    // final pass, batch D: the context hands back an older kept number (7, marked stale), so a
    // badge that kept the context's number reads 7 here, not Home's 3
    const stale = { data: { ...STUDIO_CTX.data, attention_count: 7, attention_stale: true } };
    await installApp(page, { api: { ...HOME_API, '/portal/context': stale } });
    await page.goto('/agency.html');
    await expect(page.locator('#needs .qhead')).toHaveText('Needs you · 3');
    await expect(page.locator('#dds-bell .dot')).toHaveText('3');
    await page.locator('#dds-bell').click();
    const pop = page.locator('.dds-bell-pop');
    await pop.getByRole('tab', { name: 'Needs you' }).click();
    const rows = pop.locator('.body a.row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Harbor Lane Bakery — 3 new enquiries through your website');
    await expect(rows.nth(2)).toContainText('Willow Day Spa — signed the agreement — make them a customer');
    await expect(rows.nth(2)).toHaveAttribute('href', '/pipeline.html?deal=d1#convert');
    await expect(pop).not.toContainText('Waiting on you');          // the nudge about a listed request is not a second row
    await pop.getByRole('tab', { name: 'Updates' }).click();
    await expect(pop.locator('.body')).toContainText('Paid — Invoice ($500.00)');
  });

  test('a plain owner (not a studio) keeps the feed-driven bell', async ({ page }) => {
    await installApp(page);
    await page.goto('/pipeline.html');
    await page.locator('#dds-bell').click();
    await expect(page.locator('.dds-bell-pop')).toContainText('A quote request is waiting for a reply');
  });
});

test.describe('item 23 — one Home for a studio', () => {
  test('a studio account on the old Home is sent to the new Home', async ({ page }) => {
    await installApp(page, { api: HOME_API });
    await page.goto('/today.html');
    await expect(page).toHaveURL(/\/agency\.html$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();   // final pass, batch C: headed Home, as the nav says
  });

  test('a plain owner keeps their Today', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    await expect(page.locator('#greeting')).toBeVisible();
    await expect(page).toHaveURL(/\/today\.html$/);
  });

  test('Home carries Recent wins (the last 90 days, each opening its deal) and the Ask box', async ({ page }) => {
    await installApp(page, { api: { ...HOME_API, '/concierge/ask': { data: { answer: 'Start with the signed agreement: make them a customer.', source_labels: ['Your pipeline'] } } } });
    await page.goto('/agency.html');
    const wins = page.locator('#recent-wins');
    await expect(wins).toBeVisible();
    await expect(wins.locator('a')).toHaveCount(1);                  // the 2025 win is past the window
    await expect(wins.locator('a').first()).toContainText('Willow Day Spa');
    await expect(wins.locator('a').first()).toHaveAttribute('href', '/pipeline.html?deal=d9');
    const ask = page.locator('#askSec');
    await expect(ask).toBeVisible();
    await ask.getByLabel('Ask a question').fill('what should I do first?');
    const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/concierge/ask'));
    await ask.getByRole('button', { name: 'Ask' }).click();
    expect(JSON.parse((await posted).postData() || '{}')).toEqual({ question: 'what should I do first?' });
    await expect(page.locator('#askAns')).toContainText('make them a customer');
    await expect(page.locator('#askAns')).toContainText('Your pipeline');
  });
});
