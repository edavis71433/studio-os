import { test, expect, Page, Locator } from '@playwright/test';
import { installApp } from './helpers/app';

// Found Nov 9 while building item 39: in dark mode the shell turns its purple light
// (--dds-p) and gives the text on it a dark colour (--dds-on-p), but the Files page's
// own pop-ups kept white text on that purple, which read faintly. Their buttons are
// styled inline, where the shell can't reach. These pin the pairing in both themes.
// Its own spec file so open pull requests that add to the other Files specs don't collide.
const NOW = new Date().toISOString();
const id = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const file = (n: number) => ({
  id: id(n), name: `Photo ${n}`, kind: 'image', mime: 'image/jpeg', in_use: false, favorite: false, alt_text: `A clear description ${n}`,
  tags: [], collection: '', metadata: { title: `Photo ${n}` }, asset_status: 'approved', state: 'approved', bytes: 120000 + n, width: 800, height: 600, created_at: NOW,
});
const api = {
  '/assets/collections': { data: [{ name: 'Outside', count: 1 }] },
  '/assets/health': { data: { findings: [] } },
  '/assets': { data: { assets: [file(1), file(2)], total: 2, shown: 2, live_count: 0, policy: 'immediate' } },
};
const pinGrid = (page: Page) =>
  page.addInitScript(() => { try { localStorage.setItem('dds-display:files', 'grid'); } catch { /* denied */ } });

// WCAG contrast between an element's text colour and what it sits on: its background
// colour, or each colour of its gradient (the shell's filled buttons are gradients),
// taking the worst. 0 when it sits on nothing, so a missing background never passes.
const ownContrast = (el: Locator) => el.evaluate((node) => {
  const cs = getComputedStyle(node);
  const colours = (s: string) => [...s.matchAll(/rgba?\(([^)]+)\)/g)]
    .map((m) => m[1].split(',').map(Number)).filter((c) => c.length < 4 || c[3] > 0);
  const lum = ([r, g, b]: number[]) => {
    const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const fg = lum(colours(cs.color)[0]);
  const under = [...colours(cs.backgroundColor), ...colours(cs.backgroundImage)];
  if (!under.length) return 0;
  return Math.min(...under.map((bg) => { const b = lum(bg); return (Math.max(fg, b) + 0.05) / (Math.min(fg, b) + 0.05); }));
});

for (const scheme of ['dark', 'light'] as const) {
  test.describe(`Files in ${scheme} mode — text on the purple stays readable`, () => {
    test.use({ colorScheme: scheme });

    test('Add files, and a selected tile’s tick', async ({ page }) => {
      await pinGrid(page);
      await installApp(page, { api });
      await page.goto('/files.html');
      const add = page.locator('#add');
      await expect(add).toBeVisible();
      expect(await ownContrast(add), 'Add files').toBeGreaterThanOrEqual(4.5);

      await page.locator('#selbtn').click();
      await page.locator(`.tile[data-pick="${id(1)}"]`).click();
      const tick = page.locator('.tile.sel .check');
      await expect(tick).toBeVisible();
      expect(await ownContrast(tick), 'the selected tile’s tick').toBeGreaterThanOrEqual(3);   // an icon: 3:1 is the bar
    });

    test('the main button of the Move, Archive and Add tag pop-ups', async ({ page }) => {
      await pinGrid(page);
      await installApp(page, { api });
      await page.goto('/files.html');
      await page.locator('#selbtn').click();
      await page.locator(`.tile[data-pick="${id(1)}"]`).click();
      for (const [bulk, label] of [['collection', 'Move'], ['archive', 'Archive'], ['tag', 'Add tag']]) {
        await page.locator(`[data-bulk="${bulk}"]`).click();
        const main = page.locator('dialog').getByRole('button', { name: label, exact: true });
        await expect(main).toBeVisible();
        expect(await ownContrast(main), label).toBeGreaterThanOrEqual(4.5);
        await page.locator('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(page.locator('dialog[open]')).toHaveCount(0);
      }
    });
  });
}
