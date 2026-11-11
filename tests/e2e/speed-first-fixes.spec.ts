import { test, expect, type Page } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// The first speed fixes (Nov 10 2026 review, list items 167 to 169).
//  - The sign-in context (/portal/context) is asked once per visit: the shell
//    keeps the answer in the tab, so the next page draws its menu at once and
//    asks nothing. An older copy is read again behind the page; sign out and a
//    menu change drop it.
//  - Settings, Files and Analytics no longer ask for it a second time themselves.
//  - Settings runs its reads together and asks /agency/usage and /agency/nav once.
//  - Home starts its own reads with /agency/me, not after it.
//  - Files asks only for the list on a search or a filter click.
//  - Projects keeps each card's facts through a Refresh.

const ctx = (extra: Record<string, unknown> = {}) => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 3, attention_stale: false, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null, ...extra,
} });
const API = {
  '/portal/context': ctx(),
  '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', plan: 'agency', branding: {} } },
  '/agency/portfolio': { data: [] }, '/agency/kits': { data: [] }, '/studio/customers': { data: [] },
  '/sales/deals': { data: [] }, '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/agency/needs-you': { data: { rows: [], more: 0, rest: [], total: 3, empty_line: '', partial: false, own_site: true, next_by_site: {}, next_by_client: {} } },
  '/agency/members': { data: [] },
  '/agency/usage': { data: { seats: { used: 1, limit: 3 }, clients: { used: 1, limit: 5 } } },
  '/agency/nav': { data: { hidden: [], choices: [{ key: 'projects', label: 'Projects', what: 'The work you are doing for each client.' }] } },
  '/identity': { data: { business_name: 'Bright Studio', email: 'hello@bright.example' } },
  '/settings': { data: { industry_key: 'generic' } },
  '/assets/collections': { data: [] }, '/assets/health': { data: { findings: [] } },
  '/assets': { data: { assets: [{ id: 'a1', kind: 'image', title: 'Front door', filename: 'door.jpg', created_at: '2026-07-01T00:00:00Z' }], total: 1, policy: 'immediate' } },
};
const watch = (page: Page) => {
  const seen: string[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.includes('/functions/v1/presence/')) seen.push(u.pathname.replace(/^.*\/functions\/v1\/presence/, '') + u.search); });
  return seen;
};
const asked = (seen: string[], path: string) => seen.filter((s) => s === path || s.startsWith(path + '?')).length;
const ageKeptCopy = (page: Page, ms: number) => page.evaluate((by) => {
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i) || ''; if (!k.startsWith('dds-ctx:')) continue;
    const v = JSON.parse(sessionStorage.getItem(k) || '{}'); v.at -= by; sessionStorage.setItem(k, JSON.stringify(v));
  }
}, ms);

test.describe('who am I: asked once per visit', () => {
  test('the first page asks once; the next page of the visit draws its menu and asks nothing', async ({ page }) => {
    const seen = watch(page);
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await expect(page.locator('#dds-bell .dot')).toHaveText('3');
    expect(asked(seen, '/portal/context')).toBe(1);
    seen.length = 0;
    await page.goto('/customers.html');
    await expect(page.locator('#dds-bell .dot')).toHaveText('3');
    await expect(page.locator('#dds-nav, .dds-nav').first()).toContainText('Pipeline');
    await page.waitForTimeout(1500);
    expect(asked(seen, '/portal/context')).toBe(0);
  });

  for (const p of ['settings', 'files', 'analytics']) {
    test(`${p} no longer asks a second time itself`, async ({ page }) => {
      const seen = watch(page);
      await installApp(page, { api: API });
      await page.goto('/' + p + '.html');
      await expect(page.locator('#dds-bell')).toBeVisible();
      await page.waitForTimeout(1500);
      expect(asked(seen, '/portal/context')).toBe(1);
    });
  }

  test('a copy older than two minutes is used at once, read again behind the page, and the menu follows a change', async ({ page }) => {
    const seen = watch(page);
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await expect(page.locator('#dds-bell .dot')).toHaveText('3');
    await ageKeptCopy(page, 3 * 60000);
    // the studio hid Projects from its menu in the meantime
    const nav = STUDIO_LEVEL_NAV.filter((s) => s.key !== 'projects');
    await page.route('**/functions/v1/presence/portal/context', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ctx({ nav, attention_count: 5 })) }));
    seen.length = 0;
    await page.goto('/customers.html');
    await expect(page.locator('#dds-bell .dot')).toHaveText('5');
    await expect(page.locator('a[href^="/projects.html"]')).toHaveCount(0);
    expect(asked(seen, '/portal/context')).toBe(1);
  });

  test('a copy older than half an hour is not used', async ({ page }) => {
    const seen = watch(page);
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await expect(page.locator('#dds-bell .dot')).toHaveText('3');
    await ageKeptCopy(page, 31 * 60000);
    seen.length = 0;
    await page.goto('/customers.html');
    await expect(page.locator('#dds-bell .dot')).toHaveText('3');
    expect(asked(seen, '/portal/context')).toBe(1);
  });

  test('a client’s pages keep their own copy, apart from the studio’s', async ({ page }) => {
    const seen = watch(page);
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await expect(page.locator('#dds-bell')).toBeVisible();
    seen.length = 0;
    await page.goto('/files.html?client=11111111-1111-4111-8111-111111111111');
    await expect(page.locator('#dds-bell')).toBeVisible();
    await page.waitForTimeout(800);
    expect(asked(seen, '/portal/context')).toBe(1);
  });

  test('signing out drops the copy', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await expect(page.locator('#dds-bell')).toBeVisible();
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('dds-ctx:')).length)).toBe(1);
    await page.evaluate(() => (window as unknown as { ddsContextForget: () => void }).ddsContextForget());
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('dds-ctx:')).length)).toBe(0);
    const src = await (await page.request.get('/shell.js')).text();
    expect(src).toMatch(/window\.ddsContextForget\(\);\s*if \(sb\) sb\.auth\.signOut\(\)/);
  });
});

test.describe('Settings: one round, and nothing asked twice', () => {
  test('usage and the menu are asked once per open; a menu change drops the kept menu', async ({ page }) => {
    const seen = watch(page);
    await installApp(page, { api: API });
    await page.goto('/settings.html');
    await expect(page.locator('#menu')).toBeVisible();
    await expect(page.locator('#team')).toBeVisible();
    await page.waitForTimeout(800);
    expect(asked(seen, '/agency/usage')).toBe(1);
    expect(asked(seen, '/agency/nav')).toBe(1);
    // an automation save repaints the section; the menu is not read again (finding C19)
    await page.locator('#sw-ack').click();
    await expect(page.locator('#sw-ack')).toHaveAttribute('aria-checked', /true|false/);
    await page.waitForTimeout(500);
    expect(seen.filter((s) => s === '/agency/nav')).toHaveLength(1);
    // hiding a menu area: the next page asks who-am-I again, so the menu is right
    await page.locator('[data-menu-key="projects"]').click();
    await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('dds-ctx:')).length)).toBe(0);
  });

  test('the studio details start with the who-am-I read, and the rest start together when it lands', async ({ page }) => {
    await installApp(page, { api: API });
    const order: string[] = [];
    let release: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; });
    await page.route('**/functions/v1/presence/portal/context', async (route) => { await held; await route.fallback(); });
    page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.includes('/functions/v1/presence/')) order.push(u.pathname.replace(/^.*\/functions\/v1\/presence/, '')); });
    await page.goto('/settings.html');
    await expect.poll(() => order.includes('/identity') && order.includes('/settings')).toBe(true);   // not waiting on who-am-I
    expect(order).not.toContain('/commerce/subscription');
    release();
    await expect.poll(() => ['/commerce/subscription', '/agency/members', '/agency/usage', '/sales/stages', '/agency/nav'].every((p) => order.includes(p))).toBe(true);
    await expect(page.locator('#f-name')).toHaveValue('Bright Studio');
  });
});

test('Home starts its own reads with /agency/me, not after it', async ({ page }) => {
  await installApp(page, { api: API });
  const order: string[] = [];
  let release: () => void = () => {};
  const held = new Promise<void>((r) => { release = r; });
  await page.route('**/functions/v1/presence/agency/me', async (route) => { await held; await route.fallback(); });
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.includes('/functions/v1/presence/')) order.push(u.pathname.replace(/^.*\/functions\/v1\/presence/, '')); });
  await page.goto('/agency.html');
  await expect.poll(() => ['/agency/needs-you', '/sales/summary', '/agency/portfolio', '/studio/customers', '/sales/receivables'].every((p) => order.includes(p))).toBe(true);
  release();
  await expect(page.locator('#needs')).toBeVisible();
  await page.waitForTimeout(800);
  // each read went out once: the early answer is the one the page used
  for (const p of ['/agency/needs-you', '/sales/summary', '/agency/portfolio', '/studio/customers', '/sales/receivables', '/sales/my-tasks']) expect(order.filter((o) => o === p), p).toHaveLength(1);
});

test('Files: a search asks for the list only; Refresh asks for all three (finding D5)', async ({ page }) => {
  const seen = watch(page);
  await installApp(page, { api: API });
  await page.goto('/files.html');
  await expect(page.locator('#q')).toBeVisible();
  expect(asked(seen, '/assets/collections')).toBe(1);
  expect(asked(seen, '/assets/health')).toBe(1);
  seen.length = 0;
  await page.locator('#q').fill('door');
  await expect.poll(() => seen.filter((s) => s.startsWith('/assets?') && s.includes('q=door')).length).toBe(1);
  await page.waitForTimeout(400);
  expect(asked(seen, '/assets/collections')).toBe(0);
  expect(asked(seen, '/assets/health')).toBe(0);
  seen.length = 0;
  await page.locator('#refreshBtn').click();
  await expect.poll(() => asked(seen, '/assets/collections') + asked(seen, '/assets/health')).toBe(2);
});
