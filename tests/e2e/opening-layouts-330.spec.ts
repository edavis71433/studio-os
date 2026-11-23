import { test, expect, Page } from '@playwright/test';
import { installApp } from './helpers/app';
import { mountCanvas, SETTINGS, API } from './helpers/editor';

// Builder item 330 (Figma section A, Nov 22 2026): Styles' "Front-page layout" row offers the three
// new openings beside the four there were, by their plain names. A pick saves hero_layout and is
// ticked; the picked one says in a line what it does, and that it opens as Type only until the
// site has a photo; on a touch screen every layout is a full 44px tap. The Business tab's words
// say the tagline is the headline under the new layouts. The drawing itself is the pure suite's
// (tests/presence/opening_layouts_330_test.mjs).
const NAMES = ['Classic', 'Photo beside text', 'Words over the photo', 'Words over a light photo', 'Split: words on a colour panel', 'Centred editorial', 'Type only'];

async function openLayouts(page: Page, settings: Record<string, unknown> = SETTINGS) {
  const mounted = await mountCanvas(page, { settings });
  await page.evaluate(() => (window as any).openSettingsPanel('styles'));
  const row = page.locator('#designCard .ins-heros');
  const tab = () => page.locator('#stylesSeg [data-stab="looks"]').click();
  await tab();
  await expect(row).toBeVisible();
  const pick = async (name: string) => { await tab(); await row.getByRole('button', { name, exact: true }).click(); };
  const says = () => page.locator('#designCard #heroSays');
  return { ...mounted, row, pick, says, tab };
}

test.describe('the front-page layouts in Styles (builder item 330)', () => {
  test('seven layouts by their plain names, the one in use ticked', async ({ page }) => {
    const { row, says } = await openLayouts(page);
    expect(await row.getByRole('button').allTextContents()).toEqual(NAMES.map((n, i) => (i === 0 ? `${n} ✓` : n)));
    await expect(says()).toHaveCount(0);   // Classic needs no line
    for (const n of NAMES) expect(n).not.toMatch(/—|_/);
  });

  test('each new one saves its layout, is ticked, and says what it does', async ({ page }) => {
    const { row, pick, says, puts, tab } = await openLayouts(page);
    await pick('Split: words on a colour panel');
    await expect.poll(() => puts.map((p) => p.hero_layout)).toEqual(['panel']);
    await tab();
    await expect(row.getByRole('button', { name: 'Split: words on a colour panel ✓' })).toBeVisible();
    await expect(says()).toHaveText('Your tagline as the headline, on a soft tint of your colour, with your photo running to the edge. Until your site has a photo, it opens as Type only.');
    await expect(page.getByText('Layout: Split: words on a colour panel. Publish to apply.')).toBeVisible();

    await pick('Centred editorial');
    await expect.poll(() => puts.map((p) => p.hero_layout)).toEqual(['panel', 'editorial']);
    await tab();
    await expect(row.getByRole('button', { name: 'Centred editorial ✓' })).toBeVisible();
    await expect(says()).toContainText('It reads best with the Centered header.');

    await pick('Type only');
    await expect.poll(() => puts.map((p) => p.hero_layout)).toEqual(['panel', 'editorial', 'type']);
    await tab();
    await expect(row.getByRole('button', { name: 'Type only ✓' })).toBeVisible();
    await expect(says()).toHaveText('Your tagline in big words on a band of your colour, then the facts your site has: reviews, today’s hours, your phone and the places you serve.');

    await pick('Classic');
    await expect.poll(() => puts.map((p) => p.hero_layout)).toEqual(['panel', 'editorial', 'type', '']);
    await tab();
    await expect(row.getByRole('button', { name: 'Classic ✓' })).toBeVisible();
    await expect(says()).toHaveCount(0);
  });

  test('a site with a photo hears nothing about Type only', async ({ page }) => {
    const { says } = await openLayouts(page, { ...SETTINGS, hero_layout: 'editorial', cover_media_id: 'm-1' });
    await expect(says()).toHaveText('Your tagline as a big centred headline, then up to three of your photos in a row. It reads best with the Centered header.');
  });

  test('every layout is a full 44px tap on a touch screen', async ({ page }) => {
    test.skip(!test.info().project.use.hasTouch, 'touch screens only: a mouse keeps the compact pills');
    const { row } = await openLayouts(page);
    const sizes = await row.getByRole('button').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().height));
    expect(sizes).toHaveLength(7);
    for (const h of sizes) expect(h).toBeGreaterThanOrEqual(44);
  });

  test('the Business tab says the tagline is the headline under a new layout', async ({ page }) => {
    await installApp(page, { api: { ...API, '/settings': { data: { ...SETTINGS, hero_layout: 'type' } } } as never });
    await page.goto('/presence.html#business');
    await expect(page.locator('#view-business [data-shows="tagline"]')).toHaveText('Shows as the big headline at the top of your home page.');
    await expect(page.locator('#view-business [data-shows="short_description"]')).toContainText('Shows under the headline at the top of your home page.');
  });

  test('under the older layouts the Business tab says what it always said', async ({ page }) => {
    await installApp(page, { api: { ...API, '/settings': { data: { ...SETTINGS, hero_layout: 'split' } } } as never });
    await page.goto('/presence.html#business');
    await expect(page.locator('#view-business [data-shows="tagline"]')).toHaveText('Shows under your name at the top of your home page.');
    await expect(page.locator('#view-business [data-shows="short_description"]')).not.toContainText('under the headline');
  });
});
