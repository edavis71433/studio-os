import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_LEVEL_NAV, ALL_FEATURES } from './helpers/app';

// Builder list items 129 and 180 (Nov 2026): every client in one table, Semrush-style.
// The Sites cards and table show each site's visitors, Google clicks and health, last
// month against the month before, a drop in red, from GET /agency/site-numbers (the
// fixture's shape is foldSiteNumbers' in supabase/functions/presence/agency/site_numbers.ts;
// tests/presence/site_numbers_test.mjs covers the server). The numbers arrive after the
// cards; a failed read leaves the page exactly as it was. Fake names only.

const site = (over: Record<string, unknown>) => ({
  site_id: '', name: '', edition: 'presence', state: 'live', state_words: 'Live', address: '', domain: null, domain_registrar: null, domain_expires_at: null,
  plan: { key: 'presence', words: 'Website + tools', status: 'active', term: 'monthly', renews: { kind: 'renews', at: '2026-12-01T00:00:00Z' } },
  team: [{ who: 'owner@studio.example', email: 'owner@studio.example', side: 'studio', role: 'Owner', me: true, invited: false }],
  tags: [], published_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-05T00:00:00Z', unpublished_changes: false, billing_issue: false, opened_at: null, pinned: false, thumb: 'live', copied: null, no_owner: false, ...over });
const MAPLE = site({ site_id: 's1', name: 'Maple & Main Realty', address: 'https://maple.example', domain: 'maple.example', tags: ['realty'] });
const BLUEBIRD = site({ site_id: 's2', name: 'Bluebird Bakery', address: 'https://bluebird.example', domain: 'bluebird.example' });
const HARBOR = site({ site_id: 's3', name: 'Harbor Dental', edition: 'monitor', state: 'elsewhere', state_words: 'Hosted elsewhere', address: 'https://harbor.example', domain: 'harbor.example', thumb: null, plan: { key: 'presence_monitor', words: 'Watch', status: 'active', term: '', renews: { kind: 'none', at: null } }, published_at: null });
const ORTIZ = site({ site_id: 's4', name: 'Ortiz Photography', state: 'not_live', state_words: 'Not live yet', thumb: 'draft', published_at: null });
const NUMBERS = {
  data: {
    s1: { visitors: { value: 812, prior: 688 }, visitors_why: null, search: { value: 64, prior: 59 }, search_why: null, health: { score: 92, prior: 88, to_look_at: 2, day: '2026-11-11', prior_day: '2026-10-12' }, health_why: null },
    s2: { visitors: { value: 389, prior: 659 }, visitors_why: null, search: { value: 12, prior: 24 }, search_why: null, health: { score: 61, prior: 76, to_look_at: 7, day: '2026-11-11', prior_day: '2026-10-12' }, health_why: null },
    s3: { visitors: null, visitors_why: 'no_counter', search: { value: 210, prior: 198 }, search_why: null, health: { score: 74, prior: null, to_look_at: 4, day: '2026-11-11', prior_day: null }, health_why: null },
    s4: { visitors: null, visitors_why: 'not_live', search: null, search_why: 'not_connected', health: null, health_why: 'not_checked' },
  },
  month: '2026-10', prior_month: '2026-09', month_label: 'October', prior_label: 'September', partial: false,
};
const SITES_NAV = [STUDIO_LEVEL_NAV[0], { key: 'sites', label: 'Sites', items: [{ key: 'sites', label: 'Sites', href: '/sites.html' }, { key: 'domains', label: 'Domains', href: '/domains.html', hidden: true }] }, ...STUDIO_LEVEL_NAV.slice(1)];
const studioContext = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'agency', edition_name: 'Agency', edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false, capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: SITES_NAV, plan_key: 'agency', upsell: null } };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function openSites(page: Page, o: { numbers?: unknown; status?: number; delay?: number; display?: 'cards' | 'table' } = {}) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await installApp(page, { api: {
    '/portal/context': studioContext,
    '/agency/sites': { data: [MAPLE, BLUEBIRD, HARBOR, ORTIZ], partial: false, can_open: true, can_pin: true, can_duplicate: true, can_create: true, can_trash: true, trash: [], trash_days: 90 },
    '/agency/needs-you': { data: { rows: [], more: 0, rest: [], total: 0, empty_line: '', partial: false, own_site: true, next_by_site: {}, next_by_client: {} } },
  } as never });
  await page.route(/\/functions\/v1\/presence\/agency\/sites\/[^/]+\/thumb/, (route: Route) => route.fulfill(json({ data: { html: '<h1>Home</h1>', version: 'live' } })));
  await page.route(/\/functions\/v1\/presence\/agency\/site-numbers$/, async (route: Route) => {
    if (o.delay) await new Promise((r) => setTimeout(r, o.delay));
    await route.fulfill(json(o.numbers ?? NUMBERS, o.status ?? 200));
  });
  if (o.display) await page.addInitScript((v) => { try { localStorage.setItem('dds-display:sites', v); } catch { /* */ } }, o.display);
  await page.goto('/sites.html');
  await expect(page.locator('.scard').first()).toBeAttached();
  return errors;
}
const noSideScroll = async (page: Page) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, 'the page must not scroll sideways').toBeLessThanOrEqual(1);
};

test.describe('Sites numbers (builder list items 129 and 180)', () => {
  test('cards: visitors, Google clicks and health, last month against the month before, a drop in red', async ({ page }) => {
    const errors = await openSites(page, { display: 'cards' });
    const maple = page.locator('.scard[data-site="s1"] .snums');
    await expect(maple).toBeVisible();
    await expect(maple.locator('.snum .l')).toHaveText(['Visits · Oct', 'Search clicks', 'Health']);
    await expect(maple.locator('.snum .l').first()).toHaveAttribute('title', 'A person counts once a day: someone who comes back on three days is three visits.');
    await expect(maple.locator('.snum').nth(0)).toContainText('812');
    await expect(maple.locator('.snum').nth(0).locator('.dchip.up')).toContainText('18%');
    await expect(maple.locator('.snum').nth(0).locator('.dchip.up')).toHaveAttribute('title', 'Up 18% on September');
    await expect(maple.locator('.snum').nth(1).locator('.dchip.up')).toContainText('8%');
    await expect(maple.locator('svg.hring')).toHaveAttribute('aria-label', 'Health 92 out of 100');
    await expect(maple.locator('.snum').nth(2).locator('.dchip.up')).toContainText('4');
    const blue = page.locator('.scard[data-site="s2"] .snums');
    await expect(blue.locator('.dchip.down')).toHaveCount(3);
    await expect(blue.locator('.snum').nth(0).locator('.dchip.down')).toHaveAttribute('title', 'Down 41% on September');
    const down = await blue.locator('.dchip.down').first().evaluate((el) => getComputedStyle(el).color);
    const up = await maple.locator('.dchip.up').first().evaluate((el) => getComputedStyle(el).color);
    expect(down, 'a drop is red, a rise is not').not.toBe(up);
    await expect(blue.locator('.hring .arc')).toHaveClass(/poor/);
    const harbor = page.locator('.scard[data-site="s3"] .snums');
    await expect(harbor.locator('.snum').nth(0)).toContainText('No counter');
    await expect(harbor.locator('.snum').nth(2).locator('.nochg')).toHaveText('No change yet');   // no reading from a month ago yet
    await expect(page.locator('.scard[data-site="s4"] .snums')).toBeHidden();   // not live: its card already says so
    expect(errors).toEqual([]);
  });

  test('table: three number columns, the month in words, red drops, and Biggest drop first', async ({ page }) => {
    await openSites(page, { display: 'table' });
    const table = page.locator('#tableHost');
    await expect(table.locator('.tcap')).toContainText('October, compared with September. A drop is red.');
    await expect(table.locator('thead .thb')).toHaveText(['Site', 'Owner', 'Health', 'Visits', 'Search clicks', 'Plan', 'People', 'Last updated', 'Tags']);   // builder item 53 adds Owner and People
    const blue = table.locator('tbody tr', { hasText: 'Bluebird Bakery' });
    await expect(blue.locator('td.num .dchip.down')).toHaveCount(3);
    await expect(table.locator('tbody tr', { hasText: 'Harbor Dental' })).toContainText('No counter');
    const ortiz = table.locator('tbody tr', { hasText: 'Ortiz Photography' });
    await expect(ortiz).toContainText('After it goes live');
    await expect(ortiz).toContainText('Not connected');
    await table.locator('.tcap [data-sort="drop"]').click();
    await expect(table.locator('.tcap [data-sort="drop"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(table.locator('tbody tr td.name .n').first()).toHaveText('Bluebird Bakery');
    await expect(page.locator('#lmeta')).toContainText('Biggest drop first');
    await table.locator('.tcap [data-sort="drop"]').click();          // pressed again: the usual order
    await expect(page.locator('#lmeta')).toContainText('Pinned first');
    await table.locator('thead [data-sort="visitors"]').click();      // numbers sort biggest first
    await expect(table.locator('tbody tr td.name .n')).toHaveText(['Maple & Main Realty', 'Bluebird Bakery', 'Harbor Dental', 'Ortiz Photography']);
    await expect(table.locator('th[aria-sort="descending"]')).toHaveCount(1);
  });

  test('the pills: Dropped in October shows only the sites that fell', async ({ page }) => {
    await openSites(page, { display: 'cards' });
    const pill = page.locator('#fpills [data-filter="drops"]');
    await expect(pill).toHaveText(/Dropped in October\s*· 1/);
    await pill.click();
    await expect(page.locator('.scard:visible')).toHaveCount(1);
    await expect(page.locator('.scard:visible')).toContainText('Bluebird Bakery');
    await pill.click();
    await expect(page.locator('.scard:visible')).toHaveCount(4);
  });

  test('the numbers come after the cards; a failed read leaves the page as it was', async ({ page }) => {
    const errors = await openSites(page, { display: 'cards', delay: 600 });
    await expect(page.locator('.scard[data-site="s1"] .snums')).toBeHidden();     // the cards don't wait
    await expect(page.locator('.scard[data-site="s1"] .snums')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a failed numbers read: no strip, no number columns guessed, no errors', async ({ page }) => {
    const errors = await openSites(page, { display: 'table', status: 502, numbers: { error: 'agency_failed' } });
    await expect(page.locator('#tableHost tbody tr')).toHaveCount(4);
    await expect(page.locator('#tableHost .tcap')).toHaveCount(0);
    await expect(page.locator('#tableHost .dchip')).toHaveCount(0);
    await expect(page.locator('#fpills [data-filter="drops"]')).toHaveCount(0);
    expect(errors.filter((e) => !/502/.test(e))).toEqual([]);
  });

  test('phone width: the table stacks each site with its three numbers, nothing wider than the screen', async ({ page }) => {
    const isMobile = (page.viewportSize()?.width || 1280) < 761;
    test.skip(!isMobile, 'the stacked rows are the phone layout');
    await openSites(page, { display: 'table' });
    const row = page.locator('#tableHost tbody tr', { hasText: 'Maple & Main Realty' });
    await expect(row.locator('td.num')).toHaveCount(3);
    const boxes = await row.locator('td.num').evaluateAll((tds) => tds.map((td) => { const r = td.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }; }));
    expect(boxes[0].y, 'the three numbers share a row').toBe(boxes[1].y);
    expect(boxes[1].y).toBe(boxes[2].y);
    expect(boxes[0].x).toBeLessThan(boxes[1].x);
    await expect(row.locator('td.wide').first()).toBeHidden();
    const label = await row.locator('td.num').first().evaluate((td) => getComputedStyle(td, '::before').content);
    expect(label).toContain('Health');
    await noSideScroll(page);
  });

  test('phone width: the cards’ three numbers fit side by side', async ({ page }) => {
    await openSites(page, { display: 'cards' });
    const strip = page.locator('.scard[data-site="s2"] .snums');
    await expect(strip).toBeVisible();
    const w = await strip.locator('.snum').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
    expect(Math.min(...w)).toBeGreaterThan(60);
    await noSideScroll(page);
  });
});
