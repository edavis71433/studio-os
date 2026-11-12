import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp } from './helpers/app';

// Bold redesign — Files (Figma "11 · Files", Nov 2026). The second column of
// collections is gone: the kinds of file sit in one row beside the search
// (All files · Photos · Documents · Favorites, then On your site, Archive and More
// filters), and folders and clients are a strip of cards under it. The cards say
// where a file is (an On your site pill) and whose it is. The old hooks stay:
// [data-col] · [data-folder] · [data-client] · .n · aria-current.

const NOW = new Date().toISOString();
const id = (n: number) => `aaaaaaaa-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const base = { tags: [], asset_status: 'approved', state: 'approved', created_at: NOW, favorite: false, in_use: false, kind: 'image', mime: 'image/jpeg', bytes: 40000 };
const A = [
  { ...base, id: id(1), name: 'Brightline logo', alt_text: 'Logo', brand: true, in_use: true, favorite: true, collection: 'Brand' },
  { ...base, id: id(2), name: 'Shopfront at dusk', alt_text: 'Shopfront', in_use: true, collection: 'Spring promo' },
  { ...base, id: id(3), name: 'Bouquet', alt_text: 'Bouquet', client_id: 'c1', client_name: 'Juniper Floral Co.', project_id: 'p1' },
  { ...base, id: id(4), name: 'Waiting room', alt_text: 'Waiting room', in_use: true, client_id: 'c2', client_name: 'Harbor Dental', project_id: 'p2' },
  { ...base, id: id(5), name: 'Price list', alt_text: 'Price list', kind: 'document', mime: 'application/pdf' },
];
const API = {
  '/assets/collections': { data: [{ name: 'Brand', count: 1 }, { name: 'Spring promo', count: 1 }, { name: 'Templates', count: 2 }] },
  '/assets/health': { data: { findings: [] } },
  '/assets': { data: { assets: A, total: 6, shown: 5, live_count: 3, policy: 'immediate' } },
};
const pinGrid = (page: import('@playwright/test').Page) => page.addInitScript(() => { try { localStorage.setItem('dds-display:files', 'grid'); } catch { /* */ } });
const tiles = (page: import('@playwright/test').Page) => page.locator('.grid .tile');

test.describe('Files — one row of kinds and a strip of folders and clients (bold redesign)', () => {
  test('no second column: the kinds in the design’s order with their counts, then the chips', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/files.html');
    await expect(page.locator('.layout > nav')).toHaveCount(0);
    const kinds = page.getByRole('group', { name: 'Show' });
    await expect(kinds.locator('.ktrack [data-col]')).toHaveText([/All files\s*5/, /Photos\s*4/, /Documents\s*1/, /Favorites\s*1/]);
    await expect(kinds.locator('[data-col="all"]')).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('#useLens')).toHaveText(/On your site\s*3/);
    await expect(kinds.locator('[data-col="archive"] .n')).toHaveText('1');   // total 6 − 5 listed
    await expect(page.locator('#moreFilters')).toHaveAttribute('aria-expanded', 'false');
  });

  test('More filters opens the rest in place, and stays open while one of them is shown', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/files.html');
    const row = page.getByRole('group', { name: 'More filters' });
    await expect(row).toBeHidden();
    await page.locator('#moreFilters').click();
    await expect(page.locator('#moreFilters')).toHaveAttribute('aria-expanded', 'true');
    await expect(row.locator('[data-col]')).toHaveText([/Brand/, /Templates\s*2/, /Downloads\s*0/, /Client-private/, /Stock Library/]);
    await row.locator('[data-col="templates"]').click();
    await expect(page.locator('[data-col="templates"]')).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('group', { name: 'More filters' })).toBeVisible();   // open while Templates is shown
    await page.locator('[data-col="all"]').click();
    await expect(page.getByRole('group', { name: 'More filters' })).toBeHidden();
  });

  test('On your site is a lens over the list: it narrows, composes with a client, and lets go', async ({ page }) => {
    await pinGrid(page);
    await installApp(page, { api: API });
    await page.goto('/files.html');
    await expect(tiles(page)).toHaveCount(5);
    await page.locator('#useLens').click();
    await expect(page.locator('#useLens')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#useLens')).toBeFocused();
    await expect(tiles(page)).toHaveCount(3);
    await expect(page.locator('.grid')).not.toContainText('Price list');
    await page.locator('[data-client="c2"]').click();   // Harbor Dental's file is on the site
    await expect(tiles(page)).toHaveCount(1);
    await expect(page.locator('.grid')).toContainText('Waiting room');
    await page.locator('[data-client="c1"]').click();   // Juniper's is not
    await expect(page.locator('#root .empty')).toBeVisible();
    await page.locator('#useLens').click();
    await expect(tiles(page)).toHaveCount(1);
    await expect(page.locator('.grid')).toContainText('Bouquet');
  });

  test('folders and clients are cards: a count in words, initials, Studio for the studio’s own', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/files.html');
    const folders = page.getByRole('group', { name: 'Folders' });
    await expect(folders.locator('[data-folder="Spring promo"]')).toContainText('Spring promo');
    await expect(folders.locator('[data-folder="Spring promo"]')).toContainText('1 file');
    await expect(folders.locator('#newFolder')).toHaveText('＋ New folder');
    const clients = page.getByRole('group', { name: 'Clients' });
    await expect(clients.locator('[data-client="c1"] .av')).toHaveText('JF');   // "Co." isn't a name
    await expect(clients.locator('[data-client="c2"] .av')).toHaveText('HD');
    await expect(clients.locator('[data-client="c1"]')).toContainText('1 file');
    await expect(clients.locator('[data-client="studio"] .n')).toHaveText('3');
    await expect(clients.locator('[data-client=""]')).toHaveAttribute('aria-current', 'true');
  });

  test('the header holds the page’s actions: Table/Grid, Make an image, refresh, Select and + Add files', async ({ page }) => {
    await pinGrid(page);
    await installApp(page, { api: API });
    await page.goto('/files.html');
    const head = page.locator('.lhead .lrow1');
    for (const sel of ['#dispTable', '#dispGrid', '#makeImage', '#refreshBtn', '#selbtn', '#add']) await expect(head.locator(sel)).toBeVisible();
  });

  test('a card says where the file is and whose it is', async ({ page }) => {
    await pinGrid(page);
    await installApp(page, { api: API });
    await page.goto('/files.html');
    const card = (name: string) => page.locator('.grid .tile', { hasText: name });
    await expect(card('Shopfront at dusk').locator('.pill.good')).toHaveText('On your site');
    await expect(card('Bouquet').locator('.use')).toHaveText('Not on your site');
    await expect(card('Brightline logo').locator('.pill.brand')).toHaveText('Brand');
    await expect(card('Bouquet').locator('.who')).toContainText('Juniper Floral Co.');
    await expect(card('Waiting room').locator('.who .av')).toHaveText('HD');
    await expect(card('Shopfront at dusk').locator('.who')).toHaveCount(0);
  });

  test('a phone: the kinds and the strip each scroll sideways in one row; the page never does', { tag: '@layout' }, async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone layout under test');
    await installApp(page, { api: API });
    await page.goto('/files.html');
    await expect(page.locator('.ktrack [data-col]')).toHaveCount(4);
    const mids = await page.locator('.kinds > *').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; }));
    expect(Math.max(...mids) - Math.min(...mids)).toBeLessThan(3);   // one row (the track is a little taller than a chip)
    const strip = await page.locator('#rail').evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth, x: getComputedStyle(e).overflowX }));
    expect(strip.x).toBe('auto');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('no serious/critical axe violations on the filters and the strip', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/files.html');
    await page.locator('#moreFilters').click();
    const r = await new AxeBuilder({ page }).include('#filters').analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(', '))).toEqual([]);
  });

  // builder list item 150: the whole page, in light and dark
  for (const scheme of ['light', 'dark'] as const) {
    test(`no serious/critical axe violations on the whole page (${scheme})`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once, on desktop');
      await page.emulateMedia({ colorScheme: scheme });
      await installApp(page, { api: API });
      await page.goto('/files.html');
      await expect(page.locator('#filters')).toBeVisible();
      await page.waitForLoadState('networkidle');
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(', '))).toEqual([]);
    });
  }
});
