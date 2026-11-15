import { test, expect, Page, Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, STUDIO_LEVEL_NAV, ALL_FEATURES } from './helpers/app';

// Builder list item 210 (Nov 2026; review file 03, findings 1, 6 and 11): the Usage tab on
// Sites, as drawn in Figma (page 310:2, option A) and approved. The month in one band: the
// publishes that went up and what they cost at Netlify, the restores among them, the ones
// skipped because nothing had changed (item 208), the storage and last month's visits; then
// each client, most publishes first. The fixture's shape is foldUsage's in
// supabase/functions/presence/agency/usage.ts (usage_per_client_210_test.mjs covers the server).
// Fake names only.

const NOW = '2026-11-12T15:00:00Z';
const MB = 1024 ** 2;
const site = (over: Record<string, unknown>) => ({ site_id: '', name: '', edition: 'presence', state: 'live', state_words: 'Live', address: '', domain: null, ...over });
const SITES = [
  site({ site_id: 's1', name: 'Bluebird Bakery', address: 'https://bluebird.example' }),
  site({ site_id: 's2', name: 'Pine & Pour', address: 'https://pineandpour.example' }),
  site({ site_id: 's3', name: 'Harbor Dental', edition: 'monitor', state: 'elsewhere', state_words: 'Hosted elsewhere', address: 'https://harbor.example' }),
  site({ site_id: 's4', name: 'Ortiz Photography', state: 'not_live', state_words: 'Not live yet', address: '' }),
  site({ site_id: 's5', name: 'Maple Street Salon', address: 'https://maplestreet.example' }),
];
const use = (over: Record<string, unknown>) => ({ publishes: 0, restores: 0, skipped: 0, cost_cents: 0, publishes_why: null, burst: null, storage: { bytes: 10 * MB, files: 3 }, visits: { value: 100, prior: 100 }, visits_why: null, ...over });
const days = (busy: Record<string, number>) => Array.from({ length: 30 }, (_, i) => { const d = `2026-11-${String(i + 1).padStart(2, '0')}`; return { day: d, publishes: busy[d] || 0 }; });
const USAGE = {
  data: {
    s1: use({ publishes: 12, restores: 2, skipped: 1, cost_cents: 120, burst: { count: 8, day: '2026-11-09' }, storage: { bytes: 340 * MB, files: 120 }, visits: { value: 389, prior: 660 } }),
    s2: use({ publishes: 4, skipped: 1, cost_cents: 40, storage: { bytes: 260 * MB, files: 80 }, visits: { value: 1108, prior: 989 } }),
    s3: use({ publishes: null, publishes_why: 'hosted_elsewhere', storage: { bytes: 40 * MB, files: 9 }, visits: null, visits_why: 'hosted_elsewhere' }),
    s4: use({ publishes: 0, publishes_why: 'not_live', storage: { bytes: 135 * MB, files: 30 }, visits: null, visits_why: 'not_live' }),
    s5: use({ publishes: 3, cost_cents: 30, storage: { bytes: 150 * MB, files: 50 }, visits: { value: 812, prior: 688 } }),
  },
  totals: { publishes: 19, restores: 2, skipped: 2, cost_cents: 190, bytes: 925 * MB, files: 292, visits: 2309 },
  days: days({ '2026-11-02': 1, '2026-11-04': 2, '2026-11-09': 10, '2026-11-10': 3, '2026-11-11': 2, '2026-11-12': 1 }),
  month: '2026-11', month_label: 'November', visits_month: '2026-10', visits_label: 'October', prior_label: 'September',
  plan: { publishes: 330, cost_cents: 10 }, storage_limit: 1024 ** 3, partial: false,
};
const OCTOBER = { ...USAGE, month: '2026-10', month_label: 'October', days: Array.from({ length: 31 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, publishes: i === 20 ? 4 : 0 })),
  data: { ...USAGE.data, s1: use({ publishes: 1, cost_cents: 10, storage: { bytes: 300 * MB, files: 110 }, visits: { value: 389, prior: 660 } }), s2: use({ publishes: 3, cost_cents: 30, storage: { bytes: 250 * MB, files: 80 } }) },
  totals: { ...USAGE.totals, publishes: 4, restores: 0, skipped: 0, cost_cents: 40 } };
const USAGE_NAV = [STUDIO_LEVEL_NAV[0], { key: 'sites', label: 'Sites', items: [{ key: 'sites', label: 'Sites', href: '/sites.html' }, { key: 'usage', label: 'Usage', href: '/usage.html', hidden: true }] }, ...STUDIO_LEVEL_NAV.slice(1)];
const studioContext = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'agency', edition_name: 'Agency', edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false, capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: USAGE_NAV, plan_key: 'agency', upsell: null } };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function openUsage(page: Page, o: { usage?: unknown; status?: number } = {}) {
  const errors: string[] = [];
  const asked: string[] = [];
  const ctl = { status: o.status ?? 200, usage: o.usage ?? (USAGE as unknown) };   // a test may change the answer later
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.clock.setFixedTime(new Date(NOW));
  await installApp(page, { api: { '/portal/context': studioContext, '/agency/sites': { data: SITES, partial: false, can_open: true, can_create: true, trash: [], trash_days: 90 } } as never });
  await page.route(/\/functions\/v1\/presence\/agency\/usage(\?.*)?$/, (route: Route) => {
    const m = new URL(route.request().url()).searchParams.get('month') || '';
    asked.push(m);
    return route.fulfill(json(ctl.status === 200 && m === '2026-10' ? OCTOBER : ctl.usage, ctl.status));
  });
  await page.goto('/usage.html');
  return { errors, asked, ctl };
}
const noSideScroll = async (page: Page) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, 'the page must not scroll sideways').toBeLessThanOrEqual(1);
};

test.describe('Usage (builder list item 210)', () => {
  test('the month in one band: publishes and their cost, restores, skips, storage, visits, the busiest day', async ({ page }) => {
    const { errors } = await openUsage(page);
    const band = page.locator('.uband');
    await expect(band.locator('.eyebrow')).toHaveText('November so far · 1–12');
    await expect(band.locator('.big')).toHaveText('19 publishes');
    await expect(band.locator('.cost')).toHaveText('about $1.90 at Netlify');
    await expect(band.locator('.bars i')).toHaveCount(12);   // Nov 1 to today, not the days still to come
    await expect(band.locator('.bars i.peak')).toContainText('10 on Nov 9');
    await expect(band.locator('.chart')).toHaveAttribute('aria-label', 'Publishes each day: most on Nov 9, with 10.');
    await expect(band.locator('.axis')).toHaveText(/Nov 1\s*Nov 12 \(today\)/);
    await expect(band.locator('.gauge .gl')).toContainText('19 of about 330 publishes Netlify’s plan covers a month');
    await expect(band.locator('.gauge .gl')).toContainText('6%');
    const facts = band.locator('.fact');
    await expect(facts.nth(0)).toContainText('2 restores');
    await expect(facts.nth(0)).toContainText('already counted in the 19');
    await expect(facts.nth(1)).toContainText('2 skipped');
    await expect(facts.nth(1)).toContainText('because nothing had changed · about 20¢ saved');
    await expect(facts.nth(2)).toContainText('925 MB');
    await expect(facts.nth(3)).toContainText('2,309 visits');
    await expect(facts.nth(3)).toContainText('last month (October)');
    await expect(page.locator('.ufoot')).toContainText('A publish or restore costs about 10 cents at Netlify. When nothing changed, Studio OS doesn’t publish again, so it costs nothing.');
    expect(errors).toEqual([]);
  });

  test('each client, most publishes first, with what they cost, what they store and their visits', async ({ page }) => {
    await openUsage(page);
    const rows = page.locator('table.utable tbody tr');
    await expect(rows).toHaveCount(5);
    await expect(rows.locator('.cn')).toHaveText(['Bluebird Bakery', 'Pine & Pour', 'Maple Street Salon', 'Ortiz Photography', 'Harbor Dental']);
    const top = rows.nth(0);
    await expect(top).toHaveClass(/hot/);
    await expect(top.locator('.burst')).toHaveText('8 publishes in one hour on Nov 9');
    await expect(top.locator('.c-pub')).toContainText('12');
    await expect(top.locator('.c-pub .pd')).toHaveText(/≈ \$1\.20\s*2 restores · 1 skipped/);
    await expect(top.locator('.c-sto')).toContainText('340 MBof 1 GB');
    await expect(top.locator('.c-sto .meter i')).toHaveAttribute('style', 'width:33%');   // 340 MB of the 1 GB a site may keep
    await expect(top.locator('.c-vis .dchip.down')).toHaveAttribute('title', 'Down 41% on September');
    await expect(top.locator('a.open')).toHaveAttribute('href', '/today.html?client=s1');
    await expect(top.locator('a.open')).toHaveAttribute('aria-label', 'Open Bluebird Bakery');
    const ortiz = rows.filter({ hasText: 'Ortiz Photography' });
    await expect(ortiz.locator('.c-pub')).toContainText('Nothing to pay until it goes live');
    await expect(ortiz.locator('.c-vis')).toContainText('After it goes live');
    await expect(ortiz.locator('.ca')).toContainText('No address yet');
    const harbor = rows.filter({ hasText: 'Harbor Dental' });
    await expect(harbor.locator('.c-pub')).toContainText('Not published from here');
    await expect(harbor.locator('.c-pub')).toContainText('Their own host puts it live. No cost to you.');
    await expect(harbor.locator('.c-vis')).toContainText('No counter');
    await expect(page.locator('.unote')).toContainText('Publishes and storage: November 1 to 12. Visits: October, compared with September. A drop is red.');
    // the tab line, on this page and the three beside it
    const tabs = page.getByRole('navigation', { name: 'Sites, domains, templates and usage' });
    await expect(tabs.getByRole('link')).toHaveText(['Sites', 'Domains', 'Templates', 'Usage']);
    await expect(tabs.getByRole('link', { name: 'Usage' })).toHaveAttribute('aria-current', 'page');
  });

  test('sort by storage, visits or name; the choice is kept', async ({ page }) => {
    await openUsage(page);
    const names = page.locator('table.utable tbody tr .cn');
    await page.getByLabel('Sort').selectOption('store');
    await expect(page.locator('.ushead h2')).toHaveText('Each client, most storage first');
    await expect(names).toHaveText(['Bluebird Bakery', 'Pine & Pour', 'Maple Street Salon', 'Ortiz Photography', 'Harbor Dental']);
    await page.getByLabel('Sort').selectOption('visits');
    await expect(names.first()).toHaveText('Pine & Pour');
    await page.getByLabel('Sort').selectOption('name');
    await expect(names).toHaveText(['Bluebird Bakery', 'Harbor Dental', 'Maple Street Salon', 'Ortiz Photography', 'Pine & Pour']);
    await page.reload();
    await expect(page.getByLabel('Sort')).toHaveValue('name');
  });

  test('last month: asks for October and says so; a failed read keeps the month that was showing', async ({ page }) => {
    const { asked, ctl } = await openUsage(page);
    await page.getByRole('button', { name: 'Last month' }).click();
    await expect(page.getByRole('button', { name: 'Last month' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.uband .eyebrow')).toHaveText('October · 1–31');
    await expect(page.locator('.uband .big')).toHaveText('4 publishes');
    await expect(page.locator('.axis')).not.toContainText('today');
    await expect(page.locator('table.utable thead')).toContainText('Publishes in October');
    expect(asked).toEqual(['', '2026-10']);
    await expect(page.getByRole('button', { name: 'Last month' })).toBeFocused();
    // a read that fails: the month that was showing stays, and it says so
    ctl.status = 500; ctl.usage = { error: 'boom' };
    await page.getByRole('button', { name: 'This month' }).click();
    await expect(page.getByRole('button', { name: 'Last month' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.uband .big')).toHaveText('4 publishes');
  });

  test('a read that fails says so, with Try again', async ({ page }) => {
    const { ctl } = await openUsage(page, { status: 500, usage: { error: 'boom' } });
    await expect(page.getByRole('heading', { name: 'We couldn’t load the usage just now.' })).toBeVisible();
    ctl.status = 200; ctl.usage = USAGE;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('.uband .big')).toHaveText('19 publishes');
  });

  test('phone width: each client is a card, the first three until Show all; nothing wider than the screen', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'phone layout');
    await openUsage(page);
    const rows = page.locator('table.utable tbody tr');
    await expect(rows.nth(0)).toBeVisible();
    await expect(rows.nth(2)).toBeVisible();
    await expect(rows.nth(3)).toBeHidden();
    await expect(rows.nth(0).locator('td.c-pub')).toContainText('Publishes');
    await expect(rows.nth(0).locator('td.c-vis')).toContainText('Visits · Oct');
    const meter = await rows.nth(0).locator('td.c-sto .meter').boundingBox();
    expect(meter && meter.height, 'the storage meter is a thin bar').toBeLessThanOrEqual(8);
    await expect(page.getByRole('link', { name: '+ New site' })).toBeHidden();   // the phone header keeps the name and Refresh
    await noSideScroll(page);
    await page.getByRole('button', { name: 'Show all 5 sites' }).click();
    await expect(rows.nth(4)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show all 5 sites' })).toBeHidden();
    await noSideScroll(page);
  });

  test('wide screens show every client and no Show all', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'desktop and tablet');
    await openUsage(page);
    await expect(page.locator('table.utable tbody tr').nth(4)).toBeVisible();
    await expect(page.getByRole('button', { name: /Show all/ })).toBeHidden();
    await noSideScroll(page);
  });
});

test.describe('Usage accessibility (builder list item 210)', () => {
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once, on desktop'); });
  for (const scheme of ['light', 'dark'] as const) {
    test(`no serious/critical axe violations on Usage (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openUsage(page);
      await expect(page.locator('table.utable tbody tr')).toHaveCount(5);
      await page.waitForLoadState('networkidle');
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} (${v.nodes.length}): ${v.nodes.map((n) => n.target.join(' ') + ' ' + String(n.any[0]?.message || '').slice(0, 170)).join(' | ')}`);
      expect(bad).toEqual([]);
    });
  }
});
