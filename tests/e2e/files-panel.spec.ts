import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp } from './helpers/app';

// Bold redesign — Files, part 2 (Figma "11 · Files", Nov 2026): the open file.
// On a computer it sits in a card beside the grid, not over it: the page makes
// room, nothing dims, the file's card is marked, and Tab moves freely (a region,
// not a dialog). On a phone it comes up as a sheet over the tab bar. In between,
// the slide-over stays. The panel leads with the photo, its name and the two
// things people do next: Edit photo and Use in an update.

const NOW = new Date().toISOString();
const id = (n: number) => `aaaaaaaa-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const base = { tags: [], asset_status: 'approved', state: 'approved', created_at: NOW, favorite: false, in_use: false, kind: 'image', mime: 'image/jpeg', bytes: 620000, width: 1600, height: 1100 };
const SHOP = { ...base, id: id(1), name: 'Shopfront at dusk', alt_text: 'The Brightline Studio shopfront', in_use: true, collection: 'Spring promo', tags: ['storefront', 'evening'] };
const TEAM = { ...base, id: id(2), name: 'Team photo', alt_text: 'The team' };
const PRIV = { ...base, id: id(3), name: 'Login screen', alt_text: 'Login screen', client_id: 'c1', client_name: 'Harbor Dental', client_private: true };
const PDF = { ...base, id: id(4), name: 'Price list', alt_text: 'Price list', kind: 'document', mime: 'application/pdf', width: undefined, height: undefined };
const detail = (a: Record<string, unknown>) => ({ data: { asset: a, usage: a.in_use ? [{ surface: 'cover', label: 'home page — the big photo at the top', live: true, site: true }] : [], usage_complete: true, versions: { has_history: false }, summary: { headline: '' } } });
const API = {
  '/assets/collections': { data: [{ name: 'Spring promo', count: 1 }] },
  '/assets/health': { data: { findings: [] } },
  '/assets': { data: { assets: [SHOP, TEAM, PDF], total: 3, shown: 3, policy: 'immediate' } },
  [`/assets/${SHOP.id}`]: detail(SHOP),
  [`/assets/${TEAM.id}`]: detail(TEAM),
  [`/assets/${PRIV.id}`]: detail(PRIV),
  [`/assets/${PDF.id}`]: detail(PDF),
};
const pinGrid = (page: import('@playwright/test').Page) => page.addInitScript(() => { try { localStorage.setItem('dds-display:files', 'grid'); } catch { /* */ } });
const open = async (page: import('@playwright/test').Page, name: string) => {
  await page.getByRole('button', { name: 'Open ' + name }).click();
  await expect(page.locator('#panel .ptitle')).toHaveText(name);
};

test.describe('Files — the open file (bold redesign, part 2)', () => {
  test('a computer: a card beside the grid — nothing dims, the page makes room, the file is marked', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'a computer-width layout');
    await page.setViewportSize({ width: 1440, height: 900 });
    await pinGrid(page);
    await installApp(page, { api: API });
    await page.goto('/files.html');
    await open(page, 'Shopfront at dusk');
    const panel = page.locator('#panel');
    await expect(panel).toHaveAttribute('role', 'region');
    await expect(panel).not.toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('#scrim')).toBeHidden();
    const tile = page.locator('.tile[data-open="' + SHOP.id + '"]');
    await expect(tile).toHaveAttribute('aria-current', 'true');
    const [p, g] = await Promise.all([panel.boundingBox(), page.locator('.grid').boundingBox()]);
    expect(g!.x + g!.width).toBeLessThanOrEqual(p!.x);   // beside the grid, never over it
    // another file swaps in, and the mark moves
    await open(page, 'Team photo');
    await expect(page.locator('.tile[data-open="' + TEAM.id + '"]')).toHaveAttribute('aria-current', 'true');
    await expect(tile).not.toHaveAttribute('aria-current', 'true');
    // Escape closes it, the page takes its room back, and focus returns to the file
    await page.keyboard.press('Escape');
    await expect(panel).not.toHaveClass(/\bon\b/);
    await expect(page.locator('html')).not.toHaveClass(/files-docked/);
    await expect(page.locator('.tile[data-open="' + TEAM.id + '"]')).toBeFocused();
  });

  test('a computer, in the table: the open file’s row is marked, and the mark moves', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'a computer-width layout');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => { try { localStorage.setItem('dds-display:files', 'table'); } catch { /* */ } });
    await installApp(page, { api: API });
    await page.goto('/files.html');
    await page.locator(`tr[data-open="${SHOP.id}"]`).click();
    await expect(page.locator('#panel .ptitle')).toHaveText('Shopfront at dusk');
    await expect(page.locator(`tr[data-open="${SHOP.id}"]`)).toHaveAttribute('aria-current', 'true');
    await page.locator(`tr[data-open="${TEAM.id}"]`).click();
    await expect(page.locator('#panel .ptitle')).toHaveText('Team photo');
    await expect(page.locator(`tr[data-open="${TEAM.id}"]`)).toHaveAttribute('aria-current', 'true');
    await expect(page.locator(`tr[data-open="${SHOP.id}"]`)).not.toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('tr[aria-current]')).toHaveCount(0);
  });

  test('a narrower computer: the header wraps beside the panel instead of squeezing + Add files', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'a computer-width layout');
    await pinGrid(page);
    await installApp(page, { api: API });
    for (const width of [1180, 1240, 1320]) {
      await page.setViewportSize({ width, height: 860 });
      await page.goto('/files.html');
      await open(page, 'Shopfront at dusk');
      const panel = (await page.locator('#panel').boundingBox())!;
      const [add, make, h1] = await Promise.all(['#add', '#makeImage', '#pagehead'].map((s) => page.locator(s).boundingBox()));
      expect(add!.height, `+ Add files on one line at ${width}`).toBeLessThan(50);
      expect(Math.abs(add!.y + add!.height / 2 - (h1!.y + h1!.height / 2)), `+ Add files beside the title at ${width}`).toBeLessThan(12);
      for (const b of [add!, make!]) expect(b.x + b.width, `clear of the panel at ${width}`).toBeLessThanOrEqual(panel.x);
      await page.keyboard.press('Escape');
    }
  });

  test('a computer: when the page makes room, a picked client stays in sight in the strip', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'a computer-width layout');
    await page.setViewportSize({ width: 1240, height: 860 });
    await pinGrid(page);
    const mine = [SHOP, { ...TEAM, client_id: 'c3', client_name: 'Blue Finch Café', project_id: 'p3' }];
    await installApp(page, { api: { ...API,
      '/assets/collections': { data: ['Brand', 'Spring promo', 'Menus', 'Signage', 'Team', 'Events'].map((name) => ({ name, count: 1 })) },
      '/assets': { data: { assets: mine, total: 2, shown: 2, policy: 'immediate' } } } });
    await page.goto('/files.html');
    const inView = () => page.evaluate(() => { const r = document.getElementById('rail')!.getBoundingClientRect(); const c = document.querySelector('#rail [data-client="c3"]')!.getBoundingClientRect(); return c.left >= r.left - 1 && c.right <= r.right + 1; });
    await page.locator('#rail [data-client="c3"]').click();
    await open(page, 'Team photo');   // the panel docks and the strip narrows
    await expect(page.locator('html')).toHaveClass(/files-docked/);
    expect(await inView()).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).not.toHaveClass(/files-docked/);
    expect(await inView()).toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);   // the strip scrolled, never the page
  });

  test('the keyboard: Enter opens a file once, Escape goes back to it, and Space picks in Select mode', async ({ page }) => {
    await pinGrid(page);
    await installApp(page, { api: API });
    let reads = 0;
    page.on('request', (r) => { if (new URL(r.url()).pathname.endsWith('/assets/' + SHOP.id)) reads++; });
    await page.goto('/files.html');
    const tile = page.locator(`.tile[data-open="${SHOP.id}"]`);
    await tile.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#panel .ptitle')).toHaveText('Shopfront at dusk');
    await page.waitForTimeout(300);
    expect(reads).toBe(1);   // not twice (shell.js clicks role=button tiles on Enter too)
    await page.keyboard.press('Escape');
    await expect(tile).toBeFocused();
    await page.locator('#selbtn').click();
    const pick = page.locator(`.tile[data-pick="${TEAM.id}"]`);
    await pick.focus();
    await page.keyboard.press(' ');
    await expect(page.locator('.bulkbar .cnt')).toHaveText('1 selected');
    await page.locator(`.tile[data-pick="${TEAM.id}"]`).focus();   // the grid re-drew
    await page.keyboard.press('Enter');
    await expect(page.locator('.bulkbar .cnt')).toHaveText('0 selected');   // one press, one change
  });

  test('a tablet keeps the slide-over: a dialog, the page dimmed', async ({ page }, info) => {
    test.skip(info.project.name !== 'tablet', 'the in-between width');
    await pinGrid(page);
    await installApp(page, { api: API });
    await page.goto('/files.html');
    await open(page, 'Shopfront at dusk');
    await expect(page.locator('#panel')).toHaveAttribute('role', 'dialog');
    await expect(page.locator('#panel')).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('#scrim')).toHaveClass(/\bon\b/);
  });

  test('a phone: a sheet from the bottom, over the tab bar', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone layout under test');
    await installApp(page, { api: API });
    await page.goto('/files.html');
    await open(page, 'Shopfront at dusk');
    await page.waitForTimeout(400);   // the sheet slides up
    const vp = page.viewportSize()!;
    const box = (await page.locator('#panel').boundingBox())!;
    expect(Math.abs(box.y + box.height - vp.height)).toBeLessThan(2);
    expect(box.width).toBeGreaterThanOrEqual(vp.width - 1);
    expect(box.height).toBeLessThan(vp.height);   // a sheet, not a page
    await expect(page.locator('#panel')).toHaveAttribute('aria-modal', 'true');
    const z = await page.evaluate(() => [Number(getComputedStyle(document.getElementById('panel')!).zIndex), Number(getComputedStyle(document.getElementById('dds-mbar') || document.body).zIndex) || 0]);
    expect(z[0]).toBeGreaterThan(z[1]);
    // its top edge shows in dark too, and the tags are labels at text size, not 44px buttons
    await expect(page.locator('#panel')).toHaveCSS('border-top-width', '1px');
    const tag = (await page.locator('#panel .tags .chip').first().boundingBox())!;
    expect(tag.height).toBeLessThan(32);
  });

  test('the panel leads with the photo, its name and the two next steps', async ({ page }) => {
    await pinGrid(page);
    await installApp(page, { api: API });
    await page.goto('/files.html');
    await open(page, 'Shopfront at dusk');
    const panel = page.locator('#panel');
    await expect(panel).toContainText('Photo · 605 KB · 1600×1100 · In Spring promo');
    await expect(panel.locator('.pacts > *')).toHaveText(['Edit photo', 'Use in an update']);
    await expect(panel.locator('#useUpdate')).toHaveAttribute('href', `/broadcasts.html?photo=${SHOP.id}`);
    // the next steps come before where it's used and the details
    const order = await panel.evaluate((p) => ['#editPhoto', '#whereUsed', '#f-alt', '#f-name'].map((s) => [...p.querySelectorAll('*')].indexOf(p.querySelector(s)!)));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Remove background and the rest are still there, below
    await expect(panel.getByRole('button', { name: 'Remove background' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Save details' })).toBeVisible();
  });

  test('Use in an update is only for a shared, live photo', async ({ page }) => {
    await pinGrid(page);
    await installApp(page, { api: { ...API, '/assets': { data: { assets: [SHOP, TEAM, PDF, { ...TEAM, id: id(5), name: 'Old sign', asset_status: 'archived' }], total: 4, shown: 4, policy: 'immediate' } }, [`/assets/${id(5)}`]: detail({ ...TEAM, id: id(5), name: 'Old sign', asset_status: 'archived' }) } });
    await page.goto('/files.html');
    await open(page, 'Price list');
    await expect(page.locator('#panel .pacts')).toHaveCount(0);   // a document: no photo steps
    await page.keyboard.press('Escape');
    await open(page, 'Old sign');
    await expect(page.locator('#panel #editPhoto')).toBeVisible();
    await expect(page.locator('#panel #useUpdate')).toHaveCount(0);   // archived
  });

  test('a client’s private photo offers no Use in an update', async ({ page }) => {
    await pinGrid(page);
    await installApp(page, { api: { ...API, '/assets': { data: { assets: [SHOP, PRIV], total: 2, shown: 2, policy: 'immediate' } } } });
    await page.goto('/files.html');
    await page.locator('[data-client="c1"]').click();
    await open(page, 'Login screen');
    await expect(page.locator('#panel #editPhoto')).toBeVisible();
    await expect(page.locator('#panel #useUpdate')).toHaveCount(0);
  });

  test('no serious/critical axe violations with a file open', async ({ page }) => {
    await pinGrid(page);
    await installApp(page, { api: API });
    await page.goto('/files.html');
    await open(page, 'Shopfront at dusk');
    const r = await new AxeBuilder({ page }).include('#panel').analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(', '))).toEqual([]);
  });
});

test.describe('Send an update — a photo from Files (bold redesign, part 2)', () => {
  const P = '11111111-2222-4333-8444-555555555555';
  const thumb = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#c9b6f0"/></svg>')}`;
  const BAPI = {
    '/broadcasts/segments': { data: { segments: [{ key: 'contacts', label: 'All contacts', description: 'Everyone.', count: 3 }] } },
    '/broadcasts': { data: { broadcasts: [] } },
    '/identity': { data: { business_name: 'Brightline Studio' } },
    '/assets': { data: { assets: [{ id: P, kind: 'image', mime: 'image/jpeg', alt_text: 'The shopfront at dusk', asset_status: 'approved', thumb }] } },
  };
  test('?photo=<id> puts it in the message on a line of its own, then forgets the link', async ({ page }) => {
    await installApp(page, { api: BAPI });
    await page.goto(`/broadcasts.html?photo=${P}`);
    await expect(page.locator('#bodytx')).toHaveValue(`![The shopfront at dusk](media:${P})\n`);
    await expect(page.locator('#livePv .mail-img img')).toHaveAttribute('alt', 'The shopfront at dusk');
    await expect(page.getByText('Your photo is in the message')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('photo')).toBeNull();
  });
  test('a photo that isn’t a shared one of yours says so and adds nothing', async ({ page }) => {
    await installApp(page, { api: BAPI });
    await page.goto('/broadcasts.html?photo=99999999-8888-4777-8666-555555555555');
    await expect(page.getByText('That photo can’t go in an update')).toBeVisible();
    await expect(page.locator('#bodytx')).toHaveValue('');
  });
});
