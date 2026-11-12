import { test, expect, Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Builder item 172, the Files half (bug hunt D9 to D12):
//  D9  Escape closes one thing at a time: backing out of a question keeps the open file.
//  D10 Two quick clicks show the file clicked last, and a closed panel stays closed.
//  D11 Un-starring a file in Favorites takes it off the list and the count; a failed star says so.
//  D12 "Review" on the attention line shows the files it counts, each with what it needs.

const NOW = new Date().toISOString();
const id = (n: number) => `bbbbbbbb-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const base = { tags: [], asset_status: 'approved', state: 'approved', created_at: NOW, favorite: false, in_use: false, kind: 'image', mime: 'image/jpeg', bytes: 420000, width: 1600, height: 1100 };
const SHOP = { ...base, id: id(1), name: 'Shopfront at dusk', alt_text: 'The shopfront at dusk', in_use: true, favorite: true };
const TEAM = { ...base, id: id(2), name: 'Team photo', alt_text: 'The team', favorite: true };
const MENU = { ...base, id: id(3), name: 'Menu board', alt_text: '' };
const detail = (a: Record<string, unknown>) => ({ data: { asset: a, usage: a.in_use ? [{ surface: 'cover', label: 'home page — the big photo at the top', live: true, site: true }] : [], usage_complete: true, versions: { has_history: false }, summary: { headline: '' } } });
const API = {
  '/assets/collections': { data: [] },
  '/assets/health': { data: { findings: [] } },
  '/assets': { data: { assets: [SHOP, TEAM, MENU], total: 3, shown: 3, policy: 'immediate' } },
  [`/assets/${SHOP.id}`]: detail(SHOP),
  [`/assets/${TEAM.id}`]: detail(TEAM),
  [`/assets/${MENU.id}`]: detail(MENU),
};
const pinGrid = (page: Page) => page.addInitScript(() => { try { localStorage.setItem('dds-display:files', 'grid'); } catch { /* */ } });
const tile = (page: Page, a: { id: string }) => page.locator(`.tile[data-open="${a.id}"]`);
const panelOpen = (page: Page) => expect(page.locator('#panel')).toHaveClass(/\bon\b/);

test.describe('Files: small bugs (item 172, D9 to D12)', () => {
  test('D9: Escape on a question backs out of the question only, and the file stays open', async ({ page }) => {
    await pinGrid(page);
    await installApp(page, { api: API });
    await page.goto('/files.html');
    await tile(page, TEAM).click();
    await expect(page.locator('#panel .ptitle')).toHaveText('Team photo');
    await page.locator('#panel .acts').getByRole('button', { name: 'Delete' }).click();
    const ask = page.locator('dialog[open]');
    await expect(ask).toContainText('Delete this file permanently?');
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog')).toHaveCount(0);
    await panelOpen(page);
    await expect(page.locator('#panel .ptitle')).toHaveText('Team photo');
    // a second Escape, with nothing on top, closes the file
    await page.keyboard.press('Escape');
    await expect(page.locator('#panel')).not.toHaveClass(/\bon\b/);
  });

  test('D9: Escape that closes the shell’s search leaves the open file alone', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'the ⌘K search is a keyboard door');
    await pinGrid(page);
    await installApp(page, { api: API });
    await page.goto('/files.html');
    await tile(page, SHOP).click();
    await expect(page.locator('#panel .ptitle')).toHaveText('Shopfront at dusk');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    await expect(page.locator('.dds-palette.open')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.dds-palette.open')).toHaveCount(0);
    await panelOpen(page);
    await expect(page.locator('#panel .ptitle')).toHaveText('Shopfront at dusk');
  });

  test('D10: two quick clicks show the second file, even when the first answers last', async ({ page }, info) => {
    await pinGrid(page);
    await installApp(page, { api: API });
    let releaseShop: () => void = () => {};
    const shopHeld = new Promise<void>((r) => { releaseShop = r; });
    await page.route(`**/functions/v1/presence/assets/${SHOP.id}`, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await shopHeld;   // the first file's answer comes back after the second's
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail(SHOP)) });
    });
    await page.goto('/files.html');
    await tile(page, SHOP).click();
    // on a computer the file sits beside the grid, so the next one is a click away; on a
    // tablet or phone it covers the grid, so the quick way to the next one is close, then open
    if (info.project.name !== 'desktop-chromium') await page.keyboard.press('Escape');
    await tile(page, TEAM).click();
    await expect(page.locator('#panel .ptitle')).toHaveText('Team photo');
    releaseShop();
    await page.waitForTimeout(300);
    await expect(page.locator('#panel .ptitle')).toHaveText('Team photo');
    await expect(tile(page, TEAM)).toHaveAttribute('aria-current', 'true');
  });

  test('D10: a panel closed while its file loads stays closed and empty', async ({ page }) => {
    await pinGrid(page);
    await installApp(page, { api: API });
    let release: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; });
    await page.route(`**/functions/v1/presence/assets/${TEAM.id}`, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await held;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail(TEAM)) });
    });
    await page.goto('/files.html');
    await tile(page, TEAM).click();
    await panelOpen(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#panel')).not.toHaveClass(/\bon\b/);
    release();
    await page.waitForTimeout(300);
    await expect(page.locator('#panel .ptitle')).toHaveCount(0);
    expect(await page.evaluate(() => document.getElementById('panel')!.innerHTML)).toBe('');
  });

  test('D11: in Favorites, taking a star off takes the file off the list and the count', async ({ page }) => {
    await pinGrid(page);
    await installApp(page, { api: API });
    await page.goto('/files.html');
    const fav = page.locator('#filters [data-col="fav"]');
    await expect(fav.locator('.n')).toHaveText('2');
    await fav.click();
    await expect(page.locator('.tile[data-open]')).toHaveCount(2);
    await tile(page, TEAM).locator('[data-fav]').click();
    await expect(page.locator('.tile[data-open]')).toHaveCount(1);
    await expect(tile(page, TEAM)).toHaveCount(0);
    await expect(page.locator('#filters [data-col="fav"] .n')).toHaveText('1');
    // and back on All files the file is still there, without its star
    await page.locator('#filters [data-col="all"]').click();
    await expect(tile(page, TEAM)).toBeVisible();
  });

  test('D11: a star that doesn’t save says so, and stays as it was', async ({ page }) => {
    await pinGrid(page);
    await installApp(page, { api: API });
    await page.route(`**/functions/v1/presence/assets/${MENU.id}`, (route) => route.request().method() === 'PATCH'
      ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden', message: 'Your role can’t change files on this site.' }) })
      : route.fallback());
    await page.goto('/files.html');
    await expect(page.locator('#filters [data-col="fav"] .n')).toHaveText('2');
    await tile(page, MENU).locator('[data-fav]').click();
    await expect(page.getByText('Your role can’t change files on this site.')).toBeVisible();
    await expect(page.locator('#filters [data-col="fav"] .n')).toHaveText('2');
  });

  test('D12: Review shows only the files the line counts, each saying what it needs', async ({ page }) => {
    await pinGrid(page);
    await installApp(page, { api: { ...API, '/assets/health': { data: { findings: [
      { kind: 'missing_alt', asset_id: MENU.id, detail: '' },
      { kind: 'unused', asset_id: MENU.id, detail: '' },
      { kind: 'oversized', asset_id: TEAM.id, detail: '' },
      { kind: 'used_unapproved', asset_id: SHOP.id, detail: '' },   // not one the line counts
    ] } } } });
    await page.goto('/files.html');
    await expect(page.locator('.nudge')).toContainText('A few files could use attention');
    await expect(page.locator('.tile[data-open]')).toHaveCount(3);
    await page.locator('#tidy').click();
    await expect(page.locator('.tile[data-open]')).toHaveCount(2);
    await expect(tile(page, SHOP)).toHaveCount(0);
    await expect(tile(page, MENU).locator('.why')).toHaveText('Needs a description · Not on your site');
    await expect(tile(page, TEAM).locator('.why')).toHaveText('Large file');
    await expect(page.locator('.nudge')).toHaveCount(0);   // the view is the answer to the line
    await expect(page.locator('#attnDone')).toBeFocused();
    await page.locator('#attnDone').click();
    await expect(page.locator('.tile[data-open]')).toHaveCount(3);
    await expect(page.locator('.why')).toHaveCount(0);
    await expect(page.locator('.nudge')).toBeVisible();
  });

  test('D12: in the table the reasons sit under each name', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('dds-display:files', 'table'); } catch { /* */ } });
    await installApp(page, { api: { ...API, '/assets/health': { data: { findings: [{ kind: 'duplicate', asset_id: TEAM.id, detail: '' }] } } } });
    await page.goto('/files.html');
    await page.locator('#tidy').click();
    await expect(page.locator('tr[data-open]')).toHaveCount(1);
    await expect(page.locator(`tr[data-open="${TEAM.id}"] .why`)).toHaveText('Looks duplicated');
  });
});
