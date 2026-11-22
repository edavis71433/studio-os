import { test, expect, type Page } from '@playwright/test';
import { installApp, settled } from './helpers/app';
import { pinClock } from './helpers/clock';
import { mountCanvas, API, PAGED } from './helpers/editor';
import { smallTargets, say } from './helpers/tap-walk';

// ── Builder item 98, the editor's half: every control in the website editor is a finger-sized
// target on a touch screen too: Edit mode's bar and dock, the canvas's section toolbar and its
// add-a-section lines. The walk is the back office's (helpers/tap-walk.ts): for every control it
// presses the four edges of the 44x44 box centred on it. The made-up site is helpers/editor.ts's.
const canvas = async (page: Page) => (await (await page.locator('#designPreview').elementHandle())!.contentFrame())!;

test.describe('every editor control is a finger-sized target on a touch screen (builder item 98)', () => {
  test.beforeEach(() => { test.skip(!test.info().project.use.hasTouch, 'touch screens only: a mouse keeps the compact desktop sizes'); });

  test('Edit mode: the bar, the dock and everything round the canvas', async ({ page }) => {
    await mountCanvas(page);
    await settled(page);
    const small = await smallTargets(page);
    expect(small, say(small)).toEqual([]);
  });

  test('the canvas: a section’s toolbar and the add-a-section lines', async ({ page }) => {
    const { frame } = await mountCanvas(page);
    await frame.locator('#main > section').first().tap();   // a tap picks the section and brings up its tools
    await expect(frame.locator('#dds-dc-bar')).toHaveClass(/\bon\b/);
    const f = await canvas(page);
    let small = await smallTargets(f, '#dds-dc-bar');
    expect(small, say(small)).toEqual([]);
    expect(await f.locator('.dc-ins').count()).toBeGreaterThan(0);
    small = (await smallTargets(f, '#main')).filter((m) => m.el.startsWith('div.dc-ins'));
    expect(small, say(small)).toEqual([]);
  });

  // the Nov 8 review: "The Pages tab hides each page's status chip on phones, so a phone never shows
  // which pages have changes waiting". On a phone it keeps a dot in the chip's colour; the words stay.
  test('the Pages tab keeps each page’s status on a phone, as a dot', async ({ page }) => {
    test.skip((page.viewportSize()?.width || 0) > 760, 'a phone: wider screens show the whole chip');
    await installApp(page, { api: { ...API, '/settings': { data: PAGED } } as never });
    await page.goto('/presence.html#pages');
    const chip = page.locator('#view-pages .pg-row .hb-chip').first();
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText('Not live yet');   // still there for a screen reader
    const dot = await chip.locator('.d').boundingBox();
    expect(dot!.width).toBeGreaterThanOrEqual(8);
    expect(await chip.evaluate((n) => getComputedStyle(n).fontSize)).toBe('0px');   // the words don't take the row's room
  });

  // the editor's other tabs: the help buttons, checklist links, text toolbars, chips and switches
  for (const [name, hash, ready] of [['Today', 'today', '#view-today.on'], ['Pages', 'pages', '#view-pages.on'], ['Business', 'business', '#view-business.on']] as const) {
    test(`the ${name} tab`, async ({ page }) => {
      await pinClock(page, '2026-11-16T18:00:00Z');
      await installApp(page, { api: { ...API, '/settings': { data: PAGED } } as never });
      await page.goto(`/presence.html#${hash}`);
      await expect(page.locator(ready)).toBeVisible();
      await settled(page);
      const small = await smallTargets(page);
      expect(small, say(small)).toEqual([]);
    });
  }
});

test('the Add card’s chips on a phone fade where there are more, and the arrow moves them along (builder item 98)', async ({ page }) => {
  test.skip((page.viewportSize()?.width || 0) > 760, 'a phone: the Add card is a sheet there');
  await mountCanvas(page);
  await page.locator('#btnTrayOpen').click();
  const chips = page.locator('.tray-chips').first();
  await expect(chips).toBeVisible();
  const more = await chips.evaluate((n) => n.scrollWidth - n.clientWidth);
  test.skip(more < 8, 'these chips fit this phone');
  await expect(chips).toHaveClass(/dds-cue-r/);
  await expect(chips.locator(':scope > .dds-cue-more')).toBeAttached();
  await chips.evaluate((n) => { n.scrollLeft = n.scrollWidth; n.dispatchEvent(new Event('scroll')); });
  await expect(chips).not.toHaveClass(/dds-cue-r/);   // at the end, nothing more on the right
  await expect(chips).toHaveClass(/dds-cue-l/);
});
