import { test, expect, type Page } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// List item 96 (Nov 8 2026): Home and the Inbox say how old a waiting item is and let
// the studio clear the stale ones; the platform's health line leaves the studio's Home
// for the account menu (staff only); Home is titled Home; roles and plans read as
// words; the client card has one way back; Help describes the menu its reader has.

const CLIENT_SITE = 'a1a1a1a1-0000-4000-8000-000000000001';
const ctx = (over: Record<string, unknown> = {}) => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null, ...over,
} });
const OLD_ROWS = [
  { key: 'enquiry:e-old', kind: 'enquiry', site_id: CLIENT_SITE, client_id: null, name: 'Harbor Cafe', what: 'new enquiry from Ana', when: '3 months ago · Contact form', verb: 'Reply', href: '/inbox.html#enquiries' },
  { key: 'support:s-old', kind: 'support', site_id: null, client_id: null, name: 'Bright Dental', what: 'support request: Logo', when: 'Opened 4 months ago', verb: 'Reply', href: '/inbox.html#support' },
  { key: 'enquiry:e-new', kind: 'enquiry', site_id: CLIENT_SITE, client_id: null, name: 'Harbor Cafe', what: 'new enquiry from Ben', when: '6 days ago · Contact form', verb: 'Reply', href: '/inbox.html#enquiries' },
];
const needs = (old: { count: number; items: unknown[] }) => ({ data: {
  rows: OLD_ROWS, more: 0, rest: [], total: OLD_ROWS.length, empty_line: '', partial: false, own_site: true, next_by_site: {}, next_by_client: {}, old,
} });
const OLD = { count: 2, items: [{ kind: 'enquiry', site_id: CLIENT_SITE, ids: ['e-old'] }, { kind: 'support', site_id: null, ids: ['s-old'] }] };
const HOME = {
  '/portal/context': ctx(),
  '/agency/needs-you': needs(OLD),
  '/agency/me': { data: { agency: 'Bright Studio', role: 'account_manager', plan: 'agency', branding: {}, email: 'am@example.com', member_id: 'm1' } },
  '/agency/portfolio': { data: [] }, '/agency/kits': { data: [] }, '/studio/customers': { data: [] },
  '/sales/summary': { data: { total: 0, open: { count: 0, value_cents: 0 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: { outstanding_cents: 0, count: 0, overdue_count: 0 } } },
  '/sales/deals': { data: [] }, '/sales/receivables': { data: { items: [], total_cents: 0 } }, '/sales/my-tasks': { data: { partial: false, total: 0, items: [] } },
};
const HEALTH = { data: { overall: 'attention', areas: [
  { key: 'domains', label: 'Domains', state: 'attention', detail: '1 expiring.' }, { key: 'cron', label: 'Scheduled operations', state: 'ok', detail: 'Running.' }, { key: 'billing', label: 'Billing', state: 'attention', detail: '1 with trouble.' },
] } };

type Write = { method: string; path: string; scope: string; body: unknown };
const recordWrites = async (page: Page) => {
  const writes: Write[] = [];
  const take = (route: import('@playwright/test').Route) => {
    const r = route.request();
    writes.push({ method: r.method(), path: new URL(r.url()).pathname.replace(/^.*\/functions\/v1\/presence/, ''), scope: r.headers()['x-dds-scope-site'] || '', body: r.postDataJSON() });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) });
  };
  await page.route('**/functions/v1/presence/forms/inbox/**', take);
  await page.route('**/functions/v1/presence/support/**', take);
  return writes;
};
const openMenu = async (page: Page) => { await page.locator('#dds-profile').click(); return page.locator('.dds-pop'); };

test.describe('item 96 — Home', () => {
  test('Home is titled Home, the role reads in words, and the platform line is gone', async ({ page }) => {
    await installApp(page, { api: { ...HOME, '/admin/health-center': HEALTH } });
    await page.goto('/agency.html');
    await expect(page.locator('#needs')).toContainText('Harbor Cafe');
    await expect(page).toHaveTitle('Home — Studio OS');
    await expect(page.locator('.rolebadge')).toHaveText('● Account manager');
    await expect(page.locator('#top')).not.toContainText('Platform');
    await expect(page.locator('#healthDoor')).toHaveCount(0);
  });

  test('Needs you says how many have waited over a month; Clear asks first, then clears each the Inbox’s way', async ({ page }) => {
    await installApp(page, { api: HOME });
    const writes = await recordWrites(page);
    const fresh: string[] = [];
    page.on('request', (r) => { if (r.url().includes('/agency/needs-you?fresh=1')) fresh.push(r.url()); });
    await page.goto('/agency.html');
    const line = page.locator('#needsOld');
    await expect(line).toHaveText('2 of these have waited over a month. Clear them');
    // a change of mind changes nothing
    await page.locator('#needsClearOld').click();
    await expect(page.locator('.dds-confirm')).toContainText('Clear 2 items older than a month?');
    await page.locator('.dds-confirm .no').click();
    await page.waitForTimeout(300);
    expect(writes).toEqual([]);
    // yes: the client's enquiry is marked read inside that client's account, the support request closed
    await page.locator('#needsClearOld').click();
    await page.locator('.dds-confirm .go').click();
    await expect.poll(() => writes.length).toBe(2);
    expect(writes).toContainEqual({ method: 'POST', path: '/forms/inbox/e-old', scope: CLIENT_SITE, body: { status: 'read' } });
    expect(writes).toContainEqual({ method: 'PATCH', path: '/support/s-old', scope: '', body: { status: 'closed' } });
    await expect.poll(() => fresh.length).toBe(1);   // and the list is read again, fresh
  });

  test('nothing over a month old: no line, no Clear', async ({ page }) => {
    await installApp(page, { api: { ...HOME, '/agency/needs-you': needs({ count: 0, items: [] }) } });
    await page.goto('/agency.html');
    await expect(page.locator('#needs')).toContainText('Harbor Cafe');
    await expect(page.locator('#needsOld')).toHaveCount(0);
  });

  test('one Back to studio inside a client', async ({ page }) => {
    await installApp(page, { api: { ...HOME, '/portal/context': ctx({ scope: { site_id: CLIENT_SITE, name: 'Harbor Cafe' } }) } });
    await page.goto(`/presence.html?client=${CLIENT_SITE}`);
    const bar = page.locator('#dds-ctxbar');
    await expect(bar).toBeVisible();
    await expect(bar.locator('a')).toHaveText(['Back to studio']);
    await expect(bar.locator('a')).toHaveAttribute('href', '/agency.html');
  });
});

test.describe('item 96 — the account menu', () => {
  test('the role and the plan in words, not codes', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    const pop = await openMenu(page);
    await expect(pop.locator('.who .r')).toHaveText('Owner · Studio OS plan');
  });

  test('platform health sits here for staff, with its count', async ({ page }) => {
    await installApp(page, { api: { ...HOME, '/portal/context': ctx({ is_operator: true }), '/admin/health-center': HEALTH } });
    await page.goto('/agency.html');
    const pop = await openMenu(page);
    const row = pop.locator('#dds-health-row');
    await expect(row).toHaveAttribute('href', '/admin-health.html');
    await expect(row).toContainText('Platform health');
    await expect(row).toContainText('2 areas need a look');
  });

  test('…and never for anyone else', async ({ page }) => {
    await installApp(page, { api: { ...HOME, '/admin/health-center': HEALTH } });
    await page.goto('/agency.html');
    const pop = await openMenu(page);
    await expect(pop).toContainText('Sign out');
    await expect(pop.locator('#dds-health-row')).toHaveCount(0);
  });
});

test.describe('item 96 — the Inbox and Help', () => {
  test('the Inbox says how many waiting enquiries are over a month old', async ({ page }) => {
    const long = new Date(Date.now() - 45 * 86400000).toISOString(), recent = new Date(Date.now() - 2 * 86400000).toISOString();
    await installApp(page, { api: { '/forms/inbox': { data: { submissions: [
      { id: 'l1', form_kind: 'contact', name: 'Sam Rivera', email: 'sam@example.com', message: 'Hello', status: 'new', created_at: long },
      { id: 'l2', form_kind: 'contact', name: 'Ada Park', email: 'ada@example.com', message: 'Hi', status: 'new', created_at: recent },
    ] } } } });
    await page.goto('/inbox.html#enquiries');
    await expect(page.locator('#lmeta')).toContainText('2 enquiries · 2 new, 1 over a month old');
  });

  test('Help shows a studio the menu it has, starting at Home', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': ctx() } });
    await page.goto('/help.html');
    await page.locator('#a-around summary').click();
    await expect(page.locator('#map-studio')).toBeVisible();
    await expect(page.locator('#map-owner')).toBeHidden();
    await expect(page.locator('#map-studio a', { hasText: 'Home' })).toHaveAttribute('href', '/agency.html');
  });

  test('…and an owner the owner’s, with Customers where the menu has it', async ({ page }) => {
    await installApp(page);
    await page.goto('/help.html');
    await page.locator('#a-around summary').click();
    await expect(page.locator('#map-owner')).toBeVisible();
    await expect(page.locator('#map-studio')).toBeHidden();
    await expect(page.locator('#map-owner a', { hasText: 'Customers' })).toHaveAttribute('href', '/customers.html');
  });
});
